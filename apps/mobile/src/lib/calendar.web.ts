import { phaseToGoogleCalendarUrl, phaseToIcs, type SalePhase } from '@sellout/core';

export interface CalendarRequest {
  phase: SalePhase;
  role: 'start' | 'deadline';
  title: string;
  description: string;
  url?: string;
}

/**
 * Is deze pagina ingesloten in een omgeving die geen downloads toestaat (zoals een gedeelde
 * artifact-pagina op claude.ai)? Die omgeving zet een object `claude` met een `use`-functie.
 */
function inSandboxedViewer(): boolean {
  return typeof (globalThis as { claude?: { use?: unknown } }).claude?.use === 'function';
}

/** Mag de browser hier een .ics-bestand opslaan? */
export function canSaveCalendarFile(): boolean {
  return !inSandboxedViewer();
}

/** Link naar Google Agenda met hetzelfde item; werkt overal waar links werken. */
export function webCalendarLink(req: CalendarRequest): string | null {
  return phaseToGoogleCalendarUrl({ phase: req.phase, role: req.role, title: req.title, description: req.description, url: req.url });
}

/** In de browser: een .ics-bestand downloaden dat Apple Agenda, Outlook en Google Agenda openen. */
export async function addToCalendar(req: CalendarRequest): Promise<string> {
  const ics = phaseToIcs({ phase: req.phase, role: req.role, title: req.title, description: req.description, url: req.url, now: new Date().toISOString() });
  if (!ics) return 'Dit moment is nog niet bekend.';
  if (inSandboxedViewer()) return 'Downloaden kan op deze pagina niet. Gebruik de link naar Google Agenda.';
  try {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${req.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'verkoopmoment'}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return 'Agendabestand gedownload.';
  } catch {
    return 'Downloaden lukte niet. Gebruik de link naar Google Agenda.';
  }
}
