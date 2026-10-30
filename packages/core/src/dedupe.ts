import { normalizeText } from './claims';

/** Normaliseert namen voor ontdubbeling: kleine letters, zonder accenten, leestekens en lidwoord. */
export function normalizeName(s: string): string {
  return normalizeText(s)
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|de|het|la|le|les|el|die|der) /, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slug(s: string): string {
  return normalizeName(s).replace(/ /g, '-');
}

/** Sleutel voor een datum: artiest + stad + lokale datum. */
export function eventKey(artistName: string, city: string, localDate: string): string {
  return `${slug(artistName)}|${slug(city)}|${localDate}`;
}

export function venueKey(name: string, city: string): string {
  return `${slug(name)}|${slug(city)}`;
}

/** Jaccard-overlap van woorden, 0..1. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Twee venues zijn dezelfde als de stad gelijk is en de namen sterk overlappen,
 * of als ze binnen 300 meter liggen.
 */
export function sameVenue(
  a: { name: string; city: string; lat?: number; lon?: number },
  b: { name: string; city: string; lat?: number; lon?: number },
): boolean {
  if (a.lat !== undefined && a.lon !== undefined && b.lat !== undefined && b.lon !== undefined) {
    if (haversineMeters(a.lat, a.lon, b.lat, b.lon) < 300) return true;
  }
  if (normalizeName(a.city) !== normalizeName(b.city)) return false;
  return tokenSimilarity(a.name, b.name) >= 0.5;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
