import * as Calendar from 'expo-calendar/legacy';
import { DateTime } from 'luxon';
import { earliestInstant, type SalePhase } from '@sellout/core';

export interface CalendarRequest {
  phase: SalePhase;
  role: 'start' | 'deadline';
  title: string;
  description: string;
  url?: string;
}

/** Op de iPhone gaat alles via de eigen agenda; een losse webagendalink is daar niet nodig. */
export function webCalendarLink(_req: CalendarRequest): string | null {
  return null;
}

/** De agendaknop werkt op de iPhone altijd (de app vraagt zelf om toestemming). */
export function canSaveCalendarFile(): boolean {
  return true;
}

/**
 * "Zet in agenda": opent het agendascherm van iOS met het verkoopmoment ingevuld.
 * Alleen een datum bekend: een hele-dag-item. Onbekend: niets (we raden geen data).
 */
export async function addToCalendar(req: CalendarRequest): Promise<string> {
  const tp = req.role === 'deadline' ? (req.phase.deadline ?? req.phase.end) : req.phase.start;
  if (!tp || (tp.precision !== 'exact' && tp.precision !== 'date')) return 'Dit moment is nog niet bekend.';
  let startDate: Date;
  let endDate: Date;
  let allDay = false;
  if (tp.precision === 'exact') {
    const s = earliestInstant(tp)!;
    startDate = s.toJSDate();
    endDate = s.plus({ minutes: 30 }).toJSDate();
  } else {
    const d = DateTime.fromISO(tp.localDate!);
    startDate = new Date(d.year, d.month - 1, d.day);
    endDate = new Date(d.year, d.month - 1, d.day + 1);
    allDay = true;
  }
  try {
    const r = await Calendar.createEventInCalendarAsync({
      title: req.title,
      startDate,
      endDate,
      allDay,
      notes: [req.description, allDay ? 'Tijd nog niet bekend.' : ''].filter(Boolean).join('\n'),
      ...(req.url ? { url: req.url } : {}),
      alarms: [{ relativeOffset: allDay ? -720 : -60 }],
    });
    return r.action === 'saved' ? 'In je agenda gezet.' : r.action === 'canceled' ? '' : 'Agenda geopend.';
  } catch (e) {
    return `Kon de agenda niet openen: ${(e as Error).message}`;
  }
}
