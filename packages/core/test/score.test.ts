import { describe, expect, it } from 'vitest';
import { explainScore, formatNumber, joinList } from '../src/score/explain';
import type { ScoreInputs, SiblingInfo } from '../src/score/factors';
import { scoreBand, scoreColor } from '../src/score/labels';
import { confidenceFromCoverage, DEFAULT_MODEL, scoreEvent, scoreTrend } from '../src/score/model';
import { NOW } from './fixtures';

const base = (over: Partial<ScoreInputs> = {}): ScoreInputs => ({
  eventId: 'e',
  type: 'concert',
  status: 'announced',
  city: 'Amsterdam',
  country: 'NL',
  continent: 'EU',
  siblings: [],
  now: NOW,
  ...over,
});

const sib = (over: Partial<SiblingInfo> & { eventId: string }): SiblingInfo => ({
  city: 'London',
  country: 'GB',
  continent: 'EU',
  status: 'announced',
  ...over,
});

describe('labels en kleuren', () => {
  it('banden met grenzen', () => {
    expect(scoreBand(80).label).toBe('Zeer waarschijnlijk uitverkocht');
    expect(scoreBand(79).label).toBe('Waarschijnlijk uitverkocht');
    expect(scoreBand(40).label).toBe('Mogelijk uitverkocht');
    expect(scoreBand(39).label).toBe('Eerder niet uitverkocht');
    expect(scoreBand(0).label).toBe('Waarschijnlijk niet uitverkocht');
  });

  it('vloeiend van rood naar groen', () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r0, g0] = rgb(scoreColor(0));
    const [r100, g100] = rgb(scoreColor(100));
    const [r55, g55, b55] = rgb(scoreColor(55));
    expect(r0).toBeGreaterThan(g0!);
    expect(g100).toBeGreaterThan(r100!);
    expect(Math.min(r55!, g55!)).toBeGreaterThan(b55! + 60); // geel
    // vloeiend: kleine stap in score = kleine stap in kleur
    for (let s = 0; s < 100; s++) {
      const a = rgb(scoreColor(s));
      const b = rgb(scoreColor(s + 1));
      const d = Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
      expect(d).toBeLessThanOrEqual(16);
    }
  });
});

describe('sellout-score', () => {
  it('zonder gegevens: basiskans, lage betrouwbaarheid en een eerlijke kanttekening', () => {
    const r = scoreEvent(base());
    expect(r.score).toBe(30);
    expect(r.confidence).toBe('low');
    expect(explainScore(r).caveat).toMatch(/Nog weinig gegevens/);
  });

  it('uitverkocht is 100; een voorspelling blijft tussen 1 en 99', () => {
    expect(scoreEvent(base({ status: 'soldout' })).score).toBe(100);
    const hot = scoreEvent(
      base({
        siblings: Array.from({ length: 8 }, (_, i) => sib({ eventId: `s${i}`, country: 'NL', status: 'soldout', capacity: 60000, soldOutAfterHours: 1 })),
        capacity: 50000,
        addedForDemand: 5,
        resale: { minResalePrice: 400, faceValueMin: 100 },
        scarcity: { farewell: true, onlyShowIn: 'europe' },
        fandom: 'organized',
      }),
    );
    expect(hot.score).toBe(99);
  });

  it('een loting verhoogt de score en staat in de uitleg', () => {
    const without = scoreEvent(base({ fandom: 'regular' }));
    const withBallot = scoreEvent(base({ fandom: 'regular', scarcity: { ballot: true } }));
    expect(withBallot.score).toBeGreaterThan(without.score);
    const line = explainScore(withBallot).lines.find((l) => l.factor === 'scarcity');
    expect(line?.direction).toBe('up');
    expect(line?.text).toMatch(/loting/);
  });

  it('festival op dezelfde plek: uitleg noemt de vorige editie', () => {
    const r = scoreEvent(
      base({ type: 'festival', previousVisit: { scope: 'city', sameVenue: true, soldOut: true, yearsAgo: 1, venueName: 'Festivalpark', place: 'Werchter' } }),
    );
    const line = explainScore(r).lines.find((l) => l.factor === 'scale_jump');
    expect(line?.text).toBe('De vorige editie op dezelfde plek (Festivalpark) was uitverkocht.');
    expect(r.score).toBeGreaterThan(scoreEvent(base({ type: 'festival' })).score);
  });

  it('geannuleerd krijgt geen voorspelling', () => {
    expect(scoreEvent(base({ status: 'cancelled' })).state).toBe('cancelled');
  });

  it('ontbrekende data is neutraal, nooit een straf', () => {
    const a = scoreEvent(base({ fandom: 'regular' }));
    const b = scoreEvent(base({ fandom: 'regular', resale: undefined, momentum: undefined }));
    expect(a.score).toBe(b.score);
  });

  it('meer uitverkochte data elders verhoogt de score (monotoon)', () => {
    let prev = 0;
    for (let n = 0; n <= 4; n++) {
      const sibs = Array.from({ length: n }, (_, i) => sib({ eventId: `s${i}`, status: 'soldout', capacity: 60000 }));
      const s = scoreEvent(base({ capacity: 60000, siblings: sibs })).score;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('"in de verkoop" zonder bevestigde beschikbaarheid telt niet als tegensignaal', () => {
    const unknown = scoreEvent(base({ siblings: [sib({ eventId: 's', status: 'onsale', firstSaleAt: '2026-10-01T08:00:00Z' })] }));
    const available = scoreEvent(
      base({ siblings: [sib({ eventId: 's', status: 'onsale', firstSaleAt: '2026-10-01T08:00:00Z', available: true })] }),
    );
    expect(unknown.score).toBe(30);
    expect(available.score).toBeLessThan(30);
  });

  it('betrouwbaarheid hooguit middel zolang er minder dan 50 uitkomsten zijn', () => {
    expect(confidenceFromCoverage(0.9, 0)).toBe('medium');
    expect(confidenceFromCoverage(0.9, 60)).toBe('high');
    expect(confidenceFromCoverage(0.5, 60)).toBe('medium');
    expect(confidenceFromCoverage(0.2, 60)).toBe('low');
  });
});

describe('startlijst', () => {
  // Noah Kahan Europa: Dublin 17 juli en Wembley 23 en 24 juli uitverkocht; Dublin 18 en Wembley 25 toegevoegd.
  const nkSiblings: SiblingInfo[] = [
    sib({ eventId: 'nk-dublin-17', city: 'Dublin', country: 'IE', status: 'soldout', capacity: 51700 }),
    sib({ eventId: 'nk-dublin-18', city: 'Dublin', country: 'IE', status: 'announced', capacity: 51700, addedShow: true }),
    sib({ eventId: 'nk-wembley-23', city: 'London', country: 'GB', status: 'soldout', capacity: 90000 }),
    sib({ eventId: 'nk-wembley-24', city: 'London', country: 'GB', status: 'soldout', capacity: 90000 }),
    sib({ eventId: 'nk-wembley-25', city: 'London', country: 'GB', status: 'announced', capacity: 90000, addedShow: true }),
  ];

  it('Noah Kahan Wembley 25 juli (extra show): hoog, gedreven door bewezen vraag', () => {
    const r = scoreEvent(
      base({
        eventId: 'nk-wembley-25',
        city: 'London',
        country: 'GB',
        capacity: 90000,
        localDate: '2027-07-25',
        outdoor: true,
        siblings: nkSiblings,
        addedForDemand: 2,
        market: { showsInCity: 3, indexInCity: 2, isAddedShow: true },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.top[0]!.key).toBe('proven_demand');
    const ex = explainScore(r);
    expect(ex.lines[0]!.text).toBe(
      '3 andere data van deze tour zijn al uitverkocht (Dublin en Londen); er zijn al 2 extra shows bijgekomen.',
    );
    expect(ex.lines.some((l) => l.direction === 'down' && l.text.includes('extra toegevoegde show'))).toBe(true);
  });

  it('Noah Kahan Groningen: uitverkochte data in Europa tillen de score boven de basiskans', () => {
    const r = scoreEvent(
      base({
        eventId: 'nk-groningen',
        city: 'Groningen',
        localDate: '2027-07-01',
        outdoor: true,
        siblings: nkSiblings,
        addedForDemand: 2,
        market: { showsInCity: 1, indexInCity: 0 },
        scarcity: { onlyShowIn: 'country' },
      }),
    );
    expect(r.score).toBeGreaterThan(50);
    expect(r.speed).toBeDefined();
  });

  it('U2 Amsterdam 5 en 6 juni: tweede avond iets lager dan de eerste', () => {
    const common = {
      city: 'Amsterdam',
      capacity: 55000,
      outdoor: false,
      addedForDemand: 5,
      momentum: { newReleaseWithinDays: 7 },
    };
    const d1 = scoreEvent(base({ ...common, eventId: 'u2-ams-1', localDate: '2027-06-05', market: { showsInCity: 2, indexInCity: 0 } }));
    const d2 = scoreEvent(base({ ...common, eventId: 'u2-ams-2', localDate: '2027-06-06', market: { showsInCity: 2, indexInCity: 1 } }));
    expect(d1.score).toBeGreaterThan(d2.score);
    expect(d1.score).toBeGreaterThan(30);
    expect(d1.confidence).not.toBe('high');
  });

  it('ATEEZ Amsterdam: georganiseerde fanbase, maar lage betrouwbaarheid zolang venue en verkoop onbekend zijn', () => {
    const r = scoreEvent(base({ eventId: 'ateez-ams', localDate: '2027-04-12', fandom: 'organized' }));
    expect(r.confidence).toBe('low');
    expect(r.score).toBeGreaterThan(30);
    expect(explainScore(r).lines.map((l) => l.text)).toContain(
      'Georganiseerde fanbase: fans kopen massaal en snel, vaak al in de presale.',
    );
  });

  it('kop van de uitleg bevat getal, label en betrouwbaarheid', () => {
    const r = scoreEvent(base({ fandom: 'organized' }));
    expect(explainScore(r).headline).toBe(`${r.score} · Mogelijk uitverkocht · betrouwbaarheid laag`);
  });
});

describe('trendpijl', () => {
  it('vergelijkt met de score van 72 uur geleden', () => {
    const h = [
      { at: '2026-10-25T18:00:00Z', score: 40 },
      { at: '2026-10-27T18:00:00Z', score: 45 },
      { at: '2026-10-29T18:00:00Z', score: 52 },
    ];
    expect(scoreTrend(h, NOW)).toBe('up');
    expect(scoreTrend([{ at: NOW, score: 50 }], NOW)).toBeNull();
    expect(scoreTrend([...h.slice(0, 2), { at: NOW, score: 42 }], NOW)).toBe('flat');
    expect(scoreTrend([...h.slice(0, 2), { at: NOW, score: 30 }], NOW)).toBe('down');
  });
});

describe('hulpjes voor tekst', () => {
  it('getallen en lijsten', () => {
    expect(formatNumber(55000)).toBe('55.000');
    expect(formatNumber(1234567)).toBe('1.234.567');
    expect(joinList(['Dublin'])).toBe('Dublin');
    expect(joinList(['Dublin', 'Londen'])).toBe('Dublin en Londen');
    expect(joinList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C en nog 2');
  });

  it('het standaardmodel heeft 9 gewichten van zwaar naar licht', () => {
    expect(DEFAULT_MODEL.weights).toHaveLength(9);
    for (let i = 1; i < 9; i++) expect(DEFAULT_MODEL.weights[i]!).toBeLessThan(DEFAULT_MODEL.weights[i - 1]!);
  });
});
