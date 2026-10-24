# Devpost draft — Beacon

**Tagline:** Point your phone at the emergency. Beacon sees it, talks you through it, shows you where to put your hands, and gets help moving.

## Inspiration
Survival from cardiac arrest drops ~10% per minute without CPR, and most bystanders freeze — not because they don't care, but because nobody is telling them what to do *right now*. 911 dispatchers do this brilliantly over the phone, but they can't see the scene and they can't show you anything. We built the dispatcher that can.

## What it does
Open Beacon and point the camera. It detects emergencies (collapse, bleeding, choking signs, fire, smoke, flood, downed lines, crashes), picks the right protocol, and coaches you by voice — one short instruction at a time, conversationally, while your hands are busy. An AR overlay shows hand placement and a visible 110 bpm beat for CPR, highlights the AED or exit it spotted, and points you away from hazards. It keeps pushing you to the one-tap 911 call, sends a structured packet to a dispatch data channel, texts your emergency contacts a live link, and pings the closest trained helpers through a Fetch.ai agent mesh — who can talk in the same channel. When it's over, a Factory Droid agent writes the after-action report, audits the coaching against the protocol, and files a Jira follow-up — and shows you every step it took.

## How we built it
React PWA (camera, AR canvas, Cartesia TTS/STT over WebSockets with barge-in) → Convex (reactive incident state, actions, scheduler, HTTP webhooks) → Claude (schema-constrained vision triage + coaching, guard-railed by 18 hand-written protocol graphs) with Bitdeer as a hot fallback. Apify actor for nearest AED/hospital; Bright Data Unlocker for live NWS alerts and road closures; Elastic for incident search; Fetch.ai uAgents for helper dispatch; Factory Droid SDK + Jira for after-action.

## Challenges
Turn-taking latency with hands busy (solved with client VAD + Cartesia `finalize` + streamed PCM); stopping the model from inventing medicine (protocol graphs as the only source of spoken steps, pointer-only moves validated server-side); false positives vs false negatives (two-frame agreement, severity-tuned thresholds, one-tap cancel); making an autonomous agent trustworthy (sandboxed Droid with deny-by-default permissions and a visible trace).

## What we learned
The hard part of an emergency copilot isn't the model — it's the thousand ways it must *not* fail: no vendor can be a single point of failure, no instruction can be improvised, and the user must always know what the system did on their behalf.

## What's next
On-device first-pass detection for no-signal use, certified NG911 integration, clinical review of the protocol library, localisation (protocols are data; Claude and Cartesia already speak the languages), and the glasses client — the architecture is already voice-first with a pluggable capture/render surface.

## Built with
anthropic · cartesia · convex · factory-droid-sdk · fetch.ai · apify · bright-data · elastic · jira · bitdeer · react · vite · typescript · python

---

## Two-minute pitch (spoken)

"Four minutes. That's how long a brain lasts without oxygen, and it's about how long before an ambulance arrives — if you're lucky. In those four minutes, most people do nothing. Not because they don't care. Because nobody is telling them what to do.

*[teammate lies down; phone on table]* This is Beacon. *[it speaks]* It saw him, it decided this is a collapse, and it's already coaching — from AHA protocol text, not improvised. *[tap 911]* It never dials for you; it makes sure you do, and sends dispatch the packet it already built. *[hands on chest]* That ring is where my hands go. That beat is 110 a minute — I can see it and feel it. *[hands too low → correction]* It's watching my form. *[second phone buzzes → "I'm coming" → first phone speaks]* That's a nurse a hundred metres away, pulled in by a Fetch.ai agent, talking in my channel. *["Paramedics are here"]* And now a Droid agent writes the report, audits what I was told against the protocol, and files the follow-up — and shows me every step.

Everything you heard is Cartesia. Everything it decided is Claude, inside guardrails we wrote and tested. Everything it remembered is Convex. And if any vendor had gone down mid-CPR, it would have fallen back — the beat never stops. Beacon."
