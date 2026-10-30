import type { Artist, Conflict, EventDate, SalePhase, SourceKind, Tour, Venue } from './types';
import type { AccuracySummary } from './score/calibration';
import type { ExplanationLine } from './score/explain';
import type { ConfidenceLevel } from './score/labels';
import type { SpeedClass, Trend } from './score/model';

/**
 * Het snapshotbestand dat de updater na elke run schrijft (data/snapshot.json) en dat de
 * app leest. Het is het contract tussen beide kanten; verhoog schemaVersion bij een
 * niet-compatibele wijziging.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotScore {
  value: number;
  state: 'scored' | 'soldout' | 'cancelled';
  confidence: ConfidenceLevel;
  label: string;
  headline: string;
  lines: ExplanationLine[];
  speed?: SpeedClass;
  speedText?: string;
  caveat?: string;
  computedAt: string;
  modelVersion: string;
}

export interface SnapshotEvent extends EventDate {
  score: SnapshotScore;
  /** Compacte scoregeschiedenis (hooguit één punt per run waarin iets veranderde). */
  history: { at: string; score: number }[];
  trend: Trend | null;
  conflicts: Conflict[];
  /** Gezet als een bron van deze datum bij de laatste run niet bereikbaar was. */
  stale?: { since: string; message: string };
}

export interface SourceHealth {
  name: string;
  kind: SourceKind | 'api';
  ok: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  message?: string;
}

export interface ChangeLogEntry {
  at: string;
  kind: 'extra_show' | 'new_phase' | 'sale_date' | 'score_jump' | 'soldout' | 'new_event' | 'conflict';
  eventIds: string[];
  phaseId?: string;
  text: string;
}

export interface Snapshot {
  schemaVersion: number;
  generatedAt: string;
  runId?: string;
  model: { version: string; outcomesUsed: number };
  artists: Artist[];
  tours: Tour[];
  venues: Venue[];
  events: SnapshotEvent[];
  phases: SalePhase[];
  sources: SourceHealth[];
  changes: ChangeLogEntry[];
  accuracy?: AccuracySummary;
}

/** Controleert de basisvorm van een snapshot voordat de app hem gebruikt. */
export function isValidSnapshot(x: unknown): x is Snapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<Snapshot>;
  return (
    typeof s.schemaVersion === 'number' &&
    s.schemaVersion <= SNAPSHOT_SCHEMA_VERSION &&
    typeof s.generatedAt === 'string' &&
    Array.isArray(s.events) &&
    Array.isArray(s.phases) &&
    Array.isArray(s.venues) &&
    Array.isArray(s.artists)
  );
}

/** Hoe oud is de data? Na 10 uur (meer dan één gemiste run) tonen we een waarschuwing. */
export function snapshotAgeWarning(generatedAt: string, now: string, maxHours = 10): string | null {
  const ageH = (Date.parse(now) - Date.parse(generatedAt)) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH <= maxHours) return null;
  const h = Math.floor(ageH);
  return h < 48
    ? `Laatste update ${h} uur geleden. Dit is de laatst bekende data.`
    : `Laatste update ${Math.floor(h / 24)} dagen geleden. Dit is de laatst bekende data.`;
}
