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

// ---------------------------------------------------------------------------
// Na de verkoop: In de verkoop → Uitverkocht of Nog beschikbaar
// ---------------------------------------------------------------------------

/**
 * Waar een datum hoort:
 *  - 'upcoming'  Nog niet in de verkoop
 *  - 'onsale'    In de verkoop: de verkoop loopt, tot één dag na het laatste verkoopmoment
 *  - 'soldout'   Uitverkocht, en de verkoop is voorbij
 *  - 'available' Niet uitverkocht, en de verkoop is voorbij (nog kaarten)
 */
export type SaleBucket = 'upcoming' | 'onsale' | 'soldout' | 'available';

/** Hoe lang een datum na het laatste verkoopmoment nog bij "In de verkoop" staat. */
export const SALE_GRACE_DAYS = 1;

/**
 * Laatste verkoopmoment (start van de laatste presale of algemene verkoop) waarvan minstens de dag
 * bekend is. Bij alleen een datum telt het einde van die dag, want het uur is onbekend.
 */
export function lastSaleMoment(phases: SalePhase[]): DateTime | null {
  let best: DateTime | null = null;
  for (const p of phases) {
    if (!isSalePhase(p)) continue;
    if (p.start.precision !== 'exact' && p.start.precision !== 'date') continue;
    let t = earliestInstant(p.start);
    if (!t) continue;
    if (p.start.precision === 'date') t = t.plus({ days: 1 });
    if (!best || t > best) best = t;
  }
  return best;
}

/**
 * Bij welke lijst een datum nu hoort. Een datum die in de verkoop is zonder bekend verkoopmoment
 * (alleen een bron die "in de verkoop" meldt) kan niet "nu" in de verkoop zijn; die telt als voorbij.
 */
export function saleBucket(ev: Pick<EventDate, 'status'>, phases: SalePhase[], now: string | DateTime): SaleBucket {
  if (saleStage(ev, phases, now) === 'upcoming') return 'upcoming';
  const n = typeof now === 'string' ? DateTime.fromISO(now) : now;
  const last = lastSaleMoment(phases);
  if (last && n.toMillis() < last.plus({ days: SALE_GRACE_DAYS }).toMillis()) return 'onsale';
  return ev.status === 'soldout' ? 'soldout' : 'available';
}
