/**
 * Factory Droid — after-action agent.
 *
 * TRIGGER: Convex fires `afterAction.requestReport` when an incident closes
 *          (coach says "handed off", user taps False alarm, or a helper marks arrival).
 *          Convex POSTs a signed payload to this runner (server.ts).
 *
 * WHAT DROID DOES (real work, in the running product):
 *   1. Reads the incident packet + transcript + alert log.
 *   2. Writes a structured after-action report (timeline, what went well,
 *      protocol deviations, follow-ups) to workspace/reports/<id>.md.
 *   3. Opens a Jira issue for any follow-ups it found via an in-process MCP tool.
 *   4. Posts the report + its full visible trace (plan, each tool call, result)
 *      back to Convex so the user and judges can see exactly what the agent did.
 *
 * SAFETY / BLAST RADIUS:
 *   - cwd is pinned to ./workspace — Droid can only read/write there.
 *   - Autonomy is MEDIUM; every tool call goes through permissionHandler which
 *     allows file edits inside workspace/ and the two MCP tools, denies shell
 *     commands, network, and anything touching paths outside the workspace.
 *   - The agent never has credentials: Jira/Convex are reached only through the
 *     MCP tools we expose, which hold the secrets.
 *   - Hard cap on turns and wall-clock; failure → Convex falls back to a template report.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AutonomyLevel, DroidMessageType, ToolConfirmationOutcome, createSdkMcpServer, createSession, tool, type RequestPermissionRequestParams } from '@factory/droid-sdk';

export const IncidentPayload = z.object({
  incidentId: z.string(),
  incident: z.object({
    situation: z.string(), protocolId: z.string().nullable(), severity: z.string(), summary: z.string(),
    openedAt: z.number(), resolvedAt: z.number().optional(), resolution: z.string().optional(),
    calledEmergency: z.boolean(), calledAt: z.number().optional(), location: z.string().nullable(),
    context: z.record(z.unknown()), helpersEnRoute: z.number(),
  }),
  transcript: z.array(z.object({ at: z.number(), role: z.string(), content: z.string() })),
  alerts: z.array(z.object({ channel: z.string(), status: z.string(), at: z.number(), error: z.string().optional() })),
  callbackUrl: z.string(),
});
export type IncidentPayload = z.infer<typeof IncidentPayload>;

export interface Trace { at: number; kind: string; text: string }

const WORKSPACE = path.resolve(process.cwd(), 'workspace');

export async function runAfterAction(payload: IncidentPayload, opts: { onTrace: (t: Trace) => Promise<void> | void; jira: (summary: string, description: string, labels: string[]) => Promise<{ key?: string; url?: string; error?: string; skipped?: boolean }> }) {
  await mkdir(path.join(WORKSPACE, 'reports'), { recursive: true });
  const inputPath = path.join(WORKSPACE, 'reports', `${payload.incidentId}.input.json`);
  const reportPath = path.join(WORKSPACE, 'reports', `${payload.incidentId}.md`);
  await writeFile(inputPath, JSON.stringify(payload, null, 2));

  const trace: Trace[] = [];
  const push = async (kind: string, text: string) => {
    const t = { at: Date.now(), kind, text };
    trace.push(t);
    await opts.onTrace(t);
  };

  let jiraResult: { key?: string; url?: string } = {};

  // In-process MCP tools: the ONLY way the agent reaches Jira or reads protocol text.
  const tools = createSdkMcpServer({
    name: 'beacon',
    tools: [
      tool(
        'open_jira_followup',
        'Open ONE Jira issue summarising follow-up actions for this incident. Call at most once.',
        { summary: z.string().max(200), description: z.string().max(6000), labels: z.array(z.string()).max(6) },
        async ({ summary, description, labels }) => {
          if (jiraResult.key) return `Already opened ${jiraResult.key}; not opening another.`;
          const r = await opts.jira(summary, description, ['beacon', 'after-action', ...labels]);
          if (r.key) jiraResult = { key: r.key, url: r.url };
          await push('tool_call', `open_jira_followup → ${r.key ?? (r.skipped ? 'skipped (Jira not configured)' : `error: ${r.error}`)}`);
          return JSON.stringify(r);
        },
      ),
      tool(
        'get_protocol_reference',
        'Return the canonical protocol step text for a protocol id so you can check the coaching against it.',
        { protocolId: z.string() },
        async ({ protocolId }) => {
          const { getProtocol, isProtocolId, renderProtocolForPrompt } = await import('@beacon/protocols');
          const text = isProtocolId(protocolId) ? renderProtocolForPrompt(getProtocol(protocolId)) : 'unknown protocol';
          await push('tool_call', `get_protocol_reference(${protocolId})`);
          return text;
        },
      ),
    ],
  });

  // Blast-radius control: file tools only inside workspace/, plus our two MCP
  // tools. Shell, web, and anything outside the workspace are denied.
  const permissionHandler = async (params: RequestPermissionRequestParams) => {
    let allowAll = true;
    for (const tu of params.toolUses) {
      const name = tu.toolUse.name.toLowerCase();
      const input = tu.toolUse.input as Record<string, unknown>;
      const p = String(input.path ?? input.file_path ?? input.filePath ?? '');
      const inside = !p || path.resolve(WORKSPACE, p).startsWith(WORKSPACE);
      const fileTool = ['read', 'create', 'edit', 'write', 'ls', 'glob', 'grep'].some((k) => name.includes(k));
      const ok = (fileTool && inside) || name.includes('beacon') || name.startsWith('mcp__beacon');
      await push('permission', `${ok ? 'allow' : 'DENY'} ${tu.toolUse.name}${p ? ` ${p}` : ''}`);
      if (!ok) allowAll = false;
    }
    return allowAll ? ToolConfirmationOutcome.ProceedOnce : ToolConfirmationOutcome.Cancel;
  };

  const session = await createSession({
    cwd: WORKSPACE,
    autonomyLevel: AutonomyLevel.Medium,
    mcpServers: [tools],
    permissionHandler,
  });

  const prompt = `You are Beacon's after-action analyst. An emergency incident just closed.

Read ${path.relative(WORKSPACE, inputPath)} (the incident packet: assessment, transcript, alerts).
Then:
1. Call get_protocol_reference for the protocol used, and compare the coach's transcript against it.
2. Write ${path.relative(WORKSPACE, reportPath)} in Markdown with EXACTLY these sections:
   # After-action report — <situation>
   ## Summary (3 sentences, plain language)
   ## Timeline (one bullet per meaningful event with HH:MM:SS, derived from transcript timestamps)
   ## What went well
   ## Protocol deviations or gaps (be specific; "none found" is acceptable)
   ## Alerting (which channels fired, which failed and why)
   ## Follow-ups (checklist; include anything a safety team should fix — e.g. an alert channel that failed, a step the user struggled with, missing AED data)
3. If there is at least one follow-up, call open_jira_followup once with the checklist as the description and labels from: ["protocol", "alerting", "data", "ux"].
Rules: never invent facts not in the packet; mark unknowns as unknown; do not include personal data beyond what's in the packet; keep it under 600 words.`;

  const deadline = Date.now() + 120_000;
  let turns = 0;
  try {
    await push('plan', 'Session started with cwd=workspace, autonomy=medium, tools: read/write (workspace only), open_jira_followup, get_protocol_reference');
    for await (const msg of session.stream(prompt)) {
      if (Date.now() > deadline) {
        await push('error', 'wall-clock limit reached');
        await session.interrupt().catch(() => {});
        break;
      }
      if (msg.type === DroidMessageType.Assistant) {
        if (msg.text?.trim()) await push('thought', msg.text.trim().slice(0, 400));
      } else if (msg.type === DroidMessageType.ToolCall) {
        turns++;
        await push('tool_call', `${msg.toolUse.name} ${JSON.stringify(msg.toolUse.input ?? {}).slice(0, 200)}`);
        if (turns > 25) {
          await push('error', 'turn cap reached');
          await session.interrupt().catch(() => {});
          break;
        }
      } else if (msg.type === DroidMessageType.ToolResult) {
        await push('result', 'tool result received');
      } else if (msg.type === DroidMessageType.Error) {
        await push('error', JSON.stringify(msg).slice(0, 300));
      }
    }
  } finally {
    await session.close().catch(() => {});
  }

  const markdown = await readFile(reportPath, 'utf8').catch(() => '');
  await push(markdown ? 'result' : 'error', markdown ? `report written (${markdown.length} chars)` : 'no report written');
  return { markdown, trace, jira: jiraResult };
}
