import {
  DEFAULT_MODEL,
  type Artist,
  type ChangeLogEntry,
  type ChangeSnapshot,
  type Claim,
  type ConfidenceLevel,
  type Conflict,
  type Observation,
  type OutcomeRecord,
  type SalePhase,
  type ScoreModel,
  type SourceHealth,
} from '@sellout/core';
import type { Catalog, CatalogEvent, CatalogTour, CatalogVenue } from './catalog';

export interface ScorePoint {
  at: string;
  score: number;
  probability: number;
  confidence: ConfidenceLevel;
  modelVersion: string;
  /** c·s per factor (9 waarden), voor latere kalibratie. */
  features: number[];
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
  version: 1;
  updatedAt?: string;
  /** Catalogus van de vorige run, inclusief wat bronnen zelf hebben gevonden. */
  catalog: SerializedCatalog;
  /** Beweringen van bronnen (de seed-beweringen worden elke run opnieuw uit de bestanden gelezen). */
  claims: Claim[];
  conflicts: Conflict[];
  /** Metingen, alleen bij verandering opgeslagen. */
  observations: Observation[];
  scoreHistory: Record<string, ScorePoint[]>;
  outcomes: OutcomeRecord[];
  model: ScoreModel;
  lastCalibration?: { at: string; outcomes: number };
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
    version: 1,
    catalog: { artists: [], tours: [], venues: [], events: [], phases: [] },
    claims: [],
    conflicts: [],
    observations: [],
    scoreHistory: {},
    outcomes: [],
    model: structuredClone(DEFAULT_MODEL),
    sent: {},
    health: {},
    kv: {},
    changes: [],
  };
}

export function serializeCatalog(c: Catalog): SerializedCatalog {
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
  modelChanged: boolean;
}

export function emptyDelta(): RunDelta {
  return { claims: [], observations: [], scorePoints: [], outcomes: [], changes: [], sent: [], documents: [], externalIds: [], modelChanged: false };
}

/** Houdt de opslag klein: oude beweringen, metingen en meldingssleutels gaan eruit. */
export function pruneState(s: State, now: string): void {
  const cutoff = (days: number) => new Date(Date.parse(now) - days * 86_400_000).toISOString();
  const c180 = cutoff(180);
  s.claims = s.claims.filter((c) => c.source.fetchedAt >= c180);
  s.observations = s.observations.filter((o) => o.observedAt >= c180);
  const c60 = cutoff(60);
  s.changes = s.changes.filter((c) => c.at >= c60);
  for (const [k, v] of Object.entries(s.sent)) if (v < c60) delete s.sent[k];
  for (const [id, pts] of Object.entries(s.scoreHistory)) {
    s.scoreHistory[id] = pts.slice(-150);
  }
}
