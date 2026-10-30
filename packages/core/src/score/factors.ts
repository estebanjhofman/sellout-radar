import { DateTime } from 'luxon';
import type { EventStatus, EventType, Fandom } from '../types';

/**
 * De factoren van de twee scores. Elke factor geeft een signaal tussen −1 en +1 (0 = neutraal of
 * onbekend) en een dekking tussen 0 en 1 (hoeveel data er is). Ontbrekende data is neutraal, nooit een
 * straf; ze verlaagt alleen de betrouwbaarheid.
 *
 *  - Verwachte drukte (vóór de verkoop): hoe moeilijk wordt het om bij de eerste verkoop een kaart te
 *    krijgen? Populariteit en groei tegenover het aantal plekken, de vorige tour of editie, schaarste,
 *    het soort fanbase en de vraag elders op dezelfde tour.
 *  - Uitverkoopkans (tijdens de verkoop): de kans dat de datum vóór de showdag uitverkoopt, op basis van
 *    echte verkoopsignalen. Startpunt is de verwachte drukte van vlak vóór de verkoop.
 */

export type ScoreKind = 'rush' | 'sellout';

export const RUSH_FACTORS = [
  { key: 'demand_supply', name: 'Populariteit tegenover plekken' },
  { key: 'growth', name: 'Groei en hitnoteringen' },
  { key: 'previous_tour', name: 'Vorige tour of editie' },
  { key: 'scarcity', name: 'Schaarste' },
  { key: 'fandom', name: 'Soort fanbase' },
  { key: 'tour_demand', name: 'Vraag elders op deze tour' },
] as const;

export const SELLOUT_FACTORS = [
  { key: 'prior', name: 'Verwachte drukte vooraf' },
  { key: 'sold_out_dates', name: 'Uitverkochte datums' },
  { key: 'added_shows', name: 'Extra shows' },
  { key: 'sales_speed', name: 'Verkoopsnelheid' },
  { key: 'resale', name: 'Doorverkoop' },
  { key: 'few_left', name: 'Bijna uitverkocht' },
] as const;

export type RushFactorKey = (typeof RUSH_FACTORS)[number]['key'];
export type SelloutFactorKey = (typeof SELLOUT_FACTORS)[number]['key'];
export type FactorKey = RushFactorKey | SelloutFactorKey;

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

/** Een hitnotering met jaartal (uit een bron). */
export interface ChartHit {
  chart: string;
  country: string;
  title: string;
  peak: number;
  year: number;
}

export interface ScoreInputs {
  eventId: string;
  type: EventType;
  status: EventStatus;
  city: string;
  country: string;
  continent: string;
  capacity?: number;
  /** Lokale showdatum YYYY-MM-DD. */
  localDate?: string;
  outdoor?: boolean;
  /** Eerste verkoopmoment van deze datum (UTC ISO), als minstens de dag bekend is. */
  firstSaleAt?: string;
  /** Andere data van dezelfde tour (alle legs). */
  siblings: SiblingInfo[];
  /** Shows die expliciet wegens vraag zijn toegevoegd aan de tour. */
  addedForDemand?: number;
  market?: {
    showsInCity: number;
    /** 0 voor de eerste datum in de stad. */
    indexInCity: number;
    isAddedShow?: boolean;
    /** Aantal shows in deze stad dat wegens vraag is toegevoegd. */
    addedInCity?: number;
    /** Plekken van deze tour in dit land: som van capaciteit × shows (alleen datums met bekende capaciteit). */
    seatsInCountry?: number;
    showsInCountry?: number;
  };
  popularity?: {
    /** Luisteraars op Last.fm, wereldwijd (laatste meting). */
    listeners?: number;
    /** Groei van dat aantal over ongeveer 90 dagen (0,1 = +10%). */
    listenerGrowth90d?: number;
    /** Positie in de Last.fm-toplijst van dit land; null = niet in de opgevraagde lijst. */
    countryRank?: number | null;
    countryListSize?: number;
    /** Positie in de wereldwijde Last.fm-toplijst; null = niet in de opgevraagde lijst. */
    globalRank?: number | null;
    globalListSize?: number;
    /** Inwoners van het land in miljoenen. */
    populationM?: number;
    /** Hitnoteringen (leeg = gezocht, niets gevonden; ontbreekt = onbekend). */
    charts?: ChartHit[];
    /** Dagen tussen een nieuwe release en de verkoopstart (absolute waarde). */
    newReleaseWithinDays?: number;
  };
  previousVisit?: {
    /** Zelfde venue als nu: dan is de schaal gelijk, ook zonder bekende capaciteit. */
    sameVenue?: boolean;
    capacity?: number;
    /** Aantal shows bij dat vorige bezoek op die plek (standaard 1). */
    shows?: number;
    soldOut?: boolean;
    /** Deel van de kaarten dat verkocht werd (0–1), als een bron dat noemt. */
    sellThrough?: number;
    /** Binnen hoeveel uur uitverkocht (of `sellThrough` bereikt), als een bron dat noemt. */
    withinHours?: number;
    yearsAgo?: number;
    year?: number;
    scope: 'city' | 'country';
    venueName?: string;
    place?: string;
    tourName?: string;
  };
  scarcity?: {
    yearsSinceLastVisit?: number;
    onlyShowIn?: 'benelux' | 'europe' | 'country' | null;
    farewell?: boolean;
    reunion?: boolean;
    /** Kaarten gaan (ook) via een loting: de organisator verwacht meer vraag dan plaatsen. */
    ballot?: boolean;
  };
  fandom?: Fandom;
  resale?: {
    minResalePrice?: number;
    faceValueMin?: number;
    listingsPer1000?: number;
    /** Relatieve verandering van de laagste resaleprijs over 7 dagen, bijv. 0.2 = +20%. */
    priceTrend7d?: number;
    /** Doorverkoop is beperkt (Face Value Exchange, TicketSwap-plafond): premie zegt niets. */
    capped?: boolean;
  };
  live?: { fewTicketsLeft?: boolean; queueSize?: number; extraRelease?: boolean };
  /** Alleen voor de uitverkoopkans: de verwachte drukte van vlak vóór de verkoop. */
  rushPrior?: {
    probability: number;
    score: number;
    coverage: number;
    /** true = vastgelegd vóór de verkoop; false = achteraf geschat (de datum was al in de verkoop). */
    frozen: boolean;
  };
  /** Nu (UTC ISO); maakt de berekening reproduceerbaar. */
  now: string;
}

export interface FactorResult {
  key: FactorKey;
  signal: number;
  coverage: number;
  /** Feiten voor de uitleg in gewone taal. */
  facts: Record<string, string | number | boolean | string[]>;
}

export const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const sigmoidLogit = (p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};

function result(key: FactorKey, signal: number, coverage: number, facts: FactorResult['facts'] = {}): FactorResult {
  return { key, signal: clamp(signal), coverage: clamp(coverage, 0, 1), facts };
}

// ---------------------------------------------------------------------------
// Verwachte drukte
// ---------------------------------------------------------------------------

/**
 * Aanname voor "luisteraars naar verhouding van het inwonertal": de Last.fm-luisteraars van een artiest
 * zijn verspreid over ongeveer 1 miljard mensen (vooral Europa en Noord-Amerika). Alleen de verhouding
 * tussen markten telt; het gewicht van de factor wordt met de kalibratie bijgesteld.
 */
export const LASTFM_REACH_M = 1000;
/** Referentie: ongeveer één (geschatte) luisteraar per plek is neutraal. */
export const REF_FANS_PER_SEAT = 1;

/** 1. Populariteit en groei tegenover het aantal plekken (capaciteit × aantal shows). */
export function demandSupply(inp: ScoreInputs): FactorResult {
  const p = inp.popularity;
  const m = inp.market;
  const seats = m?.seatsInCountry ?? (inp.capacity ? inp.capacity * (m?.showsInCity ?? 1) : undefined);
  if (!p?.listeners || !p.populationM || !seats) return result('demand_supply', 0, 0);
  let fans = p.listeners * (p.populationM / LASTFM_REACH_M);
  let coverage = 0.55;
  let local: number | undefined;
  // Per land: staat de artiest hoger in de toplijst van dit land dan wereldwijd, dan is hij hier populairder.
  if ((p.countryRank !== undefined && p.countryListSize) || (p.globalRank !== undefined && p.globalListSize)) {
    const cPos = p.countryRank ?? (p.countryListSize ? p.countryListSize * 1.5 : undefined);
    const gPos = p.globalRank ?? (p.globalListSize ? p.globalListSize * 1.5 : undefined);
    if (cPos && gPos) {
      local = clamp(Math.sqrt(gPos / cPos), 1 / 3, 3);
      fans *= local;
      coverage = 0.8;
    }
  }
  const ratio = fans / seats;
  let signal = Math.log(ratio / REF_FANS_PER_SEAT) / Math.log(4);
  // Bij meerdere shows in de stad gaat de eerste datum het eerst weg; een later toegevoegde show trekt minder.
  signal -= 0.1 * (m?.indexInCity ?? 0);
  if (m?.isAddedShow) signal -= 0.2;
  return result('demand_supply', signal, coverage, {
    listeners: p.listeners,
    seats,
    shows: m?.showsInCountry ?? m?.showsInCity ?? 1,
    country: inp.country,
    level: ratio >= 2 ? 'krap' : ratio <= 0.5 ? 'ruim' : 'gemiddeld',
    ...(local !== undefined ? { localFactor: round(local, 2) } : {}),
    ...(typeof p.countryRank === 'number' ? { countryRank: p.countryRank } : {}),
  });
}

/** 2. Groei: luisteraars, positie in de toplijst van het land, hitnoteringen en een nieuwe release. */
export function growthFactor(inp: ScoreInputs): FactorResult {
  const p = inp.popularity;
  if (!p) return result('growth', 0, 0);
  let s = 0;
  let parts = 0;
  const facts: FactorResult['facts'] = {};
  if (p.listenerGrowth90d !== undefined) {
    parts++;
    s += clamp(p.listenerGrowth90d / 0.5, -0.5, 0.5);
    facts.listenerGrowthPct = Math.round(p.listenerGrowth90d * 100);
  }
  if (p.countryRank !== undefined && p.countryListSize) {
    parts++;
    if (p.countryRank !== null && p.countryRank <= 50) {
      s += 0.2;
      facts.countryRank = p.countryRank;
      facts.country = inp.country;
    }
  }
  if (p.charts !== undefined) {
    parts++;
    const year = DateTime.fromISO(inp.now).year;
    const recent = p.charts.filter((c) => c.year >= year - 1).sort((a, b) => a.peak - b.peak);
    const home = recent.find((c) => c.country === inp.country);
    const best = recent[0];
    const use = home && home.peak <= 40 ? home : best && best.peak <= 10 ? best : undefined;
    if (use) {
      s += use === home ? (use.peak <= 10 ? 0.3 : 0.15) : 0.15;
      facts.chartTitle = use.title;
      facts.chartName = use.chart;
      facts.chartPeak = use.peak;
      facts.chartYear = use.year;
    }
  }
  if (p.newReleaseWithinDays !== undefined) {
    parts++;
    if (Math.abs(p.newReleaseWithinDays) <= 45) {
      s += 0.3;
      facts.newRelease = true;
    }
  }
  return result('growth', s, Math.min(1, parts / 3), facts);
}

/** 3. De vorige tour (zaalgrootte en of die uitverkocht was) of de vorige editie. */
export function previousTour(inp: ScoreInputs): FactorResult {
  const pv = inp.previousVisit;
  if (!pv) return result('previous_tour', 0, 0);
  const showsNow = inp.market?.showsInCity ?? 1;
  const nowSeats =
    pv.scope === 'country' ? (inp.market?.seatsInCountry ?? (inp.capacity ? inp.capacity * showsNow : undefined)) : inp.capacity ? inp.capacity * showsNow : undefined;
  const prevSeats = pv.capacity ? pv.capacity * (pv.shows ?? 1) : undefined;
  let ratio: number | undefined;
  if (pv.sameVenue && (pv.shows ?? 1) === showsNow) ratio = 1;
  else if (nowSeats && prevSeats) ratio = nowSeats / prevSeats;
  else if (pv.sameVenue) ratio = (showsNow / (pv.shows ?? 1)) || 1;
  // Vrijwel helemaal verkocht (≥ 99%) telt als uitverkocht.
  const soldOut = pv.soldOut ?? (pv.sellThrough !== undefined && pv.sellThrough >= 0.99 ? true : undefined);
  const st = pv.sellThrough;
  if (ratio === undefined && soldOut === undefined && st === undefined) return result('previous_tour', 0, 0);
  const fast = pv.withinHours !== undefined && pv.withinHours <= 24 && (soldOut === true || (st !== undefined && st >= 0.9));
  let base: number;
  if (soldOut === true) base = fast ? 1 : 0.8;
  else if (st !== undefined && st >= 0.9 && fast) base = 0.8;
  else if (st !== undefined && st >= 0.95) base = 0.5;
  else if (st !== undefined && st >= 0.85) base = 0.2;
  else if (soldOut === false || st !== undefined) base = -0.2;
  else base = 0.3;
  const signal = ratio === undefined ? base : base - 0.9 * Math.log(ratio);
  let coverage = pv.scope === 'city' ? 1 : 0.7;
  if (soldOut === undefined && st === undefined) coverage *= 0.6;
  if ((pv.yearsAgo ?? 0) > 6) coverage *= 0.6;
  if (ratio === undefined) coverage *= 0.5;
  return result('previous_tour', signal, coverage, {
    scope: pv.scope,
    ...(ratio !== undefined ? { ratio: round(ratio, 1) } : {}),
    ...(pv.sameVenue ? { sameVenue: true } : {}),
    ...(inp.type === 'festival' || inp.type === 'sport' || inp.type === 'other' ? { edition: true } : {}),
    ...(pv.place ? { place: pv.place } : {}),
    ...(pv.venueName ? { venueName: pv.venueName } : {}),
    ...(soldOut !== undefined ? { prevSoldOut: soldOut } : {}),
    ...(st !== undefined && soldOut !== true ? { sellThroughPct: Math.round(st * 100) } : {}),
    ...(fast ? { fast: true, fastHours: pv.withinHours! } : {}),
    ...(pv.year ? { year: pv.year } : {}),
    ...(pv.tourName ? { tourName: pv.tourName } : {}),
  });
}

/** 4. Schaarste: afscheid, reünie, loting, enige show in land/Benelux/Europa, lang niet geweest. */
export function scarcity(inp: ScoreInputs): FactorResult {
  const sc = inp.scarcity;
  if (!sc) return result('scarcity', 0, 0);
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
  return result('scarcity', s, known ? 1 : 0, facts);
}

/** 5. Soort fanbase. */
export function fandomFactor(inp: ScoreInputs): FactorResult {
  if (!inp.fandom || inp.fandom === 'unknown') return result('fandom', 0, 0);
  return inp.fandom === 'organized' ? result('fandom', 0.7, 1, { organized: true }) : result('fandom', 0, 1, { organized: false });
}

/** 6. Vraag elders op deze tour: data die al in de verkoop zijn (uitverkocht, extra shows). */
export function tourDemand(inp: ScoreInputs): FactorResult {
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
      capW = s.status === 'soldout' && s.capacity >= inp.capacity ? 1 : Math.exp(-Math.abs(Math.log(s.capacity / inp.capacity)));
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
  return result('tour_demand', signal, coverage, {
    considered,
    soldCount,
    soldCities,
    soldSameCountry,
    added,
    ...(fastest !== undefined ? { fastestHours: fastest } : {}),
  });
}

// ---------------------------------------------------------------------------
// Uitverkoopkans
// ---------------------------------------------------------------------------

/** 1. De verwachte drukte van vlak vóór de verkoop is het startpunt. */
export function priorFactor(inp: ScoreInputs): FactorResult {
  const rp = inp.rushPrior;
  if (!rp) return result('prior', 0, 0);
  // Op logit-schaal t.o.v. 25% ("binnen een dag uitverkocht" is zeldzamer dan "ooit uitverkocht").
  // De onzekerheid zit al in de kans zelf (weinig gegevens = dicht bij het gemiddelde); een achteraf
  // geschatte drukte telt minder zwaar, omdat die niet vóór de verkoop is vastgelegd.
  const signal = (sigmoidLogit(rp.probability) - sigmoidLogit(0.25)) / 3;
  return result('prior', signal, rp.frozen ? 1 : 0.6, { rush: rp.score, frozen: rp.frozen });
}

/** 2. Uitverkochte datums van dezelfde tour (dichtbij telt zwaarder), en datums die lang beschikbaar blijven. */
export function soldOutDates(inp: ScoreInputs): FactorResult {
  const now = DateTime.fromISO(inp.now);
  let wsum = 0;
  let ssum = 0;
  let relevance = 0;
  const soldCities: string[] = [];
  let soldSameCity = 0;
  let soldSameCountry = 0;
  let lingering = 0;
  for (const s of inp.siblings) {
    if (s.eventId === inp.eventId || s.status === 'cancelled' || s.status === 'postponed') continue;
    const sameCity = s.city === inp.city && s.country === inp.country;
    const regionW = sameCity ? 1 : s.country === inp.country ? 0.9 : s.continent === inp.continent ? 0.6 : 0.3;
    let capW = 0.7;
    if (s.capacity && inp.capacity) {
      capW = s.status === 'soldout' && s.capacity >= inp.capacity ? 1 : Math.exp(-Math.abs(Math.log(s.capacity / inp.capacity)));
    }
    let sig: number | undefined;
    if (s.status === 'soldout') sig = 1;
    else if (s.status === 'few_left') sig = 0.6;
    else if (s.available === true && s.firstSaleAt && now.diff(DateTime.fromISO(s.firstSaleAt), 'days').days > 7) {
      sig = -0.5;
      lingering++;
    }
    if (sig === undefined) continue;
    const w = regionW * capW;
    wsum += w;
    ssum += w * sig;
    relevance = Math.max(relevance, regionW);
    if (s.status === 'soldout') {
      const key = `${s.city}|${s.country}`;
      if (!soldCities.includes(key)) soldCities.push(key);
      if (sameCity) soldSameCity++;
      if (s.country === inp.country) soldSameCountry++;
    }
  }
  if (wsum === 0) return result('sold_out_dates', 0, 0);
  const signal = (ssum / wsum) * (0.5 + 0.5 * relevance);
  const coverage = Math.min(1, wsum / 1.5) * (0.4 + 0.6 * relevance);
  const soldCount = inp.siblings.filter((s) => s.eventId !== inp.eventId && s.status === 'soldout').length;
  return result('sold_out_dates', signal, coverage, { soldCount, soldCities, soldSameCity, soldSameCountry, lingering });
}

/** 3. Extra shows wegens vraag. Een toegevoegde show zelf verkoopt meestal trager. */
export function addedShows(inp: ScoreInputs): FactorResult {
  const added = inp.addedForDemand ?? 0;
  const m = inp.market;
  const addedInCity = m?.addedInCity ?? 0;
  if (added === 0 && !m?.isAddedShow && addedInCity === 0) return result('added_shows', 0, 0);
  // De vraag die tot de extra show leidde, zit al in de uitverkochte datums; de extra datum zelf is
  // de laatste die verkoopt.
  if (m?.isAddedShow) return result('added_shows', -0.3, 1, { isAddedShow: true, added, city: inp.city, country: inp.country });
  let s = Math.min(0.6, 0.2 * added);
  if (addedInCity > 0) s += 0.3;
  return result('added_shows', s, 1, { added, addedInCity, city: inp.city, country: inp.country });
}

/** 4. Verkoopsnelheid: hoe snel data elders uitverkochten, hoe lang deze al te koop is, hoeveel tijd er nog is. */
export function salesSpeed(inp: ScoreInputs): FactorResult {
  const now = DateTime.fromISO(inp.now);
  let s = 0;
  let coverage = 0;
  const facts: FactorResult['facts'] = {};
  const sold = inp.siblings.filter((x) => x.eventId !== inp.eventId && x.status === 'soldout');
  const hours = sold.map((x) => x.soldOutAfterHours).filter((h): h is number => h !== undefined);
  if (sold.some((x) => x.soldOutInPresale)) {
    s += 0.5;
    coverage = Math.max(coverage, 0.7);
    facts.presaleSellout = true;
  } else if (hours.length) {
    const fastest = Math.min(...hours);
    coverage = Math.max(coverage, 0.6);
    facts.fastestHours = Math.round(fastest);
    if (fastest <= 24) s += 0.4;
    else if (fastest <= 24 * 7) s += 0.15;
  }
  if (inp.firstSaleAt && inp.status !== 'soldout') {
    const days = now.diff(DateTime.fromISO(inp.firstSaleAt), 'days').days;
    if (days >= 0) {
      coverage = Math.max(coverage, 0.5);
      facts.daysOnSale = Math.floor(days);
      if (inp.status !== 'few_left') {
        if (days >= 30) s -= 0.4;
        else if (days >= 7) s -= 0.2;
      }
    }
  }
  if (inp.localDate && inp.status !== 'soldout') {
    const daysLeft = DateTime.fromISO(inp.localDate).diff(now.startOf('day'), 'days').days;
    if (daysLeft >= 0 && daysLeft <= 14) {
      s -= 0.3;
      coverage = Math.max(coverage, 0.5);
      facts.daysLeft = Math.floor(daysLeft);
    }
  }
  const q = inp.live?.queueSize;
  if (q !== undefined) {
    coverage = 1;
    facts.queueSize = q;
    if (inp.capacity) {
      const ratio = q / inp.capacity;
      s += ratio > 3 ? 0.8 : ratio > 1 ? 0.5 : ratio > 0.3 ? 0.2 : -0.1;
    } else {
      s += q > 100_000 ? 0.6 : q > 20_000 ? 0.3 : 0;
    }
  }
  return result('sales_speed', s, coverage, facts);
}

/** 5. Doorverkoop: prijzen boven of onder de nominale prijs, aantal aanbiedingen. */
export function resalePremium(inp: ScoreInputs): FactorResult {
  const r = inp.resale;
  if (!r) return result('resale', 0, 0);
  if (r.capped) return result('resale', 0, 0, { capped: true });
  if (r.minResalePrice && r.faceValueMin) {
    const premium = r.minResalePrice / r.faceValueMin;
    let signal = Math.log(premium) / Math.log(2.5);
    if (r.priceTrend7d !== undefined) signal += r.priceTrend7d > 0.1 ? 0.15 : r.priceTrend7d < -0.1 ? -0.15 : 0;
    return result('resale', signal, 1, {
      premiumPct: Math.round((premium - 1) * 100),
      ...(r.priceTrend7d !== undefined ? { trendPct: Math.round(r.priceTrend7d * 100) } : {}),
    });
  }
  if (r.listingsPer1000 !== undefined) {
    const signal = r.listingsPer1000 < 5 ? 0.2 : r.listingsPer1000 > 50 ? -0.3 : 0;
    return result('resale', signal, 0.4, { listingsPer1000: Math.round(r.listingsPer1000) });
  }
  return result('resale', 0, 0);
}

/** 6. Bijna uitverkocht: melding van de ticketverkoper, extra kaarten vrijgegeven. */
export function fewLeft(inp: ScoreInputs): FactorResult {
  const l = inp.live;
  let s = 0;
  let known = false;
  const facts: FactorResult['facts'] = {};
  if (inp.status === 'few_left' || l?.fewTicketsLeft) {
    known = true;
    s += 0.8;
    facts.fewTicketsLeft = true;
  }
  if (l?.extraRelease) {
    known = true;
    s += 0.3;
    facts.extraRelease = true;
  }
  return result('few_left', s, known ? 1 : 0, facts);
}

export const RUSH_FUNCTIONS = [demandSupply, growthFactor, previousTour, scarcity, fandomFactor, tourDemand] as const;
export const SELLOUT_FUNCTIONS = [priorFactor, soldOutDates, addedShows, salesSpeed, resalePremium, fewLeft] as const;

export function factorDefs(kind: ScoreKind): readonly { key: FactorKey; name: string }[] {
  return kind === 'rush' ? RUSH_FACTORS : SELLOUT_FACTORS;
}

export function factorFunctions(kind: ScoreKind): readonly ((inp: ScoreInputs) => FactorResult)[] {
  return kind === 'rush' ? RUSH_FUNCTIONS : SELLOUT_FUNCTIONS;
}
