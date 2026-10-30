import { DateTime } from 'luxon';
import { earliestInstant, firstSaleStart, type OutcomeRecord, type SalePhase, type SpeedClass } from '@sellout/core';
import type { Catalog } from '../catalog';
import type { ScorePoint } from '../state';

/**
 * Uitkomsten voor de kalibratie. Uitverkocht = 1 (met snelheid), show voorbij zonder
 * uitverkocht-melding = 0. De voorspelling is de score van vlak vóór de eerste verkoop.
 */
export function detectOutcomes(
  cat: Catalog,
  phasesByEvent: Map<string, SalePhase[]>,
  history: Record<string, ScorePoint[]>,
  known: OutcomeRecord[],
  now: string,
): OutcomeRecord[] {
  const done = new Set(known.map((o) => o.eventId));
  const today = DateTime.fromISO(now).toISODate()!;
  const out: OutcomeRecord[] = [];
  for (const ev of cat.events.values()) {
    if (done.has(ev.id) || ev.status === 'cancelled' || ev.status === 'postponed') continue;
    const phases = phasesByEvent.get(ev.id) ?? [];
    const first = firstSaleStart(phases);
    const pts = history[ev.id] ?? [];
    if (!first || pts.length === 0) continue;
    const before = pts.filter((p) => p.at <= first.toUTC().toISO()!);
    const pt = before[before.length - 1] ?? pts[0]!;
    if (ev.status === 'soldout') {
      const soldAt = DateTime.fromISO(ev.soldOutAt ?? now);
      const general = phases.find((p) => p.kind === 'general_sale');
      const gStart = general ? earliestInstant(general.start) : null;
      const hours = soldAt.diff(first, 'hours').hours;
      const speed: SpeedClass = ev.soldOutInPresale || (gStart && soldAt < gStart) ? 'presale' : hours <= 24 ? 'day1' : hours <= 168 ? 'week1' : 'later';
      out.push({ eventId: ev.id, predicted: pt.probability, outcome: 1, features: pt.features, type: ev.type, speed, resolvedAt: now });
    } else if ((ev.date.localDate ?? '9999') < today && first.toMillis() < Date.parse(now)) {
      out.push({ eventId: ev.id, predicted: pt.probability, outcome: 0, features: pt.features, type: ev.type, resolvedAt: now });
    }
  }
  return out;
}
