# Architecture & decisions

## Why a PWA and not glasses (yet)

The track list rewards a working demo on a device judges can hold. A PWA gives camera, mic, speaker, haptics, geolocation and install-to-home-screen on every phone with zero app-store latency, and it's HTTPS-only which is what the browser Cartesia tokens need. The architecture is already glasses-shaped: voice is the primary channel, the AR layer is a canvas over a `<video>` element, and nothing on the phone is stateful — a glasses client would reuse `packages/agent` + the same Convex actions and simply swap the capture/render surface.

## The two loops

**Perception loop** (`apps/web/src/hooks/useIncidentEngine.ts` → `convex/triage.ts`)
- Capture ≤768 px JPEG q0.6 (~70 KB). A 32×18 thumbnail diff gates uploads while scanning so a static desk doesn't burn tokens.
- Cadence: 2.5 s scanning, 6 s during an incident (re-checks use the fast model and a re-check prompt that only looks for *changes* and CPR form).
- Server validates the model's JSON against `SceneAssessment` (zod), repairs once, clamps boxes, forces `callEmergencyServices` for protocols that require it.
- Incident opens when `shouldOpenIncident` (confidence ≥ a per-severity threshold) **and** either two of the last four frames agree or the frame is critical at ≥0.8.
- Opening schedules three things in parallel: enrichment, the opening coach line, and (if critical) alert fan-out.

**Conversation loop** (`apps/web/src/lib/voice.ts` → `convex/coach.ts`)
- STT final transcript → `coach.respond` → Claude with the full protocol graph in the system prompt + last 12 messages + current scene → `CoachTurn` JSON → appended to `messages` → every client subscribed to the incident gets it → the owner's phone speaks it.
- Client-side silence timer calls `coach.nudge` at the step's `remindEverySec` so a looping step (compressions) keeps talking.
- Camera interjections (`coach.interject`) go through the same path so the transcript is one linear truth.
- Barge-in: a new assistant message cancels in-flight TTS (`stopSpeaking` + server-side `cancel` on the TTS context).
- Half-duplex guard: mic frames are dropped while our own audio is scheduled, in addition to AEC.

## State machine

`incidents.status`: `open → resolved | cancelled`. Protocol pointer `(protocolId, stepId)` is only ever written by `applyTurn`, from a validated `CoachTurn`. The protocol graphs are the source of truth for what may be said; `validateProtocol` + tests enforce that every `next`/branch target exists and every step is reachable.

## Alert fan-out (`convex/alerts.ts`)

Idempotent per `(incident, channel)`. Order: dispatch data channel → SMS (high/critical only) → Fetch.ai (falls back to in-DB dispatch) → Elastic. Each writes an `alerts` row with `sent | failed | skipped` and the reason, which the UI shows — the user is never left guessing whether anything went out.

## Enrichment (`convex/enrichment.ts`)

Runs concurrently with the first coach turn. Apify actor (sync run, ≤20 s) → OSM fallback for AED/hospital/shelter; Bright Data Unlocker → direct fallback for NWS alerts + Caltrans closures. Results land in `incident.context` and, when material (AED < 300 m, active alert in a disaster), trigger a single coach interjection.

## After-action (Droid)

`incident closed` → `afterAction.requestReport` → HMAC-signed POST to the Droid runner → `createSession({ cwd: workspace, autonomyLevel: medium, mcpServers: [beacon], permissionHandler })` → agent reads the packet, calls `get_protocol_reference`, writes the report, calls `open_jira_followup` once → runner streams trace to `/droid/trace` and the report to `/droid/report`. Caps: 120 s wall clock, 25 tool calls. Failure → Convex writes a template report so the user always gets a timeline.

## Privacy & security

- No frames persisted. No accounts. Device id only.
- Cartesia API key never reaches the browser; 5-minute scoped tokens via a Convex action.
- Inbound webhooks: HMAC-SHA256 (dispatch, Droid) or bearer secret (Convex HTTP routes).
- Droid: sandbox cwd, deny-by-default permission handler, secrets only inside MCP tool handlers.
- Elastic documents contain the assessment and transcript but no media and no contact details.

## What would change for production

- Replace anonymous session ids with device attestation + optional account for helpers (background checks for the helper network are a policy problem, not a code one — the data model already carries `skills` and `available`).
- NG911 integration through a certified aggregator (RapidSOS/Intrado) instead of a generic webhook; same packet shape.
- On-device first-pass detector (person-down / fire / smoke) to cut frame uploads by ~90% and work with no signal; cloud model only confirms.
- Localisation: protocols are data; Claude + Cartesia already speak the languages.
- Clinical review of `packages/protocols` by a medical director; the step graphs are small, versioned, and testable precisely so that review is tractable.
