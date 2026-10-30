import type { Claim, EventStatus, EventType, Observation, PhaseKind, PhaseType, SourceKind, SourceRef, TimePoint } from '@sellout/core';
import type { Catalog } from '../catalog';
import type { Config } from '../config';
import type { Fetcher } from '../http';
import type { State } from '../state';

/** Een datum zoals een bron die aanlevert, nog niet gekoppeld aan de catalogus. */
export interface DiscoveredEvent {
  artistName: string;
  /** Externe ID van de artiest bij deze bron, bijv. Ticketmaster-attractie-ID. */
  artistExternalId?: string;
  tourName?: string;
  title?: string;
  type: EventType;
  venue: {
    name: string;
    city: string;
    country: string;
    tz?: string;
    lat?: number;
    lon?: number;
    externalId?: string;
  };
  localDate: string;
  localTime?: string;
  /** Alleen gezet als de bron het zeker weet; 'onsale' gebruiken we niet als beschikbaarheidsclaim. */
  status?: Extract<EventStatus, 'soldout' | 'cancelled' | 'postponed' | 'few_left'>;
  addedShow?: boolean;
  url?: string;
  priceRange?: { min?: number; max?: number; currency: string };
  ticketLimit?: number;
  officialSeller?: { name: string; url?: string };
  phases: DiscoveredPhase[];
  source: SourceRef;
  externalId?: string;
  /** Letterlijk bewijsfragment (bij extractie uit tekst). */
  evidence?: string;
  notes?: string[];
}

export interface DiscoveredPhase {
  kind: PhaseKind;
  type?: PhaseType;
  name: string;
  region?: string;
  start: TimePoint;
  end?: TimePoint;
  deadline?: TimePoint;
  url?: string;
  requiresCode?: boolean | null;
  whereToRegister?: string;
  ticketLimit?: number;
  conditions?: string;
  evidence?: string;
  notes?: string[];
}

export interface ConnectorContext {
  cfg: Config;
  http: Fetcher;
  now: string;
  state: State;
  catalog: Catalog;
  log: (msg: string) => void;
}

export interface ConnectorResult {
  name: string;
  kind: SourceKind | 'api';
  ok: boolean;
  /** Niet ingesteld (geen sleutel): geen fout, maar wel zichtbaar in de app. */
  skipped?: boolean;
  message?: string;
  claims: Claim[];
  observations: Observation[];
  discovered: DiscoveredEvent[];
  /** Fases die bij data van een artiest horen maar niet aan één datum vastzitten (uit tekstextractie). */
  loosePhases: LoosePhase[];
  documents: { url: string; hash: string }[];
  externalIds: { entity: string; source: string; externalId: string }[];
  /** Entiteiten waarvoor deze bron data levert (voor "laatst bekende data"-waarschuwingen). */
  coveredEventIds?: string[];
  llmCalls?: number;
}

export interface LoosePhase {
  artistName: string;
  tourName?: string;
  /** Steden waarvoor de fase geldt; leeg = alle (toekomstige) data van de artiest in de regio. */
  cities: string[];
  region?: string;
  phase: DiscoveredPhase;
  source: SourceRef;
}

export function emptyResult(name: string, kind: ConnectorResult['kind']): ConnectorResult {
  return { name, kind, ok: true, claims: [], observations: [], discovered: [], loosePhases: [], documents: [], externalIds: [] };
}

export interface Connector {
  name: string;
  kind: ConnectorResult['kind'];
  run(ctx: ConnectorContext): Promise<ConnectorResult>;
}
