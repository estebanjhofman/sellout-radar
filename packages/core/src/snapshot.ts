import type { Artist, Conflict, EventDate, SalePhase, SourceKind, SourceRef, Tour, Venue } from './types';
import type { AccuracySummary } from './score/calibration';
import type { ExplanationLine } from './score/explain';
import type { ScoreKind } from './score/factors';
import type { ConfidenceLevel } from './score/labels';
import type { SpeedClass, Trend } from './score/model';
import type { SaleStage } from './stage';

/**
 * Het snapshotbestand dat de updater na elke run schrijft (data/snapshot.json) en dat de
 * app leest. Het is het contract tussen beide kanten; verhoog schemaVersion bij een
 * niet-compatibele wijziging. Nieuwe velden zijn optioneel, zodat een oudere app blijft werken:
 * `score` is altijd de score die bij het tabblad hoort.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotScore {
  /** 'rush' = Verwachte drukte, 'sellout' = Uitverkoopkans. Ontbreekt in oude snapshots ('sellout'). */
  kind?: ScoreKind;
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

/** De laatste verwachte drukte van vóór de eerste verkoop, om achteraf te zien of die klopte. */
export interface FrozenRush {
  value: number;
  label: string;
  confidence: ConfidenceLevel;
  /** Moment van die verwachting (UTC ISO). */
  at: string;
  /** Eerste verkoopmoment (UTC ISO). */
  firstSaleAt?: string;
  /** true = niet vóór de verkoop vastgelegd (de datum was al in de verkoop toen de radar hem vond); achteraf geschat. */
  reconstructed?: boolean;
  /** Wat er gebeurde, zodra dat vaststaat. */
  outcome?: {
    /** busy = uitverkocht in de presale of binnen een dag; calm = niet. */
    result: 'busy' | 'calm';
    speed?: SpeedClass;
    /** Bijv. "Binnen een dag uitverkocht. De verwachting klopte." */
    text: string;
    resolvedAt: string;
  };
}

export interface SnapshotEvent extends EventDate {
  /** Tabblad volgens de updater; de app rekent het zelf opnieuw uit met de verkoopfases en de klok. */
  stage?: SaleStage;
  /** Eerste verkoopmoment (presale of algemene verkoop), als minstens de dag bekend is (UTC ISO). */
  firstSaleAt?: string;
  /** De score die bij het tabblad hoort (verwachte drukte of uitverkoopkans). */
  score: SnapshotScore;
  /** Verwachte drukte (alleen zolang de verkoop nog niet begonnen is). */
  rush?: SnapshotScore;
  /** Uitverkoopkans; bij "nog niet in de verkoop" alvast berekend voor het moment dat de verkoop begint. */
  sellout?: SnapshotScore;
  /** Bij "al in de verkoop": de verwachte drukte van vlak vóór de verkoop. */
  rushFinal?: FrozenRush;
  /** Compacte geschiedenis van de score die bij het tabblad hoort (hooguit één punt per run waarin iets veranderde). */
  history: { at: string; score: number }[];
  trend: Trend | null;
  conflicts: Conflict[];
  /** Gezet als een bron van deze datum bij de laatste run niet bereikbaar was. */
  stale?: { since: string; message: string };
}

/** Een openbaar cijfer met bron, voor de detailpagina. */
export interface SourcedNumber {
  value: number;
  /** Moment van de meting of controle (UTC ISO). */
  at: string;
  source: SourceRef;
}

export interface ChartEntry {
  chart: string;
  country: string;
  title: string;
  kind: 'album' | 'single';
  peak: number;
  year: number;
  source: SourceRef;
}

/** Openbare cijfers over een artiest of evenement. */
export interface ArtistPopularity {
  /** Luisteraars op Last.fm, wereldwijd. */
  lastfmListeners?: SourcedNumber;
  /** Keer afgespeeld op Last.fm (scrobbles), wereldwijd. */
  lastfmPlaycount?: SourcedNumber;
  /** Groei van de Last.fm-luisteraars over ongeveer 90 dagen (0,1 = +10%), als er genoeg metingen zijn. */
  lastfmGrowth90d?: number;
  /** Positie in de Last.fm-toplijst per land (alleen recente metingen). */
  lastfmRanks?: { country: string; rank: number; at: string }[];
  /**
   * YouTube-kanaal (alleen weergave, niet in de score: de YouTube-voorwaarden verbieden afgeleide
   * maten uit API-data en het langer dan 30 dagen bewaren van statistieken).
   */
  youtube?: { subscribers?: number; views?: number; at: string; url?: string };
  /** Overige openbare cijfers uit de seeds, bijv. maandelijkse luisteraars op Spotify volgens een bron. */
  other?: { label: string; value: number; at: string; source: SourceRef }[];
  charts?: ChartEntry[];
}

/** Een eerder bezoek (vorige tour) of een eerdere editie. */
export interface PastVisit {
  tour?: string;
  year: number;
  date?: string;
  city?: string;
  country?: string;
  venue?: string;
  capacity?: number;
  shows?: number;
  soldOut?: boolean;
  /** Deel van de kaarten dat verkocht werd (0–1). */
  sellThrough?: number;
  /** Binnen hoeveel uur uitverkocht, of binnen hoeveel uur `sellThrough` bereikt was. */
  withinHours?: number;
  detail?: string;
  sources: SourceRef[];
}

export interface SnapshotArtist extends Artist {
  popularity?: ArtistPopularity;
}

export interface SnapshotTour extends Tour {
  /** Eerdere bezoeken van de artiest (vorige tour), per stad of land. */
  previousVisits?: PastVisit[];
  /** Eerdere edities (festivals en terugkerende evenementen). */
  previousEditions?: PastVisit[];
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
  kind: 'extra_show' | 'new_phase' | 'sale_date' | 'score_jump' | 'soldout' | 'new_event' | 'conflict' | 'sale_started';
  eventIds: string[];
  phaseId?: string;
  text: string;
}

/** Een vergelijking "verwachte drukte vooraf ↔ wat er gebeurde", voor de pagina Nauwkeurigheid. */
export interface RushCheck {
  eventId: string;
  title: string;
  localDate?: string;
  predicted: number;
  label: string;
  result: 'busy' | 'calm';
  speed?: SpeedClass;
  resolvedAt: string;
}

export interface Snapshot {
  schemaVersion: number;
  generatedAt: string;
  runId?: string;
  /** Het model van de uitverkoopkans (oud veld, voor oudere apps). */
  model: { version: string; outcomesUsed: number };
  models?: Record<ScoreKind, { version: string; outcomesUsed: number }>;
  artists: SnapshotArtist[];
  tours: SnapshotTour[];
  venues: Venue[];
  events: SnapshotEvent[];
  phases: SalePhase[];
  sources: SourceHealth[];
  changes: ChangeLogEntry[];
  /** Nauwkeurigheid van de uitverkoopkans. */
  accuracy?: AccuracySummary;
  /** Nauwkeurigheid van de verwachte drukte, met de laatste vergelijkingen. */
  rushAccuracy?: AccuracySummary & { recent: RushCheck[] };
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
