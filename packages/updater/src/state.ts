import {
  DEFAULT_MODELS,
  usableModel,
  type Artist,
  type ChangeLogEntry,
  type ChangeSnapshot,
  type Claim,
  type ConfidenceLevel,
  type Conflict,
  type Observation,
  type OutcomeRecord,
  type SalePhase,
  type ScoreKind,
  type ScoreModel,
  type SourceHealth,
} from '@sellout/core';
import type { CatalogEvent, CatalogTour, CatalogVenue } from './catalog';

export interface ScorePoint {
  /** Welke score: verwachte drukte ('rush') of uitverkoopkans ('sellout'). Ontbreekt bij oude punten. */
  kind?: ScoreKind;
  at: string;
  score: number;
  probability: number;
  confidence: ConfidenceLevel;
  /** Gewogen dekking 0..1. */
  coverage?: number;
  modelVersion: string;
  /** c·s per factor, voor latere kalibratie. */
  features: number[];
}

/** De laatste verwachte drukte van vóór de eerste verkoop, bewaard bij de overgang. */
export interface FrozenRushState {
  at: string;
  score: number;
  probability: number;
  confidence: ConfidenceLevel;
  coverage?: number;
  modelVersion: string;
  features: number[];
  /** Eerste verkoopmoment (UTC ISO). */
  firstSaleAt: string;
  /** Run waarin de overgang werd gezien. */
  frozenAt: string;
}

export interface SerializedCatalog {
  artists: Artist[];
  tours: CatalogTour[];
  venues: CatalogVenue[];
  events: CatalogEvent[];
  phases: SalePhase[];
}

/** Alles wat de updater tussen runs onthoudt. */
export interface State {
  version: 2;
  updatedAt?: string;
  /** Catalogus van de vorige run, inclusief wat bronnen zelf hebben gevonden. */
  catalog: SerializedCatalog;
  /** Beweringen van bronnen (de seed-beweringen worden elke run opnieuw uit de bestanden gelezen). */
  claims: Claim[];
  conflicts: Conflict[];
  /** Metingen, alleen bij verandering opgeslagen. */
  observations: Observation[];
  /** Scoregeschiedenis per datum; elk punt zegt welke score het is. */
  scoreHistory: Record<string, ScorePoint[]>;
  /** Uitkomsten voor de uitverkoopkans. */
  outcomes: OutcomeRecord[];
  /** Uitkomsten voor de verwachte drukte (bewaarde drukte ↔ binnen een dag uitverkocht). */
  rushOutcomes: OutcomeRecord[];
  models: Record<ScoreKind, ScoreModel>;
  lastCalibration?: Partial<Record<ScoreKind, { at: string; outcomes: number }>>;
  /** Bewaarde verwachte drukte per datum, vanaf het moment dat de verkoop begon. */
  rushFinal: Record<string, FrozenRushState>;
  /** Eerste run waarin een datum als uitverkocht werd gezien (als de bron geen tijdstip noemt). */
  soldOutSeen: Record<string, string>;
  /** Verstuurde pushmeldingen: sleutel → tijdstip. */
  sent: Record<string, string>;
  health: Record<string, SourceHealth>;
  /** Overige opslag: paginahashes, verwerkt nieuws, caches van setlist.fm en Ticketmaster-ID's. */
  kv: Record<string, unknown>;
  changes: ChangeLogEntry[];
  lastChangeSnapshot?: ChangeSnapshot;
}

export function emptyState(): State {
  return {
    version: 2,
    catalog: { artists: [], tours: [], venues: [], events: [], phases: [] },
    claims: [],
    conflicts: [],
    observations: [],
    scoreHistory: {},
    outcomes: [],
    rushOutcomes: [],
    models: structuredClone(DEFAULT_MODELS),
    rushFinal: {},
    soldOutSeen: {},
    sent: {},
    health: {},
    kv: {},
    changes: [],
  };
}

/**
 * Zet een opgeslagen staat om naar het huidige formaat. Uit versie 1 (één score met negen factoren)
 * blijven catalogus, beweringen, metingen, meldingen en het logboek staan. De oude scoregeschiedenis en
 * uitkomsten passen niet bij de nieuwe factoren en vervallen; de twee eerdere uitkomsten waren bovendien
 * gemeten toen de datums al uitverkocht waren.
 */
export function migrateState(raw: Partial<State> & { model?: ScoreModel; version?: number }): State {
  const s = { ...emptyState(), ...raw } as State & { model?: ScoreModel };
  if ((raw.version ?? 1) < 2) {
    s.version = 2;
    s.scoreHistory = {};
    s.outcomes = [];
    s.rushOutcomes = [];
    s.lastCalibration = undefined;
    // Het wijzigingsmoment-overzicht kende nog geen tabbladen; laat het opnieuw opbouwen.
    s.lastChangeSnapshot = undefined;
  }
  s.models = {
    rush: usableModel('rush', raw.models?.rush),
    sellout: usableModel('sellout', raw.models?.sellout),
  };
  delete s.model;
  s.rushFinal ??= {};
  s.soldOutSeen ??= {};
  s.rushOutcomes ??= [];
  return s;
}

export function serializeCatalog(c: { artists: Map<string, Artist>; tours: Map<string, CatalogTour>; venues: Map<string, CatalogVenue>; events: Map<string, CatalogEvent>; phases: Map<string, SalePhase> }): SerializedCatalog {
  return {
    artists: [...c.artists.values()],
    tours: [...c.tours.values()],
    venues: [...c.venues.values()],
    events: [...c.events.values()],
    phases: [...c.phases.values()],
  };
}

/** Wat er in deze run is bijgekomen; de Supabase-opslag schrijft alleen dit weg. */
export interface RunDelta {
  claims: Claim[];
  observations: Observation[];
  scorePoints: { eventId: string; point: ScorePoint; factors: unknown; explanation: unknown }[];
  outcomes: OutcomeRecord[];
  changes: ChangeLogEntry[];
  sent: { key: string; userId: string; kind: string; eventIds: string[]; phaseId?: string; idealAt: string; sendAt: string; title: string; body: string }[];
  documents: { sourceName: string; url: string; fetchedAt: string; hash: string }[];
  externalIds: { entity: string; source: string; externalId: string }[];
  /** Welke modellen deze run zijn bijgesteld. */
  modelsChanged: ScoreKind[];
}

export function emptyDelta(): RunDelta {
  return { claims: [], observations: [], scorePoints: [], outcomes: [], changes: [], sent: [], documents: [], externalIds: [], modelsChanged: [] };
}

/** YouTube-statistieken mogen zonder toestemming van de kanaaleigenaar niet langer dan 30 dagen bewaard worden. */
export const YOUTUBE_RETENTION_DAYS = 30;

export function isYouTubeObservation(o: Pick<Observation, 'metric'>): boolean {
  return o.metric.startsWith('youtube_');
}

/** Houdt de opslag klein: oude beweringen, metingen en meldingssleutels gaan eruit. */
export function pruneState(s: State, now: string): void {
  const cutoff = (days: number) => new Date(Date.parse(now) - days * 86_400_000).toISOString();
  const c180 = cutoff(180);
  const yt = cutoff(YOUTUBE_RETENTION_DAYS);
  s.claims = s.claims.filter((c) => c.source.fetchedAt >= c180);
  s.observations = s.observations.filter((o) => o.observedAt >= (isYouTubeObservation(o) ? yt : c180));
  const c60 = cutoff(60);
  s.changes = s.changes.filter((c) => c.at >= c60);
  for (const [k, v] of Object.entries(s.sent)) if (v < c60) delete s.sent[k];
  for (const [id, pts] of Object.entries(s.scoreHistory)) {
    s.scoreHistory[id] = pts.slice(-150);
  }
}
