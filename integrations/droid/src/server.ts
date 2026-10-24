/**
 * Droid runner — tiny HTTP server that Convex calls when an incident closes.
 * Verifies the HMAC, runs the Droid after-action agent, streams the trace to
 * Convex (/droid/trace) as it goes, then posts the final report (/droid/report).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { IncidentPayload, runAfterAction } from './afterAction.js';
import { createJiraIssue } from './jira.js';

const PORT = Number(process.env.PORT ?? 8787);
const SECRET = process.env.DROID_WEBHOOK_SECRET ?? '';
const INTERNAL = process.env.BEACON_INTERNAL_SECRET ?? '';

async function postConvex(url: string, body: unknown) {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify(body) }).catch((e) => console.error('convex callback failed', e));
}

http
  .createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return res.writeHead(200).end('ok');
    if (req.method !== 'POST' || req.url !== '/incident-closed') return res.writeHead(404).end();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (SECRET) {
      const expected = createHmac('sha256', SECRET).update(raw).digest('hex');
      const got = String(req.headers['x-beacon-signature'] ?? '');
      if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return res.writeHead(401).end('bad signature');
    }
    const parsed = IncidentPayload.safeParse(JSON.parse(raw));
    if (!parsed.success) return res.writeHead(400).end(parsed.error.message);
    res.writeHead(202).end('accepted');

    const payload = parsed.data;
    const traceUrl = payload.callbackUrl.replace(/\/droid\/report$/, '/droid/trace');
    console.log(`[droid] incident ${payload.incidentId} closed → running after-action agent`);
    try {
      const out = await runAfterAction(payload, {
        onTrace: (t) => postConvex(traceUrl, { incidentId: payload.incidentId, kind: t.kind, text: t.text }),
        jira: (summary, description, labels) => createJiraIssue({ summary, description, labels }),
      });
      await postConvex(payload.callbackUrl, { incidentId: payload.incidentId, markdown: out.markdown, jiraKey: out.jira.key, jiraUrl: out.jira.url, trace: out.trace });
      console.log(`[droid] done ${payload.incidentId} (${out.trace.length} trace entries, jira=${out.jira.key ?? 'none'})`);
    } catch (e) {
      console.error('[droid] failed', e);
      await postConvex(payload.callbackUrl, { incidentId: payload.incidentId, status: 'failed' });
    }
  })
  .listen(PORT, () => console.log(`Beacon Droid runner on :${PORT}  (POST /incident-closed)`));
