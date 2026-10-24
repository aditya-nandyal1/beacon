"""
Beacon helper-dispatch agent (Fetch.ai uAgents).

Role in the product
-------------------
When Beacon's Convex backend decides an incident needs hands (coach sets
requestHelpers, or severity is high/critical), it POSTs the incident packet to
this agent. The agent keeps a registry of responder agents (people who opted in
with skills + coarse location), geo-matches the closest qualified ones, sends
each a `HelpRequest`, collects `HelpResponse`s, and reports decisions back to
Convex so the victim's coach can say "a nurse is three minutes away".

Why an agent and not a Convex query
-----------------------------------
Responders don't have to be Beacon users. Any uAgent (a hospital's on-call
bot, a campus safety agent, a CERT team coordinator) can speak the
HelpRequest/HelpResponse protocol and join the mesh via Agentverse / Almanac,
which is the point of an open agent network for public safety.

Run locally:   python dispatch_agent.py           (REST on :8001)
Deploy:        paste into Agentverse hosted agent, set env vars.
"""
from __future__ import annotations

import math
import os
import time
import uuid
from typing import Dict, List, Optional

import requests
from uagents import Agent, Context, Model, Protocol

AGENT_SEED = os.environ.get("BEACON_DISPATCH_SEED", "beacon-dispatch-dev-seed")
CONVEX_SECRET = os.environ.get("BEACON_INTERNAL_SECRET", "")
PORT = int(os.environ.get("PORT", "8001"))
MAX_RADIUS_M = float(os.environ.get("BEACON_HELPER_RADIUS_M", "1500"))


# ───────────────────────────── message models ─────────────────────────────
class ResponderRegister(Model):
    responder_id: str
    name: str
    skills: List[str]
    lat: float
    lng: float
    available: bool = True


class HelpRequest(Model):
    request_id: str
    incident_id: str
    situation: str
    severity: str
    summary: str
    lat: float
    lng: float
    distance_m: float
    live_link: str


class HelpResponse(Model):
    request_id: str
    incident_id: str
    responder_id: str
    name: str
    status: str  # accepted | declined | arrived
    eta_sec: Optional[int] = None


class IncidentPacket(Model):
    incidentId: str
    situation: str
    severity: str
    summary: str
    location: Optional[dict] = None
    liveLink: str = ""
    callbackUrl: str = ""


class Ack(Model):
    requestId: str
    notified: int


# ───────────────────────────── state ─────────────────────────────
responders: Dict[str, ResponderRegister] = {}
last_seen: Dict[str, float] = {}
pending: Dict[str, dict] = {}  # request_id -> {incident_id, callback, distance_m}

SKILL_FOR = {
    "cardiac_arrest": {"CPR certified", "Nurse", "EMT / paramedic", "Physician", "Lifeguard"},
    "opioid_overdose": {"CPR certified", "Nurse", "EMT / paramedic", "Physician"},
    "severe_bleeding": {"Stop the Bleed", "Nurse", "EMT / paramedic", "Physician", "First aid"},
    "choking_adult": {"CPR certified", "First aid", "Nurse", "EMT / paramedic"},
}


def dist_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r = 6371000.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    s = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(s))


agent = Agent(name="beacon-dispatch", seed=AGENT_SEED, port=PORT, endpoint=[f"http://localhost:{PORT}/submit"])
proto = Protocol(name="beacon-help", version="0.1.0")


@proto.on_message(model=ResponderRegister)
async def on_register(ctx: Context, sender: str, msg: ResponderRegister):
    responders[sender] = msg
    last_seen[sender] = time.time()
    ctx.logger.info(f"responder {msg.name} ({', '.join(msg.skills)}) {'available' if msg.available else 'offline'}")


@proto.on_message(model=HelpResponse)
async def on_response(ctx: Context, sender: str, msg: HelpResponse):
    p = pending.get(msg.request_id)
    if not p:
        return
    ctx.logger.info(f"{msg.name} → {msg.status} for incident {msg.incident_id}")
    if p["callback"]:
        try:
            requests.post(
                p["callback"],
                json={
                    "incidentId": msg.incident_id,
                    "helperName": msg.name,
                    "helperId": msg.responder_id,
                    "status": msg.status,
                    "distanceM": p["distance_m"],
                    "etaSec": msg.eta_sec,
                },
                headers={"authorization": f"Bearer {CONVEX_SECRET}"},
                timeout=8,
            )
        except Exception as e:  # noqa: BLE001
            ctx.logger.warning(f"convex callback failed: {e}")


agent.include(proto, publish_manifest=True)


# ───────────────────────────── REST entry from Convex ─────────────────────────────
@agent.on_rest_post("/incident", IncidentPacket, Ack)
async def on_incident(ctx: Context, req: IncidentPacket) -> Ack:
    request_id = str(uuid.uuid4())
    loc = req.location or {}
    lat, lng = loc.get("lat"), loc.get("lng")
    if lat is None or lng is None:
        return Ack(requestId=request_id, notified=0)

    wanted = SKILL_FOR.get(req.situation, set())
    cutoff = time.time() - 6 * 3600
    ranked = []
    for addr, r in responders.items():
        if not r.available or last_seen.get(addr, 0) < cutoff:
            continue
        if wanted and not (set(r.skills) & wanted):
            continue
        d = dist_m(lat, lng, r.lat, r.lng)
        if d <= MAX_RADIUS_M:
            ranked.append((d, addr, r))
    ranked.sort(key=lambda x: x[0])

    notified = 0
    for d, addr, r in ranked[:5]:
        pending[request_id] = {"incident_id": req.incidentId, "callback": req.callbackUrl, "distance_m": round(d)}
        await ctx.send(
            addr,
            HelpRequest(
                request_id=request_id, incident_id=req.incidentId, situation=req.situation, severity=req.severity,
                summary=req.summary, lat=lat, lng=lng, distance_m=round(d), live_link=req.liveLink,
            ),
        )
        # Tell Convex immediately who was pinged so the UI shows "3 helpers notified".
        if req.callbackUrl:
            try:
                requests.post(
                    req.callbackUrl,
                    json={"incidentId": req.incidentId, "helperName": r.name, "helperId": r.responder_id, "status": "notified", "distanceM": round(d), "etaSec": int(d / 1.4)},
                    headers={"authorization": f"Bearer {CONVEX_SECRET}"},
                    timeout=8,
                )
            except Exception:  # noqa: BLE001
                pass
        notified += 1
    ctx.logger.info(f"incident {req.incidentId} ({req.situation}) → notified {notified} responders")
    return Ack(requestId=request_id, notified=notified)


@agent.on_event("startup")
async def startup(ctx: Context):
    ctx.logger.info(f"Beacon dispatch agent address: {agent.address}")


if __name__ == "__main__":
    agent.run()
