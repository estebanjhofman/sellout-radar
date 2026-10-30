import { DateTime } from 'luxon';
import { earliestInstant, firstSaleMoment, type OutcomeRecord, type SalePhase, type SpeedClass } from '@sellout/core';
import type { Catalog, CatalogEvent } from '../catalog';
import type { FrozenRushState, ScorePoint } from '../state';

/**
 * Uitkomsten voor de kalibratie van beide scores. Zie ook core/score/calibration.ts.
 *
 * Wanneer was een datum uitverkocht? Als een bron het tijdstip noemt (soldOutAt) dat; anders de eerste
 * run waarin de updater de datum als uitverkocht zag (soldOutSeen). Met drie runs per dag is dat
 * hooguit een halve dag te laat.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function soldOutMoment(ev: CatalogEvent, soldOutSeen: Record<string, string>): DateTime | null {
  const iso = ev.soldOutAt ?? soldOutSeen[ev.id];
  return iso ? DateTime.fromISO(iso) : null;
}

export function speedClass(ev: CatalogEvent, phases: SalePhase[], first: DateTime, soldAt: DateTime): SpeedClass {
  const general = phases.find((p) => p.kind === 'general_sale');
  const gStart = general ? earliestInstant(general.start) : null;
  if (ev.soldOutInPresale || (gStart && soldAt < gStart && gStart > first)) return 'presale';
  const hours = soldAt.diff(first, 'hours').hours;
  return hours <= 24 ? 'day1' : hours <= 168 ? 'week1' : 'later';
}

/**
 * Verwachte drukte: voorspelling = de bewaarde drukte van vlak vóór de eerste verkoop.
 * Uitkomst 1 = uitverkocht in de presale of binnen 24 uur na de eerste verkoopstart.
 * Uitkomst 0 = later uitverkocht, of na een week nog niet uitverkocht.
 */
export function detectRushOutcomes(
  cat: Catalog,
  phasesByEvent: Map<string, SalePhase[]>,
  rushFinal: Record<string, FrozenRushState>,
  soldOutSeen: Record<string, string>,
  known: OutcomeRecord[],
  now: string,
): OutcomeRecord[] {
  const done = new Set(known.map((o) => o.eventId));
  const nowMs = Date.parse(now);
  const out: OutcomeRecord[] = [];
  for (const ev of cat.events.values()) {
    const fr = rushFinal[ev.id];
    if (!fr || done.has(ev.id) || ev.status === 'cancelled' || ev.status === 'postponed') continue;
    const first = DateTime.fromISO(fr.firstSaleAt);
    const phases = phasesByEvent.get(ev.id) ?? [];
    const base = { eventId: ev.id, kind: 'rush' as const, predicted: fr.probability, features: fr.features, type: ev.type, resolvedAt: now };
    if (ev.status === 'soldout') {
      const soldAt = soldOutMoment(ev, soldOutSeen) ?? DateTime.fromISO(now);
      const speed = speedClass(ev, phases, first, soldAt);
      out.push({ ...base, outcome: speed === 'presale' || speed === 'day1' ? 1 : 0, speed });
    } else if (nowMs - first.toMillis() >= 7 * DAY) {
      out.push({ ...base, outcome: 0 });
    }
  }
  return out;
}

/**
 * Uitverkoopkans: voorspelling = de laatste uitverkoopkans in de eerste week van de verkoop, en
 * minstens een uur vóór het uitverkopen (anders verraadt de score de uitkomst al). Zonder zo'n punt
 * (bijv. binnen een paar uur uitverkocht, nog vóór de volgende run) telt de datum niet mee.
 * Uitkomst 1 = uitverkocht vóór de showdag, 0 = show voorbij zonder uitverkocht-melding.
 */
export function detectSelloutOutcomes(
  cat: Catalog,
  phasesByEvent: Map<string, SalePhase[]>,
  history: Record<string, ScorePoint[]>,
  soldOutSeen: Record<string, string>,
  known: OutcomeRecord[],
  now: string,
): OutcomeRecord[] {
  const done = new Set(known.map((o) => o.eventId));
  const today = DateTime.fromISO(now).toISODate()!;
  const out: OutcomeRecord[] = [];
  for (const ev of cat.events.values()) {
    if (done.has(ev.id) || ev.status === 'cancelled' || ev.status === 'postponed') continue;
    const phases = phasesByEvent.get(ev.id) ?? [];
    const first = firstSaleMoment(phases);
    if (!first) continue;
    const pts = (history[ev.id] ?? []).filter((p) => p.kind === 'sellout' && p.at >= first.toUTC().toISO()! && p.score < 100);
    if (pts.length === 0) continue;
    const soldAt = ev.status === 'soldout' ? (soldOutMoment(ev, soldOutSeen) ?? DateTime.fromISO(now)) : null;
    const horizon = Math.min(first.toMillis() + 7 * DAY, soldAt ? soldAt.toMillis() - HOUR : Infinity);
    const before = pts.filter((p) => Date.parse(p.at) <= horizon);
    const pt = before[before.length - 1];
    if (!pt) continue;
    const base = { eventId: ev.id, kind: 'sellout' as const, predicted: pt.probability, features: pt.features, type: ev.type, resolvedAt: now };
    if (soldAt) {
      out.push({ ...base, outcome: 1, speed: speedClass(ev, phases, first, soldAt) });
    } else if ((ev.date.localDate ?? '9999') < today) {
      out.push({ ...base, outcome: 0 });
    }
  }
  return out;
}

/** Tekst voor de app: wat gebeurde er, en klopte de verwachte drukte? */
export function rushOutcomeText(predicted: number, o: Pick<OutcomeRecord, 'outcome' | 'speed'>): string {
  const what =
    o.outcome === 1
      ? o.speed === 'presale'
        ? 'Al in de presale uitverkocht.'
        : 'Binnen een dag uitverkocht.'
      : o.speed === 'week1'
        ? 'Binnen een week uitverkocht, maar niet op de eerste dag.'
        : o.speed === 'later'
          ? 'Pas na meer dan een week uitverkocht.'
          : 'Na een week nog niet uitverkocht.';
  const verdict =
    predicted >= 60 ? (o.outcome === 1 ? 'De verwachting klopte.' : 'Het viel mee: de verwachting was te hoog.') : predicted < 40 ? (o.outcome === 1 ? 'Drukker dan verwacht.' : 'De verwachting klopte.') : o.outcome === 1 ? 'Druk, zoals verwacht.' : 'Rustiger dan "Druk".';
  return `${what} ${verdict}`;
}
