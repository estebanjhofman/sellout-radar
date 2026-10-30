import { DateTime } from 'luxon';
import type { EventType } from '../types';
import { applyIsotonic, type IsotonicMap } from './calibration';
import { factorDefs, factorFunctions, type FactorResult, type ScoreInputs, type ScoreKind } from './factors';
import type { ConfidenceLevel } from './labels';

/**
 * Twee scores met hetzelfde rekenwerk:
 *
 *   logit(p) = b + b_type + Σ w_i · c_i · s_i
 *
 * s_i ∈ [−1, 1] is het signaal van factor i, c_i ∈ [0, 1] de dekking (hoeveel data er is),
 * w_i het gewicht. Ontbrekende data geeft c_i = 0: neutraal, maar lagere betrouwbaarheid.
 *
 *  - Verwachte drukte ('rush'): p = kans dat de datum bij de eerste verkoop uitverkoopt
 *    (in de presale of binnen 24 uur na de eerste verkoopstart). Hoe hoger, hoe moeilijker
 *    het wordt om een kaart te krijgen.
 *  - Uitverkoopkans ('sellout'): p = kans dat de datum vóór de showdag uitverkoopt.
 */

export type { ScoreKind } from './factors';

export interface ScoreModel {
  /** Ontbreekt bij het oude formaat (één score); dat telt als 'sellout'. */
  kind?: ScoreKind;
  version: string;
  /** Basiskans zonder enige informatie. */
  baseRate: number;
  /** Na hertraining: intercept op logit-schaal (gaat voor baseRate). */
  intercept?: number;
  /** Verschuiving per type evenement op logit-schaal. */
  typeOffsets: Partial<Record<EventType, number>>;
  weights: number[];
  /** Isotone kalibratie van ruwe naar werkelijke kans, na genoeg uitkomsten. */
  calibration?: IsotonicMap;
  /** Aantal uitkomsten waarop het model getraind is. */
  outcomesUsed: number;
  trainedAt?: string;
}

/** Startgewichten Verwachte drukte: populariteit/plekken, groei, vorige tour, schaarste, fanbase, vraag elders. */
export const DEFAULT_RUSH_WEIGHTS: readonly number[] = [1.6, 0.9, 1.5, 1.3, 1.0, 1.8];
/** Startgewichten Uitverkoopkans: drukte vooraf, uitverkochte datums, extra shows, snelheid, doorverkoop, bijna uitverkocht. */
export const DEFAULT_SELLOUT_WEIGHTS: readonly number[] = [3.0, 2.0, 1.2, 1.5, 1.3, 2.0];

export const DEFAULT_RUSH_MODEL: ScoreModel = {
  kind: 'rush',
  version: 'drukte-start-2026-10',
  baseRate: 0.25,
  typeOffsets: {},
  weights: [...DEFAULT_RUSH_WEIGHTS],
  outcomesUsed: 0,
};

export const DEFAULT_SELLOUT_MODEL: ScoreModel = {
  kind: 'sellout',
  version: 'kans-start-2026-10',
  baseRate: 0.3,
  typeOffsets: {},
  weights: [...DEFAULT_SELLOUT_WEIGHTS],
  outcomesUsed: 0,
};

export const DEFAULT_MODELS: Record<ScoreKind, ScoreModel> = { rush: DEFAULT_RUSH_MODEL, sellout: DEFAULT_SELLOUT_MODEL };

/** Past dit opgeslagen model bij de huidige factoren? Anders het startmodel (bijv. na een update van de app). */
export function usableModel(kind: ScoreKind, model: ScoreModel | undefined): ScoreModel {
  if (model && (model.kind ?? 'sellout') === kind && model.weights.length === factorDefs(kind).length) return model;
  return structuredClone(DEFAULT_MODELS[kind]);
}

/** Onder dit aantal uitkomsten is de betrouwbaarheid hooguit "middel". */
export const MIN_OUTCOMES_FOR_HIGH_CONFIDENCE = 50;

export type SpeedClass = 'presale' | 'day1' | 'week1' | 'later';

export const SPEED_LABELS: Record<SpeedClass, string> = {
  presale: 'al tijdens de presale',
  day1: 'binnen een dag',
  week1: 'binnen een week',
  later: 'later dan een week',
};

export interface FactorContribution extends FactorResult {
  name: string;
  weight: number;
  /** Bijdrage op logit-schaal: w · c · s. */
  contribution: number;
}

export interface ScoreResult {
  kind: ScoreKind;
  eventId: string;
  state: 'scored' | 'soldout' | 'cancelled';
  /** 0–100. Een voorspelling blijft tussen 1 en 99; 100 betekent echt uitverkocht. */
  score: number;
  probability: number;
  rawProbability: number;
  confidence: ConfidenceLevel;
  /** Gewogen dekking 0..1. */
  coverage: number;
  factors: FactorContribution[];
  /** De (hooguit) drie factoren met de grootste invloed. */
  top: FactorContribution[];
  /** Verwachte snelheid van uitverkopen (schatting), alleen bij de uitverkoopkans en score ≥ 50. */
  speed?: SpeedClass;
  modelVersion: string;
  computedAt: string;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

export function computeFactors(kind: ScoreKind, inp: ScoreInputs, model: ScoreModel = DEFAULT_MODELS[kind]): FactorContribution[] {
  const defs = factorDefs(kind);
  return factorFunctions(kind).map((fn, i) => {
    const r = fn(inp);
    const weight = model.weights[i] ?? 0;
    return { ...r, name: defs[i]!.name, weight, contribution: weight * r.coverage * r.signal };
  });
}

/** Factorwaarden zoals de kalibratie ze bewaart: c · s per factor. */
export function featureVector(factors: FactorResult[]): number[] {
  return factors.map((f) => f.coverage * f.signal);
}

export function confidenceFromCoverage(coverage: number, outcomesUsed: number): ConfidenceLevel {
  const level: ConfidenceLevel = coverage < 0.4 ? 'low' : coverage < 0.7 ? 'medium' : 'high';
  if (level === 'high' && outcomesUsed < MIN_OUTCOMES_FOR_HIGH_CONFIDENCE) return 'medium';
  return level;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Schat hoe snel de datum uitverkoopt; leunt eerst op andere data van dezelfde tour. */
export function estimateSpeed(inp: ScoreInputs, p: number): SpeedClass | undefined {
  if (p < 0.5) return undefined;
  const sold = inp.siblings.filter((s) => s.eventId !== inp.eventId && s.status === 'soldout');
  const near = sold.filter((s) => s.continent === inp.continent);
  const pool = near.length ? near : sold;
  if (pool.some((s) => s.soldOutInPresale)) return 'presale';
  const hours = pool.map((s) => s.soldOutAfterHours).filter((h): h is number => h !== undefined);
  if (hours.length) {
    const h = median(hours);
    return h <= 24 ? 'day1' : h <= 24 * 7 ? 'week1' : 'later';
  }
  return p >= 0.9 ? 'day1' : p >= 0.75 ? 'week1' : 'later';
}

export function scoreWith(kind: ScoreKind, inp: ScoreInputs, modelIn?: ScoreModel): ScoreResult {
  const model = usableModel(kind, modelIn);
  const factors = computeFactors(kind, inp, model);
  const wsum = model.weights.reduce((a, b) => a + b, 0);
  const coverage = wsum > 0 ? factors.reduce((s, f) => s + f.weight * f.coverage, 0) / wsum : 0;
  const base = { kind, eventId: inp.eventId, coverage, factors, modelVersion: model.version, computedAt: inp.now };

  if (inp.status === 'soldout') {
    return { ...base, state: 'soldout', score: 100, probability: 1, rawProbability: 1, confidence: 'high', top: [] };
  }
  if (inp.status === 'cancelled') {
    return { ...base, state: 'cancelled', score: 0, probability: 0, rawProbability: 0, confidence: 'high', top: [] };
  }

  const intercept = model.intercept ?? logit(model.baseRate);
  const z = intercept + (model.typeOffsets[inp.type] ?? 0) + factors.reduce((s, f) => s + f.contribution, 0);
  const raw = sigmoid(z);
  const p = model.calibration ? applyIsotonic(model.calibration, raw) : raw;
  const score = Math.min(99, Math.max(1, Math.round(p * 100)));
  const top = factors
    .filter((f) => Math.abs(f.contribution) >= 0.05)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4);
  return {
    ...base,
    state: 'scored',
    score,
    probability: p,
    rawProbability: raw,
    confidence: confidenceFromCoverage(coverage, model.outcomesUsed),
    top,
    ...(kind === 'sellout' ? { speed: estimateSpeed(inp, p) } : {}),
  };
}

/** Verwachte drukte (vóór de verkoop). */
export function scoreRush(inp: ScoreInputs, model?: ScoreModel): ScoreResult {
  return scoreWith('rush', inp, model);
}

/** Uitverkoopkans (tijdens de verkoop). */
export function scoreSellout(inp: ScoreInputs, model?: ScoreModel): ScoreResult {
  return scoreWith('sellout', inp, model);
}

// ---------------------------------------------------------------------------
// Trendpijl in het overzicht
// ---------------------------------------------------------------------------

export type Trend = 'up' | 'down' | 'flat';

/**
 * Vergelijkt de huidige score met die van `hours` uur geleden (of de oudste meting
 * als de reeks korter is). Een verschil van minder dan `threshold` punten is vlak.
 */
export function scoreTrend(history: { at: string; score: number }[], now: string, hours = 72, threshold = 3): Trend | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const current = sorted[sorted.length - 1]!;
  const cutoff = DateTime.fromISO(now).minus({ hours }).toUTC().toISO()!;
  const older = sorted.filter((h) => h.at <= cutoff);
  const baseline = older.length ? older[older.length - 1]! : sorted[0]!;
  if (baseline === current) return null;
  const d = current.score - baseline.score;
  return d >= threshold ? 'up' : d <= -threshold ? 'down' : 'flat';
}
