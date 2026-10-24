export interface Geo { lat: number; lng: number; accuracyM: number; at: number }

export function watchPosition(cb: (g: Geo) => void): () => void {
  if (!('geolocation' in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(
    (p) => cb({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy, at: Date.now() }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Reverse geocode via OSM Nominatim (public, rate-limited; best-effort). */
export async function describeLocation(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as { display_name?: string; address?: Record<string, string> };
    const a = j.address ?? {};
    const short = [a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road, a.neighbourhood || a.suburb, a.city || a.town || a.village].filter(Boolean).join(', ');
    return short || j.display_name || null;
  } catch {
    return null;
  }
}
