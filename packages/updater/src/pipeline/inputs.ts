import { DateTime } from 'luxon';
import {
  earliestInstant,
  firstSaleMoment,
  normalizeName,
  populationM,
  type ChartHit,
  type Observation,
  type PastVisit,
  type SalePhase,
  type ScoreInputs,
  type SiblingInfo,
} from '@sellout/core';
import type { Catalog, CatalogEvent } from '../catalog';
import type { PreviousVisitFact } from '../connectors/signals';
import { BENELUX, COUNTRY_NAME_NL, continentOf } from '../geo';

export interface InputContext {
  now: string;
  setlistVisits: Record<string, PreviousVisitFact | { none: true; checkedAt: string } | null>;
  phasesByEvent: Map<string, SalePhase[]>;
  /** Toplijsten van Last.fm: wanneer per land (of 'world') voor het laatst opgehaald en hoe lang. */
  lastfmLists?: Record<string, { at: string; size: number }>;
}

/** Indexeert metingen per entiteit en meting, oud → nieuw. */
export function indexObservations(obs: Observation[]): Map<string, Observation[]> {
  const m = new Map<string, Observation[]>();
  for (const o of obs) {
    const k = `${o.entity}|${o.metric}|${o.dimension ?? ''}`;
    const list = m.get(k) ?? [];
    list.push(o);
    m.set(k, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return m;
}

/** Groei tussen de meting van ~`days` dagen geleden en de laatste. */
export function growth(list: Observation[] | undefined, now: string, days: number): number | undefined {
  if (!list || list.length < 2) return undefined;
  const last = list[list.length - 1]!;
  const target = DateTime.fromISO(now).minus({ days }).toISO()!;
  const older = list.filter((o) => o.observedAt <= target);
  const base = older[older.length - 1];
  if (!base || typeof base.value !== 'number' || typeof last.value !== 'number' || base.value <= 0) return undefined;
  // Pas meten na minstens 80% van de periode.
  const span = DateTime.fromISO(last.observedAt).diff(DateTime.fromISO(base.observedAt), 'days').days;
  if (span < days * 0.8) return undefined;
  return last.value / base.value - 1;
}

export function latestValue(list: Observation[] | undefined): number | undefined {
  const v = list?.[list.length - 1]?.value;
  return typeof v === 'number' ? v : undefined;
}

/**
 * Positie in een Last.fm-toplijst, alleen als die lijst recent is opgehaald. Een positie wordt alleen
 * opnieuw bewaard als hij verandert (of wekelijks), dus een meting tot 8 dagen vóór de laatste ophaalronde
 * telt nog. Staat de artiest niet in een recente lijst, dan is de positie null ("niet in de toplijst").
 */
function rankFrom(list: Observation[] | undefined, fetched: { at: string; size: number } | undefined, now: string): { rank: number | null; size: number } | undefined {
  if (!fetched) return undefined;
  if (DateTime.fromISO(now).diff(DateTime.fromISO(fetched.at), 'days').days > 14) return undefined;
  const cutoff = DateTime.fromISO(fetched.at).minus({ days: 8 }).toISO()!;
  const last = list?.[list.length - 1];
  if (last && last.observedAt >= cutoff && typeof last.value === 'number') return { rank: last.value, size: fetched.size };
  return { rank: null, size: fetched.size };
}

function siblingsOf(ev: CatalogEvent, cat: Catalog): CatalogEvent[] {
  if (ev.tourId) return [...cat.events.values()].filter((e) => e.tourId === ev.tourId && e.id !== ev.id);
  const d = DateTime.fromISO(ev.date.localDate ?? '');
  return [...cat.events.values()].filter((e) => {
    if (e.id === ev.id || e.artistIds[0] !== ev.artistIds[0]) return false;
    const x = DateTime.fromISO(e.date.localDate ?? '');
    return d.isValid && x.isValid && Math.abs(x.diff(d, 'days').days) <= 180;
  });
}

const sameCity = (a: string, b: string) => normalizeName(a) === normalizeName(b);

/** Het meest recente vorige bezoek in deze stad, anders in dit land. */
function pickVisit(visits: PastVisit[] | undefined, city: string, country: string): { v: PastVisit; scope: 'city' | 'country' } | undefined {
  const sorted = [...(visits ?? [])].sort((a, b) => b.year - a.year || (b.date ?? '').localeCompare(a.date ?? ''));
  const inCity = sorted.find((v) => v.city && sameCity(v.city, city) && (!v.country || v.country === country));
  if (inCity) return { v: inCity, scope: 'city' };
  const inCountry = sorted.find((v) => v.country === country);
  return inCountry ? { v: inCountry, scope: 'country' } : undefined;
}

export function buildScoreInputs(ev: CatalogEvent, cat: Catalog, ctx: InputContext, obsIndex: Map<string, Observation[]>): ScoreInputs {
  const venue = cat.venues.get(ev.venueId);
  const tour = ev.tourId ? cat.tours.get(ev.tourId) : undefined;
  const artistId = ev.artistIds[0] ?? '';
  const artist = cat.artists.get(artistId);
  const country = venue?.country ?? '';
  const continent = continentOf(country);
  const now = DateTime.fromISO(ctx.now);
  const phases = ctx.phasesByEvent.get(ev.id) ?? [];
  const first = firstSaleMoment(phases);

  const sibs = siblingsOf(ev, cat).filter((s) => s.status !== 'cancelled');
  const siblingInfo: SiblingInfo[] = sibs.map((s) => {
    const v = cat.venues.get(s.venueId);
    const sp = ctx.phasesByEvent.get(s.id) ?? [];
    const sFirst = firstSaleMoment(sp);
    const general = sp.find((p) => p.kind === 'general_sale');
    const soldAt = s.soldOutAt ? DateTime.fromISO(s.soldOutAt) : undefined;
    return {
      eventId: s.id,
      city: v?.city ?? '',
      country: v?.country ?? '',
      continent: continentOf(v?.country ?? ''),
      ...(v?.capacity ? { capacity: v.capacity } : {}),
      status: s.status,
      ...(sFirst ? { firstSaleAt: sFirst.toUTC().toISO()! } : {}),
      ...(soldAt && sFirst ? { soldOutAfterHours: Math.max(0, soldAt.diff(sFirst, 'hours').hours) } : {}),
      ...(s.soldOutInPresale || (soldAt && general && earliestInstant(general.start) && soldAt < earliestInstant(general.start)!) ? { soldOutInPresale: true } : {}),
      ...(s.addedShow ? { addedShow: true } : {}),
    };
  });
  for (const x of tour?.soldOutElsewhere ?? []) {
    for (let i = 0; i < x.count; i++) {
      siblingInfo.push({
        eventId: `elders-${normalizeName(x.city)}-${i}`,
        city: x.city,
        country: x.country,
        continent: continentOf(x.country),
        status: 'soldout',
        ...(x.capacity ? { capacity: x.capacity } : {}),
      });
    }
  }
  const addedInCatalog = sibs.filter((s) => s.addedShow).length + (ev.addedShow ? 1 : 0);

  // Doorverkoop
  const minPrice = latestValue(obsIndex.get(`event:${ev.id}|resale_min_price|USD`)) ?? latestValue(obsIndex.get(`event:${ev.id}|resale_min_price|`));
  const listings = latestValue(obsIndex.get(`event:${ev.id}|resale_listings|`));
  const capped = [...(ev.notes ?? []), ...phases.flatMap((p) => p.notes ?? [])].some((n) => /face value|nominale prijs/i.test(n));
  const trend = growth(obsIndex.get(`event:${ev.id}|resale_min_price|USD`), ctx.now, 7);

  // Tours en voorstellingen herhalen shows; festivals, sport en het Songfestival zijn per datum uniek.
  const touring = ev.type === 'concert' || ev.type === 'comedy' || ev.type === 'theatre';

  // Vorige tour of vorige editie
  let previousVisit: ScoreInputs['previousVisit'];
  let yearsSince: number | undefined;
  const seedPv = ev.inputs?.previousVisit;
  const yearsAgo = (v: { year: number; date?: string }) => {
    const d = v.date ? DateTime.fromISO(v.date.length === 7 ? `${v.date}-15` : v.date) : DateTime.fromObject({ year: v.year, month: 7, day: 1 });
    return Math.max(0, Math.round(now.diff(d, 'years').years * 10) / 10);
  };
  if (seedPv) {
    previousVisit = {
      scope: seedPv.scope,
      ...(seedPv.venueName && venue && normalizeName(seedPv.venueName) === normalizeName(venue.name) ? { sameVenue: true } : {}),
      ...(seedPv.capacity ? { capacity: seedPv.capacity } : {}),
      ...(seedPv.soldOut !== undefined ? { soldOut: seedPv.soldOut } : {}),
      ...(seedPv.yearsAgo !== undefined ? { yearsAgo: seedPv.yearsAgo } : {}),
      ...(seedPv.venueName ? { venueName: seedPv.venueName } : {}),
      ...(seedPv.place ? { place: seedPv.place } : {}),
    };
    yearsSince = seedPv.yearsAgo;
  } else if (!touring && tour?.previousEditions?.length) {
    const ed = [...tour.previousEditions].sort((a, b) => b.year - a.year)[0]!;
    const same = !ed.venue || !venue || normalizeName(ed.venue) === normalizeName(venue.name) || (ed.city !== undefined && sameCity(ed.city, venue.city));
    previousVisit = {
      scope: 'city',
      ...(same ? { sameVenue: true } : {}),
      ...(ed.capacity ? { capacity: ed.capacity } : {}),
      ...(ed.soldOut !== undefined ? { soldOut: ed.soldOut } : {}),
      ...(ed.sellThrough !== undefined ? { sellThrough: ed.sellThrough } : {}),
      ...(ed.withinHours !== undefined ? { withinHours: ed.withinHours } : {}),
      yearsAgo: yearsAgo(ed),
      year: ed.year,
      ...(ed.venue ? { venueName: ed.venue } : {}),
    };
  } else if (venue && tour?.previousVisits?.length && pickVisit(tour.previousVisits, venue.city, country)) {
    const { v, scope } = pickVisit(tour.previousVisits, venue.city, country)!;
    previousVisit = {
      scope,
      ...(v.venue && normalizeName(v.venue) === normalizeName(venue.name) ? { sameVenue: true } : {}),
      ...(v.capacity ? { capacity: v.capacity } : {}),
      ...(v.shows ? { shows: v.shows } : {}),
      ...(v.soldOut !== undefined ? { soldOut: v.soldOut } : {}),
      ...(v.sellThrough !== undefined ? { sellThrough: v.sellThrough } : {}),
      ...(v.withinHours !== undefined ? { withinHours: v.withinHours } : {}),
      yearsAgo: yearsAgo(v),
      year: v.year,
      ...(v.venue ? { venueName: v.venue } : {}),
      ...(scope === 'city' && v.city ? { place: v.city } : scope === 'country' ? { place: COUNTRY_NAME_NL[country] ?? country } : {}),
      ...(v.tour ? { tourName: v.tour } : {}),
    };
    yearsSince = Math.floor(yearsAgo(v));
  } else if (venue && artistId) {
    const fact = ctx.setlistVisits[`${artistId}|${normalizeName(venue.city)}`];
    if (fact && !('none' in fact)) {
      const years = Math.round(now.diff(DateTime.fromISO(fact.date), 'years').years * 10) / 10;
      const prevVenue = [...cat.venues.values()].find((v) => normalizeName(v.name) === normalizeName(fact.venueName) && normalizeName(v.city) === normalizeName(fact.city));
      previousVisit = {
        scope: fact.scope,
        ...(normalizeName(fact.venueName) === normalizeName(venue.name) && normalizeName(fact.city) === normalizeName(venue.city) ? { sameVenue: true } : {}),
        yearsAgo: years,
        venueName: fact.venueName,
        place: fact.scope === 'city' ? fact.city : (COUNTRY_NAME_NL[fact.country] ?? fact.country),
        ...(prevVenue?.capacity ? { capacity: prevVenue.capacity } : {}),
      };
      yearsSince = Math.floor(years);
    }
  }
  if (ev.inputs?.yearsSinceLastVisit !== undefined) yearsSince = ev.inputs.yearsSinceLastVisit;

  // Markt: shows in dezelfde stad (volgorde) en alle plekken van deze tour in dit land
  const sameCityEvents = [ev, ...sibs.filter((s) => cat.venues.get(s.venueId)?.city === venue?.city)].sort((a, b) =>
    (a.date.localDate ?? '').localeCompare(b.date.localDate ?? ''),
  );
  const inCountry = [ev, ...sibs.filter((s) => cat.venues.get(s.venueId)?.country === country)];
  const caps = inCountry.map((e) => cat.venues.get(e.venueId)?.capacity);
  const known = caps.filter((c): c is number => !!c);
  // Alleen als alle datums in het land een bekende capaciteit hebben; anders tellen we te weinig plekken.
  const seatsInCountry = known.length === caps.length && known.length > 0 ? known.reduce((a, b) => a + b, 0) : undefined;

  // Schaarste: enige show in land, Benelux of Europa
  let onlyShowIn: 'europe' | 'benelux' | 'country' | null = null;
  if (venue && sibs.length > 0) {
    const others = sibs.map((s) => cat.venues.get(s.venueId)?.country ?? '');
    if (continent === 'EU' && !others.some((c) => continentOf(c) === 'EU')) onlyShowIn = 'europe';
    else if (BENELUX.has(country) && !others.some((c) => BENELUX.has(c))) onlyShowIn = 'benelux';
    else if (!others.includes(country)) onlyShowIn = 'country';
  }

  // Populariteit en groei (Last.fm, met de seedmeting als startpunt), hitnoteringen, nieuwe release
  const releaseDays =
    tour?.releaseDate && first
      ? Math.abs(DateTime.fromISO(tour.releaseDate).diff(first, 'days').days)
      : tour?.releaseDate
        ? Math.abs(DateTime.fromISO(tour.releaseDate).diff(now, 'days').days)
        : undefined;
  const listenersList = obsIndex.get(`artist:${artistId}|lastfm_listeners|`);
  const listeners = latestValue(listenersList);
  const listenerGrowth = growth(listenersList, ctx.now, 90);
  const countryRank = rankFrom(obsIndex.get(`artist:${artistId}|lastfm_rank|${country}`), ctx.lastfmLists?.[country], ctx.now);
  const globalRank = rankFrom(obsIndex.get(`artist:${artistId}|lastfm_rank|world`), ctx.lastfmLists?.world, ctx.now);
  const facts = cat.facts.get(artistId);
  const charts: ChartHit[] | undefined = facts ? facts.charts.map((c) => ({ chart: c.chart, country: c.country, title: c.title, peak: c.peak, year: c.year })) : undefined;
  const pop = populationM(country);
  // Luisteraars zeggen iets over de vraag naar concerten; bij comedy, theater, festivals en sport niet
  // (Last.fm-cijfers van een comedian of een festivalnaam zijn geen maat voor de kaartvraag).
  const music = ev.type === 'concert';
  const popularity: ScoreInputs['popularity'] = {
    ...(music && listeners !== undefined ? { listeners } : {}),
    ...(music && listenerGrowth !== undefined ? { listenerGrowth90d: listenerGrowth } : {}),
    ...(music && countryRank ? { countryRank: countryRank.rank, countryListSize: countryRank.size } : {}),
    ...(music && globalRank ? { globalRank: globalRank.rank, globalListSize: globalRank.size } : {}),
    ...(pop !== undefined ? { populationM: pop } : {}),
    ...(charts && charts.length ? { charts } : {}),
    ...(releaseDays !== undefined ? { newReleaseWithinDays: Math.round(releaseDays) } : {}),
  };

  return {
    eventId: ev.id,
    type: ev.type,
    status: ev.status,
    city: venue?.city ?? '',
    country,
    continent,
    ...(venue?.capacity ? { capacity: venue.capacity } : {}),
    ...(ev.date.localDate ? { localDate: ev.date.localDate } : {}),
    ...(venue?.outdoor !== undefined ? { outdoor: venue.outdoor } : {}),
    ...(first ? { firstSaleAt: first.toUTC().toISO()! } : {}),
    siblings: siblingInfo,
    addedForDemand: Math.max(tour?.addedForDemand ?? 0, addedInCatalog),
    ...(minPrice !== undefined || listings !== undefined || capped
      ? {
          resale: {
            ...(minPrice !== undefined ? { minResalePrice: minPrice } : {}),
            ...(ev.priceRange?.min && ev.priceRange.currency === 'USD' ? { faceValueMin: ev.priceRange.min } : {}),
            ...(listings !== undefined && venue?.capacity ? { listingsPer1000: (listings / venue.capacity) * 1000 } : {}),
            ...(trend !== undefined ? { priceTrend7d: trend } : {}),
            ...(capped ? { capped: true } : {}),
          },
        }
      : {}),
    ...(previousVisit ? { previousVisit } : {}),
    // "Shows in de stad" gaat over herhaalde shows van een tour of voorstelling. Bij festivals,
    // sport en evenementen zoals het Songfestival is elke datum een ander programma.
    market: touring
      ? {
          showsInCity: sameCityEvents.length,
          indexInCity: sameCityEvents.findIndex((e) => e.id === ev.id),
          ...(ev.addedShow ? { isAddedShow: true } : {}),
          addedInCity: sameCityEvents.filter((e) => e.addedShow).length,
          ...(seatsInCountry ? { seatsInCountry } : {}),
          showsInCountry: inCountry.length,
        }
      : { showsInCity: 1, indexInCity: 0, ...(venue?.capacity ? { seatsInCountry: venue.capacity } : {}), showsInCountry: 1 },
    scarcity: {
      // "Lang niet geweest" geldt voor tours; een jaarlijks festival of toernooi komt altijd terug.
      ...(yearsSince !== undefined && touring ? { yearsSinceLastVisit: yearsSince } : {}),
      onlyShowIn,
      ...(tour?.farewell ? { farewell: true } : {}),
      ...(tour?.reunion ? { reunion: true } : {}),
      ...(phases.some((p) => p.kind === 'lottery') ? { ballot: true } : {}),
    },
    ...(Object.keys(popularity).length ? { popularity } : {}),
    fandom: artist?.fandom ?? 'unknown',
    ...(ev.status === 'few_left' || ev.inputs?.fewTicketsLeft ? { live: { fewTicketsLeft: true } } : {}),
    now: ctx.now,
  };
}
