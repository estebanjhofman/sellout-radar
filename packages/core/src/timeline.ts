import { DateTime } from 'luxon';
import type { EventDate, SalePhase, TimePoint } from './types';
import { earliestInstant, isKnown, latestInstant } from './time';

/**
 * Tijdlijn van alle verkoopfases van een datum, chronologisch.
 * Onbekende momenten staan onderaan als "nog niet bekend", nooit met een geraden datum.
 */

export type TimelineRole = 'opens' | 'deadline' | 'start' | 'end' | 'draw';
export type TimelineState = 'past' | 'now' | 'next' | 'future' | 'unknown';

export interface TimelineItem {
  key: string;
  phaseId: string;
  kind: SalePhase['kind'];
  role: TimelineRole;
  label: string;
  at: TimePoint;
  state: TimelineState;
  phase: SalePhase;
}

function labelFor(phase: SalePhase, role: TimelineRole): string {
  switch (phase.kind) {
    case 'registration':
      return role === 'deadline' ? `Inschrijving sluit: ${phase.name}` : `Inschrijving opent: ${phase.name}`;
    case 'lottery':
      if (role === 'deadline' || role === 'end') return `Loting sluit: ${phase.name}`;
      if (role === 'draw') return `Uitslag loting: ${phase.name}`;
      return `Loting opent: ${phase.name}`;
    case 'presale':
      return role === 'end' ? `Einde ${phase.name}` : phase.name;
    case 'general_sale':
      return role === 'end' ? 'Einde algemene verkoop' : 'Algemene verkoop';
  }
}

export function buildTimeline(phases: SalePhase[], now: string): TimelineItem[] {
  const nowDt = DateTime.fromISO(now);
  const items: TimelineItem[] = [];
  for (const p of phases) {
    const push = (role: TimelineRole, at: TimePoint | undefined) => {
      if (!at) return;
      items.push({ key: `${p.id}:${role}`, phaseId: p.id, kind: p.kind, role, label: labelFor(p, role), at, state: 'unknown', phase: p });
    };
    if (p.kind === 'registration') {
      // Een inschrijving zonder bekende start staat al open (er is een aanmeldlink); dan telt alleen de deadline.
      if (isKnown(p.start)) push('opens', p.start);
      push('deadline', p.deadline ?? p.end ?? { precision: 'unknown', tz: p.start.tz });
    } else if (p.kind === 'lottery') {
      push('opens', p.start);
      push('deadline', p.deadline ?? p.end ?? { precision: 'unknown', tz: p.start.tz });
      if (p.drawAt && isKnown(p.drawAt)) push('draw', p.drawAt);
    } else {
      push('start', p.start);
      // Een einde tonen we alleen als het bekend is.
      if (p.end && isKnown(p.end)) push('end', p.end);
    }
  }
  for (const it of items) {
    if (!isKnown(it.at)) continue;
    const lo = earliestInstant(it.at)!;
    const hi = latestInstant(it.at)!;
    it.state = hi < nowDt ? 'past' : lo > nowDt ? 'future' : 'now';
  }
  items.sort((a, b) => {
    const ka = isKnown(a.at) ? earliestInstant(a.at)!.toMillis() : Number.POSITIVE_INFINITY;
    const kb = isKnown(b.at) ? earliestInstant(b.at)!.toMillis() : Number.POSITIVE_INFINITY;
    if (ka !== kb) return ka - kb;
    return a.key.localeCompare(b.key);
  });
  const firstFuture = items.find((i) => i.state === 'future');
  if (firstFuture) firstFuture.state = 'next';
  return items;
}

/**
 * Het eerstvolgende moment waar je iets moet doen (inschrijven, presale, verkoop),
 * voor de aftelklok in het overzicht.
 */
export function nextAction(phases: SalePhase[], now: string): TimelineItem | null {
  const tl = buildTimeline(phases, now);
  return (
    tl.find((i) => (i.state === 'next' || i.state === 'now') && i.role !== 'end' && !(i.role === 'opens' && i.state === 'now')) ??
    null
  );
}

/** Fases die bij een bepaalde datum horen. */
export function phasesForEvent(event: Pick<EventDate, 'id'>, phases: SalePhase[]): SalePhase[] {
  return phases.filter((p) => p.eventIds.includes(event.id));
}

/** Is er een verkoopmoment (presale of algemene verkoop) met minstens een bekende dag? */
export function hasKnownSaleDate(phases: SalePhase[]): boolean {
  return phases.some(
    (p) => (p.kind === 'presale' || p.kind === 'general_sale' || p.kind === 'lottery') && (p.start.precision === 'exact' || p.start.precision === 'date'),
  );
}

/** Eerste moment waarop kaarten te koop zijn (vroegste presale of algemene verkoop). */
export function firstSaleStart(phases: SalePhase[]): DateTime | null {
  let best: DateTime | null = null;
  for (const p of phases) {
    if (p.kind === 'registration') continue;
    const t = earliestInstant(p.start);
    if (t && (!best || t < best)) best = t;
  }
  return best;
}

/**
 * De fase die een inschrijving ontsluit, voor één datum. Bij fases die per tijdzone zijn
 * gesplitst verwijst de inschrijving naar de basis-ID; dan kiezen we de groep van deze datum.
 */
export function unlockedPhase(registration: SalePhase, phasesOfEvent: SalePhase[]): SalePhase | undefined {
  const id = registration.unlocksPhaseId;
  if (!id) return undefined;
  return phasesOfEvent.find((p) => p.id === id) ?? phasesOfEvent.find((p) => p.id.startsWith(`${id}:`));
}
