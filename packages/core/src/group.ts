import { DateTime } from 'luxon';
import { normalizeName } from './dedupe';
import { cityNl } from './names';
import type { ScoreKind } from './score/factors';
import type { FrozenRush, SnapshotEvent, SnapshotScore } from './snapshot';
import { firstSaleMoment, saleStage, type SaleStage } from './stage';
import { earliestInstant } from './time';
import { buildTimeline, nextAction, type TimelineItem } from './timeline';
import type { Artist, EventType, SalePhase, Tour, Venue } from './types';

// ---------------------------------------------------------------------------
// Welke score hoort bij een datum, nu?
// ---------------------------------------------------------------------------

export interface EventScoreView {
  stage: SaleStage;
  kind: ScoreKind;
  score: SnapshotScore;
  /** Bij "al in de verkoop": de verwachte drukte van vlak vóór de verkoop. */
  before?: FrozenRush & { pending?: boolean };
  /** De verkoop is begonnen na de laatste update: de app heeft de datum zelf doorgeschoven. */
  movedLocally: boolean;
}

/**
 * Rekent het tabblad opnieuw uit met de verkoopfases en de klok, zodat een datum doorschuift zodra de
 * eerste verkoop begint, ook tussen twee updates in. Dan gebruikt de app de uitverkoopkans die de updater
 * alvast berekende, en de huidige verwachte drukte als "vooraf" (die legt de volgende update vast).
 */
export function eventScoreView(e: SnapshotEvent, phases: SalePhase[], now: string | DateTime): EventScoreView {
  const stage = saleStage(e, phases, now);
  if (stage === 'upcoming') {
    const s = e.rush ?? e.score;
    return { stage, kind: 'rush', score: { ...s, kind: s.kind ?? (e.rush ? 'rush' : 'sellout') }, movedLocally: false };
  }
  const sellout = e.sellout ?? e.score;
  const score = { ...sellout, kind: sellout.kind ?? 'sellout' };
  if (e.stage === 'upcoming' && e.rush) {
    const first = firstSaleMoment(phases);
    return {
      stage,
      kind: 'sellout',
      score,
      before: {
        value: e.rush.value,
        label: e.rush.label,
        confidence: e.rush.confidence,
        at: e.rush.computedAt,
        ...(first ? { firstSaleAt: first.toUTC().toISO()! } : {}),
        pending: true,
      },
      movedLocally: true,
    };
  }
  return { stage, kind: 'sellout', score, ...(e.rushFinal ? { before: e.rushFinal } : {}), movedLocally: false };
}

/** Uitverkocht of geannuleerd: de uitkomst staat vast. */
export function isSettled(e: Pick<SnapshotEvent, 'status'>): boolean {
  return e.status === 'soldout' || e.status === 'cancelled';
}

// ---------------------------------------------------------------------------
// Indeling per artiest of evenement → stad → datums en verkoopmomenten
// ---------------------------------------------------------------------------

export interface GroupDate {
  event: SnapshotEvent;
  view: EventScoreView;
  venue?: Venue;
}

export interface CityGroup {
  key: string;
  /** Nederlandse naam van de stad. */
  city: string;
  country: string;
  dates: GroupDate[];
  /** Alle verkoopfases van de datums in deze stad (zonder dubbele). */
  phases: SalePhase[];
  best: number;
  settled: boolean;
  firstDate: string;
}

export interface EventGroup {
  key: string;
  artistId: string;
  title: string;
  subtitle?: string;
  type: EventType;
  tourIds: string[];
  cities: CityGroup[];
  count: number;
  /** Hoogste score van de datums die nog niet vaststaan (of 100 als alles uitverkocht is). */
  best: number;
  settled: boolean;
  /** Eerstvolgend moment om iets te doen (ms), voor het sorteren. */
  nextAt: number | null;
  firstDate: string;
}

export type GroupSort = 'score' | 'next' | 'date';

export interface GroupContext {
  artists: Map<string, Artist>;
  tours: Map<string, Tour>;
  phasesByEvent: Map<string, SalePhase[]>;
  now: string;
}

const dateKey = (e: SnapshotEvent) => e.date.localDate ?? (e.date.localMonth ? `${e.date.localMonth}-99` : '9999');

function bestOf(dates: GroupDate[]): number {
  const open = dates.filter((d) => !isSettled(d.event) && d.view.score.state === 'scored');
  if (open.length) return Math.max(...open.map((d) => d.view.score.value));
  return dates.some((d) => d.event.status === 'soldout') ? 100 : 0;
}

export function groupEvents(dates: GroupDate[], ctx: GroupContext, sort: GroupSort = 'score'): EventGroup[] {
  const byGroup = new Map<string, GroupDate[]>();
  for (const d of dates) {
    const key = d.event.artistIds[0] ?? d.event.tourId ?? d.event.id;
    byGroup.set(key, [...(byGroup.get(key) ?? []), d]);
  }
  const groups: EventGroup[] = [];
  for (const [key, list] of byGroup) {
    const byCity = new Map<string, GroupDate[]>();
    for (const d of list) {
      const v = d.venue;
      const ck = `${normalizeName(v?.city ?? '?')}|${v?.country ?? ''}`;
      byCity.set(ck, [...(byCity.get(ck) ?? []), d]);
    }
    const cities: CityGroup[] = [];
    for (const [ck, cl] of byCity) {
      cl.sort((a, b) => Number(isSettled(a.event)) - Number(isSettled(b.event)) || dateKey(a.event).localeCompare(dateKey(b.event)));
      const seen = new Set<string>();
      const phases: SalePhase[] = [];
      for (const d of cl) {
        for (const p of ctx.phasesByEvent.get(d.event.id) ?? []) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          phases.push(p);
        }
      }
      const v = cl[0]!.venue;
      cities.push({
        key: ck,
        city: v ? cityNl(v.city, v.country) : '?',
        country: v?.country ?? '',
        dates: cl,
        phases,
        best: bestOf(cl),
        settled: cl.every((d) => isSettled(d.event)),
        firstDate: cl.map((d) => dateKey(d.event)).sort()[0]!,
      });
    }
    // Steden die nog open zijn eerst, op datum; uitverkochte steden onderaan.
    cities.sort((a, b) => Number(a.settled) - Number(b.settled) || a.firstDate.localeCompare(b.firstDate));
    const first = list[0]!.event;
    const artist = ctx.artists.get(key);
    const tourIds = [...new Set(list.map((d) => d.event.tourId).filter(Boolean) as string[])];
    const tourNames = tourIds.map((t) => ctx.tours.get(t)?.name).filter(Boolean) as string[];
    const isEvent = first.type === 'festival' || first.type === 'sport' || first.type === 'other';
    const title = isEvent && tourNames.length === 1 ? tourNames[0]! : (artist?.name ?? first.title);
    // Bij een evenement: de naam van de organisator/artiest alleen als die niet al in de titel staat ("Pinkpop 2027").
    const subtitle =
      isEvent && tourNames.length === 1
        ? artist?.name && !normalizeName(title).includes(normalizeName(artist.name))
          ? artist.name
          : undefined
        : tourNames.join(' · ') || undefined;
    let nextAt: number | null = null;
    const allPhases = cities.flatMap((c) => c.phases);
    const na = nextAction(allPhases, ctx.now);
    const t = na ? earliestInstant(na.at) : null;
    if (t) nextAt = t.toMillis();
    groups.push({
      key,
      artistId: key,
      title,
      ...(subtitle ? { subtitle } : {}),
      type: first.type,
      tourIds,
      cities,
      count: list.length,
      best: bestOf(list),
      settled: list.every((d) => isSettled(d.event)),
      nextAt,
      firstDate: cities.map((c) => c.firstDate).sort()[0]!,
    });
  }
  groups.sort((a, b) => {
    if (a.settled !== b.settled) return Number(a.settled) - Number(b.settled);
    if (sort === 'next') return (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || b.best - a.best;
    if (sort === 'date') return a.firstDate.localeCompare(b.firstDate) || b.best - a.best;
    return b.best - a.best || a.firstDate.localeCompare(b.firstDate);
  });
  return groups;
}

/**
 * De verkoopmomenten van een stad voor in het overzicht: inschrijvingen, lotingen, presales en de
 * algemene verkoop (zonder de eindtijden van fases), chronologisch, onbekend onderaan.
 */
export function saleMoments(phases: SalePhase[], now: string): TimelineItem[] {
  return buildTimeline(phases, now).filter((i) => i.role !== 'end');
}
