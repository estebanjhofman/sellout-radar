import { DateTime } from 'luxon';
import { normalizeName, slug, type Observation, type SourceRef } from '@sellout/core';
import type { CatalogEvent } from '../catalog';
import { emptyResult, type Connector, type ConnectorContext } from './types';

/**
 * Signaalbronnen: doorverkoop (SeatGeek), luisteraars en toplijsten per land (Last.fm),
 * kanaalcijfers (YouTube, alleen ter informatie) en eerdere bezoeken (setlist.fm). Allemaal
 * officiële API's met een eigen sleutel; zonder sleutel wordt de bron overgeslagen.
 */

function upcomingEvents(ctx: ConnectorContext): CatalogEvent[] {
  const today = DateTime.fromISO(ctx.now).toISODate()!;
  return [...ctx.catalog.events.values()].filter((e) => (e.date.localDate ?? e.date.localMonth ?? '9999') >= today && e.status !== 'cancelled');
}

function obs(entity: string, metric: string, value: number, source: SourceRef, observedAt: string, dimension?: string): Observation {
  return { entity, metric, value, source, observedAt, ...(dimension ? { dimension } : {}) };
}

// ---------------------------------------------------------------------------
// SeatGeek: laagste prijs en aantal aanbiedingen (vooral Noord-Amerika)
// Voorwaarden: https://seatgeek.com/api-terms
// ---------------------------------------------------------------------------

export class SeatGeekConnector implements Connector {
  name = 'SeatGeek';
  kind = 'aggregator' as const;

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    const id = ctx.cfg.keys.seatgeek;
    if (!id) return { ...res, skipped: true, message: 'Niet ingesteld (SEATGEEK_CLIENT_ID ontbreekt).' };
    const byArtist = new Map<string, CatalogEvent[]>();
    for (const e of upcomingEvents(ctx)) {
      const venue = ctx.catalog.venues.get(e.venueId);
      if (!venue || !['US', 'CA', 'GB', 'MX'].includes(venue.country)) continue;
      for (const a of e.artistIds) byArtist.set(a, [...(byArtist.get(a) ?? []), e]);
    }
    let calls = 0;
    for (const [artistId, events] of byArtist) {
      if (calls >= 150) break;
      const artist = ctx.catalog.artists.get(artistId);
      if (!artist) continue;
      calls++;
      const qs = new URLSearchParams({ client_id: id, 'performers.slug': artist.externalIds?.seatgeek ?? slug(artist.name), per_page: '100' });
      const r = await ctx.http.get(`https://api.seatgeek.com/2/events?${qs}`);
      if (r.status === 401 || r.status === 403) throw new Error(`SeatGeek weigert de sleutel (HTTP ${r.status}).`);
      if (!r.ok) continue;
      const data = JSON.parse(r.text) as {
        events?: { id: number; datetime_local?: string; url?: string; venue?: { city?: string; country?: string }; stats?: { lowest_price?: number | null; listing_count?: number | null; average_price?: number | null } }[];
      };
      for (const sg of data.events ?? []) {
        const date = sg.datetime_local?.slice(0, 10);
        const match = events.find((e) => e.date.localDate === date && normalizeName(ctx.catalog.venues.get(e.venueId)?.city ?? '') === normalizeName(sg.venue?.city ?? ''));
        if (!match || !sg.stats) continue;
        const src: SourceRef = { name: 'SeatGeek', kind: 'aggregator', ...(sg.url ? { url: sg.url } : {}), fetchedAt: ctx.now };
        if (typeof sg.stats.lowest_price === 'number') res.observations.push(obs(`event:${match.id}`, 'resale_min_price', sg.stats.lowest_price, src, ctx.now, 'USD'));
        if (typeof sg.stats.listing_count === 'number') res.observations.push(obs(`event:${match.id}`, 'resale_listings', sg.stats.listing_count, src, ctx.now));
        res.externalIds.push({ entity: `event:${match.id}`, source: 'seatgeek', externalId: String(sg.id) });
        res.coveredEventIds = [...(res.coveredEventIds ?? []), match.id];
      }
    }
    res.message = `${res.observations.length} metingen.`;
    return res;
  }
}

// ---------------------------------------------------------------------------
// Last.fm: luisteraars wereldwijd en de toplijsten per land
// Voorwaarden: https://www.last.fm/api/tos (alleen niet-commercieel, met bronvermelding en link naar
// Last.fm; gebruik volgens de HTTP-cacheheaders; hooguit 100 MB opslag). We vragen drie keer per dag op.
// ---------------------------------------------------------------------------

/** Landnamen zoals Last.fm ze verwacht (ISO 3166-1 country names). */
export const LASTFM_COUNTRY: Record<string, string> = {
  NL: 'Netherlands', BE: 'Belgium', LU: 'Luxembourg', DE: 'Germany', FR: 'France', GB: 'United Kingdom', IE: 'Ireland',
  ES: 'Spain', PT: 'Portugal', IT: 'Italy', AT: 'Austria', CH: 'Switzerland', SE: 'Sweden', NO: 'Norway', DK: 'Denmark',
  FI: 'Finland', PL: 'Poland', CZ: 'Czech Republic', HU: 'Hungary', HR: 'Croatia', RS: 'Serbia', BG: 'Bulgaria',
  RO: 'Romania', GR: 'Greece', TR: 'Turkey', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil',
  AR: 'Argentina', CL: 'Chile', AU: 'Australia', NZ: 'New Zealand', JP: 'Japan', KR: 'Korea, Republic of',
  TW: 'Taiwan', HK: 'Hong Kong', SG: 'Singapore', MY: 'Malaysia', ID: 'Indonesia', TH: 'Thailand', PH: 'Philippines',
};

/** Lengte van de opgevraagde toplijsten (2 pagina's van 500). */
export const LASTFM_LIST_PAGES = 2;
const LASTFM_PAGE_SIZE = 500;
/** Hooguit zoveel landen per run (de landen met de meeste komende datums gaan voor). */
const LASTFM_MAX_COUNTRIES = 20;

export class LastFmConnector implements Connector {
  name = 'Last.fm';
  kind = 'aggregator' as const;

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    const key = ctx.cfg.keys.lastfm;
    if (!key) return { ...res, skipped: true, message: 'Niet ingesteld (LASTFM_API_KEY ontbreekt).' };
    const upcoming = upcomingEvents(ctx);
    const artists = new Set(upcoming.flatMap((e) => e.artistIds));
    const api = async (params: Record<string, string>) => {
      const qs = new URLSearchParams({ ...params, api_key: key, format: 'json' });
      const r = await ctx.http.get(`https://ws.audioscrobbler.com/2.0/?${qs}`);
      if (!r.ok) return null;
      const d = JSON.parse(r.text) as { error?: number; message?: string } & Record<string, unknown>;
      if (d.error === 10 || d.error === 26) throw new Error('Last.fm weigert de sleutel.');
      if (d.error === 29) throw new Error('Last.fm: te veel verzoeken; volgende run opnieuw.');
      return d.error ? null : d;
    };

    // 1. Luisteraars en afspeelaantal per artiest (wereldwijd), met een link naar de artiestpagina.
    let calls = 0;
    for (const id of artists) {
      if (calls >= 300) break;
      const a = ctx.catalog.artists.get(id);
      if (!a) continue;
      calls++;
      const d = (await api({ method: 'artist.getinfo', artist: a.name, autocorrect: '1' })) as { artist?: { url?: string; stats?: { listeners?: string; playcount?: string } } } | null;
      const src: SourceRef = { name: 'Last.fm', kind: 'aggregator', url: d?.artist?.url ?? 'https://www.last.fm', fetchedAt: ctx.now };
      const listeners = Number(d?.artist?.stats?.listeners);
      const plays = Number(d?.artist?.stats?.playcount);
      if (Number.isFinite(listeners) && listeners > 0) res.observations.push(obs(`artist:${id}`, 'lastfm_listeners', listeners, src, ctx.now));
      if (Number.isFinite(plays) && plays > 0) res.observations.push(obs(`artist:${id}`, 'lastfm_playcount', plays, src, ctx.now));
    }

    // 2. Toplijsten: wereldwijd en per land waar komende datums zijn. Een positie in de lijst van een land
    //    vergeleken met de wereldwijde positie zegt hoe populair de artiest juist daar is.
    const byName = new Map<string, string>();
    for (const id of artists) {
      const a = ctx.catalog.artists.get(id);
      if (!a) continue;
      byName.set(normalizeName(a.name), id);
      for (const al of a.aliases ?? []) byName.set(normalizeName(al), id);
    }
    const lists = (ctx.state.kv['lastfm:lists'] ?? {}) as Record<string, { at: string; size: number }>;
    const fetchList = async (dimension: string, params: Record<string, string>, pick: (d: Record<string, unknown>) => { name: string; listeners?: string }[] | undefined) => {
      // Toplijsten veranderen langzaam: hooguit één keer per dag ophalen (de vorige meting blijft gelden).
      const prev = lists[dimension];
      if (prev && DateTime.fromISO(ctx.now).diff(DateTime.fromISO(prev.at), 'hours').hours < 20) return;
      let size = 0;
      for (let page = 1; page <= LASTFM_LIST_PAGES; page++) {
        const d = await api({ ...params, limit: String(LASTFM_PAGE_SIZE), page: String(page) });
        const items = d ? pick(d) : undefined;
        if (!items || items.length === 0) break;
        const src: SourceRef = { name: 'Last.fm', kind: 'aggregator', url: 'https://www.last.fm/charts', fetchedAt: ctx.now };
        items.forEach((x, i) => {
          const id = byName.get(normalizeName(x.name));
          if (!id) return;
          const rank = (page - 1) * LASTFM_PAGE_SIZE + i + 1;
          res.observations.push(obs(`artist:${id}`, 'lastfm_rank', rank, src, ctx.now, dimension));
          const l = Number(x.listeners);
          if (dimension !== 'world' && Number.isFinite(l) && l > 0) res.observations.push(obs(`artist:${id}`, 'lastfm_country_listeners', l, src, ctx.now, dimension));
        });
        size += items.length;
        if (items.length < LASTFM_PAGE_SIZE) break;
      }
      if (size > 0) lists[dimension] = { at: ctx.now, size };
    };
    await fetchList('world', { method: 'chart.gettopartists' }, (d) => (d.artists as { artist?: { name: string; listeners?: string }[] } | undefined)?.artist);
    const perCountry = new Map<string, number>();
    for (const e of upcoming) {
      const c = ctx.catalog.venues.get(e.venueId)?.country;
      if (c && LASTFM_COUNTRY[c]) perCountry.set(c, (perCountry.get(c) ?? 0) + 1);
    }
    const countries = [...perCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, LASTFM_MAX_COUNTRIES).map(([c]) => c);
    for (const c of countries) {
      await fetchList(c, { method: 'geo.gettopartists', country: LASTFM_COUNTRY[c]! }, (d) => (d.topartists as { artist?: { name: string; listeners?: string }[] } | undefined)?.artist);
    }
    ctx.state.kv['lastfm:lists'] = lists;
    res.message = `${res.observations.length} metingen (${countries.length} landen).`;
    return res;
  }
}

// ---------------------------------------------------------------------------
// YouTube Data API: abonnees en weergaven van het kanaal, alleen om te tonen.
// Voorwaarden: https://developers.google.com/youtube/terms/developer-policies
//  - statistieken die zonder toestemming van de kanaaleigenaar zijn opgehaald, niet langer dan 30 dagen
//    bewaren (III.E.4.b); daarom ruimt de updater ze na 30 dagen op;
//  - geen nieuwe of afgeleide maten of scores uit API-data maken (III.E.4.h); daarom telt YouTube niet
//    mee in de scores en berekenen we geen groei.
// ---------------------------------------------------------------------------

export class YouTubeConnector implements Connector {
  name = 'YouTube';
  kind = 'aggregator' as const;

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    const key = ctx.cfg.keys.youtube;
    if (!key) return { ...res, skipped: true, message: 'Niet ingesteld (YOUTUBE_API_KEY ontbreekt).' };
    const cache = (ctx.state.kv['yt:channels'] ?? {}) as Record<string, string | null>;
    const artists = [...new Set(upcomingEvents(ctx).flatMap((e) => e.artistIds))];
    let searches = 0;
    const ids: { artistId: string; channelId: string }[] = [];
    for (const id of artists) {
      const a = ctx.catalog.artists.get(id);
      if (!a) continue;
      let channel = a.externalIds?.youtube ?? cache[id];
      if (channel === undefined) {
        // Zoeken kost 100 quota-eenheden; hooguit 40 nieuwe artiesten per run.
        if (searches >= 40) continue;
        searches++;
        const qs = new URLSearchParams({ part: 'snippet', type: 'channel', q: a.name, maxResults: '3', key });
        const r = await ctx.http.get(`https://www.googleapis.com/youtube/v3/search?${qs}`);
        if (r.status === 403) throw new Error('YouTube-quotum op of sleutel geweigerd.');
        const d = r.ok ? (JSON.parse(r.text) as { items?: { snippet?: { channelId?: string; channelTitle?: string } }[] }) : {};
        const hit = d.items?.find((x) => normalizeName(x.snippet?.channelTitle ?? '').startsWith(normalizeName(a.name)));
        channel = hit?.snippet?.channelId ?? null;
        cache[id] = channel;
      }
      if (channel) ids.push({ artistId: id, channelId: channel });
    }
    ctx.state.kv['yt:channels'] = cache;
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      const qs = new URLSearchParams({ part: 'statistics', id: part.map((x) => x.channelId).join(','), key });
      const r = await ctx.http.get(`https://www.googleapis.com/youtube/v3/channels?${qs}`);
      if (!r.ok) continue;
      const d = JSON.parse(r.text) as { items?: { id: string; statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] };
      for (const item of d.items ?? []) {
        const who = part.find((x) => x.channelId === item.id);
        if (!who) continue;
        const src: SourceRef = { name: 'YouTube', kind: 'aggregator', url: `https://www.youtube.com/channel/${item.id}`, fetchedAt: ctx.now };
        const views = Number(item.statistics?.viewCount);
        const subs = item.statistics?.hiddenSubscriberCount ? NaN : Number(item.statistics?.subscriberCount);
        if (Number.isFinite(views)) res.observations.push(obs(`artist:${who.artistId}`, 'youtube_views', views, src, ctx.now));
        if (Number.isFinite(subs)) res.observations.push(obs(`artist:${who.artistId}`, 'youtube_subscribers', subs, src, ctx.now));
      }
    }
    res.message = `${res.observations.length} metingen (alleen ter informatie).`;
    return res;
  }
}

// ---------------------------------------------------------------------------
// setlist.fm: wanneer was de artiest voor het laatst in deze stad of dit land?
// Voorwaarden: https://www.setlist.fm/help/api-terms (niet-commercieel, bronvermelding,
// geen langdurige opslag: we bewaren alleen het afgeleide jaartal en de venuenaam, 30 dagen).
// ---------------------------------------------------------------------------

export interface PreviousVisitFact {
  date: string;
  venueName: string;
  city: string;
  country: string;
  scope: 'city' | 'country';
  checkedAt: string;
}

export class SetlistFmConnector implements Connector {
  name = 'setlist.fm';
  kind = 'aggregator' as const;

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    const key = ctx.cfg.keys.setlistfm;
    if (!key) return { ...res, skipped: true, message: 'Niet ingesteld (SETLISTFM_API_KEY ontbreekt).' };
    const cache = (ctx.state.kv['setlistfm:visits'] ?? {}) as Record<string, PreviousVisitFact | null | { none: true; checkedAt: string }>;
    const fresh = (checkedAt: string) => DateTime.fromISO(ctx.now).diff(DateTime.fromISO(checkedAt), 'days').days < 30;
    for (const [k, v] of Object.entries(cache)) if (!v || !fresh(v.checkedAt)) delete cache[k];
    let calls = 0;
    const pairs = new Map<string, { artistId: string; city: string; country: string }>();
    for (const e of upcomingEvents(ctx)) {
      const v = ctx.catalog.venues.get(e.venueId);
      const artistId = e.artistIds[0];
      if (!v || !artistId || e.type !== 'concert') continue;
      pairs.set(`${artistId}|${normalizeName(v.city)}`, { artistId, city: v.city, country: v.country });
    }
    for (const [k, p] of pairs) {
      if (k in cache || calls >= 120) continue;
      const artist = ctx.catalog.artists.get(p.artistId);
      if (!artist) continue;
      const search = async (params: Record<string, string>) => {
        calls++;
        const qs = new URLSearchParams({ artistName: artist.name, p: '1', ...params });
        const r = await ctx.http.get(`https://api.setlist.fm/rest/1.0/search/setlists?${qs}`, { headers: { 'x-api-key': key, Accept: 'application/json' } });
        if (r.status === 401 || r.status === 403) throw new Error('setlist.fm weigert de sleutel.');
        if (r.status === 404 || !r.ok) return [];
        const d = JSON.parse(r.text) as { setlist?: { eventDate?: string; venue?: { name?: string; city?: { name?: string; country?: { code?: string } } } }[] };
        const today = DateTime.fromISO(ctx.now);
        return (d.setlist ?? [])
          .map((s) => ({ ...s, dt: DateTime.fromFormat(s.eventDate ?? '', 'dd-MM-yyyy') }))
          .filter((s) => s.dt.isValid && s.dt < today)
          .sort((a, b) => b.dt.toMillis() - a.dt.toMillis());
      };
      let hits = await search({ cityName: p.city });
      let scope: 'city' | 'country' = 'city';
      if (hits.length === 0) {
        hits = await search({ countryCode: p.country });
        scope = 'country';
      }
      const h = hits[0];
      cache[k] = h
        ? {
            date: h.dt.toISODate()!,
            venueName: h.venue?.name ?? '',
            city: h.venue?.city?.name ?? p.city,
            country: h.venue?.city?.country?.code ?? p.country,
            scope,
            checkedAt: ctx.now,
          }
        : { none: true, checkedAt: ctx.now };
    }
    ctx.state.kv['setlistfm:visits'] = cache;
    res.message = `${calls} zoekopdrachten.`;
    return res;
  }
}
