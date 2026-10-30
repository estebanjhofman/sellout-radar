import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  cityNl,
  dateOnly,
  earliestInstant,
  exactLocal,
  isKnown,
  isOfficial,
  normalizeName,
  resolveClaims,
  sameTimePoint,
  sameVenue,
  slug,
  SOURCE_RANK,
  tokenSimilarity,
  type Claim,
  type Conflict,
  type EventStatus,
  type SalePhase,
  type SourceRef,
  type TimePoint,
} from '@sellout/core';
import { cloneCatalog, type Catalog, type CatalogEvent, type CatalogVenue } from '../catalog';
import type { ConnectorResult, DiscoveredEvent, DiscoveredPhase, LoosePhase } from '../connectors/types';
import { EARLIEST_TZ } from '../extract/llm';
import { continentOf } from '../geo';
import type { SerializedCatalog } from '../state';

export interface MergeInput {
  seed: Catalog;
  previous: SerializedCatalog;
  storedClaims: Claim[];
  results: ConnectorResult[];
  now: string;
}

export interface MergeOutput {
  catalog: Catalog;
  /** Nieuwe beweringen uit deze run (alleen als de waarde veranderde of nieuw is). */
  newClaims: Claim[];
  conflicts: Conflict[];
  externalIds: { entity: string; source: string; externalId: string }[];
  createdEventIds: string[];
  log: string[];
}

const short = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);

/** Volgorde van "definitief": een latere uitverkocht-melding gaat voor een oudere "aangekondigd". */
const FINAL: EventStatus[] = ['cancelled', 'postponed', 'soldout'];
const STATUS_PRIORITY: Record<EventStatus, number> = { cancelled: 6, postponed: 5, soldout: 4, few_left: 3, onsale: 2, announced: 1 };

/**
 * Status uit beweringen. Status verandert in de tijd (aangekondigd → uitverkocht), dus een
 * nieuwere definitieve status (uitverkocht, geannuleerd, uitgesteld) van een officiële bron of
 * nieuwsbron gaat voor een oudere officiële "aangekondigd". Spreekt een officiële bron die
 * daarna tegen, dan wint de officiële bron en tonen we het conflict.
 */
export function resolveStatus(claims: Claim<EventStatus>[]): { value: EventStatus | null; conflict: Conflict | null } {
  if (claims.length === 0) return { value: null, conflict: null };
  const latest = new Map<string, Claim<EventStatus>>();
  for (const c of claims) {
    const p = latest.get(c.source.name);
    if (!p || p.source.fetchedAt < c.source.fetchedAt) latest.set(c.source.name, c);
  }
  const all = [...latest.values()];
  const finals = all
    .filter((c) => FINAL.includes(c.value) && SOURCE_RANK[c.source.kind] <= 5)
    .sort((a, b) => STATUS_PRIORITY[b.value] - STATUS_PRIORITY[a.value] || b.source.fetchedAt.localeCompare(a.source.fetchedAt));
  for (const f of finals) {
    const newerOfficialContrary = all.filter((c) => isOfficial(c.source) && c.value !== f.value && c.source.fetchedAt > f.source.fetchedAt);
    if (newerOfficialContrary.length === 0) {
      const contrary = all.filter((c) => c.value !== f.value && c.source.fetchedAt >= f.source.fetchedAt && !FINAL.includes(c.value) && isOfficial(c.source));
      return {
        value: f.value,
        conflict: contrary.length
          ? { entity: f.entity, field: 'status', chosen: f.value, alternatives: contrary.map((c) => ({ value: c.value, source: c.source })), reason: `Gekozen: ${f.source.name} (nieuwste definitieve status).` }
          : null,
      };
    }
  }
  const r = resolveClaims(all);
  return { value: r.value, conflict: r.conflict };
}

/** Twee tijden zijn verenigbaar als de ene een preciezere versie van de andere is. */
export function compatibleTimes(a: TimePoint, b: TimePoint): boolean {
  if (!isKnown(a) || !isKnown(b)) return true;
  if (sameTimePoint(a, b)) return true;
  const dayIn = (tp: TimePoint, tz: string) => (tp.precision === 'exact' ? earliestInstant(tp)!.setZone(tz).toISODate() : tp.localDate);
  if (a.precision === 'month' || b.precision === 'month') {
    const m = (tp: TimePoint) => (tp.precision === 'month' ? tp.localMonth : (tp.localDate ?? earliestInstant(tp)?.toISODate())?.slice(0, 7));
    return m(a) === m(b);
  }
  if (a.precision === 'exact' && b.precision === 'exact') return false;
  const date = a.precision === 'date' ? a : b;
  const other = a.precision === 'date' ? b : a;
  return dayIn(other, date.tz) === date.localDate;
}

const PRECISION_ORDER = { exact: 3, date: 2, month: 1, unknown: 0 } as const;

/**
 * Tijd uit beweringen: verenigbare beweringen worden samengevoegd (de preciezere wint, geen
 * conflict); echte tegenspraak gaat via de bronvoorrang en wordt als conflict gemarkeerd.
 * "Onbekend" overschrijft nooit een bekende tijd.
 */
export function resolveTime(claims: Claim<TimePoint>[]): { value: TimePoint | null; conflict: Conflict | null } {
  const known = claims.filter((c) => isKnown(c.value));
  if (known.length === 0) return { value: claims[0]?.value ?? null, conflict: null };
  const latest = new Map<string, Claim<TimePoint>>();
  for (const c of known) {
    const p = latest.get(c.source.name);
    if (!p || p.source.fetchedAt < c.source.fetchedAt) latest.set(c.source.name, c);
  }
  const all = [...latest.values()];
  const allCompatible = all.every((a) => all.every((b) => compatibleTimes(a.value, b.value)));
  if (allCompatible) {
    const best = [...all].sort(
      (a, b) =>
        PRECISION_ORDER[b.value.precision] - PRECISION_ORDER[a.value.precision] ||
        SOURCE_RANK[a.source.kind] - SOURCE_RANK[b.source.kind] ||
        b.source.fetchedAt.localeCompare(a.source.fetchedAt),
    )[0]!;
    return { value: best.value, conflict: null };
  }
  const r = resolveClaims(all, (a, b) => compatibleTimes(a, b));
  return { value: r.value, conflict: r.conflict };
}

function addSource(list: SourceRef[], s: SourceRef): SourceRef[] {
  const i = list.findIndex((x) => x.name === s.name);
  if (i < 0) return [...list, s];
  const copy = [...list];
  if (copy[i]!.fetchedAt < s.fetchedAt) copy[i] = { ...copy[i]!, fetchedAt: s.fetchedAt, ...(s.url ? { url: s.url } : {}) };
  return copy;
}

const COUNTRY_TZ_FALLBACK: Record<string, string> = {
  NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', DE: 'Europe/Berlin', FR: 'Europe/Paris', GB: 'Europe/London', IE: 'Europe/Dublin',
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', IT: 'Europe/Rome', AT: 'Europe/Vienna', CH: 'Europe/Zurich', DK: 'Europe/Copenhagen',
  SE: 'Europe/Stockholm', NO: 'Europe/Oslo', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw', CZ: 'Europe/Prague', HU: 'Europe/Budapest',
  KR: 'Asia/Seoul', JP: 'Asia/Tokyo', SG: 'Asia/Singapore', NZ: 'Pacific/Auckland',
};

export function mergeAll(input: MergeInput): MergeOutput {
  const log: string[] = [];
  const cat = cloneCatalog({
    artists: new Map(input.previous.artists.map((a) => [a.id, a])),
    tours: new Map(input.previous.tours.map((t) => [t.id, t])),
    venues: new Map(input.previous.venues.map((v) => [v.id, v])),
    events: new Map(input.previous.events.map((e) => [e.id, e])),
    phases: new Map(input.previous.phases.map((p) => [p.id, p])),
    claims: [],
    conflicts: [],
  });

  // 1. Seed bovenop de vorige catalogus: de handmatig gecontroleerde structuur gaat voor.
  for (const [id, a] of input.seed.artists) {
    const prev = cat.artists.get(id);
    cat.artists.set(id, { ...a, externalIds: { ...(prev?.externalIds ?? {}), ...(a.externalIds ?? {}) } });
  }
  for (const [id, t] of input.seed.tours) cat.tours.set(id, structuredClone(t));
  for (const [id, v] of input.seed.venues) cat.venues.set(id, { ...structuredClone(v), externalIds: cat.venues.get(id)?.externalIds });
  for (const [id, e] of input.seed.events) {
    const prev = cat.events.get(id);
    const merged: CatalogEvent = { ...structuredClone(e), externalIds: { ...(prev?.externalIds ?? {}), ...(e.externalIds ?? {}) }, firstSeenAt: prev?.firstSeenAt ?? input.now };
    // Bronnen die eerder door connectors zijn toegevoegd blijven staan.
    for (const s of prev?.sources ?? []) merged.sources = addSource(merged.sources, s);
    if (!merged.priceRange && prev?.priceRange) merged.priceRange = prev.priceRange;
    if (!merged.officialSellers && prev?.officialSellers) merged.officialSellers = prev.officialSellers;
    if (merged.ticketLimit === undefined && prev?.ticketLimit !== undefined) merged.ticketLimit = prev.ticketLimit;
    cat.events.set(id, merged);
  }
  for (const [id, p] of input.seed.phases) {
    const prev = cat.phases.get(id);
    const merged = structuredClone(p);
    for (const s of prev?.sources ?? []) merged.sources = addSource(merged.sources, s);
    cat.phases.set(id, merged);
  }

  // Indexen
  const artistByName = new Map<string, string>();
  const artistByExt = new Map<string, string>();
  const indexArtist = (id: string) => {
    const a = cat.artists.get(id)!;
    artistByName.set(normalizeName(a.name), id);
    for (const al of a.aliases ?? []) artistByName.set(normalizeName(al), id);
    for (const [src, ext] of Object.entries(a.externalIds ?? {})) artistByExt.set(`${src}:${ext}`, id);
  };
  for (const id of cat.artists.keys()) indexArtist(id);
  const eventsByArtistDate = new Map<string, string[]>();
  const indexEvent = (e: CatalogEvent) => {
    const d = e.date.localDate ?? '';
    for (const a of e.artistIds) {
      const k = `${a}|${d}`;
      const list = eventsByArtistDate.get(k) ?? [];
      if (!list.includes(e.id)) list.push(e.id);
      eventsByArtistDate.set(k, list);
    }
  };
  for (const e of cat.events.values()) indexEvent(e);
  const eventByExt = new Map<string, string>();
  for (const e of cat.events.values()) for (const [src, ext] of Object.entries(e.externalIds ?? {})) eventByExt.set(`${src}:${ext}`, e.id);

  const newClaims: Claim[] = [];
  const allClaims: Claim[] = [...input.seed.claims, ...input.storedClaims];
  const externalIds: MergeOutput['externalIds'] = [];
  const createdEventIds: string[] = [];

  // Laatste bewering per (entiteit, veld, bron), om herhalingen niet opnieuw op te slaan.
  const latestClaim = new Map<string, Claim>();
  for (const c of allClaims) {
    const k = `${c.entity}|${c.field}|${c.source.name}`;
    const p = latestClaim.get(k);
    if (!p || p.source.fetchedAt < c.source.fetchedAt) latestClaim.set(k, c);
  }
  /** Voegt een bewering toe als die nieuw is of de waarde veranderde. */
  const claim = (entity: string, field: string, value: unknown, source: SourceRef, evidence?: string) => {
    const k = `${entity}|${field}|${source.name}`;
    const prev = latestClaim.get(k);
    if (prev && JSON.stringify(prev.value) === JSON.stringify(value)) return;
    const c: Claim = { entity, field, value, source, ...(evidence ? { evidence } : {}) };
    newClaims.push(c);
    latestClaim.set(k, c);
  };

  // Fases per datum, voor snel koppelen.
  const phasesByEvent = new Map<string, Set<string>>();
  const indexPhase = (p: SalePhase) => {
    for (const e of p.eventIds) {
      const s = phasesByEvent.get(e) ?? new Set<string>();
      s.add(p.id);
      phasesByEvent.set(e, s);
    }
  };
  for (const p of cat.phases.values()) indexPhase(p);

  const sourceKey = (s: SourceRef) => (s.kind === 'ticketing' ? s.name.toLowerCase() : slug(s.name));

  const findOrCreateArtist = (d: DiscoveredEvent | LoosePhase): string | null => {
    const ext = 'artistExternalId' in d && d.artistExternalId ? artistByExt.get(`ticketmaster:${d.artistExternalId}`) : undefined;
    if (ext) return ext;
    const byName = artistByName.get(normalizeName(d.artistName));
    if (byName) return byName;
    if (!('venue' in d)) return null; // losse fase zonder bekende artiest: niets aan te koppelen
    let id = slug(d.artistName) || `artist-${short(d.artistName)}`;
    if (cat.artists.has(id)) id = `${id}-${short(d.artistName)}`;
    cat.artists.set(id, {
      id,
      name: d.artistName,
      fandom: 'unknown',
      externalIds: d.artistExternalId ? { ticketmaster: d.artistExternalId } : {},
    });
    indexArtist(id);
    return id;
  };

  const findOrCreateVenue = (d: DiscoveredEvent): CatalogVenue | null => {
    if (d.venue.externalId) {
      for (const v of cat.venues.values()) if (v.externalIds?.[sourceKey(d.source)] === d.venue.externalId) return v;
    }
    for (const v of cat.venues.values()) {
      if (v.country === d.venue.country && sameVenue(v, d.venue)) return v;
    }
    const tz = d.venue.tz ?? COUNTRY_TZ_FALLBACK[d.venue.country];
    if (!tz) return null;
    let id = slug(`${d.venue.name} ${d.venue.city}`);
    if (cat.venues.has(id)) id = `${id}-${short(d.venue.name + d.venue.city + d.venue.country)}`;
    const v: CatalogVenue = {
      id,
      name: d.venue.name,
      city: d.venue.city,
      country: d.venue.country,
      tz,
      ...(d.venue.lat !== undefined ? { lat: d.venue.lat, lon: d.venue.lon } : {}),
      ...(d.venue.externalId ? { externalIds: { [sourceKey(d.source)]: d.venue.externalId } } : {}),
    };
    cat.venues.set(id, v);
    return v;
  };

  const attachPhase = (eventIds: string[], dp: DiscoveredPhase, source: SourceRef, ownerKey: string) => {
    const candIds = new Set<string>();
    for (const e of eventIds) for (const pid of phasesByEvent.get(e) ?? []) candIds.add(pid);
    const candidates = [...candIds].map((id) => cat.phases.get(id)!).filter((p) => p && p.kind === dp.kind);
    let match: SalePhase | undefined;
    if (dp.kind === 'general_sale') {
      match = candidates.find((p) => !p.region || !dp.region || p.region === dp.region) ?? candidates[0];
    } else {
      match = candidates.find(
        (p) =>
          tokenSimilarity(p.name, dp.name) >= 0.5 ||
          normalizeName(p.name).includes(normalizeName(dp.name)) ||
          normalizeName(dp.name).includes(normalizeName(p.name)) ||
          (isKnown(p.start) && isKnown(dp.start) && p.start.precision === 'exact' && sameTimePoint(p.start, dp.start) && (!p.type || !dp.type || p.type === dp.type)),
      );
    }
    if (match) {
      match.eventIds = [...new Set([...match.eventIds, ...eventIds])];
      match.sources = addSource(match.sources, source);
      if (!match.url && dp.url) match.url = dp.url;
      if (match.ticketLimit === undefined && dp.ticketLimit !== undefined) match.ticketLimit = dp.ticketLimit;
      if (!match.conditions && dp.conditions) match.conditions = dp.conditions;
      if (!match.whereToRegister && dp.whereToRegister) match.whereToRegister = dp.whereToRegister;
      if (dp.notes) match.notes = [...new Set([...(match.notes ?? []), ...dp.notes])];
      indexPhase(match);
    } else {
      const id = `${ownerKey}:${sourceKey(source)}:${slug(dp.name) || dp.kind}:${short(JSON.stringify(dp.start) + eventIds.join(','))}`;
      match = {
        id,
        kind: dp.kind,
        ...(dp.type ? { type: dp.type } : {}),
        name: dp.name,
        ...(dp.region ? { region: dp.region } : {}),
        eventIds: [...eventIds],
        start: dp.start,
        ...(dp.end ? { end: dp.end } : {}),
        ...(dp.deadline ? { deadline: dp.deadline } : {}),
        ...(dp.url ? { url: dp.url } : {}),
        ...(dp.requiresCode !== undefined ? { requiresCode: dp.requiresCode } : {}),
        ...(dp.whereToRegister ? { whereToRegister: dp.whereToRegister } : {}),
        ...(dp.ticketLimit !== undefined ? { ticketLimit: dp.ticketLimit } : {}),
        ...(dp.conditions ? { conditions: dp.conditions } : {}),
        ...(dp.notes ? { notes: dp.notes } : {}),
        sources: [source],
      };
      cat.phases.set(id, match);
      indexPhase(match);
    }
    claim(`phase:${match.id}`, 'start', dp.start, source, dp.evidence);
    if (dp.end) claim(`phase:${match.id}`, 'end', dp.end, source, dp.evidence);
    if (dp.deadline) claim(`phase:${match.id}`, 'deadline', dp.deadline, source, dp.evidence);
  };

  // 2. Ontdekte datums koppelen of toevoegen.
  for (const r of input.results) {
    for (const d of r.discovered) {
      const artistId = findOrCreateArtist(d);
      if (!artistId) continue;
      let ev: CatalogEvent | undefined;
      if (d.externalId) ev = cat.events.get(eventByExt.get(`${sourceKey(d.source)}:${d.externalId}`) ?? '');
      if (!ev) {
        const ids = eventsByArtistDate.get(`${artistId}|${d.localDate}`) ?? [];
        const cands = ids.map((id) => cat.events.get(id)!).filter(Boolean);
        ev =
          cands.find((e) => {
            const v = cat.venues.get(e.venueId);
            return v && (normalizeName(v.city) === normalizeName(d.venue.city) || sameVenue(v, d.venue));
          }) ?? cands.find((e) => cat.venues.get(e.venueId)?.country === d.venue.country) ?? (cands.length === 1 && !d.venue.country ? cands[0] : undefined);
      }
      if (!ev) {
        const venue = findOrCreateVenue(d);
        if (!venue) {
          log.push(`Overgeslagen (geen tijdzone): ${d.artistName} ${d.venue.city} ${d.localDate}`);
          continue;
        }
        let tourId: string | undefined;
        if (d.tourName) {
          tourId = `${artistId}-${slug(d.tourName)}`.slice(0, 120);
          if (!cat.tours.has(tourId)) cat.tours.set(tourId, { id: tourId, artistId, name: d.tourName, announcedAt: input.now.slice(0, 10) });
        }
        let id = `${slug(artistId)}-${d.localDate}-${slug(venue.city)}`;
        if (cat.events.has(id)) id = `${id}-${short(d.venue.name + (d.localTime ?? ''))}`;
        const artistName = cat.artists.get(artistId)!.name;
        const title = d.type === 'concert' || d.type === 'comedy' || !d.title ? `${artistName} · ${cityNl(venue.city, venue.country)}` : d.title;
        ev = {
          id,
          title,
          type: d.type,
          artistIds: [artistId],
          ...(tourId ? { tourId } : {}),
          venueId: venue.id,
          date: d.localTime ? exactLocal(d.localDate, d.localTime, venue.tz) : dateOnly(d.localDate, venue.tz),
          status: 'announced',
          verification: isOfficial(d.source) ? 'official' : 'unconfirmed',
          sources: [d.source],
          firstSeenAt: input.now,
          ...(d.notes ? { notes: d.notes } : {}),
        };
        cat.events.set(id, ev);
        indexEvent(ev);
        createdEventIds.push(id);
      } else {
        ev.sources = addSource(ev.sources, d.source);
        if (isOfficial(d.source)) ev.verification = 'official';
        if (d.notes) ev.notes = [...new Set([...(ev.notes ?? []), ...d.notes])];
        if (!ev.tourId && d.tourName) {
          const tourId = `${artistId}-${slug(d.tourName)}`.slice(0, 120);
          if (!cat.tours.has(tourId)) cat.tours.set(tourId, { id: tourId, artistId, name: d.tourName, announcedAt: input.now.slice(0, 10) });
          ev.tourId = tourId;
        }
      }
      if (d.externalId) {
        ev.externalIds = { ...(ev.externalIds ?? {}), [sourceKey(d.source)]: d.externalId };
        eventByExt.set(`${sourceKey(d.source)}:${d.externalId}`, ev.id);
        externalIds.push({ entity: `event:${ev.id}`, source: sourceKey(d.source), externalId: d.externalId });
      }
      if (d.priceRange && (!ev.priceRange || d.source.kind === 'ticketing')) ev.priceRange = d.priceRange;
      if (d.ticketLimit !== undefined && ev.ticketLimit === undefined) ev.ticketLimit = d.ticketLimit;
      if (d.officialSeller) {
        const sellers = ev.officialSellers ?? [];
        if (!sellers.some((s) => s.name === d.officialSeller!.name)) ev.officialSellers = [...sellers, d.officialSeller];
      }
      if (d.status) claim(`event:${ev.id}`, 'status', d.status, d.source, d.evidence);
      if (d.addedShow) claim(`event:${ev.id}`, 'addedShow', true, d.source, d.evidence);
      claim(`event:${ev.id}`, 'date', d.localDate, d.source, d.evidence);
      if (d.venue.name && d.venue.name !== 'Venue nog niet bekend') claim(`event:${ev.id}`, 'venue', `${d.venue.name}, ${d.venue.city}`, d.source, d.evidence);
      const owner = ev.tourId ?? ev.artistIds[0] ?? 'x';
      for (const dp of d.phases) attachPhase([ev.id], dp, d.source, owner);
    }
  }

  // 3. Losse fases aan de data van de artiest koppelen.
  const today = DateTime.fromISO(input.now).toISODate()!;
  for (const r of input.results) {
    for (const lp of r.loosePhases) {
      const artistId = findOrCreateArtist(lp);
      if (!artistId) {
        log.push(`Fase zonder bekende artiest overgeslagen: ${lp.artistName} – ${lp.phase.name}`);
        continue;
      }
      const cities = lp.cities.map(normalizeName);
      const region = (lp.region ?? '').toLowerCase();
      const regionContinent = /europ|eu\b|uk|benelux/.test(region) ? 'EU' : /north america|na\b|us|canada/.test(region) ? 'NA' : undefined;
      let targets = [...cat.events.values()].filter((e) => e.artistIds.includes(artistId) && (e.date.localDate ?? '9999') >= today && e.status !== 'cancelled');
      if (lp.tourName) {
        const tourMatch = targets.filter((e) => e.tourId && tokenSimilarity(cat.tours.get(e.tourId)?.name ?? '', lp.tourName!) >= 0.4);
        if (tourMatch.length) targets = tourMatch;
      }
      if (cities.length) targets = targets.filter((e) => cities.includes(normalizeName(cat.venues.get(e.venueId)?.city ?? '')));
      else if (regionContinent) targets = targets.filter((e) => continentOf(cat.venues.get(e.venueId)?.country ?? '') === regionContinent);
      if (targets.length === 0) {
        log.push(`Fase zonder datums overgeslagen: ${lp.artistName} – ${lp.phase.name}`);
        continue;
      }
      // Eén fase per tijdzonegroep: "10:00 lokale tijd" is in Londen een ander moment dan in Amsterdam.
      const byTz = new Map<string, string[]>();
      for (const e of targets) {
        const tz = lp.phase.start.tz === EARLIEST_TZ ? cat.venues.get(e.venueId)!.tz : lp.phase.start.tz;
        byTz.set(tz, [...(byTz.get(tz) ?? []), e.id]);
      }
      for (const [tz, ids] of byTz) {
        const shift = (tp?: TimePoint): TimePoint | undefined =>
          !tp ? undefined : tp.precision === 'date' && tp.tz === EARLIEST_TZ ? dateOnly(tp.localDate!, tz) : tp.precision === 'unknown' ? { precision: 'unknown', tz } : tp;
        const dp: DiscoveredPhase = { ...lp.phase, start: shift(lp.phase.start)!, ...(lp.phase.end ? { end: shift(lp.phase.end) } : {}), ...(lp.phase.deadline ? { deadline: shift(lp.phase.deadline) } : {}) };
        const owner = cat.events.get(ids[0]!)!.tourId ?? artistId;
        attachPhase(ids, dp, lp.source, owner);
      }
    }
  }

  // 4. Velden bepalen uit alle beweringen.
  const claimsByKey = new Map<string, Claim[]>();
  for (const c of [...allClaims, ...newClaims]) {
    const k = `${c.entity}|${c.field}`;
    claimsByKey.set(k, [...(claimsByKey.get(k) ?? []), c]);
  }
  const conflicts: Conflict[] = [];
  const nowDt = DateTime.fromISO(input.now);
  for (const ev of cat.events.values()) {
    const st = resolveStatus((claimsByKey.get(`event:${ev.id}|status`) ?? []) as Claim<EventStatus>[]);
    if (st.value) ev.status = st.value;
    if (st.conflict) conflicts.push(st.conflict);
    if ((claimsByKey.get(`event:${ev.id}|addedShow`) ?? []).some((c) => c.value === true)) ev.addedShow = true;
    for (const field of ['venue', 'date']) {
      const r = resolveClaims(claimsByKey.get(`event:${ev.id}|${field}`) ?? []);
      if (r.conflict) conflicts.push(r.conflict);
    }
  }
  for (const p of cat.phases.values()) {
    for (const field of ['start', 'end', 'deadline'] as const) {
      const cl = (claimsByKey.get(`phase:${p.id}|${field}`) ?? []) as Claim<TimePoint>[];
      if (cl.length === 0) continue;
      const r = resolveTime(cl);
      if (r.value) (p as unknown as Record<string, TimePoint>)[field] = r.value;
      if (r.conflict) conflicts.push(r.conflict);
    }
  }
  // Afgeleide status: zodra een verkoopfase is begonnen, is de datum "in de verkoop".
  for (const ev of cat.events.values()) {
    if (ev.status !== 'announced') continue;
    const started = [...(phasesByEvent.get(ev.id) ?? [])]
      .map((id) => cat.phases.get(id))
      .some((p) => p && p.kind !== 'registration' && p.kind !== 'lottery' && (earliestInstant(p.start)?.toMillis() ?? Infinity) <= nowDt.toMillis());
    if (started) ev.status = 'onsale';
  }

  // 5. Opruimen: fases zonder datums, datums ruim voorbij.
  const cutoff = nowDt.minus({ days: 45 }).toISODate()!;
  for (const [id, e] of cat.events) {
    if ((e.date.localDate ?? e.date.localMonth ?? '9999') < cutoff && !input.seed.events.has(id)) cat.events.delete(id);
  }
  for (const [id, p] of cat.phases) {
    p.eventIds = p.eventIds.filter((e) => cat.events.has(e));
    if (p.eventIds.length === 0) cat.phases.delete(id);
  }

  cat.claims = [...input.seed.claims];
  cat.conflicts = conflicts;
  return { catalog: cat, newClaims, conflicts, externalIds, createdEventIds, log };
}
