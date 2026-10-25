/**
 * Apify adapter — runs the Beacon AED/shelter finder actor (integrations/apify-aed-finder)
 * synchronously and returns dataset items. Falls back to OpenStreetMap Overpass
 * directly so the feature still works without a token.
 */
export interface NearbyResource {
  kind: 'aed' | 'shelter' | 'hospital' | 'fire_station';
  name: string;
  lat: number;
  lng: number;
  address?: string;
  source: string;
}

export async function findNearbyResources(lat: number, lng: number, kinds: NearbyResource['kind'][], radiusM = 800): Promise<{ items: NearbyResource[]; source: string; error?: string }> {
  const token = process.env.APIFY_TOKEN;
  const actor = process.env.APIFY_AED_ACTOR_ID;
  if (token && actor) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 45_000);
      const r = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${token}&timeout=40&memory=256`, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat, lng, radiusM, kinds }),
      });
      clearTimeout(t);
      if (r.ok) {
        const items = (await r.json()) as NearbyResource[];
        return { items, source: 'apify' };
      }
    } catch (e) {
      // fall through
      void e;
    }
  }
  return overpass(lat, lng, kinds, radiusM);
}

async function overpass(lat: number, lng: number, kinds: NearbyResource['kind'][], radiusM: number): Promise<{ items: NearbyResource[]; source: string; error?: string }> {
  const filters: string[] = [];
  if (kinds.includes('aed')) filters.push(`node["emergency"="defibrillator"](around:${radiusM},${lat},${lng});`);
  if (kinds.includes('hospital')) filters.push(`nwr["amenity"="hospital"](around:${radiusM * 4},${lat},${lng});`);
  if (kinds.includes('fire_station')) filters.push(`nwr["amenity"="fire_station"](around:${radiusM * 4},${lat},${lng});`);
  if (kinds.includes('shelter')) filters.push(`nwr["amenity"="shelter"](around:${radiusM * 4},${lat},${lng});nwr["social_facility"="shelter"](around:${radiusM * 4},${lat},${lng});`);
  const q = `[out:json][timeout:8];(${filters.join('')});out center 30;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) return { items: [], source: 'overpass', error: `HTTP ${r.status}` };
    const j = (await r.json()) as { elements: Array<{ lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }> };
    const items: NearbyResource[] = j.elements
      .map((e): NearbyResource | null => {
        const la = e.lat ?? e.center?.lat;
        const lo = e.lon ?? e.center?.lon;
        if (la == null || lo == null) return null;
        const t = e.tags ?? {};
        const kind: NearbyResource['kind'] = t.emergency === 'defibrillator' ? 'aed' : t.amenity === 'hospital' ? 'hospital' : t.amenity === 'fire_station' ? 'fire_station' : 'shelter';
        const name = t.name ?? (kind === 'aed' ? `AED${t['defibrillator:location'] ? ` — ${t['defibrillator:location']}` : ''}` : kind.replace('_', ' '));
        const address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || undefined;
        return { kind, name, lat: la, lng: lo, address, source: 'openstreetmap' };
      })
      .filter((x): x is NearbyResource => x !== null);
    return { items, source: 'overpass' };
  } catch (e) {
    return { items: [], source: 'overpass', error: (e as Error).message };
  }
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
