import type { EventType } from '../types';
import type { ScoreKind } from './factors';
import type { ScoreModel, SpeedClass } from './model';

/**
 * Kalibratie: voorspellingen naast echte uitkomsten leggen en het model bijstellen. Elk van de twee
 * scores heeft een eigen model en eigen uitkomsten.
 *
 *  - Verwachte drukte: voorspelling = de laatste verwachte drukte vóór de eerste verkoop (bij de overgang
 *    bewaard). Uitkomst = 1 als de datum in de presale of binnen 24 uur na de eerste verkoopstart uitverkocht
 *    raakte, anders 0 (vastgesteld na een week, of eerder als hij later uitverkocht raakte).
 *  - Uitverkoopkans: voorspelling = de laatste uitverkoopkans in de eerste week van de verkoop, vóór de
 *    uitkomst bekend was. Uitkomst = 1 als de datum vóór de showdag uitverkocht raakte, anders 0.
 */

export interface OutcomeRecord {
  eventId: string;
  /** Welke score deze uitkomst toetst; ontbreekt = 'sellout' (oud formaat). */
  kind?: ScoreKind;
  /** Voorspelde kans 0..1 op het meetmoment. */
  predicted: number;
  outcome: 0 | 1;
  /** Per factor dekking × signaal op het meetmoment, voor het hertrainen. */
  features?: number[];
  type?: EventType;
  /** Werkelijke snelheid als de datum uitverkocht raakte. */
  speed?: SpeedClass;
  /** Moment van de uitkomst (UTC ISO), voor een eerlijke tijdsvolgorde. */
  resolvedAt?: string;
}

const EPS = 1e-6;
const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));

/** Brier-score: gemiddelde kwadratische fout, 0 is perfect, 0,25 is gokken op 50%. */
export function brier(records: Pick<OutcomeRecord, 'predicted' | 'outcome'>[]): number {
  if (records.length === 0) return NaN;
  return records.reduce((s, r) => s + (r.predicted - r.outcome) ** 2, 0) / records.length;
}

/** Log-loss: straft zelfverzekerde missers zwaar. */
export function logLoss(records: Pick<OutcomeRecord, 'predicted' | 'outcome'>[]): number {
  if (records.length === 0) return NaN;
  return (
    -records.reduce((s, r) => {
      const p = clampP(r.predicted);
      return s + (r.outcome === 1 ? Math.log(p) : Math.log(1 - p));
    }, 0) / records.length
  );
}

export interface ReliabilityBin {
  /** Scoregrenzen 0..100, gelijk aan de labels in de app. */
  lo: number;
  hi: number;
  n: number;
  meanPredicted: number | null;
  observedRate: number | null;
}

/** Betrouwbaarheidstabel per scoreband: "van de shows met 60–79 raakte X% uitverkocht". */
export function reliabilityBins(
  records: Pick<OutcomeRecord, 'predicted' | 'outcome'>[],
  edges: number[] = [0, 20, 40, 60, 80, 101],
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = records.filter((r) => {
      const s = Math.round(r.predicted * 100);
      return s >= lo && s < hi;
    });
    bins.push({
      lo,
      hi: Math.min(hi - 1, 100),
      n: inBin.length,
      meanPredicted: inBin.length ? inBin.reduce((s, r) => s + r.predicted, 0) / inBin.length : null,
      observedRate: inBin.length ? inBin.reduce((s, r) => s + r.outcome, 0) / inBin.length : null,
    });
  }
  return bins;
}

// ---------------------------------------------------------------------------
// Isotone regressie (pool-adjacent-violators)
// ---------------------------------------------------------------------------

/** Monotone afbeelding van ruwe kans naar gekalibreerde kans. */
export interface IsotonicMap {
  x: number[];
  y: number[];
}

/** Past een stijgende stapfunctie aan met PAV; de knooppunten liggen op het blokgemiddelde. */
export function isotonicFit(points: { p: number; y: number; w?: number }[]): IsotonicMap {
  const sorted = [...points].sort((a, b) => a.p - b.p);
  type Block = { w: number; sy: number; sp: number };
  const blocks: Block[] = [];
  for (const pt of sorted) {
    const w = pt.w ?? 1;
    blocks.push({ w, sy: w * pt.y, sp: w * pt.p });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sy / a.w <= b.sy / b.w) break;
      blocks.splice(blocks.length - 2, 2, { w: a.w + b.w, sy: a.sy + b.sy, sp: a.sp + b.sp });
    }
  }
  return { x: blocks.map((b) => b.sp / b.w), y: blocks.map((b) => b.sy / b.w) };
}

/** Past de kalibratie toe met lineaire interpolatie; nooit precies 0 of 1. */
export function applyIsotonic(map: IsotonicMap, p: number): number {
  const { x, y } = map;
  if (x.length === 0) return p;
  const bound = (v: number) => Math.min(0.99, Math.max(0.01, v));
  if (p <= x[0]!) return bound(y[0]!);
  if (p >= x[x.length - 1]!) return bound(y[y.length - 1]!);
  for (let i = 0; i < x.length - 1; i++) {
    const x0 = x[i]!;
    const x1 = x[i + 1]!;
    if (p >= x0 && p <= x1) {
      const t = x1 === x0 ? 0 : (p - x0) / (x1 - x0);
      return bound(y[i]! + t * (y[i + 1]! - y[i]!));
    }
  }
  return bound(p);
}

// ---------------------------------------------------------------------------
// Gewichten hertrainen: logistische regressie, met L2 naar de startgewichten toe
// ---------------------------------------------------------------------------

export interface LinearParams {
  intercept: number;
  weights: number[];
}

/**
 * Minimaliseert log-loss + λ/2·‖β − prior‖². Met weinig uitkomsten blijven de gewichten
 * dicht bij de vaste startvolgorde; met veel uitkomsten mag de data meer spreken.
 */
export function fitWeights(
  records: OutcomeRecord[],
  prior: LinearParams,
  opts: { lambda?: number; iterations?: number; learningRate?: number } = {},
): LinearParams {
  const lambda = opts.lambda ?? 2;
  const iterations = opts.iterations ?? 2000;
  const lr = opts.learningRate ?? 0.1;
  const data = records.filter((r) => r.features && r.features.length === prior.weights.length);
  let b0 = prior.intercept;
  const w = [...prior.weights];
  if (data.length === 0) return { intercept: b0, weights: w };
  const n = data.length;
  for (let it = 0; it < iterations; it++) {
    let g0 = 0;
    const g = new Array<number>(w.length).fill(0);
    for (const r of data) {
      const f = r.features!;
      let z = b0;
      for (let i = 0; i < w.length; i++) z += w[i]! * f[i]!;
      const err = sigmoid(z) - r.outcome;
      g0 += err;
      for (let i = 0; i < w.length; i++) g[i]! += err * f[i]!;
    }
    b0 -= lr * (g0 / n + (lambda / n) * (b0 - prior.intercept));
    for (let i = 0; i < w.length; i++) {
      w[i] = w[i]! - lr * (g[i]! / n + (lambda / n) * (w[i]! - prior.weights[i]!));
      // Een factor mag de goede kant op niet omkeren; signalen zijn al gericht.
      if (w[i]! < 0) w[i] = 0;
    }
  }
  return { intercept: b0, weights: w };
}

export function predictLinear(params: LinearParams, features: number[]): number {
  let z = params.intercept;
  for (let i = 0; i < params.weights.length; i++) z += params.weights[i]! * (features[i] ?? 0);
  return sigmoid(z);
}

export interface CalibrationReport {
  n: number;
  applied: boolean;
  reason: string;
  before: { brier: number; logLoss: number };
  after?: { brier: number; logLoss: number };
  model: ScoreModel;
}

/** Minimaal aantal uitkomsten voordat we gewichten aanpassen. */
export const MIN_OUTCOMES_TO_REFIT = 30;
/** Isotone kalibratie pas vanaf zoveel uitkomsten; daaronder overfit ze. */
export const MIN_OUTCOMES_FOR_ISOTONIC = 100;

/**
 * Herkalibreert maandelijks of per 30 nieuwe uitkomsten. Train op de oudste 80%,
 * toets op de nieuwste 20%; het nieuwe model wordt alleen gebruikt als het op die
 * toetsset niet slechter is.
 */
export function recalibrate(model: ScoreModel, records: OutcomeRecord[], now: string): CalibrationReport {
  const usable = records
    .filter((r) => r.features && r.features.length === model.weights.length)
    .sort((a, b) => (a.resolvedAt ?? '').localeCompare(b.resolvedAt ?? ''));
  const before = { brier: brier(records), logLoss: logLoss(records) };
  if (usable.length < MIN_OUTCOMES_TO_REFIT) {
    return {
      n: usable.length,
      applied: false,
      reason: `Nog te weinig uitkomsten (${usable.length} van ${MIN_OUTCOMES_TO_REFIT}).`,
      before,
      model,
    };
  }
  const prior: LinearParams = { intercept: model.intercept ?? logit(model.baseRate), weights: model.weights };
  const cut = Math.floor(usable.length * 0.8);
  const train = usable.slice(0, cut);
  const test = usable.slice(cut);

  const evaluate = (params: LinearParams, iso: IsotonicMap | undefined, set: OutcomeRecord[]) =>
    set.map((r) => {
      const raw = predictLinear(params, r.features!);
      return { predicted: iso ? applyIsotonic(iso, raw) : raw, outcome: r.outcome };
    });

  const trial = fitWeights(train, prior);
  const trialIso =
    train.length >= MIN_OUTCOMES_FOR_ISOTONIC
      ? isotonicFit(train.map((r) => ({ p: predictLinear(trial, r.features!), y: r.outcome })))
      : undefined;
  const oldLoss = logLoss(evaluate(prior, model.calibration, test));
  const newLoss = logLoss(evaluate(trial, trialIso, test));
  if (newLoss > oldLoss + 1e-9) {
    return {
      n: usable.length,
      applied: false,
      reason: `Nieuw model scoort slechter op recente uitkomsten (log-loss ${newLoss.toFixed(3)} tegen ${oldLoss.toFixed(3)}).`,
      before,
      model,
    };
  }

  // Goedgekeurd: train opnieuw op alles.
  const finalParams = fitWeights(usable, prior);
  const finalIso =
    usable.length >= MIN_OUTCOMES_FOR_ISOTONIC
      ? isotonicFit(usable.map((r) => ({ p: predictLinear(finalParams, r.features!), y: r.outcome })))
      : undefined;
  const prefix = model.kind === 'rush' ? 'drukte-' : model.kind === 'sellout' ? 'kans-' : '';
  const next: ScoreModel = {
    ...model,
    version: `${prefix}fit-${now.slice(0, 10)}-n${usable.length}`,
    intercept: finalParams.intercept,
    weights: finalParams.weights,
    calibration: finalIso,
    outcomesUsed: usable.length,
    trainedAt: now,
  };
  const afterPreds = evaluate(finalParams, finalIso, usable);
  return {
    n: usable.length,
    applied: true,
    reason: `Bijgesteld op ${usable.length} uitkomsten.`,
    before,
    after: { brier: brier(afterPreds), logLoss: logLoss(afterPreds) },
    model: next,
  };
}

// ---------------------------------------------------------------------------
// Nauwkeurigheidsoverzicht voor in de app
// ---------------------------------------------------------------------------

export interface AccuracySummary {
  n: number;
  soldOut: number;
  brier: number | null;
  logLoss: number | null;
  bins: ReliabilityBin[];
  /** Aandeel van de datums met score ≥ 70 waarbij de uitkomst 1 was (uitverkocht, of bij de drukte: binnen een dag). */
  highScoreHitRate: number | null;
  /** Aantal datums met score < 40 waarbij de uitkomst tóch 1 was. */
  lowScoreSurprises: number;
  /** Werkelijke snelheid van de uitverkochte shows. */
  bySpeed: Record<SpeedClass, number>;
}

export function accuracySummary(records: OutcomeRecord[]): AccuracySummary {
  const high = records.filter((r) => r.predicted >= 0.7);
  const bySpeed: Record<SpeedClass, number> = { presale: 0, day1: 0, week1: 0, later: 0 };
  for (const r of records) if (r.outcome === 1 && r.speed) bySpeed[r.speed]++;
  return {
    n: records.length,
    soldOut: records.filter((r) => r.outcome === 1).length,
    brier: records.length ? brier(records) : null,
    logLoss: records.length ? logLoss(records) : null,
    bins: reliabilityBins(records),
    highScoreHitRate: high.length ? high.filter((r) => r.outcome === 1).length / high.length : null,
    lowScoreSurprises: records.filter((r) => r.predicted < 0.4 && r.outcome === 1).length,
    bySpeed,
  };
}
