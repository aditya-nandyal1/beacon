# Runbook — setup, demo, failure drills

## Setup checklist (≈15 min)

1. `npm install && npx convex dev` (keep it running). Copy the deployment URL into `apps/web/.env.local` as `VITE_CONVEX_URL`.
2. `npx convex env set ANTHROPIC_API_KEY …` and `CARTESIA_API_KEY …`. Optional: `BITDEER_*`, `APIFY_*`, `BRIGHTDATA_*`, `ELASTIC_*`, `TWILIO_*`, `JIRA_*`, `FETCHAI_AGENT_ENDPOINT`, `DROID_WEBHOOK_URL/SECRET`, `BEACON_INTERNAL_SECRET`, `PUBLIC_APP_URL`, `CONVEX_SITE_URL` (your `*.convex.site` URL, used for webhook callbacks).
3. `npm run dev:web` and expose over HTTPS (`cloudflared tunnel --url http://localhost:5173`). Open on the demo phone, allow camera + mic + location, "Add to Home Screen".
4. Droid runner: install the `droid` CLI, `export FACTORY_API_KEY=…`, `cd integrations/droid && npm start` (port 8787), tunnel it, set `DROID_WEBHOOK_URL=https://…/incident-closed`.
5. Fetch.ai: `pip install -r integrations/fetchai/requirements.txt`, start `dispatch_agent.py`, then two `responder_agent.py` with lat/lng near the venue (Palace of Fine Arts ≈ 37.8029, -122.4484). Set `FETCHAI_AGENT_ENDPOINT`.
6. Apify: `apify push` the actor; set `APIFY_TOKEN` + `APIFY_AED_ACTOR_ID`.
7. Second phone (or laptop tab): open `/helper`, register as "Priya (Nurse)", go available.

## Two-minute demo (demo-first, one complete flow)

0:00 Phone propped on a table, app on "Start watching". A teammate lies down on the floor.
0:05 Beacon: *"I see someone on the floor who isn't moving. Kneel beside them, tap their shoulder and shout — are you okay?"* Red pill, 911 button appears.
0:15 You: "He's not answering." → *"Call 911 now — tap the red button. Anyone else here? Send them to the AED at the front desk, forty metres away."* (Apify chip turns green.) Tap the red button (on the demo phone, point `VITE_EMERGENCY_NUMBER` at a teammate's number).
0:30 "He's not breathing." → hand-position ring appears on his chest; *"Heel of your hand here…"* → metronome starts, ring pulses at 110.
0:45 Put your hands deliberately too low → within one re-check: *"Move your hands up — centre of the chest."* (Vision in the loop.)
1:00 Second phone buzzes: "cardiac arrest · 120 m". Tap **I'm coming**. First phone: *"A nurse is on the way, about two minutes."* (Convex + Fetch.ai.)
1:20 "Paramedics are here." → *"Step back and let them take over. You did everything right."* Screen flips to after-action; "Droid working…" → trace lines appear: plan → read packet → get_protocol_reference → write report → open_jira_followup → Jira key.
1:45 Close: *Everything you heard came from AHA protocol text — Claude chose the step and the words, never the medicine. No video was stored. And if Anthropic had gone down mid-CPR, it would have switched to Bitdeer, then to reading the step verbatim — the beat never stops.*

Backup flow (if the room is too dark for vision): tap **I'm in an emergency now**, say "there's a fire in the kitchen" → fire protocol, exit arrow, Bright Data closure/alert chips.

## Failure drills (practise these; judges may try one)

| Break | Expected behaviour |
|---|---|
| Revoke `ANTHROPIC_API_KEY` | Next turn comes from Bitdeer (pill in log shows provider); if that's also missing, the coach reads the step verbatim and logs `coach fallback`. |
| Kill Cartesia key | Pill switches to "Browser voice"; speech continues via SpeechSynthesis. |
| Airplane mode mid-incident | Camera loop pauses (`navigator.onLine`), last instruction stays on screen, metronome keeps ticking (local), 911 button still works (it's a `tel:` link). |
| Droid runner down | After-action shows the template report with a `fallback` trace entry. |
| No helpers nearby | `[0 helpers notified]` isn't shown; coach never promises help that isn't coming. |
| Point camera at a normal desk | `situation: none`; nothing opens. Point at a lying person → opens within two frames (~5 s). |
| Tap "False alarm" | Incident cancelled, no after-action, no Jira. |

## Observability

- Convex dashboard → `alerts` table: what went where and why not.
- `observations` table: every triage result with provider/model/latency — compute p50 time-to-detect from here.
- Elastic: `incident.dispatched` / `incident.closed` documents.
- Droid trace: `afterActionReports.agentTrace`.
