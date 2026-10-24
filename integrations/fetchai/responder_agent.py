"""
A responder agent: represents one trained helper on the Fetch.ai network.
Registers with the dispatch agent and auto-accepts requests within its policy
(e.g. only cardiac/bleeding, only within 800 m) — or forwards to a human via
the Beacon PWA helper view. Run several with different seeds for the demo.
"""
from __future__ import annotations

import os

from uagents import Agent, Context
from dispatch_agent import HelpRequest, HelpResponse, ResponderRegister, proto

DISPATCH = os.environ["BEACON_DISPATCH_ADDRESS"]
NAME = os.environ.get("RESPONDER_NAME", "Priya (Nurse)")
SKILLS = os.environ.get("RESPONDER_SKILLS", "Nurse,CPR certified").split(",")
LAT = float(os.environ.get("RESPONDER_LAT", "37.7749"))
LNG = float(os.environ.get("RESPONDER_LNG", "-122.4194"))
AUTO_ACCEPT_M = float(os.environ.get("RESPONDER_AUTO_ACCEPT_M", "800"))

agent = Agent(name=f"responder-{NAME}", seed=os.environ.get("RESPONDER_SEED", f"seed-{NAME}"), port=int(os.environ.get("PORT", "8002")), endpoint=[f"http://localhost:{os.environ.get('PORT', '8002')}/submit"])


@agent.on_event("startup")
async def register(ctx: Context):
    await ctx.send(DISPATCH, ResponderRegister(responder_id=agent.address[-8:], name=NAME, skills=SKILLS, lat=LAT, lng=LNG, available=True))


@agent.on_interval(period=120.0)
async def heartbeat(ctx: Context):
    await ctx.send(DISPATCH, ResponderRegister(responder_id=agent.address[-8:], name=NAME, skills=SKILLS, lat=LAT, lng=LNG, available=True))


@proto.on_message(model=HelpRequest)
async def on_request(ctx: Context, sender: str, msg: HelpRequest):
    accept = msg.distance_m <= AUTO_ACCEPT_M
    ctx.logger.info(f"request {msg.incident_id} {msg.situation} {msg.distance_m} m → {'accept' if accept else 'decline'}")
    await ctx.send(sender, HelpResponse(request_id=msg.request_id, incident_id=msg.incident_id, responder_id=agent.address[-8:], name=NAME, status="accepted" if accept else "declined", eta_sec=int(msg.distance_m / 1.4) if accept else None))


agent.include(proto)

if __name__ == "__main__":
    agent.run()
