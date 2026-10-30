import { describe, expect, it } from 'vitest';
import { eventScoreView, groupEvents, saleMoments, type GroupDate } from '../src/group';
import type { SnapshotEvent, SnapshotScore } from '../src/snapshot';
import { firstSaleMoment, saleStage } from '../src/stage';
import { dateOnly, exactLocal, monthOnly } from '../src/time';
import type { Artist, SalePhase, Tour, Venue } from '../src/types';
import { EVENTS, NOW, PHASES } from './fixtures';

const u2Phases: SalePhase[] = [
  PHASES.u2AmsGeneral,
  PHASES.u2ArtistPresale,
  PHASES.u2EuStorePresale,
  PHASES.u2FeedbackPresale,
  PHASES.u2ArtistRegistration,
  PHASES.u2EuStoreRegistration,
];

describe('tabblad: nog niet in de verkoop of al in de verkoop', () => {
  it('U2 Amsterdam schuift door zodra de eerste presale begint (ma 2 nov 10:00 CET)', () => {
    expect(saleStage(EVENTS.u2Ams1, u2Phases, NOW)).toBe('upcoming');
    expect(firstSaleMoment(u2Phases)!.toUTC().toISO()).toBe('2026-11-02T09:00:00.000Z');
    expect(saleStage(EVENTS.u2Ams1, u2Phases, '2026-11-02T08:59:00.000Z')).toBe('upcoming');
    expect(saleStage(EVENTS.u2Ams1, u2Phases, '2026-11-02T09:00:00.000Z')).toBe('onsale');
  });

  it('een inschrijving of loting is nog geen verkoop', () => {
    const reg = [PHASES.u2EuStoreRegistration, PHASES.u2ArtistRegistration];
    expect(saleStage(EVENTS.u2Ams1, reg, '2026-12-01T00:00:00Z')).toBe('upcoming');
    const lottery: SalePhase = { ...PHASES.u2EuStoreRegistration, id: 'lot', kind: 'lottery', start: dateOnly('2026-09-01', 'Europe/London') };
    expect(saleStage(EVENTS.u2Ams1, [lottery], '2026-12-01T00:00:00Z')).toBe('upcoming');
  });

  it('alleen een datum bekend: vanaf 00:00 lokale tijd; alleen een maand: geen gok', () => {
    const p: SalePhase = { ...PHASES.u2EuStorePresale, start: dateOnly('2026-11-04', 'Europe/Amsterdam') };
    expect(saleStage(EVENTS.u2Ams1, [p], '2026-11-03T22:59:00Z')).toBe('upcoming');
    expect(saleStage(EVENTS.u2Ams1, [p], '2026-11-03T23:00:00Z')).toBe('onsale');
    const m: SalePhase = { ...PHASES.u2EuStorePresale, start: monthOnly('2026-11', 'Europe/Amsterdam') };
    expect(saleStage(EVENTS.u2Ams1, [m], '2026-11-20T12:00:00Z')).toBe('upcoming');
  });

  it('een bron die "in de verkoop", "bijna uitverkocht" of "uitverkocht" meldt, wint', () => {
    expect(saleStage(EVENTS.nkWembley23, [], NOW)).toBe('onsale');
    expect(saleStage({ status: 'few_left' }, [], NOW)).toBe('onsale');
    expect(saleStage({ status: 'onsale' }, [], NOW)).toBe('onsale');
    expect(saleStage(EVENTS.ateezAms, [PHASES.ateezAll], NOW)).toBe('upcoming');
  });
});

const score = (kind: 'rush' | 'sellout', value: number): SnapshotScore => ({
  kind,
  value,
  state: 'scored',
  confidence: 'medium',
  label: kind === 'rush' ? 'Druk' : 'Mogelijk uitverkocht',
  headline: '',
  lines: [],
  computedAt: NOW,
  modelVersion: 'test',
});

const snap = (e: (typeof EVENTS)[keyof typeof EVENTS], over: Partial<SnapshotEvent> = {}): SnapshotEvent => ({
  ...e,
  score: score('rush', 50),
  rush: score('rush', 50),
  sellout: score('sellout', 60),
  stage: 'upcoming',
  history: [],
  trend: null,
  conflicts: [],
  ...over,
});

describe('score bij het tabblad', () => {
  it('nog niet in de verkoop: de verwachte drukte', () => {
    const v = eventScoreView(snap(EVENTS.u2Ams1), u2Phases, NOW);
    expect(v.stage).toBe('upcoming');
    expect(v.kind).toBe('rush');
    expect(v.score.value).toBe(50);
  });

  it('de verkoop begint vóór de volgende update: de app schuift zelf door en houdt de drukte vast als "vooraf"', () => {
    const v = eventScoreView(snap(EVENTS.u2Ams1), u2Phases, '2026-11-02T10:00:00Z');
    expect(v.stage).toBe('onsale');
    expect(v.kind).toBe('sellout');
    expect(v.score.value).toBe(60);
    expect(v.movedLocally).toBe(true);
    expect(v.before).toMatchObject({ value: 50, pending: true, firstSaleAt: '2026-11-02T09:00:00.000Z' });
  });

  it('al in de verkoop volgens de updater: uitverkoopkans met de bewaarde drukte', () => {
    const e = snap(EVENTS.nkWembley25, {
      status: 'onsale',
      stage: 'onsale',
      rush: undefined,
      score: score('sellout', 70),
      sellout: score('sellout', 70),
      rushFinal: { value: 81, label: 'Extreem druk verwacht', confidence: 'medium', at: NOW },
    });
    const v = eventScoreView(e, [], NOW);
    expect(v.kind).toBe('sellout');
    expect(v.before?.value).toBe(81);
    expect(v.movedLocally).toBe(false);
  });
});

describe('indeling per artiest → stad → datums', () => {
  const venues: Record<string, Venue> = {
    'johan-cruijff-arena': { id: 'johan-cruijff-arena', name: 'Johan Cruijff ArenA', city: 'Amsterdam', country: 'NL', tz: 'Europe/Amsterdam' },
    wembley: { id: 'wembley', name: 'Wembley Stadium', city: 'London', country: 'GB', tz: 'Europe/London' },
    'stadspark-groningen': { id: 'stadspark-groningen', name: 'Stadspark', city: 'Groningen', country: 'NL', tz: 'Europe/Amsterdam' },
  };
  const artists = new Map<string, Artist>([
    ['u2', { id: 'u2', name: 'U2' }],
    ['nk', { id: 'nk', name: 'Noah Kahan' }],
  ]);
  const tours = new Map<string, Tour>();
  const phasesByEvent = new Map<string, SalePhase[]>([
    ['u2-2027-06-05-amsterdam', u2Phases],
    ['u2-2027-06-06-amsterdam', u2Phases],
  ]);
  const rows = (list: SnapshotEvent[]): GroupDate[] =>
    list.map((e) => ({ event: e, view: eventScoreView(e, phasesByEvent.get(e.id) ?? [], NOW), venue: venues[e.venueId] }));

  it('groepeert per artiest en per stad, met alle datums en verkoopfases van die stad', () => {
    const groups = groupEvents(rows([snap(EVENTS.u2Ams1), snap(EVENTS.u2Ams2), snap(EVENTS.nkGroningen, { rush: score('rush', 70), score: score('rush', 70) })]), {
      artists,
      tours,
      phasesByEvent,
      now: NOW,
    });
    expect(groups.map((g) => g.title)).toEqual(['Noah Kahan', 'U2']); // hoogste score eerst
    const u2 = groups.find((g) => g.title === 'U2')!;
    expect(u2.cities).toHaveLength(1);
    expect(u2.cities[0]!.city).toBe('Amsterdam');
    expect(u2.cities[0]!.dates.map((d) => d.event.date.localDate)).toEqual(['2027-06-05', '2027-06-06']);
    expect(u2.cities[0]!.phases).toHaveLength(6);
    expect(u2.nextAt).toBe(Date.parse('2026-10-30T12:00:00Z')); // inschrijving EU Store sluit vr 30 okt 12:00 Londen (GMT)
  });

  it('al in de verkoop: uitverkochte datums en steden onderaan', () => {
    const sold = snap(EVENTS.nkWembley23, { status: 'soldout', stage: 'onsale', score: { ...score('sellout', 100), state: 'soldout' } });
    const open = snap(EVENTS.nkWembley25, { status: 'onsale', stage: 'onsale', score: score('sellout', 72), sellout: score('sellout', 72) });
    const gro = snap(EVENTS.nkGroningen, { status: 'onsale', stage: 'onsale', score: score('sellout', 40), sellout: score('sellout', 40) });
    const [g] = groupEvents(rows([sold, gro, open]), { artists, tours, phasesByEvent, now: NOW });
    expect(g!.cities.map((c) => c.city)).toEqual(['Groningen', 'Londen']);
    expect(g!.cities[1]!.dates.map((d) => d.event.status)).toEqual(['onsale', 'soldout']);
    const allSold = groupEvents(rows([sold, snap(EVENTS.u2Ams1)]), { artists, tours, phasesByEvent, now: NOW });
    expect(allSold.map((x) => x.settled)).toEqual([false, true]);
  });

  it('verkoopmomenten zonder eindtijden, in volgorde', () => {
    const labels = saleMoments(u2Phases, NOW).map((i) => i.label);
    expect(labels).toEqual([
      'Inschrijving sluit: Inschrijving EU Store-presale',
      'Inschrijving sluit: Inschrijving U2 Artist Presale',
      'U2.com Feedback Group-presale',
      'EU Store-presale',
      'U2 Artist Presale',
      'Algemene verkoop',
    ]);
  });
});

describe('festival: titel van het evenement', () => {
  it('gebruikt de naam van de editie', () => {
    const fest: SnapshotEvent = {
      ...snap(EVENTS.u2Ams1),
      id: 'pinkpop-2027',
      type: 'festival',
      artistIds: ['pinkpop'],
      tourId: 'pinkpop-2027',
      venueId: 'megaland',
      date: exactLocal('2027-06-18', '12:00', 'Europe/Amsterdam'),
    };
    const [g] = groupEvents(
      [{ event: fest, view: eventScoreView(fest, [], NOW), venue: { id: 'megaland', name: 'Megaland', city: 'Landgraaf', country: 'NL', tz: 'Europe/Amsterdam' } }],
      {
        artists: new Map([['pinkpop', { id: 'pinkpop', name: 'Pinkpop' }]]),
        tours: new Map([['pinkpop-2027', { id: 'pinkpop-2027', artistId: 'pinkpop', name: 'Pinkpop 2027' }]]),
        phasesByEvent: new Map(),
        now: NOW,
      },
    );
    expect(g!.title).toBe('Pinkpop 2027');
    // "Pinkpop" staat al in de titel, dus geen ondertitel.
    expect(g!.subtitle).toBeUndefined();
    expect(g!.cities[0]!.city).toBe('Landgraaf');
  });
});
