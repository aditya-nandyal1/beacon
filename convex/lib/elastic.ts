/**
 * Elastic adapter: incident telemetry + full-text search over after-action
 * reports. Uses the plain REST API so it works on Elastic Cloud and self-hosted.
 */
export interface AdapterResult {
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  externalId?: string;
}

function cfg() {
  const url = process.env.ELASTIC_URL?.replace(/\/$/, '');
  const key = process.env.ELASTIC_API_KEY;
  const index = process.env.ELASTIC_INDEX || 'beacon-incidents';
  return url && key ? { url, key, index } : null;
}

export async function indexIncidentEvent(doc: Record<string, unknown>): Promise<AdapterResult> {
  const c = cfg();
  if (!c) return { status: 'skipped', error: 'Elastic not configured' };
  try {
    const r = await fetch(`${c.url}/${c.index}/_doc`, {
      method: 'POST',
      headers: { authorization: `ApiKey ${c.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ '@timestamp': new Date().toISOString(), ...doc }),
    });
    const j = (await r.json()) as { _id?: string; error?: { reason?: string } };
    return r.ok ? { status: 'sent', externalId: j._id } : { status: 'failed', error: j.error?.reason ?? `HTTP ${r.status}` };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

export async function searchIncidents(query: string, size = 10): Promise<{ hits: Array<Record<string, unknown>>; error?: string }> {
  const c = cfg();
  if (!c) return { hits: [], error: 'Elastic not configured' };
  try {
    const r = await fetch(`${c.url}/${c.index}/_search`, {
      method: 'POST',
      headers: { authorization: `ApiKey ${c.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        size,
        query: { multi_match: { query, fields: ['summary^3', 'situation^2', 'report', 'hazards.label', 'location.text'], fuzziness: 'AUTO' } },
        sort: [{ '@timestamp': 'desc' }],
      }),
    });
    const j = (await r.json()) as { hits?: { hits: Array<{ _id: string; _source: Record<string, unknown> }> } };
    return { hits: (j.hits?.hits ?? []).map((h) => ({ id: h._id, ...h._source })) };
  } catch (e) {
    return { hits: [], error: (e as Error).message };
  }
}
