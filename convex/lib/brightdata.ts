/**
 * Bright Data adapter — live public web context during an incident.
 *
 * Why it's essential, not decorative: in a wildfire or flood the single most
 * useful thing after "get out" is *which way*. That answer only exists on live
 * public pages (CalFire incidents, 511 road closures, NWS alerts, utility
 * outage maps) that are JS-heavy and rate-limit aggressively. We route through
 * the Web Unlocker so the fetch succeeds under real conditions, and we handle
 * blocks / slow responses / empty results explicitly.
 */
export interface LiveContext {
  alerts: string[];
  roadClosures: string[];
  source: 'brightdata' | 'direct' | 'none';
  errors: string[];
}

const UNLOCKER = 'https://api.brightdata.com/request';

async function unlockerFetch(url: string, timeoutMs = 9000): Promise<string | null> {
  const key = process.env.BRIGHTDATA_API_KEY;
  const zone = process.env.BRIGHTDATA_ZONE || 'beacon_unlocker';
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    if (key) {
      const r = await fetch(UNLOCKER, {
        method: 'POST',
        signal: ac.signal,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ zone, url, format: 'raw' }),
      });
      if (r.ok) return await r.text();
      if (r.status === 429 || r.status >= 500) return null; // blocked/slow → caller degrades
    }
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'BeaconEmergency/0.1 (+public-safety)' } });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** NWS active alerts for a point — public JSON API, routed through the unlocker when configured. */
export async function fetchLiveContext(lat: number, lng: number, situation: string): Promise<LiveContext> {
  const out: LiveContext = { alerts: [], roadClosures: [], source: 'none', errors: [] };
  const hasKey = Boolean(process.env.BRIGHTDATA_API_KEY);

  const nws = await unlockerFetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`);
  if (nws) {
    try {
      const j = JSON.parse(nws) as { features?: Array<{ properties: { event: string; headline?: string; severity?: string } }> };
      out.alerts = (j.features ?? [])
        .slice(0, 5)
        .map((f) => `${f.properties.event}${f.properties.severity ? ` (${f.properties.severity})` : ''}: ${f.properties.headline ?? ''}`.trim());
      out.source = hasKey ? 'brightdata' : 'direct';
    } catch {
      out.errors.push('nws: unparsable');
    }
  } else out.errors.push('nws: blocked or timed out');

  if (['wildfire_smoke', 'flood', 'earthquake', 'structure_fire'].includes(situation)) {
    // Caltrans QuickMap feed is public and lists lane/road closures statewide.
    const ct = await unlockerFetch('https://quickmap.dot.ca.gov/data/lcs2way.json');
    if (ct) {
      try {
        const j = JSON.parse(ct) as { data?: Array<{ lcs?: { location?: { begin?: { beginRoute?: string; beginNearby?: string } }; closure?: { typeOfClosure?: string; facility?: string } } }> };
        const rows = (j.data ?? []).map((d) => d.lcs).filter(Boolean) as NonNullable<NonNullable<typeof j.data>[number]['lcs']>[];
        const near = rows
          .filter((r) => r.closure?.typeOfClosure && r.location?.begin?.beginRoute)
          .slice(0, 8)
          .map((r) => `${r.location!.begin!.beginRoute} near ${r.location!.begin!.beginNearby ?? '?'}: ${r.closure!.typeOfClosure} (${r.closure!.facility ?? ''})`.trim());
        out.roadClosures = near;
      } catch {
        out.errors.push('caltrans: unparsable');
      }
    } else out.errors.push('caltrans: blocked or timed out');
  }
  return out;
}
