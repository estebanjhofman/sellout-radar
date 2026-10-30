import { DateTime } from 'luxon';
import type { TimePoint } from './types';

/** Tijdzone van de gebruiker (Nederland). */
export const NL_TZ = 'Europe/Amsterdam';

const WEEKDAYS_NL = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] as const;
const WEEKDAYS_NL_LONG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'] as const;
const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'] as const;
const MONTHS_NL_LONG = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
] as const;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Exact moment uit een lokale wandkloktijd in een tijdzone (DST-veilig). */
export function exactLocal(localDate: string, localTime: string, tz: string): TimePoint {
  const dt = DateTime.fromISO(`${localDate}T${localTime}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Ongeldige lokale tijd ${localDate} ${localTime} in ${tz}`);
  return { precision: 'exact', tz, utc: dt.toUTC().toISO()!, localDate: dt.toISODate()! };
}

/** Exact moment uit een UTC-tijdstip; tz bepaalt de lokale weergave. */
export function exactUtc(utcIso: string, tz: string): TimePoint {
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Ongeldig UTC-tijdstip ${utcIso}`);
  return { precision: 'exact', tz, utc: dt.toISO()!, localDate: dt.setZone(tz).toISODate()! };
}

/** Alleen de datum is bekend, het uur niet. */
export function dateOnly(localDate: string, tz: string): TimePoint {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error(`Ongeldige datum ${localDate}`);
  return { precision: 'date', tz, localDate };
}

/** Alleen de maand is bekend. */
export function monthOnly(localMonth: string, tz: string): TimePoint {
  if (!/^\d{4}-\d{2}$/.test(localMonth)) throw new Error(`Ongeldige maand ${localMonth}`);
  return { precision: 'month', tz, localMonth };
}

/** Nog niet bekend. */
export function unknownTime(tz: string): TimePoint {
  return { precision: 'unknown', tz };
}

export function isKnown(tp?: TimePoint): tp is TimePoint {
  return !!tp && tp.precision !== 'unknown';
}

// ---------------------------------------------------------------------------
// Bounds: vroegst en laatst mogelijke moment
// ---------------------------------------------------------------------------

/**
 * Vroegst mogelijke moment. Bij alleen een datum is dat 00:00 lokale tijd, zodat
 * herinneringen nooit te laat komen.
 */
export function earliestInstant(tp?: TimePoint): DateTime | null {
  if (!tp) return null;
  switch (tp.precision) {
    case 'exact':
      return tp.utc ? DateTime.fromISO(tp.utc, { zone: 'utc' }) : null;
    case 'date':
      return tp.localDate ? DateTime.fromISO(tp.localDate, { zone: tp.tz }).startOf('day').toUTC() : null;
    case 'month':
      return tp.localMonth ? DateTime.fromISO(`${tp.localMonth}-01`, { zone: tp.tz }).startOf('month').toUTC() : null;
    default:
      return null;
  }
}

/** Laatst mogelijke moment (einde van de dag of maand). */
export function latestInstant(tp?: TimePoint): DateTime | null {
  if (!tp) return null;
  switch (tp.precision) {
    case 'exact':
      return tp.utc ? DateTime.fromISO(tp.utc, { zone: 'utc' }) : null;
    case 'date':
      return tp.localDate ? DateTime.fromISO(tp.localDate, { zone: tp.tz }).endOf('day').toUTC() : null;
    case 'month':
      return tp.localMonth ? DateTime.fromISO(`${tp.localMonth}-01`, { zone: tp.tz }).endOf('month').toUTC() : null;
    default:
      return null;
  }
}

/** Zelfde moment? Vergelijkt precisie en waarde. */
export function sameTimePoint(a?: TimePoint, b?: TimePoint): boolean {
  if (!a || !b) return a === b;
  if (a.precision !== b.precision) return false;
  switch (a.precision) {
    case 'exact':
      return earliestInstant(a)!.toMillis() === earliestInstant(b)!.toMillis();
    case 'date':
      return a.localDate === b.localDate;
    case 'month':
      return a.localMonth === b.localMonth;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Weergave (Nederlands)
// ---------------------------------------------------------------------------

export function weekdayShort(dt: DateTime): string {
  return WEEKDAYS_NL[dt.weekday - 1] ?? '';
}

export function weekdayLong(dt: DateTime): string {
  return WEEKDAYS_NL_LONG[dt.weekday - 1] ?? '';
}

export function monthShort(month: number): string {
  return MONTHS_NL[month - 1] ?? '';
}

export function monthLong(month: number): string {
  return MONTHS_NL_LONG[month - 1] ?? '';
}

/** "vr 6 nov 2026" */
export function formatDate(dt: DateTime, withYear = true): string {
  const base = `${weekdayShort(dt)} ${dt.day} ${monthShort(dt.month)}`;
  return withYear ? `${base} ${dt.year}` : base;
}

/** "10:00" */
export function formatClock(dt: DateTime): string {
  return dt.toFormat('HH:mm');
}

/**
 * Formatteert een TimePoint in een tijdzone. Onbekende delen worden expliciet benoemd,
 * nooit ingevuld.
 */
export function formatTimePoint(tp: TimePoint | undefined, zone?: string, withYear = true): string {
  if (!tp || tp.precision === 'unknown') return 'nog niet bekend';
  const z = zone ?? tp.tz;
  if (tp.precision === 'exact') {
    const dt = earliestInstant(tp)!.setZone(z);
    return `${formatDate(dt, withYear)}, ${formatClock(dt)}`;
  }
  if (tp.precision === 'date') {
    const dt = DateTime.fromISO(tp.localDate!, { zone: tp.tz });
    return `${formatDate(dt, withYear)} (tijd nog niet bekend)`;
  }
  const [y, m] = tp.localMonth!.split('-').map(Number);
  return `${monthLong(m!)} ${y} (dag nog niet bekend)`;
}

const CET_ZONES = [
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Paris', 'Europe/Brussels', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Stockholm', 'Europe/Copenhagen', 'Europe/Oslo', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Prague',
  'Europe/Warsaw', 'Europe/Budapest', 'Europe/Luxembourg', 'Europe/Belgrade', 'Europe/Zagreb', 'Europe/Ljubljana',
  'Europe/Bratislava', 'Europe/Monaco', 'Europe/Malta', 'Europe/Andorra',
];
const EASTERN_ZONES = ['America/New_York', 'America/Toronto', 'America/Detroit', 'America/Montreal', 'America/Indiana/Indianapolis'];
const CENTRAL_ZONES = ['America/Chicago', 'America/Winnipeg'];
const MOUNTAIN_ZONES = ['America/Denver', 'America/Edmonton'];
const PACIFIC_ZONES = ['America/Los_Angeles', 'America/Vancouver'];

/** [standaardtijd, zomertijd] per zone. Intl geeft per platform verschillende afkortingen, dus vast. */
const ABBR_BY_ZONE: Record<string, [string, string?]> = {
  ...Object.fromEntries(CET_ZONES.map((z) => [z, ['CET', 'CEST'] as [string, string]])),
  ...Object.fromEntries(EASTERN_ZONES.map((z) => [z, ['EST', 'EDT'] as [string, string]])),
  ...Object.fromEntries(CENTRAL_ZONES.map((z) => [z, ['CST', 'CDT'] as [string, string]])),
  ...Object.fromEntries(MOUNTAIN_ZONES.map((z) => [z, ['MST', 'MDT'] as [string, string]])),
  ...Object.fromEntries(PACIFIC_ZONES.map((z) => [z, ['PST', 'PDT'] as [string, string]])),
  'Europe/London': ['GMT', 'BST'],
  'Europe/Dublin': ['GMT', 'IST'],
  'Europe/Lisbon': ['WET', 'WEST'],
  ...Object.fromEntries(
    ['Europe/Helsinki', 'Europe/Athens', 'Europe/Sofia', 'Europe/Bucharest', 'Europe/Riga', 'Europe/Tallinn', 'Europe/Vilnius', 'Europe/Kyiv', 'Europe/Kiev', 'Asia/Nicosia', 'Europe/Nicosia'].map(
      (z) => [z, ['EET', 'EEST'] as [string, string]],
    ),
  ),
  'Asia/Kuala_Lumpur': ['MYT'],
  'Europe/Istanbul': ['TRT'],
  'America/Phoenix': ['MST'],
  'America/Mexico_City': ['CST'],
  'America/Sao_Paulo': ['BRT'],
  'America/Argentina/Buenos_Aires': ['ART'],
  'America/Santiago': ['CLT', 'CLST'],
  'America/Bogota': ['COT'],
  'Asia/Seoul': ['KST'],
  'Asia/Tokyo': ['JST'],
  'Asia/Singapore': ['SGT'],
  'Asia/Hong_Kong': ['HKT'],
  'Asia/Bangkok': ['ICT'],
  'Asia/Manila': ['PHT'],
  'Asia/Jakarta': ['WIB'],
  'Asia/Taipei': ['CST'],
  'Australia/Sydney': ['AEST', 'AEDT'],
  'Australia/Melbourne': ['AEST', 'AEDT'],
  'Australia/Brisbane': ['AEST'],
  'Australia/Perth': ['AWST'],
  'Pacific/Auckland': ['NZST', 'NZDT'],
  UTC: ['UTC'],
};

/** Korte zoneaanduiding, bijv. "CET", "EDT", "GMT"; anders "UTC+9" (nooit een lege of dubbelzinnige string). */
export function zoneAbbr(dt: DateTime): string {
  const entry = dt.zoneName ? ABBR_BY_ZONE[dt.zoneName] : undefined;
  if (entry) return dt.isInDST && entry[1] ? entry[1] : entry[0];
  const o = dt.offset;
  const sign = o >= 0 ? '+' : '−';
  const h = Math.floor(Math.abs(o) / 60);
  const m = Math.abs(o) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/**
 * Tijd in de lokale tijd van het evenement én in Nederlandse tijd.
 * `same` is waar als beide gelijk zijn (evenement in Nederland of zelfde offset).
 */
export function formatDual(
  tp: TimePoint | undefined,
  userTz: string = NL_TZ,
): { local: string; user: string; same: boolean } {
  const local = formatTimePoint(tp, tp?.tz);
  if (!tp || tp.precision !== 'exact') return { local, user: local, same: true };
  const at = earliestInstant(tp)!;
  const l = at.setZone(tp.tz);
  const u = at.setZone(userTz);
  const same = l.offset === u.offset;
  return {
    local: `${formatDate(l)}, ${formatClock(l)} ${zoneAbbr(l)}`,
    user: `${formatDate(u)}, ${formatClock(u)} NL`,
    same,
  };
}

/** "vandaag 10:00", "morgen 10:00", "vr 6 nov 10:00" ten opzichte van `now`. */
export function relativeMoment(at: DateTime, now: DateTime, zone: string = NL_TZ): string {
  const a = at.setZone(zone);
  const n = now.setZone(zone);
  const days = Math.round(a.startOf('day').diff(n.startOf('day'), 'days').days);
  const clock = formatClock(a);
  if (days === 0) return `vandaag ${clock}`;
  if (days === 1) return `morgen ${clock}`;
  if (days === -1) return `gisteren ${clock}`;
  return `${formatDate(a, a.year !== n.year)} ${clock}`;
}

/**
 * Zoals relativeMoment, maar zonder kloktijd: voor momenten waarvan alleen de dag bekend is.
 * De kalenderdag van `at` geldt in de eigen zone van `at` (de lokale datum van de bron),
 * "vandaag" en "morgen" in de zone van de gebruiker.
 */
export function relativeDay(at: DateTime, now: DateTime, userZone: string = NL_TZ): string {
  const a = DateTime.fromObject({ year: at.year, month: at.month, day: at.day }, { zone: 'utc' });
  const nz = now.setZone(userZone);
  const n = DateTime.fromObject({ year: nz.year, month: nz.month, day: nz.day }, { zone: 'utc' });
  const days = Math.round(a.diff(n, 'days').days);
  if (days === 0) return 'vandaag';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gisteren';
  return formatDate(a, a.year !== n.year);
}

/** Aftelklok: "3 d 4 u", "5 u 12 m", "12 m", "nu". */
export function countdown(target: DateTime, now: DateTime): string {
  const ms = target.toMillis() - now.toMillis();
  if (ms <= 0) return 'nu';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} u`;
  if (h > 0) return `${h} u ${m} m`;
  return `${m} m`;
}

/** ISO-weekdag (1 = maandag ... 7 = zondag) van een lokale datum. */
export function isoWeekday(localDate: string): number {
  return DateTime.fromISO(localDate).weekday;
}
