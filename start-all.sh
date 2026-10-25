#!/bin/bash
# Relaunch everything the demo needs from the laptop (phone app lives on Vercel). Run: ./start-all.sh
B=~/Downloads/beacon; F=$B/integrations/fetchai; D=agent1qt3la3s0tayy27t8n2mt686phvdmarmfcfsyqr9m0ahqm5y77vjzzt9hvlx
run() { osascript -e "tell application \"Terminal\" to do script \"printf '\\\\e]1;$1\\\\a'; $2\"" >/dev/null; }
run convex       "cd $B && npx convex dev"
run droid        "cd $B/integrations/droid && PORT=8787 BEACON_INTERNAL_SECRET=change-me npm start"
run tunnel-droid "sleep 3; cloudflared tunnel --url http://localhost:8787"
run fetch        "cd $F && source .venv/bin/activate && BEACON_INTERNAL_SECRET=change-me python dispatch_agent.py"
run priya        "sleep 6; cd $F && source .venv/bin/activate && BEACON_DISPATCH_ADDRESS=$D RESPONDER_NAME='Priya (Nurse)' RESPONDER_LAT=37.8029 RESPONDER_LNG=-122.4484 PORT=8002 python responder_agent.py"
run sam          "sleep 6; cd $F && source .venv/bin/activate && BEACON_DISPATCH_ADDRESS=$D RESPONDER_NAME='Sam (EMT)' RESPONDER_SKILLS='EMT / paramedic,CPR certified' RESPONDER_LAT=37.8031 RESPONDER_LNG=-122.4480 PORT=8003 python responder_agent.py"
run tunnel-fetch "sleep 3; cloudflared tunnel --url http://localhost:8001"
run caffeinate   "caffeinate -dis"
echo "Launched. Find the two tunnel URLs in the tunnel-* windows, put them in demo-day.sh, run ./demo-day.sh"
