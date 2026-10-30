import type { EventDate, SalePhase } from './types';
import { hasKnownSaleDate } from './timeline';

export type BadgeKey =
  | 'soldout'
  | 'few_left'
  | 'added_show'
  | 'sale_date_unknown'
  | 'cancelled'
  | 'postponed'
  | 'unconfirmed'
  | 'conflict';

export interface Badge {
  key: BadgeKey;
  label: string;
  tone: 'strong' | 'info' | 'warning' | 'muted';
}

/** Badges op een kaart of detailpagina. Volgorde: belangrijkste eerst. */
export function eventBadges(ev: EventDate, phases: SalePhase[], opts: { hasConflict?: boolean } = {}): Badge[] {
  const out: Badge[] = [];
  if (ev.status === 'cancelled') out.push({ key: 'cancelled', label: 'Geannuleerd', tone: 'muted' });
  if (ev.status === 'postponed') out.push({ key: 'postponed', label: 'Uitgesteld', tone: 'warning' });
  if (ev.status === 'soldout') out.push({ key: 'soldout', label: 'Uitverkocht', tone: 'strong' });
  if (ev.status === 'few_left') out.push({ key: 'few_left', label: 'Bijna uitverkocht', tone: 'warning' });
  if (ev.addedShow) out.push({ key: 'added_show', label: 'Extra show toegevoegd', tone: 'info' });
  const mine = phases.filter((p) => p.eventIds.includes(ev.id));
  const saleStarted = ev.status === 'onsale' || ev.status === 'few_left' || ev.status === 'soldout';
  if (!saleStarted && ev.status !== 'cancelled' && !hasKnownSaleDate(mine)) {
    out.push({ key: 'sale_date_unknown', label: 'Verkoopdatum nog onbekend', tone: 'muted' });
  }
  if (ev.verification === 'unconfirmed') out.push({ key: 'unconfirmed', label: 'Nog niet officieel bevestigd', tone: 'warning' });
  if (opts.hasConflict) out.push({ key: 'conflict', label: 'Bronnen spreken elkaar tegen', tone: 'warning' });
  return out;
}
