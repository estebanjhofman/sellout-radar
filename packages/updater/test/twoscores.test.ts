import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventScoreView, type Snapshot } from '@sellout/core';
import type { Config } from '../src/config';
import { LastFmConnector, YouTubeConnector } from '../src/connectors/signals';
import { emptyResult, type Connector } from '../src/connectors/types';
import type { FetchResult, Fetcher } from '../src/http';
import { buildScoreInputs, indexObservations } from '../src/pipeline/inputs';
import { mergeAll } from '../src/pipeline/merge';
import { rushOutcomeText } from '../src/pipeline/outcomes';
import { runUpdate } from '../src/pipeline/run';
import { compileSeedDir } from '../src/seed/compile';
import type { SeedFile } from '../src/seed/schema';
import { emptyState, migrateState, pruneState } from '../src/state';
import { FileStore } from '../src/store/file';

/** Een kleine, verzonnen seed om de overgang van "nog niet" naar "al in de verkoop" te testen. */
const SEED: SeedFile = {
  artist: { id: 'testband', name: 'Testband', fandom: 'regular' },
  tour: { id: 'testband-2027', name: 'Testtour 2027', verification: 'official' },
  type: 'concert',
  sources: {
    site: { name: 'Testband.example', kind: 'artist', url: 'https://testband.example/tour', checked: '2026-10-29' },
    lastfm: { name: 'Last.fm: Testband', kind: 'aggregator', url: 'https://www.last.fm/music/Testband', checked: '2026-10-29' },
    charts: { name: 'Hitlijst', kind: 'aggregator', url: 'https://charts.example/testband', checked: '2026-10-29' },
    news: { name: 'Nieuws', kind: 'news', url: 'https://news.example/testband-2025', checked: '2026-10-29' },
    wiki: { name: 'Wiki', kind: 'aggregator', url: 'https://wiki.example/ziggo', checked: '2026-10-29' },
  },
  venues: {
    ziggo: { name: 'Ziggo Dome', city: 'Amsterdam', country: 'NL', tz: 'Europe/Amsterdam', capacity: 17000, capacitySource: 'wiki' },
  },
  events: [
    { venue: 'ziggo', date: '2027-03-01', sources: ['site'] },
    { venue: 'ziggo', date: '2027-03-02', sources: ['site'] },
  ],
  phases: [
    { key: 'presale', kind: 'presale', type: 'artist', name: 'Artist presale', events: 'all', start: '2026-11-02T10:00', sources: ['site'] },
    { key: 'general', kind: 'general_sale', name: 'Algemene verkoop', events: 'all', start: '2026-11-04T10:00', sources: ['site'] },
  ],
  popularity: {
    metrics: [{ metric: 'lastfm_listeners', value: 2_400_000, source: 'lastfm' }],
    charts: [{ chart: 'Nederlandse Album Top 100', country: 'NL', title: 'Testplaat', kind: 'album', peak: 3, year: 2026, source: 'charts' }],
  },
  history: {
    previousVisits: [{ tour: 'Vorige Tour', year: 2025, date: '2025-04-10', city: 'Amsterdam', country: 'NL', venue: 'AFAS Live', capacity: 6000, shows: 2, soldOut: true, sources: ['news'] }],
  },
};

function tempSeed(seeds: SeedFile[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellout-2s-'));
  fs.mkdirSync(path.join(dir, 'seed'));
  seeds.forEach((s, i) => fs.writeFileSync(path.join(dir, 'seed', `s${i}.json`), JSON.stringify(s)));
  return dir;
}

const cfg = (dataDir: string, now: string): Config => ({
  dataDir,
  now,
  dryRun: false,
  keys: {},
  anthropicModel: 'claude-haiku-5-5',
  discoveryCountries: ['NL'],
  maxLlmCallsPerRun: 0,
  userAgent: 'test',
});

const noHttp: Fetcher = {
  get: async () => {
    throw new Error('geen netwerk in tests');
  },
  post: async () => ({ ok: true, status: 200, text: '{}', url: '', headers: new Headers() }),
};

const soldOutNews = (at: string, date: string): Connector => ({
  name: 'Nieuws',
  kind: 'news',
  run: async () => {
    const r = emptyResult('Nieuws', 'news');
    r.discovered.push({
      artistName: 'Testband',
      type: 'concert',
      venue: { name: 'Ziggo Dome', city: 'Amsterdam', country: 'NL', tz: 'Europe/Amsterdam' },
      localDate: date,
      status: 'soldout',
      phases: [],
      source: { name: 'Nieuws', kind: 'news', url: 'https://news.example/uitverkocht', fetchedAt: at },
    });
    return r;
  },
});

describe('seeds: populariteit en vorige tour met bron', () => {
  it('wordt een Last.fm-meting, een hitnotering en een vorig bezoek', () => {
    const dir = tempSeed([SEED]);
    const { catalog, issues } = compileSeedDir(path.join(dir, 'seed'));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(catalog.observations).toHaveLength(1);
    expect(catalog.observations[0]).toMatchObject({ entity: 'artist:testband', metric: 'lastfm_listeners', value: 2_400_000, observedAt: '2026-10-29T00:00:00.000Z' });
    expect(catalog.facts.get('testband')!.charts[0]!.source.name).toBe('Hitlijst');
    expect(catalog.tours.get('testband-2027')!.previousVisits![0]).toMatchObject({ venue: 'AFAS Live', capacity: 6000, soldOut: true });
  });

  it('weigert cijfers zonder (bekende) bron', () => {
    const bad: SeedFile = {
      ...SEED,
      popularity: { metrics: [{ metric: 'lastfm_listeners', value: 10, source: 'bestaatniet' }] },
      history: { previousVisits: [{ year: 2025, country: 'NL', soldOut: true, sources: [] }] },
    };
    const { issues } = compileSeedDir(path.join(tempSeed([bad]), 'seed'));
    const errors = issues.filter((i) => i.level === 'error').map((i) => i.message);
    expect(errors).toContain('populariteit lastfm_listeners: onbekende bron "bestaatniet"');
    expect(errors.some((m) => m.includes('vorige tour #1') && m.includes('geen bron'))).toBe(true);
  });

  it('de score gebruikt luisteraars, plekken in het land en het vorige bezoek', () => {
    const { catalog } = compileSeedDir(path.join(tempSeed([SEED]), 'seed'));
    const merged = mergeAll({ seed: catalog, previous: emptyState().catalog, storedClaims: [], results: [], now: '2026-10-30T12:00:00Z' }).catalog;
    const phasesByEvent = new Map<string, never[]>();
    for (const p of merged.phases.values()) for (const e of p.eventIds) phasesByEvent.set(e, [...(phasesByEvent.get(e) ?? []), p as never]);
    const ev = merged.events.get('testband-2027-03-01-amsterdam')!;
    const inp = buildScoreInputs({ ...ev }, { ...merged, facts: catalog.facts }, { now: '2026-10-30T12:00:00Z', setlistVisits: {}, phasesByEvent }, indexObservations(catalog.observations));
    expect(inp.popularity).toMatchObject({ listeners: 2_400_000, populationM: 18.2 });
    expect(inp.popularity!.charts).toHaveLength(1);
    expect(inp.market).toMatchObject({ showsInCity: 2, indexInCity: 0, seatsInCountry: 34000, showsInCountry: 2 });
    expect(inp.previousVisit).toMatchObject({ scope: 'city', capacity: 6000, shows: 2, soldOut: true, year: 2025, tourName: 'Vorige Tour' });
    expect(inp.firstSaleAt).toBe('2026-11-02T09:00:00.000Z');
  });
});

describe('overgang naar "al in de verkoop" en leren van de verwachte drukte', () => {
  it('bewaart de laatste drukte, schuift door, en zet uitkomsten klaar voor de kalibratie', async () => {
    const dir = tempSeed([SEED]);
    const store = new FileStore(dir);
    const id1 = 'testband-2027-03-01-amsterdam';
    const id2 = 'testband-2027-03-02-amsterdam';

    // 1. Vóór de verkoop: verwachte drukte.
    const r1 = await runUpdate(cfg(dir, '2026-10-30T11:43:00.000Z'), { store, http: noHttp, connectors: [], log: () => undefined });
    const e1 = r1.snapshot.events.find((e) => e.id === id1)!;
    expect(e1.stage).toBe('upcoming');
    expect(e1.score.kind).toBe('rush');
    expect(e1.rush!.value).toBe(e1.score.value);
    expect(e1.sellout!.kind).toBe('sellout');
    expect(e1.rushFinal).toBeUndefined();
    const rushBefore = e1.score.value;
    expect(r1.snapshot.artists.find((a) => a.id === 'testband')!.popularity!.lastfmListeners!.value).toBe(2_400_000);

    // De app schuift de datum zelf door zodra de presale begint, nog vóór de volgende update.
    const phases = r1.snapshot.phases.filter((p) => p.eventIds.includes(id1));
    const v = eventScoreView(e1, phases, '2026-11-02T09:30:00.000Z');
    expect(v.stage).toBe('onsale');
    expect(v.before).toMatchObject({ value: rushBefore, pending: true });

    // 2. Na de start van de presale (ma 2 nov 10:00 CET): uitverkoopkans, drukte bewaard.
    const r2 = await runUpdate(cfg(dir, '2026-11-02T11:43:00.000Z'), { store, http: noHttp, connectors: [], log: () => undefined });
    const e2 = r2.snapshot.events.find((e) => e.id === id1)!;
    expect(e2.stage).toBe('onsale');
    expect(e2.status).toBe('onsale');
    expect(e2.score.kind).toBe('sellout');
    expect(e2.rush).toBeUndefined();
    expect(e2.rushFinal).toMatchObject({ value: rushBefore, firstSaleAt: '2026-11-02T09:00:00.000Z' });
    expect(e2.rushFinal!.reconstructed).toBeUndefined();
    expect(r2.changes.filter((c) => c.type === 'sale_started').map((c) => (c as { eventId: string }).eventId).sort()).toEqual([id1, id2]);
    expect(r2.changes.some((c) => c.type === 'score_jump')).toBe(false);
    expect(r2.snapshot.changes.some((c) => c.kind === 'sale_started' && c.text.includes(`verwachte drukte vooraf ${rushBefore}`))).toBe(true);
    const line = e2.score.lines.find((l) => l.factor === 'prior');
    expect(line?.text).toContain(`Verwachte drukte vlak vóór de verkoop: ${rushBefore}`);

    // 3. Dezelfde dag uitverkocht (nieuws), nog vóór de algemene verkoop: uitkomst "druk" (al in de presale).
    const r3 = await runUpdate(cfg(dir, '2026-11-02T17:43:00.000Z'), {
      store,
      http: noHttp,
      connectors: [soldOutNews('2026-11-02T17:00:00.000Z', '2027-03-01')],
      log: () => undefined,
    });
    const e3 = r3.snapshot.events.find((e) => e.id === id1)!;
    expect(e3.status).toBe('soldout');
    expect(e3.score.value).toBe(100);
    expect(e3.rushFinal!.outcome).toMatchObject({ result: 'busy', speed: 'presale', text: expect.stringContaining('Al in de presale uitverkocht.') });
    expect(r3.delta.outcomes.some((o) => o.kind === 'rush' && o.eventId === id1 && o.outcome === 1)).toBe(true);
    // De uitverkoopkans van 11:43 ging vooraf aan het uitverkopen: die telt voor de kalibratie van de kans.
    expect(r3.delta.outcomes.some((o) => o.kind === 'sellout' && o.eventId === id1 && o.outcome === 1)).toBe(true);

    // 4. Na een week is de tweede avond nog niet uitverkocht: uitkomst "niet binnen een dag".
    const r4 = await runUpdate(cfg(dir, '2026-11-10T11:43:00.000Z'), { store, http: noHttp, connectors: [], log: () => undefined });
    const e4 = r4.snapshot.events.find((e) => e.id === id2)!;
    expect(e4.rushFinal!.outcome).toMatchObject({ result: 'calm' });
    expect(r4.snapshot.rushAccuracy!.n).toBe(2);
    expect(r4.snapshot.rushAccuracy!.recent.map((c) => c.result).sort()).toEqual(['busy', 'calm']);

    // De staat bewaart de bevroren drukte en beide soorten uitkomsten.
    const state = await store.load();
    expect(state.version).toBe(2);
    expect(state.rushFinal[id1]!.score).toBe(rushBefore);
    expect(state.rushOutcomes).toHaveLength(2);
    expect(state.outcomes.every((o) => o.kind === 'sellout')).toBe(true);
  });

  it('een datum die al in de verkoop was toen de radar hem vond, krijgt een geschatte drukte (niet voor de kalibratie)', async () => {
    const onsale: SeedFile = { ...SEED, events: SEED.events.map((e) => ({ ...e, status: 'onsale' as const })), phases: [] };
    const dir = tempSeed([onsale]);
    const r = await runUpdate(cfg(dir, '2026-10-30T11:43:00.000Z'), { store: new FileStore(dir), http: noHttp, connectors: [], log: () => undefined });
    const e = r.snapshot.events[0]!;
    expect(e.stage).toBe('onsale');
    expect(e.rushFinal?.reconstructed).toBe(true);
    expect(e.score.lines.some((l) => l.text.includes('niet vóór de verkoop vastgelegd'))).toBe(true);
  });

  it('teksten bij de uitkomst', () => {
    expect(rushOutcomeText(85, { outcome: 1, speed: 'day1' })).toBe('Binnen een dag uitverkocht. De verwachting klopte.');
    expect(rushOutcomeText(85, { outcome: 0 })).toBe('Na een week nog niet uitverkocht. Het viel mee: de verwachting was te hoog.');
    expect(rushOutcomeText(20, { outcome: 1, speed: 'presale' })).toBe('Al in de presale uitverkocht. Drukker dan verwacht.');
    expect(rushOutcomeText(30, { outcome: 0, speed: 'week1' })).toBe('Binnen een week uitverkocht, maar niet op de eerste dag. De verwachting klopte.');
  });
});

describe('staat uit de vorige versie', () => {
  it('vervangt het oude model door twee startmodellen en laat oude uitkomsten vallen', () => {
    const old = {
      version: 1,
      model: { version: 'start-2026-10', baseRate: 0.3, typeOffsets: {}, weights: [2.4, 1.8, 1.5, 1.3, 1.1, 0.9, 0.8, 0.5, 0.4], outcomesUsed: 0 },
      outcomes: [{ eventId: 'x', predicted: 1, outcome: 1 as const, features: [1, 0, 0, 0, 0, 0, 0, 0, 0] }],
      scoreHistory: { x: [{ at: '2026-10-30T07:25:47Z', score: 100, probability: 1, confidence: 'high' as const, modelVersion: 'start-2026-10', features: [] }] },
      sent: { a: '2026-10-30T07:00:00Z' },
    };
    const s = migrateState(old as never);
    expect(s.version).toBe(2);
    expect(s.models.rush.version).toBe('drukte-start-2026-10');
    expect(s.models.sellout.version).toBe('kans-start-2026-10');
    expect(s.outcomes).toEqual([]);
    expect(s.scoreHistory).toEqual({});
    expect(s.sent).toEqual({ a: '2026-10-30T07:00:00Z' });
    expect('model' in s).toBe(false);
  });
});

/** Nep-HTTP voor de API's: antwoorden per methode. */
function fakeApi(routes: Record<string, unknown>): Fetcher {
  return {
    get: async (url: string): Promise<FetchResult> => {
      const u = new URL(url);
      const key = u.searchParams.get('method') ?? u.pathname.split('/').pop() ?? '';
      const page = u.searchParams.get('page') ?? '1';
      const country = u.searchParams.get('country');
      const body = routes[`${key}${country ? `:${country}` : ''}:${page}`] ?? routes[key] ?? { error: 6 };
      return { ok: true, status: 200, text: JSON.stringify(body), url, headers: new Headers() };
    },
    post: async () => ({ ok: true, status: 200, text: '{}', url: '', headers: new Headers() }),
  };
}

describe('Last.fm per land en YouTube', () => {
  const { catalog } = compileSeedDir(path.join(tempSeed([SEED]), 'seed'));
  const merged = mergeAll({ seed: catalog, previous: emptyState().catalog, storedClaims: [], results: [], now: '2026-10-30T12:00:00Z' }).catalog;
  const ctxFor = (http: Fetcher, keys: Config['keys']) => {
    const state = emptyState();
    return { state, ctx: { cfg: { ...cfg('/tmp', '2026-10-30T12:00:00.000Z'), keys }, http, now: '2026-10-30T12:00:00.000Z', state, catalog: merged, log: () => undefined } };
  };

  it('haalt luisteraars op en de positie in de wereldwijde en Nederlandse toplijst', async () => {
    const http = fakeApi({
      'artist.getinfo': { artist: { url: 'https://www.last.fm/music/Testband', stats: { listeners: '2500000', playcount: '90000000' } } },
      'chart.gettopartists:1': { artists: { artist: [{ name: 'Iemand' }, { name: 'Testband', listeners: '2500000' }] } },
      'geo.gettopartists:Netherlands:1': { topartists: { artist: [{ name: 'Testband', listeners: '120000' }] } },
    });
    const { state, ctx } = ctxFor(http, { lastfm: 'sleutel' });
    const r = await new LastFmConnector().run(ctx);
    const by = (metric: string, dim?: string) => r.observations.find((o) => o.metric === metric && o.dimension === dim)?.value;
    expect(by('lastfm_listeners')).toBe(2_500_000);
    expect(by('lastfm_playcount')).toBe(90_000_000);
    expect(by('lastfm_rank', 'world')).toBe(2);
    expect(by('lastfm_rank', 'NL')).toBe(1);
    expect(by('lastfm_country_listeners', 'NL')).toBe(120_000);
    expect(r.observations.find((o) => o.metric === 'lastfm_listeners')!.source.url).toBe('https://www.last.fm/music/Testband');
    expect(Object.keys(state.kv['lastfm:lists'] as object).sort()).toEqual(['NL', 'world']);

    // Een tweede run dezelfde dag haalt de toplijsten niet opnieuw op (wel de luisteraars).
    const again = await new LastFmConnector().run({ ...ctx, now: '2026-10-30T18:00:00.000Z' });
    expect(again.observations.some((o) => o.metric === 'lastfm_rank')).toBe(false);
    expect(again.observations.some((o) => o.metric === 'lastfm_listeners')).toBe(true);
    // Een dag later wel.
    const nextDay = await new LastFmConnector().run({ ...ctx, now: '2026-10-31T12:00:00.000Z' });
    expect(nextDay.observations.some((o) => o.metric === 'lastfm_rank' && o.dimension === 'NL')).toBe(true);
  });

  it('YouTube: abonnees en weergaven alleen ter informatie, en na 30 dagen weg', async () => {
    const http = fakeApi({
      search: { items: [{ snippet: { channelId: 'UC123', channelTitle: 'Testband' } }] },
      channels: { items: [{ id: 'UC123', statistics: { viewCount: '1000000', subscriberCount: '50000' } }] },
    });
    const { state, ctx } = ctxFor(http, { youtube: 'sleutel' });
    const r = await new YouTubeConnector().run(ctx);
    expect(r.observations.map((o) => o.metric).sort()).toEqual(['youtube_subscribers', 'youtube_views']);
    state.observations.push(...r.observations.map((o) => ({ ...o, observedAt: '2026-09-01T00:00:00.000Z' })));
    state.observations.push({ entity: 'artist:testband', metric: 'lastfm_listeners', value: 1, source: r.observations[0]!.source, observedAt: '2026-09-01T00:00:00.000Z' });
    pruneState(state, '2026-10-30T12:00:00.000Z');
    expect(state.observations.map((o) => o.metric)).toEqual(['lastfm_listeners']);
  });

  it('YouTube telt niet mee in de score; het snapshot toont alleen recente kanaalcijfers', async () => {
    const dir = tempSeed([SEED]);
    const store = new FileStore(dir);
    const yt: Connector = {
      name: 'YouTube',
      kind: 'aggregator',
      run: async () => {
        const r = emptyResult('YouTube', 'aggregator');
        r.observations.push({ entity: 'artist:testband', metric: 'youtube_subscribers', value: 50000, source: { name: 'YouTube', kind: 'aggregator', fetchedAt: '2026-10-30T11:43:00.000Z' }, observedAt: '2026-10-30T11:43:00.000Z' });
        return r;
      },
    };
    const without = await runUpdate(cfg(tempSeed([SEED]), '2026-10-30T11:43:00.000Z'), { store: new FileStore(tempSeed([SEED])), http: noHttp, connectors: [], log: () => undefined });
    const withYt = await runUpdate(cfg(dir, '2026-10-30T11:43:00.000Z'), { store, http: noHttp, connectors: [yt], log: () => undefined });
    const pick = (s: Snapshot) => s.events.find((e) => e.id === 'testband-2027-03-01-amsterdam')!.score.value;
    expect(pick(withYt.snapshot)).toBe(pick(without.snapshot));
    expect(withYt.snapshot.artists.find((a) => a.id === 'testband')!.popularity!.youtube).toMatchObject({ subscribers: 50000 });
  });
});
