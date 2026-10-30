import { DateTime } from 'luxon';
import type { Claim, Conflict, SourceKind, SourceRef } from './types';

/**
 * Bronvoorrang: lager is gezaghebbender. Officiële bronnen (artiest, promotor, venue,
 * ticketverkoper) gaan voor nieuws en fansites; daarbinnen wint de meest recente.
 */
export const SOURCE_RANK: Record<SourceKind, number> = {
  artist: 1,
  official_store: 1,
  promoter: 2,
  venue: 2,
  ticketing: 3,
  manual: 4,
  news: 5,
  aggregator: 6,
  fansite: 7,
};

export function isOfficial(source: SourceRef): boolean {
  return SOURCE_RANK[source.kind] <= 3;
}

export interface Resolved<T> {
  value: T | null;
  winner: Claim<T> | null;
  conflict: Conflict | null;
  /** Laatste bewering per bron. */
  latest: Claim<T>[];
}

const defaultEquals = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Kiest per veld de winnende waarde en markeert een conflict als bronnen het oneens zijn. */
export function resolveClaims<T>(
  claims: Claim<T>[],
  equals: (a: T, b: T) => boolean = defaultEquals,
): Resolved<T> {
  if (claims.length === 0) return { value: null, winner: null, conflict: null, latest: [] };

  // Alleen de laatste bewering per bron telt; oudere zijn vervangen.
  const perSource = new Map<string, Claim<T>>();
  for (const c of claims) {
    const prev = perSource.get(c.source.name);
    if (!prev || prev.source.fetchedAt < c.source.fetchedAt) perSource.set(c.source.name, c);
  }
  const latest = [...perSource.values()].sort((a, b) => {
    const r = SOURCE_RANK[a.source.kind] - SOURCE_RANK[b.source.kind];
    if (r !== 0) return r;
    return b.source.fetchedAt.localeCompare(a.source.fetchedAt);
  });
  // Groepeer gelijke waarden. Winnaar: gezaghebbendste bron; bij gelijke rang de waarde
  // die door de meeste bronnen wordt genoemd; daarna de recentste.
  const groups: Claim<T>[][] = [];
  for (const c of latest) {
    const g = groups.find((x) => equals(x[0]!.value, c.value));
    if (g) g.push(c);
    else groups.push([c]);
  }
  const bestRank = (g: Claim<T>[]) => Math.min(...g.map((c) => SOURCE_RANK[c.source.kind]));
  const newest = (g: Claim<T>[]) => g.map((c) => c.source.fetchedAt).sort().at(-1)!;
  groups.sort((a, b) => bestRank(a) - bestRank(b) || b.length - a.length || newest(b).localeCompare(newest(a)));
  const winner = groups[0]![0]!;
  const others = latest.filter((c) => !equals(c.value, winner.value));
  const conflict: Conflict | null =
    others.length === 0
      ? null
      : {
          entity: winner.entity,
          field: winner.field,
          chosen: winner.value,
          alternatives: others.map((c) => ({ value: c.value, source: c.source })),
          reason: isOfficial(winner.source)
            ? `Gekozen: ${winner.source.name} (officiële bron). Afwijkend: ${others.map((o) => o.source.name).join(', ')}.`
            : `Geen officiële bron; gekozen: ${winner.source.name}. Afwijkend: ${others.map((o) => o.source.name).join(', ')}.`,
        };
  return { value: winner.value, winner, conflict, latest };
}

// ---------------------------------------------------------------------------
// Weekdag-controle: "dinsdag 28 oktober" terwijl 28 oktober een woensdag is.
// ---------------------------------------------------------------------------

const WEEKDAY_WORDS: Record<string, number> = {
  monday: 1, maandag: 1, montag: 1, lundi: 1,
  tuesday: 2, dinsdag: 2, dienstag: 2, mardi: 2,
  wednesday: 3, woensdag: 3, mittwoch: 3, mercredi: 3,
  thursday: 4, donderdag: 4, donnerstag: 4, jeudi: 4,
  friday: 5, vrijdag: 5, freitag: 5, vendredi: 5,
  saturday: 6, zaterdag: 6, samstag: 6, samedi: 6,
  sunday: 7, zondag: 7, sonntag: 7, dimanche: 7,
};

export const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, januari: 1, januar: 1, janvier: 1, enero: 1,
  february: 2, feb: 2, februari: 2, februar: 2, fevrier: 2, febrero: 2,
  march: 3, mar: 3, maart: 3, mrt: 3, marz: 3, mars: 3, marzo: 3,
  april: 4, apr: 4, avril: 4, abril: 4,
  may: 5, mei: 5, mai: 5, mayo: 5,
  june: 6, jun: 6, juni: 6, juin: 6, junio: 6,
  july: 7, jul: 7, juli: 7, juillet: 7, julio: 7,
  august: 8, aug: 8, augustus: 8, aout: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, septembre: 9, septiembre: 9,
  october: 10, oct: 10, oktober: 10, okt: 10, octobre: 10, octubre: 10,
  november: 11, nov: 11, novembre: 11, noviembre: 11,
  december: 12, dec: 12, dezember: 12, decembre: 12, diciembre: 12,
};

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export interface WeekdayMismatch {
  text: string;
  stated: number;
  actual: number;
  date: string;
}

/**
 * Zoekt "weekdag + datum" in een tekst en controleert of de weekdag klopt.
 * Het jaar komt uit de context (de datum waar de tekst over gaat).
 */
export function findWeekdayMismatches(text: string, year: number): WeekdayMismatch[] {
  const t = normalizeText(text);
  const wd = Object.keys(WEEKDAY_WORDS).join('|');
  const mo = Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join('|');
  const patterns = [
    // "Tuesday, October 28th" / "dinsdag 28 oktober"
    new RegExp(`\\b(${wd})\\b[,.]?\\s+(${mo})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th|e)?\\b`, 'g'),
    new RegExp(`\\b(${wd})\\b[,.]?\\s+(\\d{1,2})(?:st|nd|rd|th|e)?\\s+(?:of\\s+)?(${mo})\\b`, 'g'),
  ];
  const out: WeekdayMismatch[] = [];
  for (const [i, re] of patterns.entries()) {
    for (const m of t.matchAll(re)) {
      const stated = WEEKDAY_WORDS[m[1]!]!;
      const month = i === 0 ? MONTH_WORDS[m[2]!]! : MONTH_WORDS[m[3]!]!;
      const day = Number(i === 0 ? m[3] : m[2]);
      const dt = DateTime.fromObject({ year, month, day });
      if (!dt.isValid) continue;
      if (dt.weekday !== stated) {
        out.push({ text: m[0], stated, actual: dt.weekday, date: dt.toISODate()! });
      }
    }
  }
  return out;
}
