import { DateTime } from 'luxon';
import { earliestInstant, firstSaleStart, normalizeName, type Observation, type SalePhase, type ScoreInputs, type SiblingInfo } from '@sellout/core';
import type { Catalog, CatalogEvent } from '../catalog';
import type { PreviousVisitFact } from '../connectors/signals';
import { BENELUX, COUNTRY_NAME_NL, continentOf } from '../geo';

export interface InputContext {
  now: string;
  observations: Observation[];
  setlistVisits: Record<string, PreviousVisitFact | { none: true; checkedAt: string } | null>;
  phasesByEvent: Map<string, SalePhase[]>;
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
function growth(list: Observation[] | undefined, now: string, days: number): number | undefined {
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

function latest(list: Observation[] | undefined): number | undefined {
  const v = list?.[list.length - 1]?.value;
  return typeof v === 'number' ? v : undefined;
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

export function buildScoreInputs(ev: CatalogEvent, cat: Catalog, ctx: InputContext, obsIndex: Map<string, Observation[]>): ScoreInputs {
  const venue = cat.venues.get(ev.venueId);
  const tour = ev.tourId ? cat.tours.get(ev.tourId) : undefined;
  const artist = cat.artists.get(ev.artistIds[0] ?? '');
  const country = venue?.country ?? '';
  const continent = continentOf(country);
  const now = DateTime.fromISO(ctx.now);

  const sibs = siblingsOf(ev, cat).filter((s) => s.status !== 'cancelled');
  const siblingInfo: SiblingInfo[] = sibs.map((s) => {
    const v = cat.venues.get(s.venueId);
    const phases = ctx.phasesByEvent.get(s.id) ?? [];
    const first = firstSaleStart(phases);
    const general = phases.find((p) => p.kind === 'general_sale');
    const soldAt = s.soldOutAt ? DateTime.fromISO(s.soldOutAt) : undefined;
    return {
      eventId: s.id,
      city: v?.city ?? '',
      country: v?.country ?? '',
      continent: continentOf(v?.country ?? ''),
      ...(v?.capacity ? { capacity: v.capacity } : {}),
      status: s.status,
      ...(first ? { firstSaleAt: first.toUTC().toISO()! } : {}),
      ...(soldAt && first ? { soldOutAfterHours: Math.max(0, soldAt.diff(first, 'hours').hours) } : {}),
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
  const minPrice = latest(obsIndex.get(`event:${ev.id}|resale_min_price|USD`)) ?? latest(obsIndex.get(`event:${ev.id}|resale_min_price|`));
  const listings = latest(obsIndex.get(`event:${ev.id}|resale_listings|`));
  const phases = ctx.phasesByEvent.get(ev.id) ?? [];
  const capped = [...(ev.notes ?? []), ...phases.flatMap((p) => p.notes ?? [])].some((n) => /face value|nominale prijs/i.test(n));
  const priceHist = obsIndex.get(`event:${ev.id}|resale_min_price|USD`);
  const trend = growth(priceHist, ctx.now, 7);

  // Tours en voorstellingen herhalen shows; festivals, sport en het Songfestival zijn per datum uniek.
  const touring = ev.type === 'concert' || ev.type === 'comedy' || ev.type === 'theatre';

  // Vorige keer in deze stad of dit land
  let previousVisit: ScoreInputs['previousVisit'];
  let yearsSince: number | undefined;
  const seedPv = ev.inputs?.previousVisit;
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
  } else if (venue && ev.artistIds[0]) {
    const fact = ctx.setlistVisits[`${ev.artistIds[0]}|${normalizeName(venue.city)}`];
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

  // Markt: aantal shows in dezelfde stad en de volgorde
  const sameCity = [ev, ...sibs.filter((s) => cat.venues.get(s.venueId)?.city === venue?.city)].sort((a, b) =>
    (a.date.localDate ?? '').localeCompare(b.date.localDate ?? ''),
  );

  // Schaarste: enige show in land, Benelux of Europa
  let onlyShowIn: 'europe' | 'benelux' | 'country' | null = null;
  // Alleen zinvol als de tour ook elders langskomt; een losse show is niet "schaars".
  if (venue && sibs.length > 0) {
    const others = sibs.map((s) => cat.venues.get(s.venueId)?.country ?? '');
    if (continent === 'EU' && !others.some((c) => continentOf(c) === 'EU')) onlyShowIn = 'europe';
    else if (BENELUX.has(country) && !others.some((c) => BENELUX.has(c))) onlyShowIn = 'benelux';
    else if (!others.includes(country)) onlyShowIn = 'country';
  }

  // Momentum
  const first = firstSaleStart(phases);
  const releaseDays =
    tour?.releaseDate && first ? Math.abs(DateTime.fromISO(tour.releaseDate).diff(first, 'days').days) : tour?.releaseDate ? Math.abs(DateTime.fromISO(tour.releaseDate).diff(now, 'days').days) : undefined;
  const listenerGrowth = growth(obsIndex.get(`artist:${ev.artistIds[0]}|lastfm_listeners|`), ctx.now, 90);
  const videoGrowth = growth(obsIndex.get(`artist:${ev.artistIds[0]}|youtube_views|`), ctx.now, 90);
  const nlRank = latest(obsIndex.get(`artist:${ev.artistIds[0]}|lastfm_rank|NL`));
  const momentum: ScoreInputs['momentum'] = {
    ...(releaseDays !== undefined ? { newReleaseWithinDays: Math.round(releaseDays) } : {}),
    ...(listenerGrowth !== undefined ? { listenerGrowth90d: listenerGrowth } : {}),
    ...(videoGrowth !== undefined ? { videoGrowth90d: videoGrowth } : {}),
    ...(nlRank !== undefined && BENELUX.has(country) ? { charting: nlRank <= 50 } : {}),
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
    // "Shows versus markt" gaat over herhaalde shows van een tour of voorstelling. Bij festivals,
    // sport en evenementen zoals het Songfestival is elke datum een ander programma.
    ...(touring
      ? {
          market: {
            showsInCity: sameCity.length,
            indexInCity: sameCity.findIndex((e) => e.id === ev.id),
            ...(ev.addedShow ? { isAddedShow: true } : {}),
            addedInCity: sameCity.filter((e) => e.addedShow).length,
          },
        }
      : {}),
    scarcity: {
      // "Lang niet geweest" geldt voor tours; een jaarlijks festival of toernooi komt altijd terug.
      ...(yearsSince !== undefined && touring ? { yearsSinceLastVisit: yearsSince } : {}),
      onlyShowIn,
      ...(tour?.farewell ? { farewell: true } : {}),
      ...(tour?.reunion ? { reunion: true } : {}),
      ...(phases.some((p) => p.kind === 'lottery') ? { ballot: true } : {}),
    },
    ...(Object.keys(momentum).length ? { momentum } : {}),
    fandom: artist?.fandom ?? 'unknown',
    ...(ev.inputs?.priceVsComparable !== undefined ? { practical: { priceVsComparable: ev.inputs.priceVsComparable } } : {}),
    ...(ev.status === 'few_left' || ev.inputs?.fewTicketsLeft ? { live: { fewTicketsLeft: true } } : {}),
    now: ctx.now,
  };
}
