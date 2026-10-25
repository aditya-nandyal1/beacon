"""
Beacon helper-dispatch agent (Fetch.ai uAgents).

Convex POSTs incident packets to /incident. The agent geo-matches registered
responder agents by skill + distance, fans out HelpRequests, and relays
HelpResponses back to Convex so the victim's coach can say "a nurse is on the way".
Responders are discovered via the beacon-help protocol (published to the Almanac),
so third-party agents can join without being Beacon users.
"""
from __future__ import annotations
import math, os, time, uuid
from typing import Dict, Optional
import requests
from uagents import Agent, Context, Model, Protocol
from models import HelpRequest, HelpResponse, LocalFirstResolver, ResponderRegister

AGENT_SEED = os.environ.get("BEACON_DISPATCH_SEED", "beacon-dispatch-dev-seed")
CONVEX_SECRET = os.environ.get("BEACON_INTERNAL_SECRET", "")
PORT = int(os.environ.get("PORT", "8001"))
MAX_RADIUS_M = float(os.environ.get("BEACON_HELPER_RADIUS_M", "1500"))

SKILL_FOR = {
    "cardiac_arrest": {"CPR certified", "Nurse", "EMT / paramedic", "Physician", "Lifeguard"},
    "opioid_overdose": {"CPR certified", "Nurse", "EMT / paramedic", "Physician"},
    "severe_bleeding": {"Stop the Bleed", "Nurse", "EMT / paramedic", "Physician", "First aid"},
    "choking_adult": {"CPR certified", "First aid", "Nurse", "EMT / paramedic"},
    "unresponsive_breathing": {"CPR certified", "Nurse", "EMT / paramedic", "Physician"},
}


def dist_m(a_lat, a_lng, b_lat, b_lng):
    r = 6371000.0
    d_lat = math.radians(b_lat - a_lat); d_lng = math.radians(b_lng - a_lng)
    s = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(s))


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


responders: Dict[str, ResponderRegister] = {}
last_seen: Dict[str, float] = {}
pending: Dict[str, dict] = {}
known_endpoints: Dict[str, str] = {}

agent = Agent(name="beacon-dispatch", seed=AGENT_SEED, port=PORT,
              endpoint=[f"http://localhost:{PORT}/submit"], resolve=LocalFirstResolver(known_endpoints))
proto = Protocol(name="beacon-help", version="0.2.0")


def post_convex(url: str, body: dict, log):
    if not url:
        return
    try:
        requests.post(url, json=body, headers={"authorization": f"Bearer {CONVEX_SECRET}"}, timeout=8)
    except Exception as e:  # noqa: BLE001
        log.warning(f"convex callback failed: {e}")


@proto.on_message(model=ResponderRegister)
async def on_register(ctx: Context, sender: str, msg: ResponderRegister):
    responders[sender] = msg
    last_seen[sender] = time.time()
    known_endpoints[sender] = msg.endpoint
    ctx.logger.info(f"responder {msg.name} ({', '.join(msg.skills)}) {'available' if msg.available else 'offline'} @ {msg.endpoint}")


@proto.on_message(model=HelpResponse)
async def on_response(ctx: Context, sender: str, msg: HelpResponse):
    p = pending.get(msg.request_id)
    if not p:
        return
    ctx.logger.info(f"{msg.name} → {msg.status} for incident {msg.incident_id}")
    post_convex(p["callback"], {"incidentId": msg.incident_id, "helperName": msg.name, "helperId": msg.responder_id,
                                "status": msg.status, "distanceM": p["distance_m"], "etaSec": msg.eta_sec}, ctx.logger)


agent.include(proto, publish_manifest=True)


@agent.on_rest_post("/incident", IncidentPacket, Ack)
async def on_incident(ctx: Context, req: IncidentPacket) -> Ack:
    request_id = str(uuid.uuid4())
    loc = req.location or {}
    lat, lng = loc.get("lat"), loc.get("lng")
    if lat is None or lng is None:
        ctx.logger.warning(f"incident {req.incidentId}: no location, cannot dispatch")
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
        await ctx.send(addr, HelpRequest(request_id=request_id, incident_id=req.incidentId, situation=req.situation,
                                         severity=req.severity, summary=req.summary, lat=lat, lng=lng,
                                         distance_m=round(d), live_link=req.liveLink))
        post_convex(req.callbackUrl, {"incidentId": req.incidentId, "helperName": r.name, "helperId": r.responder_id,
                                      "status": "notified", "distanceM": round(d), "etaSec": int(d / 1.4)}, ctx.logger)
        notified += 1
    ctx.logger.info(f"incident {req.incidentId} ({req.situation}, {req.severity}) → notified {notified} of {len(responders)} responders")
    return Ack(requestId=request_id, notified=notified)


@agent.on_event("startup")
async def startup(ctx: Context):
    ctx.logger.info(f"Beacon dispatch agent address: {agent.address}")


if __name__ == "__main__":
    agent.run()
