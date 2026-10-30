import type { Artist, ChartEntry, Claim, Conflict, EventDate, Observation, PastVisit, SalePhase, SourceRef, Tour, Venue } from '@sellout/core';
import type { SeedEventInputs } from './seed/schema';

/** Een datum met extra velden die de updater gebruikt (niet allemaal in het snapshot). */
export interface CatalogEvent extends EventDate {
  localTime?: string;
  soldOutAt?: string;
  soldOutInPresale?: boolean;
  inputs?: SeedEventInputs;
  /** Externe ID's, bijv. { ticketmaster: 'Z698xZq2Z17...' }. */
  externalIds?: Record<string, string>;
  /** Eerste keer gezien (UTC ISO). */
  firstSeenAt?: string;
}

export interface CatalogTour extends Tour {
  addedForDemand?: number;
  releaseDate?: string;
  soldOutElsewhere?: { city: string; country: string; count: number; capacity?: number }[];
  /** Bronnen voor de tourkenmerken hierboven. */
  sources?: SourceRef[];
  /** Vorige tour van de artiest, per stad of land (uit de seeds, met bron). */
  previousVisits?: PastVisit[];
  /** Vorige edities van een festival of terugkerend evenement (uit de seeds, met bron). */
  previousEditions?: PastVisit[];
}

/** Gegevens over een artiest die niet als meting binnenkomen (uit de seeds, met bron). */
export interface ArtistFacts {
  charts: ChartEntry[];
  other: { label: string; value: number; at: string; source: SourceRef }[];
}

export interface CatalogVenue extends Venue {
  externalIds?: Record<string, string>;
}

export interface Catalog {
  artists: Map<string, Artist>;
  tours: Map<string, CatalogTour>;
  venues: Map<string, CatalogVenue>;
  events: Map<string, CatalogEvent>;
  phases: Map<string, SalePhase>;
  claims: Claim[];
  conflicts: Conflict[];
  /** Metingen uit de seeds (bijv. Last.fm-luisteraars op de controledatum); elke run opnieuw ingelezen. */
  observations: Observation[];
  facts: Map<string, ArtistFacts>;
}

export function emptyCatalog(): Catalog {
  return {
    artists: new Map(),
    tours: new Map(),
    venues: new Map(),
    events: new Map(),
    phases: new Map(),
    claims: [],
    conflicts: [],
    observations: [],
    facts: new Map(),
  };
}

/** Diepe kopie zodat bewerkingen in een run de opgeslagen staat niet raken. */
export function cloneCatalog(c: Catalog): Catalog {
  return {
    artists: new Map([...c.artists].map(([k, v]) => [k, structuredClone(v)])),
    tours: new Map([...c.tours].map(([k, v]) => [k, structuredClone(v)])),
    venues: new Map([...c.venues].map(([k, v]) => [k, structuredClone(v)])),
    events: new Map([...c.events].map(([k, v]) => [k, structuredClone(v)])),
    phases: new Map([...c.phases].map(([k, v]) => [k, structuredClone(v)])),
    claims: c.claims.map((x) => structuredClone(x)),
    conflicts: c.conflicts.map((x) => structuredClone(x)),
    observations: (c.observations ?? []).map((x) => structuredClone(x)),
    facts: new Map([...(c.facts ?? new Map())].map(([k, v]) => [k, structuredClone(v)])),
  };
}
