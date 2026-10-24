# Beacon — point your phone at the emergency

Beacon is an emergency copilot for bystanders. Open it, point the camera at what's happening, and it:

1. **Sees** the scene (Claude vision, every ~2.5 s): a collapsed person, blood, fire, smoke, floodwater, a downed line, a crash — and decides *whether* it's an emergency and *which kind*.
2. **Talks you through it** (Cartesia voice, both directions): one short instruction at a time, from vetted protocols (AHA hands-only CPR, Stop the Bleed, F.A.S.T., FEMA/NFPA), answering your questions conversationally while your hands are busy.
3. **Shows you** (AR overlay on the live camera): where the heel of your hand goes, a 110 bpm compression beat you can see and feel, the AED cabinet it spotted behind you, the exit, the hazard to move away from.
4. **Gets help moving**: a one-tap 911 button the coach keeps pushing you toward, a structured incident packet to a dispatch data channel, SMS to your emergency contacts with a live link, and a Fetch.ai agent that pings the closest trained helpers — who can join the incident channel.
5. **Learns**: when the incident closes, a Factory Droid agent writes an after-action report, checks the coaching against the protocol, opens a Jira follow-up, and shows every step it took.

It's a PWA, so it runs on any phone today, and the same code path works on camera glasses tomorrow (the UI is voice-first and the AR layer is a canvas over a video element).

> **This is a hackathon prototype, not a medical device.** It reads public first-aid guidance aloud and never replaces calling emergency services — which is why it never auto-dials and instead keeps steering the user to the one-tap call.

---

## Quick start

```bash
git clone <repo> beacon && cd beacon
npm install
npx convex dev            # creates a Convex deployment, writes CONVEX_URL, regenerates convex/_generated
cp .env.example .env      # then: npx convex env set ANTHROPIC_API_KEY sk-ant-...   (and CARTESIA_API_KEY)
echo "VITE_CONVEX_URL=$(grep CONVEX_URL .env.local | cut -d= -f2)" > apps/web/.env.local
npm run dev               # web on :5173 + convex dev
```

Open on a phone over HTTPS (use `npx vite --host` + a tunnel such as `cloudflared tunnel --url http://localhost:5173`; camera and mic need a secure origin). Tap **Start watching**.

**Minimum to demo:** `ANTHROPIC_API_KEY` + `CARTESIA_API_KEY`. Everything else is optional and degrades to a documented fallback (table below).

Run the tests: `npm test`. Typecheck everything: `npm run typecheck`.

---

## How the pieces fit

```
 phone (PWA, React)                         Convex (reactive backend, TypeScript)                      outside world
 ┌───────────────────────┐   JPEG ~70KB     ┌──────────────────────────────────────────────┐
 │ camera ─ motion gate ─┼────────────────▶ │ triage.analyzeFrame  ── Claude vision ───────┼──▶ Anthropic  (fallback: Bitdeer)
 │ AR canvas ◀───────────┼── assessment ─── │   └─ opens incident when 2 frames agree       │
 │                       │                  │ coach.respond / nudge / interject ── Claude ──┼──▶ Anthropic  (fallback: Bitdeer → local)
 │ Cartesia TTS ws ◀─────┼── token ──────── │ voice.cartesiaToken (5-min scoped token)      │
 │ Cartesia STT ws ──────┼── transcript ──▶ │                                               │
 │ tel:911 button ───────┼── markCalled ──▶ │ alerts.dispatchIncident ──────────────────────┼──▶ dispatch webhook · Twilio SMS · Fetch.ai agent · Elastic
 │ helper view (live) ◀──┼── subscriptions ─│ enrichment.enrichIncident ────────────────────┼──▶ Apify actor (AED finder) · Bright Data (NWS alerts, Caltrans closures)
 │ after-action view ◀───┼──────────────────│ afterAction.requestReport ── signed webhook ──┼──▶ Droid runner ── Factory Droid SDK ── Jira
 └───────────────────────┘                  │ http.ts: /droid/report /droid/trace /fetchai/helper-response
                                            └──────────────────────────────────────────────┘
```

Repo layout:

| Path | What |
|---|---|
| `packages/protocols` | The medical/disaster protocol graphs (18 protocols, every step ≤ 2 sentences, with AR hints). Unit-tested for graph integrity. The LLM may only *move a pointer* through these; it cannot invent steps. |
| `packages/agent` | Claude prompts, zod schemas, triage + coach logic, model router (Anthropic → Bitdeer → deterministic fallback). |
| `convex/` | Schema, incident state machine, actions, alert fan-out, enrichment, HTTP webhooks. |
| `apps/web` | The PWA: camera loop, AR overlay, Cartesia voice engine, incident UI, helper network UI, ops board. |
| `integrations/droid` | Factory Droid after-action runner (triggered by Convex). |
| `integrations/fetchai` | uAgents dispatch + responder agents. |
| `integrations/apify-aed-finder` | Apify actor: nearest AED / hospital / shelter for a coordinate. |
| `docs/` | Architecture decisions, track mapping, runbook, submission draft. |

---

## Where each sponsor technology does real work

| Technology | Role in the running product | If the key is missing |
|---|---|---|
| **Anthropic (Claude)** | Scene triage from camera frames (Sonnet) and every coaching turn; cheap re-checks of CPR hand position and new hazards (Haiku). Both are schema-constrained and guard-railed by the protocol graphs. | Bitdeer fallback; then deterministic step reading. |
| **Cartesia** | *Is* the interface. Sonic TTS streamed over WebSocket (first audio ≈150 ms, barge-in on interjections); Ink STT over WebSocket with client VAD + `finalize` for sub-second turn-taking. Browser gets a 5-minute scoped access token minted server-side, never the API key. | Web Speech API (noticeably worse; shown as "Browser voice"). |
| **Convex** | Everything stateful and reactive: incidents, transcript, alerts, helper responses, after-action reports. Camera analysis, coaching and fan-out are Convex actions; the helper's phone and the ops board update from subscriptions with no polling; webhooks are Convex HTTP routes. | — (required) |
| **Factory Droid SDK** | On the `incident closed` trigger, Convex signs a webhook to the Droid runner, which runs a Droid session pinned to a sandbox dir with autonomy=medium and a permission handler that allows only workspace file edits and two in-process MCP tools (`get_protocol_reference`, `open_jira_followup`). The agent writes the after-action report, audits the coaching against the protocol, opens one Jira issue, and streams its plan/tool calls/results back to Convex so the user sees exactly what it did. | Template report generated by Convex. |
| **Fetch.ai** | `dispatch_agent.py` receives the incident packet, geo-matches registered responder agents by skill and distance, fans out `HelpRequest`s and relays acceptances back so the coach can say "a nurse is three minutes away". Protocol published to Almanac so non-Beacon agents can join. | In-database geo-dispatch in `convex/helpers.ts`. |
| **Apify** | `beacon-aed-finder` actor (OSM + city AED registries, deduped, distance-sorted) run synchronously the moment a cardiac incident opens. Published as a standalone actor (Best Actor track). | Direct Overpass query. |
| **Bright Data** | Live public web context during disasters: NWS active alerts and Caltrans lane-closure feed fetched through the Web Unlocker so they succeed under load; blocks/timeouts/empty results handled explicitly and surfaced to the coach ("I'm checking live road closures"). | Direct fetch (works until rate-limited). |
| **Elastic** | Every dispatched/closed incident and after-action report is indexed; the ops board searches them with fuzzy multi-match. | Search returns a "not configured" note. |
| **Atlassian (Jira)** | Droid opens a tracked follow-up issue per incident (failed alert channel, protocol gap, missing AED data). | Skipped, noted in the trace. |
| **Bitdeer AI Model Studio** | OpenAI-compatible fallback for both vision triage and coaching when Anthropic errors or times out — emergencies don't wait on one vendor. | Skipped. |
| **Meta — bringing people closer** | The helper network: trained strangers nearby are pulled into the incident, can talk in the same channel, and the victim's coach narrates their arrival. | — |
| **Microsoft — built for the real world** | See *Responsible design* below. | — |

---

## Responsible design (what we deliberately did and didn't do)

- **Never auto-dials 911.** Software false positives would flood PSAPs and we can't carry context on a voice line we don't control. Instead: one-tap `tel:` button the coach keeps steering to, plus a structured packet to a dispatch *data* channel when one is configured.
- **No video is stored, ever.** Frames are analysed in memory and discarded; only the structured assessment persists. No accounts; an anonymous device id is the only identifier.
- **The model cannot invent medical steps.** Every instruction read aloud comes from `packages/protocols`; Claude chooses *which* step, phrases it for the moment, and answers questions from the step's detail/do-not text. Unknown step ids are rejected server-side.
- **Opens incidents on agreement, not single frames.** Two consecutive frames must agree (or one must be critical at ≥0.8 confidence). False negatives are treated as far costlier than false positives — a wrong alert costs ten seconds; the "False alarm" button is one tap.
- **Degrades, never dies.** Anthropic → Bitdeer → deterministic reader. Cartesia → browser speech. Apify → OSM. Fetch.ai → in-DB dispatch. Droid → template report. Every adapter records what it did (or why it skipped) in the `alerts` table, visible in the UI.
- **Agent blast radius is explicit.** Droid runs in a sandbox dir, can't run shell or reach the network, and reaches Jira only via a tool we control. Its full trace is shown to the user.
- **Hands-busy, eyes-busy UX.** Voice first; ≤ 2 sentences per turn; yes/no/not-sure buttons and a text box for when you can't talk; `aria-live` on the coach line; haptic + audible metronome.
- **After the incident**, the app points to 988 — bystanders carry these events.

Known limitations: single-frame vision can't see breathing (so the coach asks); bounding boxes are approximate; bystander-CPR hand-position feedback is advisory only; non-US emergency numbers via `VITE_EMERGENCY_NUMBER`; English only today (Cartesia and Claude are multilingual, so this is a config change).

---

## Deploy

```bash
npx convex deploy                      # backend
npm run build -w apps/web              # static PWA → apps/web/dist (host on Vercel/Netlify/Cloudflare Pages)
cd integrations/droid && npm start     # Droid runner (needs `droid` CLI + FACTORY_API_KEY); point DROID_WEBHOOK_URL at it
cd integrations/fetchai && python dispatch_agent.py
cd integrations/apify-aed-finder && apify push
```

See `docs/RUNBOOK.md` for the full checklist, demo script, and failure drills.
