import { describe, expect, it } from 'vitest';
import {
  accuracySummary,
  applyIsotonic,
  brier,
  fitWeights,
  isotonicFit,
  logLoss,
  recalibrate,
  reliabilityBins,
  type OutcomeRecord,
} from '../src/score/calibration';
import { DEFAULT_RUSH_MODEL, DEFAULT_SELLOUT_MODEL } from '../src/score/model';

describe('maten', () => {
  const recs = [
    { predicted: 0.8, outcome: 1 as const },
    { predicted: 0.3, outcome: 0 as const },
  ];
  it('Brier en log-loss', () => {
    expect(brier(recs)).toBeCloseTo(0.065, 6);
    expect(logLoss(recs)).toBeCloseTo((-Math.log(0.8) - Math.log(0.7)) / 2, 6);
  });
  it('betrouwbaarheidstabel per scoreband', () => {
    const bins = reliabilityBins([...recs, { predicted: 0.85, outcome: 0 }]);
    expect(bins).toHaveLength(5);
    expect(bins[4]).toMatchObject({ lo: 80, hi: 100, n: 2, observedRate: 0.5 });
    expect(bins[1]).toMatchObject({ lo: 20, hi: 39, n: 1, observedRate: 0 });
    expect(bins[0]!.observedRate).toBeNull();
  });
});

describe('isotone regressie', () => {
  it('maakt een stijgende functie (PAV)', () => {
    const m = isotonicFit([
      { p: 0.1, y: 0 },
      { p: 0.2, y: 1 },
      { p: 0.3, y: 0 },
      { p: 0.4, y: 1 },
    ]);
    expect(m.y).toEqual([0, 0.5, 1]);
    expect(m.x[1]).toBeCloseTo(0.25);
    expect(applyIsotonic(m, 0.25)).toBeCloseTo(0.5);
    expect(applyIsotonic(m, 0)).toBe(0.01);
    expect(applyIsotonic(m, 1)).toBe(0.99);
    for (let i = 1; i < m.y.length; i++) expect(m.y[i]!).toBeGreaterThanOrEqual(m.y[i - 1]!);
  });
});

/** Deterministische pseudo-random voor reproduceerbare tests. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function synthetic(n: number, seed = 1): OutcomeRecord[] {
  const r = rng(seed);
  const out: OutcomeRecord[] = [];
  for (let i = 0; i < n; i++) {
    const f = Array.from({ length: 6 }, () => (r() * 2 - 1) * (r() < 0.5 ? 1 : 0));
    // "Werkelijkheid": factor 1 en 2 wegen zwaarder dan gedacht, basiskans lager.
    const z = -1.4 + 3.5 * f[0]! + 2.5 * f[1]! + 0.5 * f[4]!;
    const p = 1 / (1 + Math.exp(-z));
    out.push({
      eventId: `e${i}`,
      predicted: 0.5,
      outcome: r() < p ? 1 : 0,
      features: f,
      resolvedAt: new Date(Date.UTC(2027, 0, 1) + i * 3_600_000).toISOString(),
    });
  }
  return out;
}

describe('hertrainen', () => {
  it('oude uitkomsten met een ander aantal factoren tellen niet mee', () => {
    const old = synthetic(40).map((o) => ({ ...o, features: [...o.features!, 0, 0, 0] }));
    expect(recalibrate(DEFAULT_SELLOUT_MODEL, old, '2027-02-01T00:00:00Z').reason).toBe('Nog te weinig uitkomsten (0 van 30).');
  });

  it('doet niets onder de 30 uitkomsten', () => {
    const rep = recalibrate(DEFAULT_SELLOUT_MODEL, synthetic(20), '2027-02-01T00:00:00Z');
    expect(rep.applied).toBe(false);
    expect(rep.reason).toBe('Nog te weinig uitkomsten (20 van 30).');
    expect(rep.model).toBe(DEFAULT_SELLOUT_MODEL);
  });

  it('leert van genoeg uitkomsten en wordt beter', () => {
    const data = synthetic(400);
    const rep = recalibrate(DEFAULT_SELLOUT_MODEL, data, '2027-03-01T00:00:00Z');
    expect(rep.applied).toBe(true);
    expect(rep.model.weights[0]!).toBeGreaterThan(DEFAULT_SELLOUT_MODEL.weights[0]!);
    expect(rep.model.calibration).toBeDefined();
    expect(rep.model.outcomesUsed).toBe(400);
    expect(rep.model.version).toBe('kans-fit-2027-03-01-n400');
    expect(rep.model.kind).toBe('sellout');
  });

  it('de verwachte drukte leert van haar eigen uitkomsten (bewaarde drukte vóór de verkoop)', () => {
    const data = synthetic(200, 3).map((o) => ({ ...o, kind: 'rush' as const }));
    const rep = recalibrate(DEFAULT_RUSH_MODEL, data, '2027-04-01T00:00:00Z');
    expect(rep.applied).toBe(true);
    expect(rep.model.kind).toBe('rush');
    expect(rep.model.version).toBe('drukte-fit-2027-04-01-n200');
    expect(rep.model.weights).toHaveLength(6);
    expect(rep.after!.logLoss).toBeLessThan(rep.before.logLoss);
  });

  it('gewichten blijven bij weinig data dicht bij de startwaarden', () => {
    const p = fitWeights(synthetic(40), { intercept: -0.85, weights: [...DEFAULT_SELLOUT_MODEL.weights] }, { lambda: 50 });
    p.weights.forEach((w, i) => expect(Math.abs(w - DEFAULT_SELLOUT_MODEL.weights[i]!)).toBeLessThan(1));
  });

  it('gewichten worden nooit negatief', () => {
    const p = fitWeights(synthetic(300, 7), { intercept: -0.85, weights: [...DEFAULT_SELLOUT_MODEL.weights] });
    p.weights.forEach((w) => expect(w).toBeGreaterThanOrEqual(0));
  });
});

describe('nauwkeurigheidsoverzicht', () => {
  it('telt treffers en verrassingen', () => {
    const s = accuracySummary([
      { eventId: 'a', predicted: 0.9, outcome: 1, speed: 'day1' },
      { eventId: 'b', predicted: 0.75, outcome: 0 },
      { eventId: 'c', predicted: 0.2, outcome: 1, speed: 'later' },
      { eventId: 'd', predicted: 0.1, outcome: 0 },
    ]);
    expect(s.n).toBe(4);
    expect(s.soldOut).toBe(2);
    expect(s.highScoreHitRate).toBe(0.5);
    expect(s.lowScoreSurprises).toBe(1);
    expect(s.bySpeed).toEqual({ presale: 0, day1: 1, week1: 0, later: 1 });
  });
});
