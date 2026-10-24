# Beacon × Fetch.ai — helper dispatch mesh

`dispatch_agent.py` receives incident packets from Convex (`POST /incident`), geo-matches registered responder agents by skill and distance, fans out `HelpRequest`s, and relays `HelpResponse`s back to Convex (`/fetchai/helper-response`) so the victim's voice coach can say "a nurse is three minutes away".

`responder_agent.py` is one trained helper. Run a few with different `RESPONDER_*` env vars for the demo.

```bash
pip install -r requirements.txt
python dispatch_agent.py                       # prints its agent address
BEACON_DISPATCH_ADDRESS=agent1q... RESPONDER_NAME="Priya (Nurse)" python responder_agent.py
BEACON_DISPATCH_ADDRESS=agent1q... RESPONDER_NAME="Sam (EMT)" RESPONDER_SKILLS="EMT / paramedic" PORT=8003 python responder_agent.py
```

Then set in Convex: `npx convex env set FETCHAI_AGENT_ENDPOINT http://<host>:8001`.

The protocol (`beacon-help`) is published to the Almanac so third-party agents (campus safety, CERT coordinators, hospital on-call bots) can join without being Beacon users.
