import { DateTime } from 'luxon';
import {
  cityNl,
  COUNTRY_NL,
  countdown,
  earliestInstant,
  formatDate,
  formatDual,
  formatTimePoint,
  nextAction,
  NL_TZ,
  type SalePhase,
  type SnapshotEvent,
  type SourceKind,
  type TimelineItem,
  type Venue,
} from '@sellout/core';

export { cityNl, COUNTRY_NL };

export function placeText(v?: Venue): string {
  if (!v) return '';
  const venue = v.name === 'Venue nog niet bekend' ? 'Venue nog niet bekend' : v.name;
  const country = v.country === 'NL' ? '' : `, ${COUNTRY_NL[v.country] ?? v.country}`;
  return `${venue} · ${cityNl(v.city, v.country)}${country}`;
}

/** Showdatum in lokale tijd; met NL-tijd erbij als die afwijkt en het uur bekend is. */
export function showDateText(e: SnapshotEvent): string {
  if (e.date.precision === 'exact') {
    const d = formatDual(e.date);
    return d.same ? d.local : `${d.local} (${d.user})`;
  }
  if (e.date.precision === 'date') {
    const dt = DateTime.fromISO(e.date.localDate!, { zone: e.date.tz });
    return formatDate(dt);
  }
  return formatTimePoint(e.date);
}

export function shortDate(e: SnapshotEvent): string {
  if (!e.date.localDate) return formatTimePoint(e.date);
  return formatDate(DateTime.fromISO(e.date.localDate), true);
}

export interface NextInfo {
  item: TimelineItem;
  label: string;
  /** "vr 6 nov 10:00 (NL)" */
  when: string;
  countdown: string | null;
}

export function nextInfo(phases: SalePhase[], now: Date): NextInfo | null {
  const item = nextAction(phases, now.toISOString());
  if (!item) return null;
  const at = earliestInstant(item.at);
  const label =
    item.role === 'deadline'
      ? item.kind === 'lottery'
        ? 'Loting sluit'
        : 'Inschrijving sluit'
      : item.role === 'draw'
        ? 'Uitslag loting'
        : item.kind === 'general_sale'
          ? 'Algemene verkoop'
          : item.kind === 'lottery'
            ? 'Loting'
            : item.phase.name;
  let when: string;
  if (item.at.precision === 'exact' && at) {
    const nl = at.setZone(NL_TZ);
    when = `${formatDate(nl, nl.year !== DateTime.now().year)} ${nl.toFormat('HH:mm')}`;
  } else {
    when = formatTimePoint(item.at, undefined, false);
  }
  const cd = at && item.state !== 'now' ? countdown(at, DateTime.fromJSDate(now)) : item.state === 'now' ? 'nu bezig' : null;
  return { item, label, when, countdown: cd };
}

export const SOURCE_KIND_NL: Record<SourceKind | 'api', string> = {
  artist: 'Artiest (officieel)',
  official_store: 'Officiële winkel',
  promoter: 'Promotor (officieel)',
  venue: 'Venue (officieel)',
  ticketing: 'Ticketverkoper (officieel)',
  manual: 'Handmatig gecontroleerd',
  news: 'Nieuws',
  aggregator: 'Overzichtssite',
  fansite: 'Fansite',
  api: 'Databron',
};

export function timeAgo(iso: string, now = new Date()): string {
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60000);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return `${d} dagen geleden`;
}

export function typeLabel(t: SnapshotEvent['type']): string {
  return { concert: 'Concert', festival: 'Festival', sport: 'Sport', theatre: 'Theater', comedy: 'Comedy', other: 'Overig' }[t];
}
