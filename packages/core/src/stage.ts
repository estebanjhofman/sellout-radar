import { DateTime } from 'luxon';
import type { EventDate, EventStatus, SalePhase } from './types';
import { earliestInstant } from './time';

/**
 * In welk tabblad een datum staat.
 *
 *  - 'upcoming' (Nog niet in de verkoop): er is nog geen enkele presale of algemene verkoop begonnen.
 *  - 'onsale' (Al in de verkoop): minstens één presale of algemene verkoop is begonnen.
 *
 * Een inschrijving of loting is nog geen verkoop. Een verkoopfase telt als begonnen zodra haar start
 * minstens tot op de dag bekend is en dat moment voorbij is (bij alleen een datum: vanaf 00:00 lokale tijd,
 * net als de herinneringen). Een start die alleen tot op de maand bekend is, verplaatst een datum niet:
 * we raden geen verkoopdata. Meldt een bron dat de datum in de verkoop, bijna uitverkocht of uitverkocht is,
 * dan staat hij altijd bij "Al in de verkoop".
 */
export type SaleStage = 'upcoming' | 'onsale';

export const STAGE_LABEL: Record<SaleStage, string> = {
  upcoming: 'Nog niet in de verkoop',
  onsale: 'Al in de verkoop',
};

const SELLING: ReadonlySet<EventStatus> = new Set<EventStatus>(['onsale', 'few_left', 'soldout']);

/** Is dit een echte verkoopfase (presale of algemene verkoop)? */
export function isSalePhase(p: Pick<SalePhase, 'kind'>): boolean {
  return p.kind === 'presale' || p.kind === 'general_sale';
}

/** Eerste verkoopmoment (presale of algemene verkoop) waarvan minstens de dag bekend is. */
export function firstSaleMoment(phases: SalePhase[]): DateTime | null {
  let best: DateTime | null = null;
  for (const p of phases) {
    if (!isSalePhase(p)) continue;
    if (p.start.precision !== 'exact' && p.start.precision !== 'date') continue;
    const t = earliestInstant(p.start);
    if (t && (!best || t < best)) best = t;
  }
  return best;
}

export function saleStage(ev: Pick<EventDate, 'status'>, phases: SalePhase[], now: string | DateTime): SaleStage {
  if (SELLING.has(ev.status)) return 'onsale';
  const first = firstSaleMoment(phases);
  if (!first) return 'upcoming';
  const n = typeof now === 'string' ? DateTime.fromISO(now) : now;
  return first.toMillis() <= n.toMillis() ? 'onsale' : 'upcoming';
}
