/**
 * Domeinmodel van Sellout Radar.
 *
 * Twee principes lopen overal doorheen:
 *  1. Elke tijd heeft een expliciete precisie. "Onbekend" blijft onbekend; we raden nooit een datum of uur.
 *  2. Elke waarde is herleidbaar tot een bron (SourceRef) met het tijdstip van ophalen.
 */

export type EventType = 'concert' | 'festival' | 'sport' | 'theatre' | 'comedy' | 'other';

/** Hoe nauwkeurig een tijdstip bekend is. */
export type Precision = 'exact' | 'date' | 'month' | 'unknown';

/** Een moment met expliciete precisie. */
export interface TimePoint {
  precision: Precision;
  /** IANA-tijdzone waarin localDate/localMonth gelden (meestal die van de venue of markt). */
  tz: string;
  /** ISO-8601 UTC-tijdstip; alleen bij precision 'exact'. */
  utc?: string;
  /** Lokale kalenderdatum YYYY-MM-DD; bij 'exact' en 'date'. */
  localDate?: string;
  /** Lokale maand YYYY-MM; bij 'month'. */
  localMonth?: string;
}

/** Soort bron; bepaalt de voorrang bij conflicten (lager = gezaghebbender). */
export type SourceKind =
  | 'artist'
  | 'promoter'
  | 'venue'
  | 'ticketing'
  | 'official_store'
  | 'news'
  | 'fansite'
  | 'aggregator'
  | 'manual';

export interface SourceRef {
  name: string;
  kind: SourceKind;
  url?: string;
  /** ISO UTC-tijdstip waarop de bron is opgehaald of gecontroleerd. */
  fetchedAt: string;
}

export type EventStatus = 'announced' | 'onsale' | 'few_left' | 'soldout' | 'cancelled' | 'postponed';
export type Fandom = 'organized' | 'regular' | 'unknown';

export interface Artist {
  id: string;
  name: string;
  aliases?: string[];
  genres?: string[];
  fandom?: Fandom;
  externalIds?: Record<string, string>;
}

export interface Tour {
  id: string;
  artistId: string;
  name: string;
  leg?: string;
  announcedAt?: string;
  farewell?: boolean;
  reunion?: boolean;
  comeback?: boolean;
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  tz: string;
  capacity?: number;
  capacitySource?: string;
  outdoor?: boolean;
  lat?: number;
  lon?: number;
}

export interface EventDate {
  id: string;
  title: string;
  type: EventType;
  artistIds: string[];
  tourId?: string;
  venueId: string;
  date: TimePoint;
  status: EventStatus;
  /** Toegevoegd na de eerste aankondiging, bijvoorbeeld wegens grote vraag. */
  addedShow?: boolean;
  addedShowReason?: string;
  priceRange?: { min?: number; max?: number; currency: string };
  ticketLimit?: number | null;
  officialSellers?: { name: string; url?: string }[];
  /** 'unconfirmed' als alleen niet-officiële bronnen deze datum noemen. */
  verification: 'official' | 'unconfirmed';
  sources: SourceRef[];
  notes?: string[];
}

export type PhaseKind = 'registration' | 'presale' | 'general_sale' | 'lottery';
export type PhaseType =
  | 'artist'
  | 'fanclub'
  | 'ticketmaster'
  | 'livenation'
  | 'venue'
  | 'spotify'
  | 'card'
  | 'artist_store'
  | 'promoter'
  | 'other';

export interface SalePhase {
  id: string;
  kind: PhaseKind;
  type?: PhaseType;
  name: string;
  /** Markt of regio waarvoor de fase geldt, bijv. 'EU', 'NA', 'NL'. */
  region?: string;
  eventIds: string[];
  start: TimePoint;
  end?: TimePoint;
  /** Bij een inschrijving of loting: de deadline. */
  deadline?: TimePoint;
  /** Bij een loting: wanneer de uitslag bekend wordt. */
  drawAt?: TimePoint;
  requiresCode?: boolean | null;
  whereToRegister?: string;
  conditions?: string;
  url?: string;
  /** Een inschrijving verwijst naar de presale die ze ontsluit. */
  unlocksPhaseId?: string;
  ticketLimit?: number | null;
  /** Toelichting voor in de app, bijv. een fout in een bron of een onzekere tijd. */
  notes?: string[];
  sources: SourceRef[];
}

/** Eén bewering van één bron over één veld. */
export interface Claim<T = unknown> {
  entity: string;
  field: string;
  value: T;
  source: SourceRef;
  /** Letterlijk tekstfragment waarop de bewering steunt (verplicht bij LLM-extractie). */
  evidence?: string;
}

/** Een conflict dat de app moet tonen. */
export interface Conflict {
  entity: string;
  field: string;
  chosen: unknown;
  alternatives: { value: unknown; source: SourceRef }[];
  reason: string;
}

export interface Observation {
  entity: string;
  metric: string;
  value: number | string | boolean;
  dimension?: string;
  source: SourceRef;
  observedAt: string;
}
