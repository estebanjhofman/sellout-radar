import { DateTime } from 'luxon';
import { SOUTHERN, TROPICAL } from '../names';
import type { EventStatus, EventType, Fandom } from '../types';

/**
 * De negen factoren van de sellout-score, van zwaar naar licht.
 * Elke factor geeft een signaal tussen −1 en +1 (0 = neutraal of onbekend)
 * en een dekking tussen 0 en 1 (hoeveel data er is). Ontbrekende data is neutraal,
 * nooit een straf; ze verlaagt alleen de betrouwbaarheid.
 */

export const FACTORS = [
  { id: 1, key: 'proven_demand', name: 'Bewezen vraag op dezelfde tour' },
  { id: 2, key: 'resale', name: 'Resalepremie' },
  { id: 3, key: 'scale_jump', name: 'Schaalsprong' },
  { id: 4, key: 'market', name: 'Shows versus marktgrootte' },
  { id: 5, key: 'scarcity', name: 'Schaarste' },
  { id: 6, key: 'momentum', name: 'Momentum' },
  { id: 7, key: 'fandom', name: 'Type fanbase' },
  { id: 8, key: 'practical', name: 'Praktisch' },
  { id: 9, key: 'live', name: 'Signalen tijdens de verkoop' },
] as const;

export type FactorKey = (typeof FACTORS)[number]['key'];

export interface SiblingInfo {
  eventId: string;
  city: string;
  country: string;
  continent: string;
  capacity?: number;
  status: EventStatus;
  /** Uren van eerste verkoop tot uitverkocht, als bekend. */
  soldOutAfterHours?: number;
  /** Al uitverkocht vóórdat de algemene verkoop begon. */
  soldOutInPresale?: boolean;
  /** Eerste verkoopmoment (UTC ISO), als bekend. */
  firstSaleAt?: string;
  addedShow?: boolean;
  /**
   * Bevestigd dat er nog gewone kaarten te koop zijn. "In de verkoop" zegt op zich niets
   * over de beschikbaarheid (de Ticketmaster-status 'onsale' blijft ook bij uitverkocht staan),
   * dus alleen een bevestigde beschikbaarheid telt als tegensignaal.
   */
  available?: boolean;
}

export interface ScoreInputs {
  eventId: string;
  type: EventType;
  status: EventStatus;
  city: string;
  country: string;
  continent: string;
  capacity?: number;
  /** Lokale showdatum YYYY-MM-DD (weekdag, seizoen). */
  localDate?: string;
  outdoor?: boolean;
  /** Andere data van dezelfde tour (alle legs). */
  siblings: SiblingInfo[];
  /** Shows die expliciet wegens vraag zijn toegevoegd aan de tour. */
  addedForDemand?: number;
  resale?: {
    minResalePrice?: number;
    faceValueMin?: number;
    listingsPer1000?: number;
    /** Relatieve verandering van de laagste resaleprijs over 7 dagen, bijv. 0.2 = +20%. */
    priceTrend7d?: number;
    /** Doorverkoop is beperkt (Face Value Exchange, TicketSwap-plafond): premie zegt niets. */
    capped?: boolean;
  };
  previousVisit?: {
    /** Zelfde venue als nu: dan is de schaal gelijk, ook zonder bekende capaciteit. */
    sameVenue?: boolean;
    capacity?: number;
    soldOut?: boolean;
    yearsAgo?: number;
    scope: 'city' | 'country';
    venueName?: string;
    place?: string;
  };
  market?: {
    showsInCity: number;
    /** 0 voor de eerste datum in de stad. */
    indexInCity: number;
    isAddedShow?: boolean;
    /** Aantal shows in deze stad dat wegens vraag is toegevoegd (dan zegt "meerdere shows" niets negatiefs over de eerste). */
    addedInCity?: number;
    /** Inwoners van het verzorgingsgebied (stad, of land bij de enige show in het land). */
    marketPopulation?: number;
    /** Vraagschatting per plaats (bijv. luisteraars in het land / totale capaciteit). */
    demandPerSeat?: number;
  };
  scarcity?: {
    yearsSinceLastVisit?: number;
    onlyShowIn?: 'benelux' | 'europe' | 'country' | null;
    farewell?: boolean;
    reunion?: boolean;
    /** Kaarten gaan (ook) via een loting: de organisator verwacht meer vraag dan plaatsen. */
    ballot?: boolean;
  };
  momentum?: {
    /** Dagen tussen een nieuwe release en de verkoopstart (absolute waarde). */
    newReleaseWithinDays?: number;
    listenerGrowth90d?: number;
    videoGrowth90d?: number;
    charting?: boolean;
  };
  fandom?: Fandom;
  practical?: { priceVsComparable?: number; accessibility?: 'good' | 'average' | 'poor' };
  live?: { fewTicketsLeft?: boolean; queueSize?: number; extraRelease?: boolean };
  /** Nu (UTC ISO); maakt de berekening reproduceerbaar. */
  now: string;
}

export interface FactorResult {
  id: number;
  key: FactorKey;
  signal: number;
  coverage: number;
  /** Feiten voor de uitleg in gewone taal. */
  facts: Record<string, string | number | boolean | string[]>;
}

/** Referentie voor vraag per plaats; startwaarde, wordt met de kalibratie bijgesteld. */
export const REF_DEMAND_PER_SEAT = 20;

export const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

function result(id: number, signal: number, coverage: number, facts: FactorResult['facts'] = {}): FactorResult {
  const f = FACTORS[id - 1]!;
  return { id, key: f.key, signal: clamp(signal), coverage: clamp(coverage, 0, 1), facts };
}

/** 1. Bewezen vraag op dezelfde tour. */
export function provenDemand(inp: ScoreInputs): FactorResult {
  const now = DateTime.fromISO(inp.now);
  let wsum = 0;
  let ssum = 0;
  let considered = 0;
  const soldCities: string[] = [];
  let soldSameCountry = 0;
  let fastest: number | undefined;
  for (const s of inp.siblings) {
    if (s.eventId === inp.eventId) continue;
    if (s.status === 'cancelled' || s.status === 'postponed') continue;
    const informative =
      s.status === 'soldout' ||
      s.status === 'few_left' ||
      (s.available === true && (s.status === 'onsale' || (s.firstSaleAt !== undefined && DateTime.fromISO(s.firstSaleAt) <= now)));
    if (!informative) continue;
    const regionW = s.country === inp.country ? 1 : s.continent === inp.continent ? 0.6 : 0.3;
    let capW = 0.7;
    if (s.capacity && inp.capacity) {
      capW =
        s.status === 'soldout' && s.capacity >= inp.capacity
          ? 1
          : Math.exp(-Math.abs(Math.log(s.capacity / inp.capacity)));
    }
    const w = regionW * capW;
    let sig: number;
    if (s.status === 'soldout') sig = 1;
    else if (s.status === 'few_left') sig = 0.6;
    else {
      const days = s.firstSaleAt ? now.diff(DateTime.fromISO(s.firstSaleAt), 'days').days : undefined;
      sig = days === undefined ? -0.2 : days > 7 ? -0.6 : -0.1;
    }
    wsum += w;
    ssum += w * sig;
    considered++;
    if (s.status === 'soldout') {
      const key = `${s.city}|${s.country}`;
      if (!soldCities.includes(key)) soldCities.push(key);
      if (s.country === inp.country) soldSameCountry++;
      if (s.soldOutAfterHours !== undefined) fastest = Math.min(fastest ?? Infinity, s.soldOutAfterHours);
    }
  }
  const added = inp.addedForDemand ?? 0;
  // Hoe dichtbij is het bewijs? Uitverkocht in hetzelfde land zegt meer dan op een ander continent.
  let relevance = 0;
  for (const s of inp.siblings) {
    if (s.eventId === inp.eventId || (s.status !== 'soldout' && s.status !== 'few_left' && s.available !== true)) continue;
    relevance = Math.max(relevance, s.country === inp.country ? 1 : s.continent === inp.continent ? 0.6 : 0.3);
  }
  let signal = wsum > 0 ? (ssum / wsum) * (0.5 + 0.5 * relevance) : 0;
  signal += Math.min(0.4, 0.15 * added);
  if (fastest !== undefined && fastest <= 24) signal += 0.2;
  let coverage = Math.min(1, wsum / 1.5) * (wsum > 0 ? 0.4 + 0.6 * relevance : 1);
  if (added > 0) coverage = Math.max(coverage, 0.5);
  const soldCount = inp.siblings.filter((s) => s.eventId !== inp.eventId && s.status === 'soldout').length;
  return result(1, signal, coverage, {
    considered,
    soldCount,
    soldCities,
    soldSameCountry,
    added,
    ...(fastest !== undefined ? { fastestHours: fastest } : {}),
  });
}

/** 2. Resalepremie. */
export function resalePremium(inp: ScoreInputs): FactorResult {
  const r = inp.resale;
  if (!r) return result(2, 0, 0);
  if (r.capped) return result(2, 0, 0, { capped: true });
  if (r.minResalePrice && r.faceValueMin) {
    const premium = r.minResalePrice / r.faceValueMin;
    let signal = Math.log(premium) / Math.log(2.5);
    if (r.priceTrend7d !== undefined) signal += r.priceTrend7d > 0.1 ? 0.15 : r.priceTrend7d < -0.1 ? -0.15 : 0;
    return result(2, signal, 1, {
      premiumPct: Math.round((premium - 1) * 100),
      ...(r.priceTrend7d !== undefined ? { trendPct: Math.round(r.priceTrend7d * 100) } : {}),
    });
  }
  if (r.listingsPer1000 !== undefined) {
    const signal = r.listingsPer1000 < 5 ? 0.2 : r.listingsPer1000 > 50 ? -0.3 : 0;
    return result(2, signal, 0.4, { listingsPer1000: Math.round(r.listingsPer1000) });
  }
  return result(2, 0, 0);
}

/** 3. Schaalsprong ten opzichte van de vorige show in dezelfde stad of hetzelfde land. */
export function scaleJump(inp: ScoreInputs): FactorResult {
  const pv = inp.previousVisit;
  if (!pv) return result(3, 0, 0);
  const ratio = pv.sameVenue ? 1 : pv.capacity && inp.capacity ? inp.capacity / pv.capacity : undefined;
  if (ratio === undefined) return result(3, 0, 0);
  const base = pv.soldOut === true ? 0.8 : pv.soldOut === false ? -0.1 : 0.4;
  const signal = base - 0.9 * Math.log(ratio);
  let coverage = pv.scope === 'city' ? 1 : 0.7;
  if (pv.soldOut === undefined) coverage *= 0.6;
  if ((pv.yearsAgo ?? 0) > 6) coverage *= 0.6;
  return result(3, signal, coverage, {
    ratio: Math.round(ratio * 10) / 10,
    scope: pv.scope,
    ...(pv.sameVenue ? { sameVenue: true } : {}),
    ...(inp.type === 'festival' || inp.type === 'sport' || inp.type === 'other' ? { edition: true } : {}),
    ...(pv.place ? { place: pv.place } : {}),
    ...(pv.venueName ? { venueName: pv.venueName } : {}),
    ...(pv.soldOut !== undefined ? { prevSoldOut: pv.soldOut } : {}),
  });
}

/** 4. Aantal shows versus marktgrootte, inclusief de volgorde binnen de stad. */
export function marketSize(inp: ScoreInputs): FactorResult {
  const m = inp.market;
  if (!m) return result(4, 0, 0);
  let signal = m.showsInCity <= 1 ? 0.2 : m.showsInCity === 2 ? 0 : m.showsInCity === 3 ? -0.25 : -0.5;
  if (m.marketPopulation && inp.capacity) {
    const seatsPerResident = (inp.capacity * m.showsInCity) / m.marketPopulation;
    if (seatsPerResident > 0.1) signal -= 0.3;
    else if (m.marketPopulation > 5_000_000) signal += 0.15;
  }
  if (m.demandPerSeat !== undefined && m.demandPerSeat > 0) {
    signal = 0.5 * signal + 0.5 * clamp(Math.log(m.demandPerSeat / REF_DEMAND_PER_SEAT) / Math.log(4));
  }
  // Meerdere shows omdat er wegens vraag zijn bijgekomen: geen spreiding van vraag voor de oorspronkelijke data.
  if ((m.addedInCity ?? 0) > 0 && !m.isAddedShow) signal = Math.max(signal, 0);
  else signal -= 0.1 * m.indexInCity;
  if (m.isAddedShow) signal -= 0.25;
  return result(4, signal, m.demandPerSeat !== undefined ? 0.9 : 0.5, {
    showsInCity: m.showsInCity,
    indexInCity: m.indexInCity,
    isAddedShow: !!m.isAddedShow,
    addedInCity: m.addedInCity ?? 0,
    city: inp.city,
    country: inp.country,
  });
}

/** 5. Schaarste: lang niet geweest, enige show in de regio, afscheid of reünie. */
export function scarcity(inp: ScoreInputs): FactorResult {
  const sc = inp.scarcity;
  if (!sc) return result(5, 0, 0);
  let s = 0;
  let known = false;
  const facts: FactorResult['facts'] = {};
  if (sc.yearsSinceLastVisit !== undefined) {
    known = true;
    const y = sc.yearsSinceLastVisit;
    s += y >= 5 ? 0.4 : y >= 3 ? 0.2 : y <= 1 ? -0.2 : 0;
    facts.yearsSinceLastVisit = y;
  }
  if (sc.onlyShowIn) {
    known = true;
    s += sc.onlyShowIn === 'europe' ? 0.5 : sc.onlyShowIn === 'benelux' ? 0.3 : 0.15;
    facts.onlyShowIn = sc.onlyShowIn;
  }
  if (sc.farewell) {
    known = true;
    s += 0.5;
    facts.farewell = true;
  }
  if (sc.reunion) {
    known = true;
    s += 0.5;
    facts.reunion = true;
  }
  if (sc.ballot) {
    known = true;
    s += 0.4;
    facts.ballot = true;
  }
  return result(5, s, known ? 1 : 0, facts);
}

/** 6. Momentum: nieuwe release, groei in luisteraars en video, hitlijsten. */
export function momentum(inp: ScoreInputs): FactorResult {
  const m = inp.momentum;
  if (!m) return result(6, 0, 0);
  let s = 0;
  let parts = 0;
  const facts: FactorResult['facts'] = {};
  if (m.newReleaseWithinDays !== undefined) {
    parts++;
    if (Math.abs(m.newReleaseWithinDays) <= 45) {
      s += 0.3;
      facts.newRelease = true;
    }
  }
  if (m.listenerGrowth90d !== undefined) {
    parts++;
    s += clamp(m.listenerGrowth90d / 0.5, -0.5, 0.5);
    facts.listenerGrowthPct = Math.round(m.listenerGrowth90d * 100);
  }
  if (m.videoGrowth90d !== undefined) {
    parts++;
    s += clamp(m.videoGrowth90d / 0.5, -0.3, 0.3);
    facts.videoGrowthPct = Math.round(m.videoGrowth90d * 100);
  }
  if (m.charting !== undefined) {
    parts++;
    if (m.charting) {
      s += 0.2;
      facts.charting = true;
    }
  }
  return result(6, s, Math.min(1, parts / 3), facts);
}

/** 7. Type fanbase. */
export function fandomFactor(inp: ScoreInputs): FactorResult {
  if (!inp.fandom || inp.fandom === 'unknown') return result(7, 0, 0);
  return inp.fandom === 'organized'
    ? result(7, 0.7, 1, { organized: true })
    : result(7, 0, 1, { organized: false });
}

/** 8. Praktisch: weekdag, seizoen, binnen/buiten, prijs, bereikbaarheid. */
export function practical(inp: ScoreInputs): FactorResult {
  let s = 0;
  let coverage = 0;
  const facts: FactorResult['facts'] = {};
  if (inp.localDate) {
    const dt = DateTime.fromISO(inp.localDate);
    const wd = dt.weekday;
    s += wd === 5 || wd === 6 ? 0.25 : wd === 7 ? 0.1 : -0.1;
    facts.weekday = wd;
    coverage = 0.7;
    if (inp.outdoor && !TROPICAL.has(inp.country)) {
      const mo = dt.month;
      const south = SOUTHERN.has(inp.country);
      const winter = south ? mo >= 6 && mo <= 8 : mo >= 11 || mo <= 3;
      const summer = south ? mo === 12 || mo <= 2 : mo >= 6 && mo <= 8;
      if (winter) {
        s -= 0.3;
        facts.outdoorWinter = true;
      } else if (summer) {
        s += 0.05;
        facts.outdoorSummer = true;
      }
    }
  }
  const p = inp.practical;
  if (p?.priceVsComparable !== undefined) {
    coverage = 1;
    if (p.priceVsComparable > 1.3) {
      s -= 0.3;
      facts.expensive = Math.round((p.priceVsComparable - 1) * 100);
    } else if (p.priceVsComparable < 0.8) {
      s += 0.15;
      facts.cheap = Math.round((1 - p.priceVsComparable) * 100);
    }
  }
  if (p?.accessibility === 'poor') {
    s -= 0.2;
    facts.poorAccess = true;
  }
  return result(8, s, coverage, facts);
}

/** 9. Signalen tijdens de verkoop. */
export function liveSignals(inp: ScoreInputs): FactorResult {
  const l = inp.live;
  if (!l) return result(9, 0, 0);
  let s = 0;
  let known = false;
  const facts: FactorResult['facts'] = {};
  if (l.fewTicketsLeft) {
    known = true;
    s += 0.8;
    facts.fewTicketsLeft = true;
  }
  if (l.queueSize !== undefined) {
    known = true;
    facts.queueSize = l.queueSize;
    if (inp.capacity) {
      const ratio = l.queueSize / inp.capacity;
      s += ratio > 3 ? 0.8 : ratio > 1 ? 0.5 : ratio > 0.3 ? 0.2 : -0.1;
    } else {
      s += l.queueSize > 100_000 ? 0.6 : l.queueSize > 20_000 ? 0.3 : 0;
    }
  }
  if (l.extraRelease) {
    known = true;
    s += 0.3;
    facts.extraRelease = true;
  }
  return result(9, s, known ? 1 : 0, facts);
}

export const FACTOR_FUNCTIONS = [
  provenDemand,
  resalePremium,
  scaleJump,
  marketSize,
  scarcity,
  momentum,
  fandomFactor,
  practical,
  liveSignals,
] as const;
