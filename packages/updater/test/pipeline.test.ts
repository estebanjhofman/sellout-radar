import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { buildTimeline, formatDual, unlockedPhase, type SourceRef } from '@sellout/core';
import { REPO_ROOT, type Config } from '../src/config';
import { parseTicketmasterEvent } from '../src/connectors/ticketmaster';
import { emptyResult, type Connector, type ConnectorResult } from '../src/connectors/types';
import { verifyExtraction, type RawExtraction } from '../src/extract/llm';
import { isAllowed, parseRobots, type Fetcher } from '../src/http';
import { compatibleTimes, mergeAll, resolveStatus, resolveTime } from '../src/pipeline/merge';
import { runUpdate } from '../src/pipeline/run';
import { nextRunAfter, planPushes } from '../src/push/plan';
import { compileSeedDir } from '../src/seed/compile';
import { emptyState } from '../src/state';
import { FileStore } from '../src/store/file';
import type { PushTarget } from '../src/store/types';
import { dateOnly, DEFAULT_NOTIFY_SETTINGS, exactLocal, exactUtc } from '@sellout/core';

const NOW = '2026-10-29T17:43:00.000Z'; // avondrun 18:43 NL
const SEED_DIR = path.join(REPO_ROOT, 'data', 'seed');
const tm = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tm-events.json'), 'utf8'));

function tempData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellout-'));
  fs.cpSync(SEED_DIR, path.join(dir, 'seed'), { recursive: true });
  return dir;
}

function cfg(dataDir: string, now = NOW): Config {
  return {
    dataDir,
    now,
    dryRun: false,
    keys: {},
    anthropicModel: 'claude-haiku-5-5',
    discoveryCountries: ['NL'],
    maxLlmCallsPerRun: 5,
    userAgent: 'test',
  };
}

const noHttp: Fetcher = {
  get: async () => {
    throw new Error('geen netwerk in tests');
  },
  post: async () => ({ ok: true, status: 200, text: JSON.stringify({ data: [{ status: 'ok' }] }), url: '', headers: new Headers() }),
};

function fakeConnector(name: string, kind: ConnectorResult['kind'], fill: (r: ConnectorResult) => void): Connector {
  return {
    name,
    kind,
    run: async () => {
      const r = emptyResult(name, kind);
      fill(r);
      return r;
    },
  };
}

describe('seed van de startlijst', () => {
  const { catalog, issues, files } = compileSeedDir(SEED_DIR);

  it('heeft geen fouten', () => {
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('U2 Amsterdam: alle fases met lokale en Nederlandse tijd, onbekend blijft onbekend', () => {
    const ams = [...catalog.phases.values()].filter((p) => p.eventIds.includes('u2-2027-06-05-amsterdam'));
    const tl = buildTimeline(ams, NOW);
    expect(tl.map((i) => i.label)).toEqual([
      'Inschrijving sluit: Inschrijving EU Store-presale',
      'Inschrijving sluit: Inschrijving U2 Artist Presale',
      'U2.com Feedback Group-presale',
      'U2.com The Hype Group-presale',
      'EU Store-presale',
      'Einde U2.com Feedback Group-presale',
      'Einde U2.com The Hype Group-presale',
      'U2 Artist Presale',
      'Algemene verkoop',
    ]);
    const general = ams.find((p) => p.kind === 'general_sale')!;
    expect(formatDual(general.start).local).toBe('vr 6 nov 2026, 10:00 CET');
    const store = ams.find((p) => p.name === 'EU Store-presale')!;
    expect(store.start.precision).toBe('date');
    expect(store.ticketLimit).toBe(4);
    const reg = ams.find((p) => p.name === 'Inschrijving EU Store-presale')!;
    expect(formatDual(reg.deadline).user).toBe('vr 30 okt 2026, 13:00 NL');
    expect(unlockedPhase(reg, ams)?.id).toBe(store.id);
    expect(store.id).toBe('u2-gsoe-2027:eu-store-presale:europe-amsterdam');
  });

  it('U2 Lissabon heeft geen artist presale; Londen heeft eigen fases in GMT', () => {
    const lis = [...catalog.phases.values()].filter((p) => p.eventIds.includes('u2-2027-05-27-lisbon'));
    expect(lis.some((p) => p.name === 'U2 Artist Presale')).toBe(false);
    expect(lis.some((p) => p.kind === 'general_sale')).toBe(true);
    const lon = [...catalog.phases.values()].find((p) => p.kind === 'general_sale' && p.eventIds.includes('u2-2027-06-18-london'))!;
    expect(formatDual(lon.start).user).toBe('vr 6 nov 2026, 11:00 NL');
  });

  it('Noah Kahan: Europese en Noord-Amerikaanse inschrijving zijn aparte fases', () => {
    const gro = [...catalog.phases.values()].filter((p) => p.eventIds.includes('noah-kahan-2027-07-01-groningen'));
    const reg = gro.find((p) => p.kind === 'registration')!;
    expect(reg.region).toBe('EU');
    expect(formatDual(reg.deadline).local).toBe('ma 9 nov 2026, 17:00 CET');
    const na = [...catalog.phases.values()].find((p) => p.kind === 'registration' && p.region === 'NA')!;
    expect(na.deadline!.precision).toBe('date');
    expect(na.notes![0]).toContain('11:5 9.p.m');
    expect(gro.find((p) => p.kind === 'general_sale')!.start.utc).toBe('2026-11-12T11:00:00.000Z');
  });

  it('Noah Kahan Wembley 25 juli is een extra show, 23 en 24 uitverkocht', () => {
    expect(catalog.events.get('noah-kahan-2027-07-25-london')!.addedShow).toBe(true);
    expect(catalog.events.get('noah-kahan-2027-07-23-london')!.status).toBe('soldout');
    expect(catalog.events.get('noah-kahan-2027-07-24-london')!.status).toBe('soldout');
  });

  it('ATEEZ: datums zonder venue en zonder verkoopfases, niet officieel bevestigd', () => {
    const ams = catalog.events.get('ateez-2027-04-12-amsterdam')!;
    expect(ams.verification).toBe('unconfirmed');
    expect([...catalog.phases.values()].some((p) => p.eventIds.includes(ams.id))).toBe(false);
  });

  it('Bon Jovi: weekdagfout in een bron staat als toelichting bij de presale', () => {
    const p = [...catalog.phases.values()].find((x) => x.name === 'Artist presale' && x.eventIds.includes('bon-jovi-2027-07-15-east-rutherford'))!;
    expect(p.notes![0]).toContain("'Tuesday, October 28th'");
    expect(formatDual(p.start).user).toBe('wo 28 okt 2026, 15:00 NL');
  });
});

describe('samenvoegen en conflicten', () => {
  const seed = compileSeedDir(SEED_DIR).catalog;

  it('U2 Berlijn/München: officiële bron wint, conflict zichtbaar', () => {
    const out = mergeAll({ seed, previous: emptyState().catalog, storedClaims: [], results: [], now: NOW });
    const c = out.conflicts.find((x) => x.entity === 'event:u2-2027-06-30-berlin' && x.field === 'venue')!;
    expect(c.chosen).toBe('Olympiastadion, Berlin');
    expect(c.alternatives[0]!.value).toBe('Olympiastadion, Munich');
    expect(c.alternatives[0]!.source.name).toBe('u2tours.com');
  });

  it('ATEEZ Incheon: meerderheid van de bronnen wint (24 januari), afwijking gemarkeerd', () => {
    const out = mergeAll({ seed, previous: emptyState().catalog, storedClaims: [], results: [], now: NOW });
    const c = out.conflicts.find((x) => x.entity === 'event:ateez-2027-01-24-incheon' && x.field === 'date')!;
    expect(c.chosen).toBe('2027-01-24');
    expect(c.alternatives[0]!.value).toBe('2027-01-25');
  });

  it('Ticketmaster-data wordt aan de bestaande datum gekoppeld, niet verdubbeld', () => {
    const r = emptyResult('Ticketmaster', 'ticketing');
    for (const e of tm._embedded.events) {
      const d = parseTicketmasterEvent(e, NOW);
      if (d) r.discovered.push(d);
    }
    expect(r.discovered).toHaveLength(2);
    const out = mergeAll({ seed, previous: emptyState().catalog, storedClaims: [], results: [r], now: NOW });
    const ams = out.catalog.events.get('u2-2027-06-05-amsterdam')!;
    expect(ams.externalIds?.ticketmaster).toBe('TEST-U2-AMS-1');
    expect(ams.priceRange).toEqual({ min: 59.5, max: 289, currency: 'EUR' });
    expect(ams.ticketLimit).toBe(4);
    expect([...out.catalog.events.keys()].filter((k) => k.startsWith('u2-2027-06-05'))).toHaveLength(1);
    // De algemene verkoop van Ticketmaster (09:00 UTC) en de seed (10:00 CET) zijn hetzelfde moment: geen conflict.
    expect(out.conflicts.filter((c) => c.entity.includes('general'))).toEqual([]);
    const general = [...out.catalog.phases.values()].find((p) => p.kind === 'general_sale' && p.eventIds.includes(ams.id))!;
    expect(general.sources.map((s) => s.name)).toContain('Ticketmaster');
    // Nieuwe artiest uit Ticketmaster wordt toegevoegd.
    const created = out.catalog.events.get(out.createdEventIds[0]!)!;
    expect(created.title).toBe('Testband · Amsterdam');
    expect(created.verification).toBe('official');
  });

  it('verenigbare tijden: datum + exact op dezelfde dag is geen conflict; andere dag wel', () => {
    const d = dateOnly('2026-11-04', 'Europe/Amsterdam');
    expect(compatibleTimes(d, exactLocal('2026-11-04', '10:00', 'Europe/Amsterdam'))).toBe(true);
    expect(compatibleTimes(d, exactLocal('2026-11-05', '10:00', 'Europe/Amsterdam'))).toBe(false);
    const src = (name: string, kind: SourceRef['kind']): SourceRef => ({ name, kind, fetchedAt: NOW });
    const r = resolveTime([
      { entity: 'p', field: 'start', value: d, source: src('EU Store', 'official_store') },
      { entity: 'p', field: 'start', value: exactUtc('2026-11-04T09:00:00Z', 'Europe/Amsterdam'), source: src('Ticketmaster', 'ticketing') },
    ]);
    expect(r.conflict).toBeNull();
    expect(r.value!.precision).toBe('exact');
  });

  it('status: een nieuwere uitverkocht-melding gaat voor een oudere "aangekondigd"', () => {
    const old = { entity: 'e', field: 'status', value: 'announced' as const, source: { name: 'U2.com', kind: 'artist' as const, fetchedAt: '2026-10-29T12:00:00Z' } };
    const news = { entity: 'e', field: 'status', value: 'soldout' as const, source: { name: 'NME', kind: 'news' as const, fetchedAt: '2026-11-06T10:00:00Z' } };
    expect(resolveStatus([old, news]).value).toBe('soldout');
    const officialLater = { ...old, value: 'onsale' as const, source: { ...old.source, fetchedAt: '2026-11-07T10:00:00Z' } };
    const r = resolveStatus([old, news, officialLater]);
    expect(r.value).toBe('onsale');
    expect(r.conflict).not.toBeNull();
  });
});

describe('extractie uit tekst', () => {
  const seed = compileSeedDir(SEED_DIR).catalog;
  const text =
    'Tickets for the European dates will first be available through an artist presale via Laylo, beginning Tuesday, Nov. 10th at 12 p.m. local time. July 1st – Groningen, NL – Stadspark';
  const src: SourceRef = { name: 'Pollstar', kind: 'news', fetchedAt: NOW };

  it('houdt alleen wat letterlijk in de tekst staat', () => {
    const raw: RawExtraction = {
      shows: [
        { artist: 'Noah Kahan', tour: '', event_type: 'concert', city: 'Groningen', country: 'NL', venue: 'Stadspark', date: '2027-07-01', status: 'announced', evidence: 'July 1st – Groningen, NL – Stadspark' },
        { artist: 'Noah Kahan', tour: '', event_type: 'concert', city: 'Utrecht', country: 'NL', venue: 'Jaarbeurs', date: '2027-07-03', status: 'announced', evidence: 'July 3rd – Utrecht, NL – Jaarbeurs' },
      ],
      phases: [
        {
          artist: 'Noah Kahan', tour: '', kind: 'presale', name: 'Artist presale (Laylo)', region: 'Europe', cities: ['Groningen'], start_date: '2026-11-10', start_time: '12:00',
          end_date: '', end_time: '', deadline_date: '', deadline_time: '', time_zone: '', where_to_register: 'Laylo', requires_code: 'unknown', ticket_limit: '',
          evidence: 'artist presale via Laylo, beginning Tuesday, Nov. 10th at 12 p.m. local time',
        },
        {
          artist: 'Noah Kahan', tour: '', kind: 'general_sale', name: 'General sale', region: 'Europe', cities: ['Groningen'], start_date: '2026-11-13', start_time: '12:00',
          end_date: '', end_time: '', deadline_date: '', deadline_time: '', time_zone: '', where_to_register: '', requires_code: 'unknown', ticket_limit: '',
          evidence: 'artist presale via Laylo, beginning Tuesday, Nov. 10th at 12 p.m. local time',
        },
      ],
    };
    const v = verifyExtraction(raw, text, src, seed);
    expect(v.events.map((e) => e.venue.city)).toEqual(['Groningen']);
    expect(v.loosePhases).toHaveLength(1);
    expect(v.loosePhases[0]!.phase.start.utc).toBe('2026-11-10T11:00:00.000Z');
    expect(v.rejected.some((r) => r.includes('Utrecht'))).toBe(true);
    expect(v.rejected.some((r) => r.includes('2026-11-13'))).toBe(true);
  });
});

describe('volledige run (offline, met nepbronnen)', () => {
  it('maakt een snapshot, bewaart de staat en vindt wijzigingen in de tweede run', async () => {
    const dir = tempData();
    const store = new FileStore(dir);
    const tmConn = fakeConnector('Ticketmaster', 'ticketing', (r) => {
      for (const e of tm._embedded.events) {
        const d = parseTicketmasterEvent(e, NOW);
        if (d) r.discovered.push(d);
      }
    });
    const first = await runUpdate(cfg(dir), { store, http: noHttp, connectors: [tmConn], log: () => undefined });
    expect(first.summary.counts.datums).toBeGreaterThan(70);
    expect(first.changes).toEqual([]); // eerste run: alleen een nulmeting
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
    expect(snap.events.length).toBe(first.snapshot.events.length);
    const gro = snap.events.find((e: { id: string }) => e.id === 'noah-kahan-2027-07-01-groningen');
    expect(gro.score.value).toBeGreaterThan(30);
    expect(gro.score.lines.length).toBeGreaterThan(0);
    const wem23 = snap.events.find((e: { id: string }) => e.id === 'noah-kahan-2027-07-23-london');
    expect(wem23.score.value).toBe(100);
    const berlin = snap.events.find((e: { id: string }) => e.id === 'u2-2027-06-30-berlin');
    expect(berlin.conflicts.length).toBe(1);
    expect(snap.sources.find((s: { name: string }) => s.name === 'Ticketmaster').ok).toBe(true);

    // Tweede run: nieuws meldt dat Groningen uitverkocht is, en Ticketmaster faalt.
    const later = DateTime.fromISO(NOW).plus({ days: 14 }).toUTC().toISO()!;
    const newsConn = fakeConnector('Nieuws', 'news', (r) => {
      r.discovered.push({
        artistName: 'Noah Kahan',
        type: 'concert',
        venue: { name: 'Stadspark', city: 'Groningen', country: 'NL', tz: 'Europe/Amsterdam' },
        localDate: '2027-07-01',
        status: 'soldout',
        phases: [],
        source: { name: 'Pollstar', kind: 'news', url: 'https://example.org/test', fetchedAt: later },
      });
    });
    const failing: Connector = { name: 'Ticketmaster', kind: 'ticketing', run: async () => { throw new Error('HTTP 503'); } };
    const second = await runUpdate(cfg(dir, later), { store, http: noHttp, connectors: [failing, newsConn], log: () => undefined });
    expect(second.changes.some((c) => c.type === 'soldout' && c.eventId === 'noah-kahan-2027-07-01-groningen')).toBe(true);
    const snap2 = second.snapshot;
    const u2 = snap2.events.find((e) => e.id === 'u2-2027-06-05-amsterdam')!;
    expect(u2.stale?.message).toContain('Ticketmaster was bij de laatste update niet bereikbaar');
    // Laatst bekende Ticketmaster-data blijft staan.
    expect(u2.priceRange?.min).toBe(59.5);
    expect(snap2.sources.find((s) => s.name === 'Ticketmaster')!.ok).toBe(false);
    expect(snap2.changes.some((c) => c.kind === 'soldout')).toBe(true);
  });
});

describe('pushmeldingen vanuit de updater', () => {
  const seed = compileSeedDir(SEED_DIR).catalog;
  const target = (over: Partial<PushTarget> = {}): PushTarget => ({
    userId: 'u1',
    tokens: ['ExponentPushToken[test]'],
    settings: DEFAULT_NOTIFY_SETTINGS,
    scoreThreshold: 70,
    followedEvents: new Set(['u2-2027-06-05-amsterdam']),
    followedTours: new Set(),
    followedArtists: new Set(),
    mutedEvents: new Set(),
    scheduledKeys: new Set(),
    ...over,
  });
  const events = new Map([...seed.events.values()].map((e) => [e.id, { id: e.id, title: e.title, tourId: e.tourId, artistIds: e.artistIds, score: 40 }]));
  const phases = [...seed.phases.values()];

  it('volgende run na 18:43 is 06:43', () => {
    expect(nextRunAfter(DateTime.fromISO(NOW)).setZone('Europe/Amsterdam').toFormat('ccc HH:mm')).toBe('Fri 06:43');
  });

  it('vangnet: herinnering die vóór de volgende run valt, gaat nu (eerder, nooit later)', () => {
    const sent: Record<string, string> = {};
    const msgs = planPushes({ targets: [target()], events, phases, changes: [], now: DateTime.fromISO(NOW), sent });
    const keys = msgs.map((m) => m.key);
    // Deadline EU Store vr 30 okt 13:00 → ideaal do 29 okt 22:59: de run van 18:43 verstuurt hem nu.
    expect(keys).toContain('registration_deadline:u2-gsoe-2027:eu-store-registration:12h');
    const m = msgs.find((x) => x.key.startsWith('registration_deadline:u2-gsoe-2027:eu-store-registration'))!;
    expect(m.deliverAt).toBe(NOW);
    expect(m.title).toBe('Inschrijving sluit morgen 13:00: U2 · Amsterdam');
    // Algemene verkoop vr 6 nov valt ver na de volgende run: nog niet.
    expect(keys.some((k) => k.startsWith('phase_start:u2-gsoe-2027:general'))).toBe(false);
    // Twee keer plannen verstuurt niets dubbel.
    expect(planPushes({ targets: [target()], events, phases, changes: [], now: DateTime.fromISO(NOW), sent })).toEqual([]);
  });

  it('zelf ingeplande herinneringen op het toestel worden niet nog eens gepusht', () => {
    const msgs = planPushes({
      targets: [target({ scheduledKeys: new Set(['registration_open:u2-gsoe-2027:eu-store-registration', 'registration_deadline:u2-gsoe-2027:eu-store-registration:12h']) })],
      events,
      phases,
      changes: [],
      now: DateTime.fromISO(NOW),
      sent: {},
    });
    expect(msgs.filter((m) => m.key.includes('eu-store-registration'))).toEqual([]);
  });

  it('wijziging in de ochtendrun (06:43) wacht tot 07:00', () => {
    const at = DateTime.fromISO('2026-11-03T05:43:00Z');
    const msgs = planPushes({
      targets: [target({ scheduledKeys: new Set(phases.flatMap((p) => [`phase_start:${p.id}:12h`, `registration_deadline:${p.id}:12h`, `registration_open:${p.id}`])) })],
      events,
      phases,
      changes: [{ type: 'extra_show', eventId: 'u2-2027-06-05-amsterdam', title: 'U2 · Amsterdam' }],
      now: at,
      sent: {},
    });
    const m = msgs.find((x) => x.kind === 'change_extra_show')!;
    expect(DateTime.fromISO(m.deliverAt).setZone('Europe/Amsterdam').toFormat('HH:mm')).toBe('07:00');
  });

  it('niet gevolgd en score onder 70: geen meldingen', () => {
    const msgs = planPushes({ targets: [target({ followedEvents: new Set() })], events, phases, changes: [], now: DateTime.fromISO(NOW), sent: {} });
    expect(msgs).toEqual([]);
  });
});

describe('robots.txt', () => {
  it('respecteert Disallow en Allow', () => {
    const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/news\n\nUser-agent: badbot\nDisallow: /');
    expect(isAllowed(r, '/tour')).toBe(true);
    expect(isAllowed(r, '/private/x')).toBe(false);
    expect(isAllowed(r, '/private/news/1')).toBe(true);
  });
});
