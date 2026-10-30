import { DateTime } from 'luxon';
import { exactUtc, normalizeName, type EventType, type PhaseType, type SourceRef } from '@sellout/core';
import { emptyResult, type Connector, type ConnectorContext, type DiscoveredEvent, type DiscoveredPhase } from './types';

/**
 * Ticketmaster Discovery API v2 (officiële API, 5000 verzoeken per dag, 5 per seconde).
 * Levert per datum: venue, tijden, publieke verkoop en presales met start- en eindtijd,
 * prijsrange en ticketlimiet. Geen beschikbaarheid: "onsale" zegt niet of er nog kaarten zijn.
 * Voorwaarden: https://developer.ticketmaster.com/support/terms-of-use/
 */

const BASE = 'https://app.ticketmaster.com/discovery/v2';

interface TmEvent {
  id: string;
  name: string;
  url?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string; dateTBD?: boolean; dateTBA?: boolean; timeTBA?: boolean; noSpecificTime?: boolean };
    timezone?: string;
    status?: { code?: string };
  };
  sales?: {
    public?: { startDateTime?: string; endDateTime?: string; startTBD?: boolean; startTBA?: boolean };
    presales?: { name?: string; description?: string; url?: string; startDateTime?: string; endDateTime?: string }[];
  };
  priceRanges?: { type?: string; currency?: string; min?: number; max?: number }[];
  ticketLimit?: { info?: string };
  classifications?: { segment?: { name?: string }; genre?: { name?: string }; subGenre?: { name?: string }; type?: { name?: string } }[];
  _embedded?: {
    venues?: {
      id?: string;
      name?: string;
      timezone?: string;
      city?: { name?: string };
      country?: { countryCode?: string };
      location?: { latitude?: string; longitude?: string };
    }[];
    attractions?: { id?: string; name?: string }[];
  };
}

export function presaleType(name: string): PhaseType {
  const n = name.toLowerCase();
  if (/spotify/.test(n)) return 'spotify';
  if (/live ?nation/.test(n)) return 'livenation';
  if (/ticketmaster|verified fan/.test(n)) return 'ticketmaster';
  if (/amex|american express|mastercard|visa|citi|card ?member|cardholder|o2 priority|priority/.test(n)) return 'card';
  if (/fan ?club|fanclub|member|subscriber/.test(n)) return 'fanclub';
  if (/venue|arena|stadium|stadion|ziggo|afas/.test(n)) return 'venue';
  if (/artist|official/.test(n)) return 'artist';
  if (/promoter|mojo|aeg|fkp|dhp|sjm/.test(n)) return 'promoter';
  return 'other';
}

export function eventTypeOf(e: TmEvent): EventType {
  const c = e.classifications?.[0];
  const seg = c?.segment?.name?.toLowerCase() ?? '';
  const genre = c?.genre?.name?.toLowerCase() ?? '';
  const name = e.name.toLowerCase();
  if (seg === 'sports') return 'sport';
  if (seg === 'arts & theatre') {
    if (/comedy/.test(genre)) return 'comedy';
    return 'theatre';
  }
  if (seg === 'music') return /festival/.test(name) || /festival/.test(c?.type?.name?.toLowerCase() ?? '') ? 'festival' : 'concert';
  return 'other';
}

function parseLimit(info?: string): number | undefined {
  const m = info?.match(/(\d{1,2})\s*(?:ticket|tickets|kaarten|tickets per)/i) ?? info?.match(/limit(?:ed)?\s*(?:of|to)?\s*(\d{1,2})/i);
  return m ? Number(m[1]) : undefined;
}

/** Zet een Ticketmaster-evenement om; null als essentiële velden ontbreken. */
export function parseTicketmasterEvent(e: TmEvent, fetchedAt: string): DiscoveredEvent | null {
  const v = e._embedded?.venues?.[0];
  const start = e.dates?.start;
  if (!v?.name || !v.city?.name || !v.country?.countryCode || !start?.localDate || start.dateTBD || start.dateTBA) return null;
  const tz = v.timezone ?? e.dates?.timezone;
  if (!tz) return null;
  const source: SourceRef = { name: 'Ticketmaster', kind: 'ticketing', ...(e.url ? { url: e.url } : {}), fetchedAt };
  const phases: DiscoveredPhase[] = [];
  const pub = e.sales?.public;
  if (pub?.startDateTime && !pub.startTBD && !pub.startTBA) {
    // Ticketmaster gebruikt soms 1900-01-01 als "onbekend".
    if (!pub.startDateTime.startsWith('1900')) {
      phases.push({ kind: 'general_sale', type: 'ticketmaster', name: 'Algemene verkoop', start: exactUtc(pub.startDateTime, tz), ...(e.url ? { url: e.url } : {}) });
    }
  }
  for (const p of e.sales?.presales ?? []) {
    if (!p.startDateTime || !p.name) continue;
    phases.push({
      kind: 'presale',
      type: presaleType(p.name),
      name: p.name.trim(),
      start: exactUtc(p.startDateTime, tz),
      ...(p.endDateTime ? { end: exactUtc(p.endDateTime, tz) } : {}),
      ...(p.url ? { url: p.url } : {}),
      ...(p.description ? { conditions: p.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) } : {}),
    });
  }
  const code = e.dates?.status?.code?.toLowerCase();
  const status = code === 'cancelled' ? 'cancelled' : code === 'postponed' || code === 'rescheduled' ? 'postponed' : undefined;
  const price = e.priceRanges?.find((p) => p.type === 'standard') ?? e.priceRanges?.[0];
  const attraction = e._embedded?.attractions?.[0];
  const artistName = attraction?.name ?? e.name;
  const tourName = normalizeName(e.name) !== normalizeName(artistName) ? e.name : undefined;
  const localTime = start.localTime && !start.timeTBA && !start.noSpecificTime ? start.localTime.slice(0, 5) : undefined;
  return {
    artistName,
    ...(attraction?.id ? { artistExternalId: attraction.id } : {}),
    ...(tourName ? { tourName } : {}),
    title: e.name,
    type: eventTypeOf(e),
    venue: {
      name: v.name,
      city: v.city.name,
      country: v.country.countryCode.toUpperCase(),
      tz,
      ...(v.location?.latitude ? { lat: Number(v.location.latitude), lon: Number(v.location.longitude) } : {}),
      ...(v.id ? { externalId: v.id } : {}),
    },
    localDate: start.localDate,
    ...(localTime ? { localTime } : {}),
    ...(status ? { status } : {}),
    ...(e.url ? { url: e.url, officialSeller: { name: 'Ticketmaster', url: e.url } } : {}),
    ...(price?.currency ? { priceRange: { min: price.min, max: price.max, currency: price.currency } } : {}),
    ...(parseLimit(e.ticketLimit?.info) ? { ticketLimit: parseLimit(e.ticketLimit?.info) } : {}),
    phases,
    source,
    externalId: e.id,
  };
}

export class TicketmasterConnector implements Connector {
  name = 'Ticketmaster';
  kind = 'ticketing' as const;

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    const key = ctx.cfg.keys.ticketmaster;
    if (!key) return { ...res, skipped: true, message: 'Niet ingesteld (TICKETMASTER_API_KEY ontbreekt).' };
    const get = async (path: string, params: Record<string, string>) => {
      const qs = new URLSearchParams({ ...params, apikey: key }).toString();
      const r = await ctx.http.get(`${BASE}${path}?${qs}`);
      if (r.status === 401 || r.status === 403) throw new Error(`Ticketmaster weigert de sleutel (HTTP ${r.status}).`);
      if (!r.ok) throw new Error(`Ticketmaster HTTP ${r.status}`);
      return JSON.parse(r.text) as { _embedded?: { events?: TmEvent[]; attractions?: { id: string; name: string }[] }; page?: { totalPages?: number } };
    };
    const seen = new Set<string>();
    const add = (e: TmEvent) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      const d = parseTicketmasterEvent(e, ctx.now);
      if (d) res.discovered.push(d);
    };
    let calls = 0;
    const budget = 600; // ruim binnen 5000 per dag bij 3 runs

    // 1. Bekende artiesten: alle data per attractie.
    const cache = (ctx.state.kv['tm:attractions'] ?? {}) as Record<string, string | null>;
    for (const artist of ctx.catalog.artists.values()) {
      if (calls >= budget) break;
      let attractionId = artist.externalIds?.ticketmaster ?? cache[artist.id];
      if (attractionId === undefined) {
        calls++;
        const r = await get('/attractions.json', { keyword: artist.name, size: '5' });
        const hit = r._embedded?.attractions?.find((a) => normalizeName(a.name) === normalizeName(artist.name));
        attractionId = hit?.id ?? null;
        cache[artist.id] = attractionId;
      }
      if (!attractionId) continue;
      res.externalIds.push({ entity: `artist:${artist.id}`, source: 'ticketmaster', externalId: attractionId });
      for (let page = 0; page < 3 && calls < budget; page++) {
        calls++;
        const r = await get('/events.json', { attractionId, size: '200', page: String(page), sort: 'date,asc' });
        for (const e of r._embedded?.events ?? []) add(e);
        if ((r.page?.totalPages ?? 1) <= page + 1) break;
      }
    }
    ctx.state.kv['tm:attractions'] = cache;

    // 2. Ontdekken: alles waarvan de verkoop nog moet beginnen of de afgelopen 3 dagen begon.
    const since = DateTime.fromISO(ctx.now).minus({ days: 3 }).toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss'Z'");
    for (const country of ctx.cfg.discoveryCountries) {
      for (const segmentName of ['Music', 'Sports', 'Arts & Theatre']) {
        for (let page = 0; page < 2 && calls < budget; page++) {
          calls++;
          const r = await get('/events.json', {
            countryCode: country,
            segmentName,
            onsaleStartDateTime: since,
            sort: 'onSaleStartDate,asc',
            size: '200',
            page: String(page),
          });
          for (const e of r._embedded?.events ?? []) add(e);
          if ((r.page?.totalPages ?? 1) <= page + 1) break;
        }
      }
    }
    res.message = `${res.discovered.length} datums uit ${calls} verzoeken.`;
    return res;
  }
}
