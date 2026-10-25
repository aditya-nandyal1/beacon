import { Actor, log } from 'apify';

/**
 * Beacon AED & Emergency Resource Finder.
 *
 * Sources (all public, no login):
 *  - OpenStreetMap via Overpass (emergency=defibrillator, amenity=hospital|fire_station|shelter)
 *  - San Francisco open data AED registry (Socrata) when the point is inside SF
 *  - (extensible) other city registries — add a fetcher in REGISTRIES
 *
 * Output: one row per resource with distance, sorted nearest-first, de-duplicated
 * within 25 m. Designed to be called with run-sync-get-dataset-items so a phone
 * gets an answer in ~2–4 s.
 */
await Actor.init();
const input = (await Actor.getInput()) ?? {};
const { lat, lng, radiusM = 800, kinds = ['aed', 'hospital'], includeRegistries = true } = input;
if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('lat and lng are required numbers');

const results = [];
const R = 6371000;
const dist = (aLat, aLng, bLat, bLng) => {
  const dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// ── Overpass ──────────────────────────────────────────────────────────────────
const wide = radiusM * 4;
const q = [];
if (kinds.includes('aed')) q.push(`node["emergency"="defibrillator"](around:${radiusM},${lat},${lng});`);
if (kinds.includes('hospital')) q.push(`nwr["amenity"="hospital"](around:${wide},${lat},${lng});`);
if (kinds.includes('fire_station')) q.push(`nwr["amenity"="fire_station"](around:${wide},${lat},${lng});`);
if (kinds.includes('shelter')) q.push(`nwr["amenity"="shelter"](around:${wide},${lat},${lng});nwr["social_facility"="shelter"](around:${wide},${lat},${lng});`);
const overpassQ = `[out:json][timeout:25];(${q.join('')});out center 60;`;
for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
  try {
    const r = await fetch(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQ), headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(28_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    for (const e of j.elements ?? []) {
      const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
      if (la == null) continue;
      const t = e.tags ?? {};
      const kind = t.emergency === 'defibrillator' ? 'aed' : t.amenity === 'hospital' ? 'hospital' : t.amenity === 'fire_station' ? 'fire_station' : 'shelter';
      results.push({
        kind,
        name: t.name ?? (kind === 'aed' ? `AED${t['defibrillator:location'] ? ` — ${t['defibrillator:location']}` : ''}` : kind.replace('_', ' ')),
        lat: la, lng: lo,
        address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || undefined,
        details: { indoor: t.indoor, level: t.level, access: t.access, opening_hours: t.opening_hours, emergency_phone: t['emergency:phone'] ?? t.phone },
        source: 'openstreetmap',
      });
    }
    log.info(`overpass: ${j.elements?.length ?? 0} elements from ${endpoint}`);
    break;
  } catch (e) {
    log.warning(`overpass ${endpoint} failed: ${e.message}`);
  }
}

// ── City registries (public open data) ────────────────────────────────────────
const REGISTRIES = [
  {
    name: 'sf-open-data-aed',
    inBounds: (la, lo) => la > 37.70 && la < 37.84 && lo > -122.53 && lo < -122.35,
    fetch: async () => {
      // DataSF "AED locations" style dataset; shape varies, so we read defensively.
      const url = `https://data.sfgov.org/resource/8jj6-6u5c.json?$where=within_circle(location,${lat},${lng},${radiusM})&$limit=50`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json();
      return rows.map((row) => {
        const la = Number(row.location?.latitude ?? row.latitude), lo = Number(row.location?.longitude ?? row.longitude);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
        return { kind: 'aed', name: `AED — ${row.site_name ?? row.name ?? row.location_description ?? 'registered location'}`, lat: la, lng: lo, address: row.address ?? row.street_address, details: { placement: row.placement ?? row.location_description }, source: 'datasf' };
      }).filter(Boolean);
    },
  },
];
if (includeRegistries && kinds.includes('aed')) {
  for (const reg of REGISTRIES) {
    if (!reg.inBounds(lat, lng)) continue;
    try {
      const rows = await reg.fetch();
      results.push(...rows);
      log.info(`${reg.name}: ${rows.length} rows`);
    } catch (e) {
      log.warning(`${reg.name} failed: ${e.message}`);
    }
  }
}

// ── Dedupe + sort ─────────────────────────────────────────────────────────────
const out = [];
for (const r of results) {
  const d = Math.round(dist(lat, lng, r.lat, r.lng));
  if (out.some((o) => o.kind === r.kind && dist(o.lat, o.lng, r.lat, r.lng) < 25)) continue;
  out.push({ ...r, distanceM: d });
}
out.sort((a, b) => a.distanceM - b.distanceM);
log.info(`returning ${out.length} resources (${out.filter((o) => o.kind === 'aed').length} AEDs)`);
await Actor.pushData(out);
await Actor.setValue('SUMMARY', { count: out.length, nearestAed: out.find((o) => o.kind === 'aed') ?? null, queriedAt: new Date().toISOString() });
await Actor.exit();
