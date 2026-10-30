import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import {
  cityNl,
  dateOnly,
  exactLocal,
  findWeekdayMismatches,
  monthOnly,
  slug,
  unknownTime,
  type Claim,
  type PastVisit,
  type SalePhase,
  type SourceRef,
  type TimePoint,
} from '@sellout/core';
import { emptyCatalog, type Catalog, type CatalogEvent } from '../catalog';
import { continentOf } from '../geo';
import type { SeedEventSelector, SeedFile, SeedMetric, SeedPastVisit, SeedSource } from './schema';

export interface SeedIssue {
  file: string;
  level: 'error' | 'warning';
  message: string;
}

export interface CompiledSeed {
  catalog: Catalog;
  issues: SeedIssue[];
  files: string[];
}

/** Tijd uit de seednotatie naar een TimePoint; onbekend blijft onbekend. */
export function parseSeedTime(value: string | null | undefined, tz: string): TimePoint {
  if (value === null || value === undefined || value === '') return unknownTime(tz);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const [d, t] = value.split('T') as [string, string];
    return exactLocal(d, t, tz);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateOnly(value, tz);
  if (/^\d{4}-\d{2}$/.test(value)) return monthOnly(value, tz);
  throw new Error(`Onbekende tijdnotatie "${value}"`);
}

function sourceRef(s: SeedSource): SourceRef {
  const fetchedAt = s.checked.length === 10 ? `${s.checked}T00:00:00.000Z` : DateTime.fromISO(s.checked, { zone: 'utc' }).toISO()!;
  return { name: s.name, kind: s.kind, ...(s.url ? { url: s.url } : {}), fetchedAt };
}

function matches(sel: SeedEventSelector, key: string, city: string, country: string, venueKey: string): boolean {
  if (sel === 'all') return true;
  if (Array.isArray(sel)) return sel.includes(key);
  const c = city.toLowerCase();
  if (sel.cities && !sel.cities.map((x) => x.toLowerCase()).includes(c)) return false;
  if (sel.exceptCities && sel.exceptCities.map((x) => x.toLowerCase()).includes(c)) return false;
  if (sel.countries && !sel.countries.includes(country)) return false;
  if (sel.exceptCountries && sel.exceptCountries.includes(country)) return false;
  if (sel.venues && !sel.venues.includes(venueKey)) return false;
  return true;
}

const tzSlug = (tz: string) => tz.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function compileSeedFile(seed: SeedFile, file: string, into: Catalog, issues: SeedIssue[]): void {
  const err = (message: string) => issues.push({ file, level: 'error', message });
  const warn = (message: string) => issues.push({ file, level: 'warning', message });

  const refs = new Map<string, SourceRef>();
  for (const [k, s] of Object.entries(seed.sources)) refs.set(k, sourceRef(s));
  const srcs = (keys: string[] | undefined, where: string): SourceRef[] => {
    if (!keys || keys.length === 0) {
      err(`${where}: geen bron opgegeven`);
      return [];
    }
    return keys.flatMap((k) => {
      const r = refs.get(k);
      if (!r) err(`${where}: onbekende bron "${k}"`);
      return r ? [r] : [];
    });
  };

  for (const a of [seed.artist, ...(seed.artists ?? [])]) {
    const prev = into.artists.get(a.id);
    into.artists.set(a.id, {
      id: a.id,
      name: a.name,
      aliases: a.aliases ?? prev?.aliases,
      genres: a.genres ?? prev?.genres,
      fandom: a.fandom ?? prev?.fandom ?? 'unknown',
      externalIds: { ...(prev?.externalIds ?? {}), ...(a.externalIds ?? {}) },
    });
  }

  const t = seed.tour;
  const tourSources: SourceRef[] = [];
  if (t.addedForDemand) tourSources.push(...srcs(t.addedForDemandSources, `tour ${t.id} addedForDemand`));
  if (t.releaseDate) tourSources.push(...srcs(t.releaseSources, `tour ${t.id} releaseDate`));
  for (const s of t.soldOutElsewhere ?? []) tourSources.push(...srcs(s.sources, `tour ${t.id} soldOutElsewhere ${s.city}`));
  if (into.tours.has(t.id)) warn(`tour ${t.id} staat in meer dan één seedbestand`);
  into.tours.set(t.id, {
    id: t.id,
    artistId: seed.artist.id,
    name: t.name,
    leg: t.leg,
    announcedAt: t.announcedAt,
    farewell: t.farewell,
    reunion: t.reunion,
    comeback: t.comeback,
    addedForDemand: t.addedForDemand,
    releaseDate: t.releaseDate,
    soldOutElsewhere: t.soldOutElsewhere?.map(({ sources: _s, ...rest }) => rest),
    sources: tourSources.filter((s, i, a) => a.findIndex((x) => x.name === s.name) === i),
  });

  compilePopularityAndHistory(seed, into, refs, err);

  for (const [k, v] of Object.entries(seed.venues)) {
    if (!/^[A-Z]{2}$/.test(v.country)) err(`venue ${k}: landcode "${v.country}" is geen ISO-code`);
    if (v.capacity !== undefined && (!v.capacitySource || !refs.has(v.capacitySource))) err(`venue ${k}: capaciteit zonder (bekende) bron`);
    try {
      DateTime.now().setZone(v.tz);
      if (!DateTime.now().setZone(v.tz).isValid) err(`venue ${k}: ongeldige tijdzone ${v.tz}`);
    } catch {
      err(`venue ${k}: ongeldige tijdzone ${v.tz}`);
    }
    const prev = into.venues.get(k);
    into.venues.set(k, {
      id: k,
      name: v.name,
      city: v.city,
      country: v.country,
      tz: v.tz,
      capacity: v.capacity ?? prev?.capacity,
      capacitySource: v.capacitySource ?? prev?.capacitySource,
      outdoor: v.outdoor ?? prev?.outdoor,
      lat: v.lat ?? prev?.lat,
      lon: v.lon ?? prev?.lon,
    });
  }

  const artistSlug = slug(seed.artist.id);
  const localKeys = new Map<string, string>(); // "YYYY-MM-DD@venue" → event id
  for (const e of seed.events) {
    const where = `datum ${e.date}@${e.venue}`;
    const venue = seed.venues[e.venue];
    if (!venue) {
      err(`${where}: onbekende venue`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !DateTime.fromISO(e.date).isValid) {
      err(`${where}: ongeldige datum`);
      continue;
    }
    const sources = srcs(e.sources, where);
    let id = `${artistSlug}-${e.date}-${slug(venue.city)}`;
    // Middag- en avondvoorstelling op dezelfde dag: tijd in de ID.
    if (e.time && seed.events.filter((x) => x.date === e.date && x.venue === e.venue).length > 1) id += `-${e.time.replace(':', '')}`;
    if (into.events.has(id) && !localKeys.has(`${e.date}@${e.venue}`)) {
      warn(`${where}: dezelfde datum staat al in een ander seedbestand; bronnen worden samengevoegd`);
      const existing = into.events.get(id)!;
      existing.sources = [...existing.sources, ...sources.filter((s) => !existing.sources.some((x) => x.name === s.name))];
      localKeys.set(`${e.date}@${e.venue}`, id);
      continue;
    }
    localKeys.set(`${e.date}@${e.venue}`, id);
    const date = e.time ? exactLocal(e.date, e.time, venue.tz) : dateOnly(e.date, venue.tz);
    const title =
      e.title ??
      (seed.titleTemplate ?? '{artist} · {city}')
        .replace('{artist}', seed.artist.name)
        .replace('{city}', cityNl(venue.city, venue.country))
        .replace('{venue}', venue.name);
    const ev: CatalogEvent = {
      id,
      title,
      type: seed.type,
      artistIds: [seed.artist.id, ...(seed.artists ?? []).map((a) => a.id)],
      tourId: t.id,
      venueId: e.venue,
      date,
      status: e.status ?? 'announced',
      addedShow: e.addedShow,
      addedShowReason: e.addedShowReason,
      priceRange: e.priceRange,
      ticketLimit: e.ticketLimit,
      officialSellers: e.officialSellers,
      verification:
        e.verification ??
        (sources.some((s) => ['artist', 'official_store', 'promoter', 'venue', 'ticketing'].includes(s.kind)) ? 'official' : (t.verification ?? 'unconfirmed')),
      sources,
      notes: e.notes,
      localTime: e.time,
      soldOutAt: e.soldOutAt,
      soldOutInPresale: e.soldOutInPresale,
      inputs: e.inputs,
    };
    if (e.inputs?.previousVisit) srcs(e.inputs.previousVisit.sources, `${where} previousVisit`);
    into.events.set(id, ev);
    for (const s of sources) {
      into.claims.push({ entity: `event:${id}`, field: 'status', value: ev.status, source: s });
      into.claims.push({ entity: `event:${id}`, field: 'venue', value: `${venue.name}, ${venue.city}`, source: s });
      into.claims.push({ entity: `event:${id}`, field: 'date', value: e.date, source: s });
    }
    for (const note of e.notes ?? []) {
      const year = Number(e.date.slice(0, 4));
      // Een notitie kan over het showjaar of over de verkoop een jaar eerder gaan: alleen melden
      // als de weekdag in geen van beide jaren klopt.
      const prevYear = new Set(findWeekdayMismatches(note, year - 1).map((m) => m.text));
      for (const m of findWeekdayMismatches(note, year).filter((m) => prevYear.has(m.text))) {
        warn(`${where}: weekdag klopt niet in notitie "${m.text}"`);
      }
    }
  }

  const phaseIdsByKey = new Map<string, string[]>();
  const pending: { phase: SalePhase; unlocks?: string }[] = [];
  for (const p of seed.phases ?? []) {
    const where = `fase ${p.key}`;
    const sources = srcs(p.sources, where);
    const selected = seed.events.filter((e) => {
      const v = seed.venues[e.venue];
      return v && matches(p.events, `${e.date}@${e.venue}`, v.city, v.country, e.venue);
    });
    if (Array.isArray(p.events)) {
      for (const k of p.events) if (!localKeys.has(k)) err(`${where}: onbekende datum "${k}"`);
    }
    if (selected.length === 0) {
      err(`${where}: geen datums geselecteerd`);
      continue;
    }
    const groups = new Map<string, string[]>();
    for (const e of selected) {
      const tz = !p.tz || p.tz === 'venue' ? seed.venues[e.venue]!.tz : p.tz;
      const id = localKeys.get(`${e.date}@${e.venue}`);
      if (!id) continue;
      groups.set(tz, [...(groups.get(tz) ?? []), id]);
    }
    const ids: string[] = [];
    for (const [tz, eventIds] of groups) {
      const id = groups.size === 1 ? `${t.id}:${p.key}` : `${t.id}:${p.key}:${tzSlug(tz)}`;
      ids.push(id);
      let phase: SalePhase;
      try {
        phase = {
          id,
          kind: p.kind,
          type: p.type,
          name: p.name,
          region: p.region,
          eventIds,
          start: parseSeedTime(p.start, tz),
          ...(p.end ? { end: parseSeedTime(p.end, tz) } : {}),
          ...(p.deadline !== undefined ? { deadline: parseSeedTime(p.deadline, tz) } : {}),
          ...(p.drawAt ? { drawAt: parseSeedTime(p.drawAt, tz) } : {}),
          requiresCode: p.requiresCode,
          whereToRegister: p.whereToRegister,
          conditions: p.conditions,
          url: p.url,
          ticketLimit: p.ticketLimit,
          ...(p.notes?.length ? { notes: p.notes } : {}),
          sources,
        };
      } catch (e) {
        err(`${where}: ${(e as Error).message}`);
        continue;
      }
      if ((p.kind === 'registration' || p.kind === 'lottery') && p.deadline === undefined) {
        warn(`${where}: inschrijving zonder deadline-veld (zet null als die nog niet bekend is)`);
      }
      pending.push({ phase, unlocks: p.unlocks });
      for (const s of sources) {
        into.claims.push({ entity: `phase:${id}`, field: 'start', value: phase.start, source: s });
        if (phase.deadline) into.claims.push({ entity: `phase:${id}`, field: 'deadline', value: phase.deadline, source: s });
        if (phase.end) into.claims.push({ entity: `phase:${id}`, field: 'end', value: phase.end, source: s });
      }
    }
    phaseIdsByKey.set(p.key, ids);
  }
  for (const { phase, unlocks } of pending) {
    if (unlocks) {
      const targets = phaseIdsByKey.get(unlocks);
      if (!targets) err(`fase ${phase.id}: ontsluit onbekende fase "${unlocks}"`);
      else {
        // Eén doelfase: die ID. Meerdere tijdzonegroepen: de basis-ID; de app kiest per datum
        // de juiste groep (zie unlockedPhase in de kern).
        phase.unlocksPhaseId = targets.length === 1 ? targets[0] : `${t.id}:${unlocks}`;
      }
    }
    into.phases.set(phase.id, phase);
  }

  for (const c of seed.claims ?? []) {
    const src = refs.get(c.source);
    if (!src) {
      err(`claim ${c.target}: onbekende bron "${c.source}"`);
      continue;
    }
    let entity: string | undefined;
    if (c.target.startsWith('phase:')) {
      const ids = phaseIdsByKey.get(c.target.slice(6));
      entity = ids?.[0] ? `phase:${ids[0]}` : undefined;
    } else {
      const id = localKeys.get(c.target);
      entity = id ? `event:${id}` : undefined;
    }
    if (!entity) {
      err(`claim ${c.target}: onbekend doel`);
      continue;
    }
    const claim: Claim = { entity, field: c.field, value: c.value, source: src, ...(c.evidence ? { evidence: c.evidence } : {}) };
    into.claims.push(claim);
  }

  // Controle: continent bekend voor elk land.
  for (const v of Object.values(seed.venues)) {
    if (continentOf(v.country) === 'OTHER') warn(`venue ${v.name}: land ${v.country} heeft geen werelddeel in geo.ts`);
  }
}

const METRICS: Record<SeedMetric, string> = {
  lastfm_listeners: 'Luisteraars op Last.fm',
  lastfm_playcount: 'Keer afgespeeld op Last.fm',
  spotify_monthly_listeners: 'Maandelijkse luisteraars op Spotify',
  listener_growth_pct: 'Groei van het aantal luisteraars',
};

/**
 * Populariteit en geschiedenis: elk cijfer moet naar een bron met controledatum verwijzen.
 * Last.fm-luisteraars worden een meting (zelfde maat die de updater later met de API ophaalt, zodat
 * de groei vanzelf doorloopt); de rest wordt per artiest of tour bewaard voor de score en de app.
 */
function compilePopularityAndHistory(seed: SeedFile, into: Catalog, refs: Map<string, SourceRef>, err: (m: string) => void): void {
  const artistId = seed.artist.id;
  const one = (key: string, where: string): SourceRef | undefined => {
    const r = refs.get(key);
    if (!r) err(`${where}: onbekende bron "${key}"`);
    return r;
  };
  const many = (keys: string[] | undefined, where: string): SourceRef[] => {
    if (!keys || keys.length === 0) {
      err(`${where}: geen bron opgegeven`);
      return [];
    }
    return keys.map((k) => one(k, where)).filter((r): r is SourceRef => !!r);
  };
  const facts = into.facts.get(artistId) ?? { charts: [], other: [] };
  const thisYear = DateTime.now().year + 1;

  for (const m of seed.popularity?.metrics ?? []) {
    const where = `populariteit ${m.metric}`;
    if (!(m.metric in METRICS)) {
      err(`${where}: onbekende maat`);
      continue;
    }
    if (!Number.isFinite(m.value) || (m.metric !== 'listener_growth_pct' && m.value <= 0)) {
      err(`${where}: ongeldige waarde ${m.value}`);
      continue;
    }
    const src = one(m.source, where);
    if (!src) continue;
    if (m.metric === 'lastfm_listeners' || m.metric === 'lastfm_playcount') {
      into.observations.push({ entity: `artist:${artistId}`, metric: m.metric, value: m.value, source: src, observedAt: src.fetchedAt });
    } else {
      facts.other.push({ label: `${METRICS[m.metric]}${m.period ? ` (${m.period})` : ''}`, value: m.value, at: src.fetchedAt, source: src });
    }
  }
  for (const c of seed.popularity?.charts ?? []) {
    const where = `hitnotering ${c.title}`;
    if (!Number.isInteger(c.peak) || c.peak < 1 || c.peak > 200) err(`${where}: ongeldige positie ${c.peak}`);
    if (!Number.isInteger(c.year) || c.year < 1950 || c.year > thisYear) err(`${where}: ongeldig jaar ${c.year}`);
    if (!/^[A-Z]{2}$/.test(c.country)) err(`${where}: landcode "${c.country}" is geen ISO-code`);
    const src = one(c.source, where);
    if (src) facts.charts.push({ chart: c.chart, country: c.country, title: c.title, kind: c.kind, peak: c.peak, year: c.year, source: src });
  }
  if (facts.charts.length || facts.other.length) into.facts.set(artistId, facts);

  const tour = into.tours.get(seed.tour.id);
  const visit = (v: SeedPastVisit, where: string): PastVisit | null => {
    if (!Number.isInteger(v.year) || v.year < 1950 || v.year > thisYear) {
      err(`${where}: ongeldig jaar ${v.year}`);
      return null;
    }
    if (v.country && !/^[A-Z]{2}$/.test(v.country)) err(`${where}: landcode "${v.country}" is geen ISO-code`);
    if (v.capacity !== undefined && !(v.capacity > 0)) err(`${where}: ongeldige capaciteit`);
    if (v.date && !/^\d{4}-\d{2}(-\d{2})?$/.test(v.date)) err(`${where}: ongeldige datum ${v.date}`);
    if (v.date && !v.date.startsWith(String(v.year))) err(`${where}: datum ${v.date} past niet bij jaar ${v.year}`);
    const sources = many(v.sources, where);
    if (sources.length === 0) return null;
    const { sources: _s, ...rest } = v;
    return { ...rest, sources };
  };
  const prev = (seed.history?.previousVisits ?? []).map((v, i) => visit(v, `vorige tour #${i + 1}${v.city ? ` (${v.city})` : ''}`)).filter((v): v is PastVisit => !!v);
  const editions = (seed.history?.previousEditions ?? []).map((v, i) => visit(v, `vorige editie ${v.year ?? i + 1}`)).filter((v): v is PastVisit => !!v);
  if (tour) {
    if (prev.length) tour.previousVisits = prev;
    if (editions.length) tour.previousEditions = editions;
  }
}

export function compileSeedDir(dir: string): CompiledSeed {
  const catalog = emptyCatalog();
  const issues: SeedIssue[] = [];
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];
  for (const f of files) {
    const full = path.join(dir, f);
    let seed: SeedFile;
    try {
      seed = JSON.parse(fs.readFileSync(full, 'utf8')) as SeedFile;
    } catch (e) {
      issues.push({ file: f, level: 'error', message: `Geen geldige JSON: ${(e as Error).message}` });
      continue;
    }
    try {
      compileSeedFile(seed, f, catalog, issues);
    } catch (e) {
      issues.push({ file: f, level: 'error', message: (e as Error).message });
    }
  }
  return { catalog, issues, files };
}
