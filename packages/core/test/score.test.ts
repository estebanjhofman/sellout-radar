import { describe, expect, it } from 'vitest';
import { explainScore, formatCompact, formatNumber, joinList } from '../src/score/explain';
import { RUSH_FACTORS, SELLOUT_FACTORS, type ScoreInputs, type SiblingInfo } from '../src/score/factors';
import { RUSH_BANDS, scoreBand, scoreColor, SELLOUT_BANDS } from '../src/score/labels';
import {
  confidenceFromCoverage,
  DEFAULT_RUSH_MODEL,
  DEFAULT_SELLOUT_MODEL,
  scoreRush,
  scoreSellout,
  scoreTrend,
  usableModel,
} from '../src/score/model';
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
  it('uitverkoopkans: banden met grenzen', () => {
    expect(scoreBand(80).label).toBe('Zeer waarschijnlijk uitverkocht');
    expect(scoreBand(79).label).toBe('Waarschijnlijk uitverkocht');
    expect(scoreBand(40, 'sellout').label).toBe('Mogelijk uitverkocht');
    expect(scoreBand(39).label).toBe('Eerder niet uitverkocht');
    expect(scoreBand(0).label).toBe('Waarschijnlijk niet uitverkocht');
  });

  it('verwachte drukte: van "Rustig" tot "Extreem druk verwacht"', () => {
    expect(scoreBand(95, 'rush').label).toBe('Extreem druk verwacht');
    expect(scoreBand(80, 'rush').label).toBe('Extreem druk verwacht');
    expect(scoreBand(79, 'rush').label).toBe('Zeer druk');
    expect(scoreBand(50, 'rush').label).toBe('Druk');
    expect(scoreBand(25, 'rush').label).toBe('Matig druk');
    expect(scoreBand(5, 'rush').label).toBe('Rustig');
    // Beide banden dekken 0–100 zonder gaten.
    for (const bands of [RUSH_BANDS, SELLOUT_BANDS]) {
      for (let s = 0; s <= 100; s++) expect(bands.filter((b) => s >= b.min && s <= b.max)).toHaveLength(1);
    }
  });

  it('vloeiend van rood naar groen', () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r0, g0] = rgb(scoreColor(0));
    const [r100, g100] = rgb(scoreColor(100));
    const [r55, g55, b55] = rgb(scoreColor(55));
    expect(r0).toBeGreaterThan(g0!);
    expect(g100).toBeGreaterThan(r100!);
    expect(Math.min(r55!, g55!)).toBeGreaterThan(b55! + 60); // geel
    for (let s = 0; s < 100; s++) {
      const a = rgb(scoreColor(s));
      const b = rgb(scoreColor(s + 1));
      const d = Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
      expect(d).toBeLessThanOrEqual(16);
    }
  });
});

describe('verwachte drukte', () => {
  it('zonder gegevens: basiskans, lage betrouwbaarheid en een eerlijke kanttekening', () => {
    const r = scoreRush(base());
    expect(r.kind).toBe('rush');
    expect(r.score).toBe(25);
    expect(r.confidence).toBe('low');
    expect(explainScore(r).caveat).toMatch(/Nog weinig gegevens/);
    expect(explainScore(r).headline).toBe('25 · Matig druk · betrouwbaarheid laag');
  });

  it('meer plekken voor dezelfde populariteit: minder druk (monotoon)', () => {
    let prev = 101;
    for (const seats of [10_000, 30_000, 60_000, 120_000, 250_000]) {
      const s = scoreRush(
        base({ capacity: seats, market: { showsInCity: 1, indexInCity: 0, seatsInCountry: seats }, popularity: { listeners: 5_000_000, populationM: 18.2 } }),
      ).score;
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it('meer luisteraars voor dezelfde zaal: drukker, met uitleg over luisteraars en plekken', () => {
    const at = (listeners: number) =>
      scoreRush(base({ capacity: 17_000, market: { showsInCity: 1, indexInCity: 0, seatsInCountry: 17_000 }, popularity: { listeners, populationM: 18.2 } }));
    expect(at(4_000_000).score).toBeGreaterThan(at(500_000).score);
    const line = explainScore(at(4_000_000)).lines.find((l) => l.factor === 'demand_supply')!;
    expect(line.direction).toBe('up');
    expect(line.text).toBe('4,0 mln luisteraars op Last.fm tegenover 17.000 plekken in Nederland: naar verhouding veel vraag voor weinig plekken.');
  });

  it('Last.fm-toplijst per land: hoger in het land dan wereldwijd = populairder hier, en hogere dekking', () => {
    const common = { capacity: 55_000, market: { showsInCity: 1, indexInCity: 0, seatsInCountry: 55_000 } };
    const plain = scoreRush(base({ ...common, popularity: { listeners: 2_000_000, populationM: 18.2 } }));
    const local = scoreRush(
      base({ ...common, popularity: { listeners: 2_000_000, populationM: 18.2, countryRank: 12, countryListSize: 1000, globalRank: 300, globalListSize: 1000 } }),
    );
    expect(local.score).toBeGreaterThan(plain.score);
    expect(local.coverage).toBeGreaterThan(plain.coverage);
    const line = explainScore(local).lines.find((l) => l.factor === 'demand_supply')!;
    expect(line.text).toContain('In Nederland populairder dan gemiddeld (#12 in de Last.fm-toplijst).');
  });

  it('vorige tour: uitverkocht in een kleinere zaal tilt de drukte; uitleg noemt tour, venue en jaar', () => {
    const r = scoreRush(
      base({
        capacity: 17_000,
        market: { showsInCity: 1, indexInCity: 0 },
        previousVisit: { scope: 'city', capacity: 10_000, soldOut: true, year: 2024, venueName: 'AFAS Live', place: 'Amsterdam', tourName: 'Vorige Tour' },
      }),
    );
    expect(r.score).toBeGreaterThan(25);
    const line = explainScore(r).lines.find((l) => l.factor === 'previous_tour')!;
    expect(line.text).toBe('Nu 1,7× zo veel plekken als bij het vorige bezoek aan Amsterdam (Vorige Tour, AFAS Live, 2024), maar dat was uitverkocht.');
    // Een veel grotere sprong weegt zwaarder dan het uitverkochte vorige bezoek.
    const jump = scoreRush(base({ capacity: 55_000, market: { showsInCity: 1, indexInCity: 0 }, previousVisit: { scope: 'city', capacity: 6_000, soldOut: true } }));
    expect(jump.score).toBeLessThan(25);
  });

  it('festival: de vorige editie die binnen een uur uitverkocht, staat in de uitleg', () => {
    const r = scoreRush(base({ type: 'festival', previousVisit: { scope: 'city', sameVenue: true, soldOut: true, withinHours: 1, year: 2026 } }));
    const line = explainScore(r).lines.find((l) => l.factor === 'previous_tour');
    expect(line?.text).toBe('De editie van 2026 was uitverkocht (binnen een uur).');
    expect(r.score).toBeGreaterThan(scoreRush(base({ type: 'festival' })).score);
  });

  it('schaarste: loting, afscheid en reünie verhogen de drukte en staan in de uitleg', () => {
    const plain = scoreRush(base({ fandom: 'regular' }));
    const ballot = scoreRush(base({ fandom: 'regular', scarcity: { ballot: true } }));
    expect(ballot.score).toBeGreaterThan(plain.score);
    expect(explainScore(ballot).lines.find((l) => l.factor === 'scarcity')?.text).toMatch(/loting/);
    const reunion = scoreRush(base({ scarcity: { reunion: true, onlyShowIn: 'benelux' } }));
    expect(explainScore(reunion).lines.find((l) => l.factor === 'scarcity')?.text).toBe('Het is een reünie; dit is de enige show in de Benelux.');
  });

  it('georganiseerde fanbase verhoogt de drukte', () => {
    const r = scoreRush(base({ fandom: 'organized' }));
    expect(r.score).toBeGreaterThan(25);
    expect(explainScore(r).lines.map((l) => l.text)).toContain('Georganiseerde fanbase: fans kopen massaal en snel, vaak al in de presale.');
  });

  it('vraag elders op deze tour: meer uitverkochte data → drukker (monotoon)', () => {
    let prev = 0;
    for (let n = 0; n <= 4; n++) {
      const sibs = Array.from({ length: n }, (_, i) => sib({ eventId: `s${i}`, status: 'soldout', capacity: 60000 }));
      const s = scoreRush(base({ capacity: 60000, siblings: sibs })).score;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('groei en hitnoteringen: recente top-10-notering in het land telt mee', () => {
    const r = scoreRush(
      base({ popularity: { charts: [{ chart: 'Nederlandse Album Top 100', country: 'NL', title: 'Nieuw Album', peak: 2, year: 2026 }], newReleaseWithinDays: 10 } }),
    );
    expect(r.score).toBeGreaterThan(25);
    const line = explainScore(r).lines.find((l) => l.factor === 'growth')!;
    expect(line.text).toBe("'Nieuw Album' kwam op #2 in de Nederlandse Album Top 100 (2026); nieuwe release rond de verkoopstart.");
    // Een oude notering telt niet als groei.
    const old = scoreRush(base({ popularity: { charts: [{ chart: 'UK Albums Chart', country: 'GB', title: 'Oud', peak: 1, year: 2017 }] } }));
    expect(old.score).toBe(25);
  });

  it('ontbrekende data is neutraal, nooit een straf', () => {
    const a = scoreRush(base({ fandom: 'regular' }));
    const b = scoreRush(base({ fandom: 'regular', popularity: undefined, previousVisit: undefined }));
    expect(a.score).toBe(b.score);
  });

  it('geannuleerd krijgt geen voorspelling', () => {
    expect(scoreRush(base({ status: 'cancelled' })).state).toBe('cancelled');
  });

  it('heeft zes factoren met elk een gewicht', () => {
    expect(RUSH_FACTORS).toHaveLength(6);
    expect(DEFAULT_RUSH_MODEL.weights).toHaveLength(6);
    expect(scoreRush(base()).factors.map((f) => f.key)).toEqual(RUSH_FACTORS.map((f) => f.key));
  });
});

describe('uitverkoopkans', () => {
  const prior = (score: number, frozen = true) => ({ rushPrior: { probability: score / 100, score, coverage: 0.7, frozen } });

  it('zonder verkoopsignalen leunt de kans op de verwachte drukte vooraf', () => {
    const hot = scoreSellout(base({ status: 'onsale', ...prior(90) }));
    const calm = scoreSellout(base({ status: 'onsale', ...prior(10) }));
    expect(hot.kind).toBe('sellout');
    expect(hot.score).toBeGreaterThanOrEqual(88);
    expect(calm.score).toBeLessThan(20);
    const line = explainScore(hot).lines.find((l) => l.factor === 'prior')!;
    expect(line.text).toBe('Verwachte drukte vlak vóór de verkoop: 90 (extreem druk verwacht).');
  });

  it('een achteraf geschatte drukte telt minder zwaar en zegt dat eerlijk', () => {
    const frozen = scoreSellout(base({ status: 'onsale', ...prior(80, true) }));
    const guessed = scoreSellout(base({ status: 'onsale', ...prior(80, false) }));
    expect(guessed.score).toBeLessThan(frozen.score);
    expect(explainScore(guessed).lines.find((l) => l.factor === 'prior')!.text).toContain('niet vóór de verkoop vastgelegd');
  });

  it('uitverkochte datums in dezelfde stad tillen de kans', () => {
    const r = scoreSellout(
      base({ status: 'onsale', capacity: 55000, siblings: [sib({ eventId: 's', city: 'Amsterdam', country: 'NL', status: 'soldout', capacity: 55000 })] }),
    );
    expect(r.score).toBeGreaterThan(50);
    expect(explainScore(r).lines[0]!.text).toBe('Een andere datum in dezelfde stad is al uitverkocht.');
  });

  it('data die al weken beschikbaar blijven, drukken de kans', () => {
    const r = scoreSellout(
      base({
        status: 'onsale',
        siblings: [sib({ eventId: 's1', status: 'onsale', available: true, firstSaleAt: '2026-09-01T08:00:00Z' }), sib({ eventId: 's2', status: 'onsale', available: true, firstSaleAt: '2026-09-01T08:00:00Z' })],
      }),
    );
    expect(r.score).toBeLessThan(30);
  });

  it('een extra toegevoegde show verkoopt trager; de oorspronkelijke datum profiteert', () => {
    const added = scoreSellout(base({ status: 'onsale', addedForDemand: 1, market: { showsInCity: 2, indexInCity: 1, isAddedShow: true, addedInCity: 1 } }));
    const original = scoreSellout(base({ status: 'onsale', addedForDemand: 1, market: { showsInCity: 2, indexInCity: 0, addedInCity: 1 } }));
    expect(original.score).toBeGreaterThan(added.score);
    expect(explainScore(added).lines.some((l) => l.text.includes('extra toegevoegde show'))).toBe(true);
  });

  it('bijna uitverkocht en een hoge doorverkoopprijs verhogen de kans', () => {
    const plain = scoreSellout(base({ status: 'onsale' }));
    expect(scoreSellout(base({ status: 'few_left' })).score).toBeGreaterThan(plain.score + 20);
    expect(scoreSellout(base({ status: 'onsale', resale: { minResalePrice: 250, faceValueMin: 100 } })).score).toBeGreaterThan(plain.score);
  });

  it('lang te koop zonder uitverkocht-melding verlaagt de kans; snelle uitverkoop elders verhoogt hem', () => {
    const plain = scoreSellout(base({ status: 'onsale', firstSaleAt: NOW }));
    const long = scoreSellout(base({ status: 'onsale', firstSaleAt: '2026-08-01T08:00:00Z' }));
    expect(long.score).toBeLessThan(plain.score);
    const fast = scoreSellout(base({ status: 'onsale', firstSaleAt: NOW, siblings: [sib({ eventId: 's', status: 'soldout', soldOutAfterHours: 0.5 })] }));
    expect(fast.score).toBeGreaterThan(plain.score);
    expect(explainScore(fast).lines.some((l) => l.text.includes('binnen een uur uitverkocht'))).toBe(true);
  });

  it('uitverkocht is 100; een voorspelling blijft tussen 1 en 99', () => {
    expect(scoreSellout(base({ status: 'soldout' })).score).toBe(100);
    const hot = scoreSellout(
      base({
        status: 'few_left',
        ...prior(95),
        capacity: 50000,
        addedForDemand: 5,
        siblings: Array.from({ length: 8 }, (_, i) => sib({ eventId: `s${i}`, country: 'NL', status: 'soldout', capacity: 60000, soldOutAfterHours: 1 })),
        resale: { minResalePrice: 400, faceValueMin: 100 },
      }),
    );
    expect(hot.score).toBe(99);
    expect(hot.speed).toBe('day1');
  });

  it('heeft zes factoren met elk een gewicht', () => {
    expect(SELLOUT_FACTORS).toHaveLength(6);
    expect(DEFAULT_SELLOUT_MODEL.weights).toHaveLength(6);
  });
});

describe('startlijst', () => {
  // Noah Kahan Europa: Dublin 17 juli en Wembley 23 en 24 juli uitverkocht; Dublin 18 en Wembley 25 toegevoegd.
  const nkSiblings: SiblingInfo[] = [
    sib({ eventId: 'nk-dublin-17', city: 'Dublin', country: 'IE', status: 'soldout', capacity: 51700 }),
    sib({ eventId: 'nk-dublin-18', city: 'Dublin', country: 'IE', status: 'onsale', capacity: 51700, addedShow: true }),
    sib({ eventId: 'nk-wembley-23', city: 'London', country: 'GB', status: 'soldout', capacity: 90000 }),
    sib({ eventId: 'nk-wembley-24', city: 'London', country: 'GB', status: 'soldout', capacity: 90000 }),
    sib({ eventId: 'nk-wembley-25', city: 'London', country: 'GB', status: 'onsale', capacity: 90000, addedShow: true }),
  ];

  it('Noah Kahan Groningen (nog niet in de verkoop): uitverkochte data in Europa maken het druk', () => {
    const r = scoreRush(
      base({ eventId: 'nk-groningen', city: 'Groningen', localDate: '2027-07-01', outdoor: true, siblings: nkSiblings, addedForDemand: 2, market: { showsInCity: 1, indexInCity: 0 }, scarcity: { onlyShowIn: 'country' } }),
    );
    expect(r.score).toBeGreaterThan(50);
    expect(r.top[0]!.key).toBe('tour_demand');
    expect(explainScore(r).lines[0]!.text).toBe('3 andere data van deze tour zijn al uitverkocht (Dublin en Londen); er zijn al 2 extra shows bijgekomen.');
  });

  it('Noah Kahan Wembley 25 juli (extra show, al in de verkoop): hoge kans, met de toevoeging als tegenwind', () => {
    const r = scoreSellout(
      base({
        eventId: 'nk-wembley-25',
        status: 'onsale',
        city: 'London',
        country: 'GB',
        capacity: 90000,
        localDate: '2027-07-25',
        siblings: nkSiblings,
        addedForDemand: 2,
        market: { showsInCity: 3, indexInCity: 2, isAddedShow: true, addedInCity: 1 },
      }),
    );
    expect(r.score).toBeGreaterThanOrEqual(60);
    const ex = explainScore(r);
    expect(ex.lines[0]!.text).toBe('2 andere data in dezelfde stad zijn al uitverkocht.');
    expect(ex.lines.some((l) => l.direction === 'down' && l.text.includes('extra toegevoegde show'))).toBe(true);
  });

  it('U2 Amsterdam 5 en 6 juni: tweede avond iets minder druk dan de eerste', () => {
    const common = {
      city: 'Amsterdam',
      capacity: 55445,
      addedForDemand: 5,
      popularity: { listeners: 5_000_000, populationM: 18.2, newReleaseWithinDays: 7 },
    };
    const d1 = scoreRush(base({ ...common, eventId: 'u2-ams-1', localDate: '2027-06-05', market: { showsInCity: 2, indexInCity: 0, seatsInCountry: 110890 } }));
    const d2 = scoreRush(base({ ...common, eventId: 'u2-ams-2', localDate: '2027-06-06', market: { showsInCity: 2, indexInCity: 1, seatsInCountry: 110890 } }));
    expect(d1.score).toBeGreaterThan(d2.score);
    expect(d1.confidence).not.toBe('high');
  });

  it('ATEEZ Amsterdam: georganiseerde fanbase, maar lage betrouwbaarheid zolang venue en verkoop onbekend zijn', () => {
    const r = scoreRush(base({ eventId: 'ateez-ams', localDate: '2027-04-12', fandom: 'organized' }));
    expect(r.confidence).toBe('low');
    expect(r.score).toBeGreaterThan(25);
  });

  it('Bon Jovi East Rutherford (al in de verkoop): uitverkochte shows elders op de tour tellen mee', () => {
    const r = scoreSellout(
      base({
        eventId: 'bj-metlife',
        status: 'onsale',
        city: 'East Rutherford',
        country: 'US',
        continent: 'NA',
        siblings: [sib({ eventId: 'ny-1', city: 'New York', country: 'US', continent: 'NA', status: 'soldout' })],
        ...{ rushPrior: { probability: 0.4, score: 40, coverage: 0.5, frozen: false } },
      }),
    );
    expect(r.score).toBeGreaterThan(40);
  });
});

describe('modellen en betrouwbaarheid', () => {
  it('betrouwbaarheid hooguit middel zolang er minder dan 50 uitkomsten zijn', () => {
    expect(confidenceFromCoverage(0.9, 0)).toBe('medium');
    expect(confidenceFromCoverage(0.9, 60)).toBe('high');
    expect(confidenceFromCoverage(0.5, 60)).toBe('medium');
    expect(confidenceFromCoverage(0.2, 60)).toBe('low');
  });

  it('een opgeslagen model van het oude formaat wordt vervangen door het startmodel', () => {
    const old = { version: 'start-2026-10', baseRate: 0.3, typeOffsets: {}, weights: [2.4, 1.8, 1.5, 1.3, 1.1, 0.9, 0.8, 0.5, 0.4], outcomesUsed: 0 };
    expect(usableModel('sellout', old).version).toBe('kans-start-2026-10');
    expect(usableModel('rush', DEFAULT_SELLOUT_MODEL).version).toBe('drukte-start-2026-10');
    expect(usableModel('rush', DEFAULT_RUSH_MODEL)).toBe(DEFAULT_RUSH_MODEL);
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
    expect(formatCompact(5_612_345)).toBe('5,6 mln');
    expect(formatCompact(12_400_000)).toBe('12 mln');
    expect(formatCompact(84_000)).toBe('84.000');
    expect(joinList(['Dublin'])).toBe('Dublin');
    expect(joinList(['Dublin', 'Londen'])).toBe('Dublin en Londen');
    expect(joinList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C en nog 2');
  });
});

describe('vorige tour: deels uitverkocht', () => {
  it('98% verkocht telt bijna als uitverkocht en staat zo in de uitleg', () => {
    const base98 = scoreRush(base({ previousVisit: { scope: 'country', sellThrough: 0.98, year: 2025, venueName: 'Ziggo Dome', place: 'Nederland' } }));
    const sold = scoreRush(base({ previousVisit: { scope: 'country', soldOut: true, year: 2025 } }));
    const half = scoreRush(base({ previousVisit: { scope: 'country', sellThrough: 0.6, year: 2025 } }));
    expect(sold.score).toBeGreaterThan(base98.score);
    expect(base98.score).toBeGreaterThan(25);
    expect(half.score).toBeLessThan(25);
    expect(explainScore(base98).lines.find((l) => l.factor === 'previous_tour')!.text).toBe('Het vorige bezoek aan Nederland (Ziggo Dome, 2025) was voor 98% uitverkocht.');
    // ≥ 99% telt als uitverkocht.
    expect(scoreRush(base({ previousVisit: { scope: 'country', sellThrough: 0.995, year: 2025 } })).score).toBe(sold.score);
  });

  it('festival: 92% binnen twee uur weg is een sterk signaal', () => {
    const r = scoreRush(base({ type: 'festival', previousVisit: { scope: 'city', sameVenue: true, sellThrough: 0.92, withinHours: 2, year: 2025 } }));
    expect(explainScore(r).lines.find((l) => l.factor === 'previous_tour')!.text).toBe('Van de editie van 2025 was binnen 2 uur 92% van de kaarten verkocht.');
    expect(r.score).toBeGreaterThan(40);
  });
});
