import Anthropic from '@anthropic-ai/sdk';
import { DateTime } from 'luxon';
import {
  dateMentioned,
  dateOnly,
  exactLocal,
  findWeekdayMismatches,
  normalizeName,
  normalizeText,
  verifyTimePoint,
  type EventType,
  type PhaseKind,
  type SourceRef,
  type TimePoint,
} from '@sellout/core';
import type { Catalog } from '../catalog';
import type { DiscoveredEvent, DiscoveredPhase } from '../connectors/types';

/**
 * Extractie van aankondigingen uit vrije tekst met een taalmodel, gevolgd door een harde
 * controle: elk item moet een letterlijk citaat uit de tekst als bewijs hebben, en elke datum
 * en tijd moet in dat citaat staan. Wat niet te controleren is, wordt verworpen of teruggezet
 * naar een lagere precisie. Zo kan het model geen verkoopdata verzinnen.
 */

export interface RawShow {
  artist: string;
  tour: string;
  event_type: 'concert' | 'festival' | 'sport' | 'theatre' | 'comedy' | 'other';
  city: string;
  country: string;
  venue: string;
  date: string;
  status: 'announced' | 'soldout' | 'added' | 'cancelled' | 'postponed' | 'unknown';
  evidence: string;
}

export interface RawPhase {
  artist: string;
  tour: string;
  kind: PhaseKind;
  name: string;
  region: string;
  cities: string[];
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  deadline_date: string;
  deadline_time: string;
  time_zone: string;
  where_to_register: string;
  requires_code: 'yes' | 'no' | 'unknown';
  ticket_limit: string;
  evidence: string;
}

export interface RawExtraction {
  shows: RawShow[];
  phases: RawPhase[];
}

export interface Extractor {
  extract(input: { text: string; source: SourceRef; publishedAt?: string }): Promise<RawExtraction>;
}

const str = { type: 'string' } as const;

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    shows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          artist: str,
          tour: str,
          event_type: { type: 'string', enum: ['concert', 'festival', 'sport', 'theatre', 'comedy', 'other'] },
          city: str,
          country: str,
          venue: str,
          date: str,
          status: { type: 'string', enum: ['announced', 'soldout', 'added', 'cancelled', 'postponed', 'unknown'] },
          evidence: str,
        },
        required: ['artist', 'tour', 'event_type', 'city', 'country', 'venue', 'date', 'status', 'evidence'],
        additionalProperties: false,
      },
    },
    phases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          artist: str,
          tour: str,
          kind: { type: 'string', enum: ['registration', 'presale', 'general_sale', 'lottery'] },
          name: str,
          region: str,
          cities: { type: 'array', items: str },
          start_date: str,
          start_time: str,
          end_date: str,
          end_time: str,
          deadline_date: str,
          deadline_time: str,
          time_zone: str,
          where_to_register: str,
          requires_code: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          ticket_limit: str,
          evidence: str,
        },
        required: [
          'artist', 'tour', 'kind', 'name', 'region', 'cities', 'start_date', 'start_time', 'end_date', 'end_time',
          'deadline_date', 'deadline_time', 'time_zone', 'where_to_register', 'requires_code', 'ticket_limit', 'evidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['shows', 'phases'],
  additionalProperties: false,
} as const;

export function systemPrompt(publishedAt?: string): string {
  return [
    'You extract ticket information for concerts, festivals, sports events, theatre and comedy from one text.',
    'Rules:',
    '- Only report facts that are literally stated in the text. Never guess, infer or complete dates, times or venues.',
    '- Use an empty string for anything the text does not state.',
    '- "evidence" must be an exact, verbatim quote from the text (at most 300 characters) that contains the date and, if given, the time of that item.',
    `- Dates as YYYY-MM-DD. If the text gives no year, use the next occurrence after the publication date${publishedAt ? ` (${publishedAt.slice(0, 10)})` : ''}.`,
    '- Times as 24-hour HH:mm, exactly as stated (convert "10am" to 10:00). Do not convert between time zones.',
    '- time_zone: an IANA zone only if the text states the zone (e.g. "ET" -> America/New_York, "CET" -> Europe/Paris, "GMT" -> Europe/London) or says "local time" for a single city. Otherwise empty.',
    '- country: ISO 3166-1 alpha-2 code.',
    '- kind: registration = signing up for a presale code or a ballot; presale = a sale before the general sale; general_sale = sale to everyone; lottery = ballot with a draw.',
    '- status "added" means the text says the show was added (extra show); "soldout" only if the text says it sold out.',
    '- One show per date per city. One phase per sale moment; list the cities it applies to (empty if it applies to all listed shows).',
  ].join('\n');
}

export class ClaudeExtractor implements Extractor {
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extract({ text, publishedAt }: { text: string; source: SourceRef; publishedAt?: string }): Promise<RawExtraction> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 6000,
      system: systemPrompt(publishedAt),
      messages: [{ role: 'user', content: text.slice(0, 30_000) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return { shows: [], phases: [] };
    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return { shows: [], phases: [] };
    return JSON.parse(block.text) as RawExtraction;
  }
}

// ---------------------------------------------------------------------------
// Controle
// ---------------------------------------------------------------------------

/** Witruimte en aanhalingstekens gelijktrekken, voor het zoeken van citaten. */
export function canon(s: string): string {
  return normalizeText(s)
    .replace(/[‘’‚′`´]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteInText(evidence: string, text: string): boolean {
  const e = canon(evidence);
  return e.length >= 8 && canon(text).includes(e);
}

/** Tijdzone als het land er maar één heeft (anders onbekend). */
const COUNTRY_TZ: Record<string, string> = {
  NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', DE: 'Europe/Berlin', FR: 'Europe/Paris',
  GB: 'Europe/London', IE: 'Europe/Dublin', ES: 'Europe/Madrid', IT: 'Europe/Rome', AT: 'Europe/Vienna', CH: 'Europe/Zurich',
  DK: 'Europe/Copenhagen', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague', HU: 'Europe/Budapest', GR: 'Europe/Athens', HR: 'Europe/Zagreb', RS: 'Europe/Belgrade',
  RO: 'Europe/Bucharest', TR: 'Europe/Istanbul', KR: 'Asia/Seoul', JP: 'Asia/Tokyo', TW: 'Asia/Taipei', HK: 'Asia/Hong_Kong',
  SG: 'Asia/Singapore', TH: 'Asia/Bangkok', PH: 'Asia/Manila', AE: 'Asia/Dubai', NZ: 'Pacific/Auckland', AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima', MX: 'America/Mexico_City',
};
const PT_TZ = 'Europe/Lisbon';
COUNTRY_TZ.PT = PT_TZ;

/** Vroegste tijdzone ter wereld: een datum zonder zone gaat zo nooit te laat in. */
export const EARLIEST_TZ = 'Etc/GMT-14';

function validZone(tz: string): boolean {
  return !!tz && DateTime.now().setZone(tz).isValid;
}

export interface VerifiedExtraction {
  events: DiscoveredEvent[];
  loosePhases: { artistName: string; tourName?: string; cities: string[]; region?: string; phase: DiscoveredPhase; source: SourceRef }[];
  rejected: string[];
}

function cityTz(catalog: Catalog, city: string, country: string): string | undefined {
  const n = normalizeName(city);
  for (const v of catalog.venues.values()) if (normalizeName(v.city) === n && (!country || v.country === country)) return v.tz;
  return COUNTRY_TZ[country.toUpperCase()];
}

function buildTime(date: string, time: string, tz: string | undefined, evidence: string, label: string, rejected: string[]): TimePoint | undefined {
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) {
    rejected.push(`${label}: ongeldige datum "${date}"`);
    return undefined;
  }
  let tp: TimePoint;
  if (time && /^\d{1,2}:\d{2}$/.test(time) && tz) tp = exactLocal(date, time.padStart(5, '0'), tz);
  else tp = dateOnly(date, tz ?? EARLIEST_TZ);
  const check = verifyTimePoint(tp, evidence);
  for (const w of check.warnings) rejected.push(`${label}: ${w}`);
  return check.timePoint ?? undefined;
}

/** Zet ruwe extractie om in gecontroleerde ontdekkingen. */
export function verifyExtraction(raw: RawExtraction, text: string, source: SourceRef, catalog: Catalog): VerifiedExtraction {
  const out: VerifiedExtraction = { events: [], loosePhases: [], rejected: [] };
  for (const s of raw.shows ?? []) {
    const label = `${s.artist} ${s.city} ${s.date}`;
    if (!s.artist || !s.city || !s.date) continue;
    if (!quoteInText(s.evidence, text)) {
      out.rejected.push(`${label}: bewijs staat niet letterlijk in de tekst`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !dateMentioned(s.date, s.evidence)) {
      out.rejected.push(`${label}: datum staat niet in het bewijs`);
      continue;
    }
    const country = (s.country || '').toUpperCase();
    const tz = cityTz(catalog, s.city, country);
    const notes: string[] = [];
    for (const m of findWeekdayMismatches(s.evidence, Number(s.date.slice(0, 4)))) {
      if (m.date === s.date) notes.push(`De bron noemt "${m.text}", maar die weekdag klopt niet bij de datum.`);
    }
    out.events.push({
      artistName: s.artist,
      ...(s.tour ? { tourName: s.tour } : {}),
      type: (s.event_type || 'concert') as EventType,
      venue: { name: s.venue || 'Venue nog niet bekend', city: s.city, country, ...(tz ? { tz } : {}) },
      localDate: s.date,
      ...(s.status === 'soldout' || s.status === 'cancelled' || s.status === 'postponed' ? { status: s.status } : {}),
      ...(s.status === 'added' ? { addedShow: true } : {}),
      phases: [],
      source,
      evidence: s.evidence,
      ...(notes.length ? { notes } : {}),
    });
  }
  for (const p of raw.phases ?? []) {
    const label = `${p.artist} ${p.name}`;
    if (!p.artist) continue;
    if (!quoteInText(p.evidence, text)) {
      out.rejected.push(`${label}: bewijs staat niet letterlijk in de tekst`);
      continue;
    }
    // Tijdzone: expliciet uit de tekst, anders de zone van de steden (als die allemaal gelijk zijn).
    let tz = validZone(p.time_zone) ? p.time_zone : undefined;
    if (!tz) {
      const zones = new Set(
        (p.cities.length ? p.cities : out.events.filter((e) => normalizeName(e.artistName) === normalizeName(p.artist)).map((e) => e.venue.city))
          .map((c) => {
            const ev = out.events.find((e) => normalizeName(e.venue.city) === normalizeName(c));
            return ev?.venue.tz ?? cityTz(catalog, c, ev?.venue.country ?? '');
          })
          .filter(Boolean),
      );
      if (zones.size === 1) tz = [...zones][0];
    }
    const start = buildTime(p.start_date, p.start_time, tz, p.evidence, `${label} start`, out.rejected);
    const end = buildTime(p.end_date, p.end_time, tz, p.evidence, `${label} einde`, out.rejected);
    const deadline = buildTime(p.deadline_date, p.deadline_time, tz, p.evidence, `${label} deadline`, out.rejected);
    if (!start && !deadline) {
      // Fase zonder controleerbare datum: alleen bewaren als "nog niet bekend".
      if (p.start_date || p.deadline_date) continue;
    }
    const notes: string[] = [];
    const year = Number((p.start_date || p.deadline_date || DateTime.now().toISODate()!).slice(0, 4));
    for (const m of findWeekdayMismatches(p.evidence, year)) notes.push(`De bron noemt "${m.text}", maar die weekdag klopt niet bij de datum.`);
    if (!tz && (p.start_time || p.deadline_time)) notes.push('De bron noemt een tijd zonder tijdzone; daarom alleen de datum.');
    const limit = Number(p.ticket_limit);
    const phase: DiscoveredPhase = {
      kind: p.kind,
      name: p.name || (p.kind === 'general_sale' ? 'Algemene verkoop' : p.kind === 'registration' ? 'Inschrijving' : 'Presale'),
      ...(p.region ? { region: p.region } : {}),
      start: start ?? { precision: 'unknown', tz: tz ?? EARLIEST_TZ },
      ...(end ? { end } : {}),
      ...(deadline ? { deadline } : {}),
      ...(p.where_to_register ? { whereToRegister: p.where_to_register } : {}),
      requiresCode: p.requires_code === 'yes' ? true : p.requires_code === 'no' ? false : null,
      ...(Number.isFinite(limit) && limit > 0 && limit < 50 ? { ticketLimit: limit } : {}),
      evidence: p.evidence,
      ...(notes.length ? { notes } : {}),
    };
    out.loosePhases.push({ artistName: p.artist, ...(p.tour ? { tourName: p.tour } : {}), cities: p.cities ?? [], ...(p.region ? { region: p.region } : {}), phase, source });
  }
  return out;
}
