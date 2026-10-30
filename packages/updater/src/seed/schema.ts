import type { EventStatus, EventType, Fandom, PhaseKind, PhaseType, SourceKind } from '@sellout/core';

/**
 * Formaat van de seedbestanden in data/seed/*.json: handmatig gecontroleerde startdata.
 * Eén bestand per tour of evenement. Elke datum en fase verwijst naar bronnen; tijden
 * die niet in een bron staan, worden weggelaten ("nog niet bekend").
 *
 * Tijdnotatie: "2026-11-02T10:00" (lokale tijd, exact), "2026-11-04" (alleen datum),
 * "2027-04" (alleen maand) of weglaten/null (onbekend).
 */

export interface SeedSource {
  name: string;
  kind: SourceKind;
  url?: string;
  /** Wanneer de bron is gecontroleerd (ISO-datum of -tijd, UTC). */
  checked: string;
  note?: string;
}

export interface SeedArtist {
  id: string;
  name: string;
  aliases?: string[];
  genres?: string[];
  fandom?: Fandom;
  externalIds?: Record<string, string>;
}

export interface SeedTour {
  id: string;
  name: string;
  leg?: string;
  announcedAt?: string;
  farewell?: boolean;
  reunion?: boolean;
  comeback?: boolean;
  /** Aantal shows dat expliciet wegens vraag is toegevoegd (over de hele tour). */
  addedForDemand?: number;
  addedForDemandSources?: string[];
  /** Nieuwe release rond de verkoop (YYYY-MM-DD). */
  releaseDate?: string;
  releaseSources?: string[];
  /**
   * Uitverkochte shows van dezelfde tour die niet als aparte datum in de app staan
   * (bijv. al gespeelde shows van een eerdere leg).
   */
  soldOutElsewhere?: { city: string; country: string; count: number; capacity?: number; sources: string[] }[];
  /**
   * Standaard voor de datums: 'official' als de tour door de artiest of promotor is aangekondigd,
   * ook als de bron een nieuwsbericht over die aankondiging is.
   */
  verification?: 'official' | 'unconfirmed';
}

export interface SeedVenue {
  name: string;
  city: string;
  country: string;
  tz: string;
  capacity?: number;
  capacitySource?: string;
  outdoor?: boolean;
  lat?: number;
  lon?: number;
}

export interface SeedPreviousVisit {
  capacity?: number;
  soldOut?: boolean;
  yearsAgo?: number;
  scope: 'city' | 'country';
  venueName?: string;
  place?: string;
  sources: string[];
}

export interface SeedEventInputs {
  previousVisit?: SeedPreviousVisit;
  yearsSinceLastVisit?: number;
  fewTicketsLeft?: boolean;
  priceVsComparable?: number;
}

export interface SeedEvent {
  /** Sleutel van de venue in `venues`. */
  venue: string;
  /** Lokale datum YYYY-MM-DD. */
  date: string;
  /** Lokale aanvangstijd HH:mm, alleen als een bron die noemt. */
  time?: string;
  title?: string;
  status?: EventStatus;
  /** Bij uitverkocht: wanneer en hoe snel, als een bron dat noemt. */
  soldOutAt?: string;
  soldOutInPresale?: boolean;
  addedShow?: boolean;
  addedShowReason?: string;
  verification?: 'official' | 'unconfirmed';
  priceRange?: { min?: number; max?: number; currency: string };
  ticketLimit?: number | null;
  officialSellers?: { name: string; url?: string }[];
  notes?: string[];
  sources: string[];
  inputs?: SeedEventInputs;
}

export type SeedEventSelector =
  | 'all'
  | string[]
  | { cities?: string[]; exceptCities?: string[]; countries?: string[]; exceptCountries?: string[]; venues?: string[] };

export interface SeedPhase {
  key: string;
  kind: PhaseKind;
  type?: PhaseType;
  name: string;
  region?: string;
  /** Voor welke datums: 'all', een lijst "YYYY-MM-DD@venue", of een filter op stad/land/venue. */
  events: SeedEventSelector;
  start?: string | null;
  end?: string | null;
  deadline?: string | null;
  drawAt?: string | null;
  /** 'venue' (standaard): tijden gelden lokaal per venue; anders een IANA-zone. */
  tz?: string;
  requiresCode?: boolean | null;
  whereToRegister?: string;
  conditions?: string;
  url?: string;
  /** Sleutel van de fase die deze inschrijving ontsluit. */
  unlocks?: string;
  ticketLimit?: number | null;
  notes?: string[];
  sources: string[];
}

export interface SeedClaim {
  /** "YYYY-MM-DD@venue" van de datum, of "phase:<key>". */
  target: string;
  field: string;
  value: unknown;
  source: string;
  evidence?: string;
}

export interface SeedFile {
  artist: SeedArtist;
  /** Extra artiesten (co-headliners, festival-line-up). */
  artists?: SeedArtist[];
  tour: SeedTour;
  type: EventType;
  /** Titel per datum; standaard "<artiest> · <stad>". */
  titleTemplate?: string;
  sources: Record<string, SeedSource>;
  venues: Record<string, SeedVenue>;
  events: SeedEvent[];
  phases?: SeedPhase[];
  claims?: SeedClaim[];
  notes?: string[];
}
