/**
 * Fetch.ai adapter.
 *
 * The helper-dispatch uAgent (integrations/fetchai/dispatch_agent.py) runs on
 * Agentverse or locally. Convex talks to it over its HTTP /submit endpoint
 * using the uAgents envelope-less REST shape the agent exposes with @on_rest_post.
 * The agent owns geo-matching of registered responders and pushes back
 * acceptances through the Convex HTTP route /fetchai/helper-response.
 */
import type { AdapterResult } from './elastic';

export async function notifyFetchAgent(packet: Record<string, unknown>): Promise<AdapterResult> {
  const endpoint = process.env.FETCHAI_AGENT_ENDPOINT;
  if (!endpoint) return { status: 'skipped', error: 'FETCHAI_AGENT_ENDPOINT not set' };
  try {
    const r = await fetch(endpoint.replace(/\/$/, '') + '/incident', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-beacon-secret': process.env.BEACON_INTERNAL_SECRET ?? '' },
      body: JSON.stringify({ ...packet, callbackUrl: `${process.env.CONVEX_SITE_URL ?? ''}/fetchai/helper-response` }),
    });
    if (!r.ok) return { status: 'failed', error: `HTTP ${r.status}` };
    const j = (await r.json().catch(() => ({}))) as { requestId?: string };
    return { status: 'sent', externalId: j.requestId };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}
