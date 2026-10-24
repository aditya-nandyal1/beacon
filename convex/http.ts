import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

/**
 * Inbound webhooks from the agent runners. Both are authenticated with the
 * shared BEACON_INTERNAL_SECRET (HMAC when available, bearer otherwise).
 */
const http = httpRouter();

async function authed(req: Request): Promise<boolean> {
  const secret = process.env.BEACON_INTERNAL_SECRET;
  if (!secret) return true; // dev
  const h = req.headers.get('authorization') ?? '';
  return h === `Bearer ${secret}` || req.headers.get('x-beacon-secret') === secret;
}

/** Factory Droid runner posts the finished after-action report + its visible trace. */
http.route({
  path: '/droid/report',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!(await authed(req))) return new Response('unauthorized', { status: 401 });
    const body = (await req.json()) as { incidentId: string; markdown?: string; jiraKey?: string; jiraUrl?: string; trace?: Array<{ at: number; kind: string; text: string }>; status?: 'failed' };
    const incidentId = body.incidentId as Id<'incidents'>;
    if (body.status === 'failed') {
      await ctx.runMutation(internal.afterActionQueries.setStatus, { incidentId, status: 'failed' });
      return Response.json({ ok: true });
    }
    await ctx.runMutation(internal.afterActionQueries.setReport, { incidentId, markdown: body.markdown ?? '', jiraKey: body.jiraKey, jiraUrl: body.jiraUrl, agentTrace: body.trace });
    return Response.json({ ok: true });
  }),
});

/** Streaming trace entries while Droid works (plans, tool calls, diffs). */
http.route({
  path: '/droid/trace',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!(await authed(req))) return new Response('unauthorized', { status: 401 });
    const body = (await req.json()) as { incidentId: string; kind: string; text: string };
    await ctx.runMutation(internal.afterActionQueries.appendTrace, { incidentId: body.incidentId as Id<'incidents'>, entry: { at: Date.now(), kind: body.kind, text: body.text.slice(0, 2000) } });
    return Response.json({ ok: true });
  }),
});

/** Fetch.ai dispatch agent reports a responder's decision. */
http.route({
  path: '/fetchai/helper-response',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    if (!(await authed(req))) return new Response('unauthorized', { status: 401 });
    const b = (await req.json()) as { incidentId: string; helperName: string; helperId: string; status: 'notified' | 'accepted' | 'declined' | 'arrived'; distanceM: number; etaSec?: number };
    await ctx.runMutation(internal.helpers.externalResponse, { incidentId: b.incidentId as Id<'incidents'>, helperName: b.helperName, helperSessionId: `fetch:${b.helperId}`, status: b.status, distanceM: b.distanceM, etaSec: b.etaSec });
    return Response.json({ ok: true });
  }),
});

http.route({
  path: '/health',
  method: 'GET',
  handler: httpAction(async () => Response.json({ ok: true, service: 'beacon-convex' })),
});

export default http;
