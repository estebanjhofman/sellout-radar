import { DateTime } from 'luxon';
import type { SalePhase, TimePoint } from './types';
import { earliestInstant, isKnown } from './time';

/**
 * "Zet in agenda": een .ics-bestand per fase. Werkt met Apple Agenda, Google Agenda en Outlook.
 * Exact tijdstip → afspraak van 30 minuten in UTC; alleen datum → hele-dag-afspraak.
 * Onbekend → geen agenda-item (we zetten nooit een geraden datum in je agenda).
 */

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Vouwt regels op 75 bytes zoals RFC 5545 vraagt. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const utcStamp = (dt: DateTime) => dt.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");

export interface IcsInput {
  phase: SalePhase;
  /** Welk moment van de fase: start of (bij inschrijving) deadline. */
  role: 'start' | 'deadline';
  title: string;
  description?: string;
  url?: string;
  now: string;
  /** Herinnering in minuten vooraf (standaard 60). */
  alarmMinutes?: number;
}

export function phaseToIcs(inp: IcsInput): string | null {
  const tp: TimePoint | undefined = inp.role === 'deadline' ? inp.phase.deadline ?? inp.phase.end : inp.phase.start;
  if (!isKnown(tp) || tp.precision === 'month') return null;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sellout Radar//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${inp.phase.id}-${inp.role}@selloutradar`,
    `DTSTAMP:${utcStamp(DateTime.fromISO(inp.now))}`,
  ];
  if (tp.precision === 'exact') {
    const start = earliestInstant(tp)!;
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(start.plus({ minutes: 30 }))}`);
  } else {
    const d = DateTime.fromISO(tp.localDate!);
    lines.push(`DTSTART;VALUE=DATE:${d.toFormat('yyyyLLdd')}`, `DTEND;VALUE=DATE:${d.plus({ days: 1 }).toFormat('yyyyLLdd')}`);
  }
  lines.push(`SUMMARY:${esc(inp.title)}`);
  const desc = [inp.description, tp.precision === 'date' ? 'Tijd nog niet bekend.' : undefined].filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  if (inp.url) lines.push(`URL:${inp.url}`);
  // Hele-dag-item: herinnering de dag ervoor om 12:00; exact: een uur vooraf.
  const alarm = inp.alarmMinutes ?? (tp.precision === 'exact' ? 60 : 720);
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(inp.title)}`,
    `TRIGGER:-PT${alarm}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.map(fold).join('\r\n') + '\r\n';
}

/**
 * Hetzelfde agenda-item als link naar Google Agenda (voor het web, waar een download niet
 * overal mag). Zelfde regels: exact → 30 minuten, alleen datum → hele dag, onbekend → null.
 */
export function phaseToGoogleCalendarUrl(inp: Omit<IcsInput, 'now' | 'alarmMinutes'>): string | null {
  const tp: TimePoint | undefined = inp.role === 'deadline' ? inp.phase.deadline ?? inp.phase.end : inp.phase.start;
  if (!isKnown(tp) || tp.precision === 'month') return null;
  let dates: string;
  if (tp.precision === 'exact') {
    const start = earliestInstant(tp)!;
    dates = `${utcStamp(start)}/${utcStamp(start.plus({ minutes: 30 }))}`;
  } else {
    const d = DateTime.fromISO(tp.localDate!);
    dates = `${d.toFormat('yyyyLLdd')}/${d.plus({ days: 1 }).toFormat('yyyyLLdd')}`;
  }
  const details = [inp.description, tp.precision === 'date' ? 'Tijd nog niet bekend.' : undefined, inp.url].filter(Boolean).join('\n');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: inp.title, dates, ...(details ? { details } : {}) });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
