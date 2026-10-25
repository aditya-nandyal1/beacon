"""One trained helper on the Fetch.ai network. Registers with dispatch and auto-accepts
nearby requests within its policy. Run several with different RESPONDER_* env vars."""
from __future__ import annotations
import os
from uagents import Agent, Context, Protocol
from models import HelpRequest, HelpResponse, LocalFirstResolver, ResponderRegister

DISPATCH = os.environ["BEACON_DISPATCH_ADDRESS"]
DISPATCH_ENDPOINT = os.environ.get("BEACON_DISPATCH_ENDPOINT", "http://localhost:8001/submit")
NAME = os.environ.get("RESPONDER_NAME", "Priya (Nurse)")
SKILLS = [s.strip() for s in os.environ.get("RESPONDER_SKILLS", "Nurse,CPR certified").split(",")]
LAT = float(os.environ.get("RESPONDER_LAT", "37.7749"))
LNG = float(os.environ.get("RESPONDER_LNG", "-122.4194"))
PORT = int(os.environ.get("PORT", "8002"))
AUTO_ACCEPT_M = float(os.environ.get("RESPONDER_AUTO_ACCEPT_M", "800"))
MY_ENDPOINT = f"http://localhost:{PORT}/submit"

agent = Agent(name=f"responder-{NAME}", seed=os.environ.get("RESPONDER_SEED", f"seed-{NAME}-{PORT}"), port=PORT,
              endpoint=[MY_ENDPOINT], resolve=LocalFirstResolver({DISPATCH: DISPATCH_ENDPOINT}))
proto = Protocol(name="beacon-help", version="0.2.0")


def registration() -> ResponderRegister:
    return ResponderRegister(responder_id=agent.address[-8:], name=NAME, skills=SKILLS, lat=LAT, lng=LNG, available=True, endpoint=MY_ENDPOINT)


@agent.on_event("startup")
async def on_start(ctx: Context):
    ctx.logger.info(f"{NAME} registering with dispatch {DISPATCH[:16]}… via {DISPATCH_ENDPOINT}")
    await ctx.send(DISPATCH, registration())


@agent.on_interval(period=60.0)
async def heartbeat(ctx: Context):
    await ctx.send(DISPATCH, registration())


@proto.on_message(model=HelpRequest)
async def on_request(ctx: Context, sender: str, msg: HelpRequest):
    accept = msg.distance_m <= AUTO_ACCEPT_M
    ctx.logger.info(f"request {msg.incident_id} {msg.situation} {msg.distance_m} m → {'ACCEPT' if accept else 'decline'}")
    await ctx.send(sender, HelpResponse(request_id=msg.request_id, incident_id=msg.incident_id, responder_id=agent.address[-8:],
                                        name=NAME, status="accepted" if accept else "declined",
                                        eta_sec=int(msg.distance_m / 1.4) if accept else None))


agent.include(proto)

if __name__ == "__main__":
    agent.run()
