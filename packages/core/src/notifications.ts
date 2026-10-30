import { DateTime } from 'luxon';
import type { EventStatus, SalePhase, TimePoint } from './types';
import { NL_TZ, earliestInstant, formatDual, relativeDay, relativeMoment, sameTimePoint } from './time';

/**
 * Meldingsplanning.
 *
 * Regels uit de opdracht:
 *  - minimaal 12 uur vóór de start van elke presale en de algemene verkoop;
 *  - inschrijving: melding zodra die opent, en minimaal 12 uur vóór de deadline;
 *  - optioneel een extra herinnering (standaard 60 minuten) vooraf;
 *  - valt een melding in de stille uren, dan eerder versturen, nooit later.
 *
 * Bij een tijd die alleen tot op de dag bekend is, rekenen we vanaf 00:00 lokale tijd
 * (het vroegst mogelijke moment), zodat de melding nooit te laat komt.
 */

export interface QuietHours {
  enabled: boolean;
  /** 'HH:mm' in de tijdzone van de gebruiker */
  start: string;
  end: string;
}

export interface NotifySettings {
  userTz: string;
  quiet: QuietHours;
  /** Hoeveel uur vooraf (minimaal 12). */
  leadHours: number;
  /** Extra herinnering in minuten vooraf, of null voor uit. */
  extraReminderMinutes: number | null;
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  userTz: NL_TZ,
  quiet: { enabled: true, start: '23:00', end: '07:00' },
  leadHours: 12,
  extraReminderMinutes: null,
};

export type NotificationKind =
  | 'registration_open'
  | 'registration_deadline'
  | 'phase_start'
  | 'phase_extra'
  | 'change_extra_show'
  | 'change_sale_date'
  | 'change_new_phase'
  | 'change_score_jump'
  | 'change_soldout';

export interface PlannedNotification {
  /** Unieke sleutel; dezelfde sleutel wordt nooit twee keer verstuurd. */
  key: string;
  kind: NotificationKind;
  phaseId?: string;
  eventIds: string[];
  /** Ideaal moment (UTC ISO) volgens de regel. */
  idealAt: string;
  /** Werkelijk verstuurmoment (UTC ISO) na stille uren of als het ideale moment al voorbij is. */
  sendAt: string;
  title: string;
  body: string;
  /** Deeplink naar de detailpagina. */
  url: string;
}

function parseHM(s: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Ongeldige tijd ${s}, verwacht HH:mm`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Het stille-urenvenster waarin `at` valt, of null. */
export function quietWindowContaining(
  at: DateTime,
  settings: NotifySettings,
): { start: DateTime; end: DateTime } | null {
  if (!settings.quiet.enabled) return null;
  const s = parseHM(settings.quiet.start);
  const e = parseHM(settings.quiet.end);
  if (s.hour === e.hour && s.minute === e.minute) return null;
  const local = at.setZone(settings.userTz);
  for (const offset of [0, -1]) {
    const day = local.plus({ days: offset }).startOf('day');
    const wStart = day.set({ hour: s.hour, minute: s.minute });
    let wEnd = day.set({ hour: e.hour, minute: e.minute });
    if (wEnd <= wStart) wEnd = wEnd.plus({ days: 1 });
    if (local >= wStart && local < wEnd) return { start: wStart, end: wEnd };
  }
  return null;
}

/** Schuift een moment uit de stille uren: naar de minuut vóór het venster. Nooit later. */
export function shiftOutOfQuietHours(at: DateTime, settings: NotifySettings): DateTime {
  const w = quietWindowContaining(at, settings);
  if (!w) return at.toUTC();
  return w.start.minus({ minutes: 1 }).toUTC();
}

/** Labels voor de soort verkoopfase. */
export function phaseKindLabel(kind: SalePhase['kind']): string {
  switch (kind) {
    case 'registration':
      return 'Inschrijving';
    case 'presale':
      return 'Presale';
    case 'general_sale':
      return 'Algemene verkoop';
    case 'lottery':
      return 'Loting';
  }
}

export interface PlanContext {
  now: DateTime;
  settings: NotifySettings;
  /** Korte omschrijving van de betrokken data, bijv. "U2 · Amsterdam, 5 en 6 jun". */
  subject: string;
}

function eventUrl(phase: SalePhase): string {
  const first = phase.eventIds[0] ?? '';
  return `selloutradar://event/${encodeURIComponent(first)}?phase=${encodeURIComponent(phase.id)}`;
}

function dualText(tp: TimePoint | undefined, userTz: string): string {
  const d = formatDual(tp, userTz);
  return d.same ? d.local : `${d.local} (${d.user})`;
}

/**
 * Plant een melding op `ideal`: schuift uit de stille uren en vangt verlopen momenten op.
 * Geeft null als het moment waar de melding over gaat (`deadlineOfInterest`) al voorbij is.
 */
function schedule(
  ideal: DateTime,
  deadlineOfInterest: DateTime,
  ctx: PlanContext,
): { idealAt: string; sendAt: string } | null {
  if (deadlineOfInterest <= ctx.now) return null;
  let send = shiftOutOfQuietHours(ideal, ctx.settings);
  if (send < ctx.now) send = ctx.now.toUTC();
  return { idealAt: ideal.toUTC().toISO()!, sendAt: send.toISO()! };
}

/** Alle tijdgebonden meldingen voor één verkoopfase. */
export function planPhaseNotifications(phase: SalePhase, ctx: PlanContext): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const lead = Math.max(12, ctx.settings.leadHours);
  const url = eventUrl(phase);
  const end = earliestInstant(phase.end);
  if (end && end <= ctx.now) return out; // fase is voorbij

  const start = earliestInstant(phase.start);

  if (phase.kind === 'registration' || phase.kind === 'lottery') {
    const deadline = earliestInstant(phase.deadline ?? phase.end);
    const label = phase.kind === 'registration' ? 'Inschrijving' : 'Loting';

    // 1. Zodra de inschrijving opent (of meteen als die al open is).
    const opensAt = start && start > ctx.now ? start : ctx.now;
    const openSlot = schedule(opensAt, deadline ?? opensAt.plus({ years: 1 }), ctx);
    if (openSlot) {
      out.push({
        key: `registration_open:${phase.id}`,
        kind: 'registration_open',
        phaseId: phase.id,
        eventIds: phase.eventIds,
        ...openSlot,
        title: `${label} ${start && start > ctx.now ? 'opent' : 'is open'}: ${ctx.subject}`,
        body: `${phase.name}. Deadline: ${dualText(phase.deadline ?? phase.end, ctx.settings.userTz)}.${phase.whereToRegister ? ` Inschrijven via ${phase.whereToRegister}.` : ''}`,
        url,
      });
    }

    // 2. Minimaal `lead` uur vóór de deadline.
    if (deadline) {
      const slot = schedule(deadline.minus({ hours: lead }), deadline, ctx);
      if (slot) {
        const deadlineExact = (phase.deadline ?? phase.end)?.precision === 'exact';
        const when = deadlineExact
          ? relativeMoment(deadline, DateTime.fromISO(slot.sendAt), ctx.settings.userTz)
          : relativeDay(deadline.setZone((phase.deadline ?? phase.end)!.tz), DateTime.fromISO(slot.sendAt), ctx.settings.userTz);
        out.push({
          key: `registration_deadline:${phase.id}:${lead}h`,
          kind: 'registration_deadline',
          phaseId: phase.id,
          eventIds: phase.eventIds,
          ...slot,
          title: `${label} sluit ${when}: ${ctx.subject}`,
          body: `${phase.name} sluit ${dualText(phase.deadline ?? phase.end, ctx.settings.userTz)}.`,
          url,
        });
      }
    }
    return out;
  }

  // Presale of algemene verkoop.
  if (!start) return out; // nog niet bekend: geen tijdmelding, alleen wijzigingsmeldingen
  const kindLabel = phaseKindLabel(phase.kind);
  const timeKnown = phase.start.precision === 'exact';

  const main = schedule(start.minus({ hours: lead }), start, ctx);
  if (main) {
    const rel = timeKnown
      ? relativeMoment(start, DateTime.fromISO(main.sendAt), ctx.settings.userTz)
      : phase.start.precision === 'date'
        ? relativeDay(start.setZone(phase.start.tz), DateTime.fromISO(main.sendAt), ctx.settings.userTz)
        : 'binnenkort';
    out.push({
      key: `phase_start:${phase.id}:${lead}h`,
      kind: 'phase_start',
      phaseId: phase.id,
      eventIds: phase.eventIds,
      ...main,
      title: `${kindLabel} ${rel}: ${ctx.subject}`,
      body: `${phase.name} start ${dualText(phase.start, ctx.settings.userTz)}.${phase.requiresCode ? ' Code nodig.' : ''}`,
      url,
    });
  }

  const extra = ctx.settings.extraReminderMinutes;
  if (extra && timeKnown) {
    const slot = schedule(start.minus({ minutes: extra }), start, ctx);
    if (slot) {
      out.push({
        key: `phase_extra:${phase.id}:${extra}m`,
        kind: 'phase_extra',
        phaseId: phase.id,
        eventIds: phase.eventIds,
        ...slot,
        title: `Over ${extra >= 60 && extra % 60 === 0 ? `${extra / 60} uur` : `${extra} min`}: ${phase.name}`,
        body: `${ctx.subject}. Start ${dualText(phase.start, ctx.settings.userTz)}.`,
        url,
      });
    }
  }
  return out;
}

/**
 * Voor welke data meldingen standaard aan staan: alles wat je volgt en alles met
 * score ≥ drempel (standaard 70). Uitgezette data (muted) krijgen nooit meldingen.
 */
export interface NotifyScope {
  followed: ReadonlySet<string>;
  muted?: ReadonlySet<string>;
  /** null = alleen gevolgde data. */
  scoreThreshold: number | null;
}

export const DEFAULT_SCORE_THRESHOLD = 70;

export function inNotifyScope(eventId: string, score: number | undefined, scope: NotifyScope): boolean {
  if (scope.muted?.has(eventId)) return false;
  if (scope.followed.has(eventId)) return true;
  return scope.scoreThreshold !== null && score !== undefined && score >= scope.scoreThreshold;
}

/**
 * Een wijziging is urgent als de betrokken verkoop binnen de meldtermijn begint:
 * dan gaat de melding meteen, ook in de stille uren.
 */
export function isUrgentChange(change: Change, phases: Pick<SalePhase, 'id' | 'start'>[], now: DateTime, leadHours = 12): boolean {
  if (change.type !== 'new_phase' && change.type !== 'sale_date') return false;
  const phase = phases.find((p) => p.id === change.phaseId);
  const start = earliestInstant(change.type === 'sale_date' ? change.after : phase?.start);
  return !!start && start > now && start.diff(now, 'hours').hours <= leadHours;
}

/**
 * Selecteert wat de telefoon lokaal inplant: de eerstvolgende `max` meldingen
 * (iOS bewaart er maximaal 64 per app).
 */
export function selectForLocalSchedule(
  planned: PlannedNotification[],
  now: DateTime,
  max = 64,
): PlannedNotification[] {
  const seen = new Set<string>();
  return planned
    .filter((n) => DateTime.fromISO(n.sendAt) > now)
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
    .filter((n) => (seen.has(n.key) ? false : (seen.add(n.key), true)))
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Wijzigingen tussen twee updates
// ---------------------------------------------------------------------------

export interface ChangeSnapshot {
  events: { id: string; title: string; status: EventStatus; addedShow?: boolean; score?: number }[];
  phases: { id: string; name: string; kind: SalePhase['kind']; start: TimePoint; eventIds: string[] }[];
}

export type Change =
  | { type: 'extra_show'; eventId: string; title: string }
  | { type: 'new_phase'; phaseId: string; name: string; eventIds: string[] }
  | { type: 'sale_date'; phaseId: string; name: string; before: TimePoint; after: TimePoint; eventIds: string[] }
  | { type: 'score_jump'; eventId: string; title: string; before: number; after: number }
  | { type: 'soldout'; eventId: string; title: string };

export function diffSnapshots(prev: ChangeSnapshot, next: ChangeSnapshot, scoreJump = 15): Change[] {
  const changes: Change[] = [];
  const prevEvents = new Map(prev.events.map((e) => [e.id, e]));
  const prevPhases = new Map(prev.phases.map((p) => [p.id, p]));

  for (const e of next.events) {
    const before = prevEvents.get(e.id);
    if (!before) {
      if (e.addedShow) changes.push({ type: 'extra_show', eventId: e.id, title: e.title });
      continue;
    }
    if (e.status === 'soldout' && before.status !== 'soldout') {
      changes.push({ type: 'soldout', eventId: e.id, title: e.title });
    }
    if (e.score !== undefined && before.score !== undefined && Math.abs(e.score - before.score) >= scoreJump) {
      changes.push({ type: 'score_jump', eventId: e.id, title: e.title, before: before.score, after: e.score });
    }
  }
  for (const p of next.phases) {
    const before = prevPhases.get(p.id);
    if (!before) {
      changes.push({ type: 'new_phase', phaseId: p.id, name: p.name, eventIds: p.eventIds });
    } else if (!sameTimePoint(before.start, p.start)) {
      changes.push({ type: 'sale_date', phaseId: p.id, name: p.name, before: before.start, after: p.start, eventIds: p.eventIds });
    }
  }
  return changes;
}

/**
 * Zet een wijziging om in een melding die meteen gaat.
 * Valt "nu" in de stille uren en is de wijziging niet urgent, dan gaat hij aan het eind
 * van het venster (een wijziging kan niet eerder dan ze bekend is).
 */
export function changeNotification(
  change: Change,
  now: DateTime,
  settings: NotifySettings,
  urgent = false,
): PlannedNotification {
  let send = now.toUTC();
  const w = quietWindowContaining(now, settings);
  if (w && !urgent) send = w.end.toUTC();
  const base = { idealAt: now.toUTC().toISO()!, sendAt: send.toISO()! };
  switch (change.type) {
    case 'extra_show':
      return {
        ...base,
        key: `change_extra_show:${change.eventId}`,
        kind: 'change_extra_show',
        eventIds: [change.eventId],
        title: `Extra show toegevoegd: ${change.title}`,
        body: 'Er is een nieuwe datum bijgekomen. Bekijk de verkoopfases.',
        url: `selloutradar://event/${encodeURIComponent(change.eventId)}`,
      };
    case 'new_phase':
      return {
        ...base,
        key: `change_new_phase:${change.phaseId}`,
        kind: 'change_new_phase',
        phaseId: change.phaseId,
        eventIds: change.eventIds,
        title: `Nieuwe verkoopfase: ${change.name}`,
        body: 'Er is een presale of inschrijving toegevoegd.',
        url: `selloutradar://event/${encodeURIComponent(change.eventIds[0] ?? '')}?phase=${encodeURIComponent(change.phaseId)}`,
      };
    case 'sale_date':
      return {
        ...base,
        key: `change_sale_date:${change.phaseId}:${change.after.utc ?? change.after.localDate ?? change.after.localMonth ?? 'unknown'}`,
        kind: 'change_sale_date',
        phaseId: change.phaseId,
        eventIds: change.eventIds,
        title: `Verkoopdatum gewijzigd: ${change.name}`,
        body: `Was ${dualText(change.before, settings.userTz)}, nu ${dualText(change.after, settings.userTz)}.`,
        url: `selloutradar://event/${encodeURIComponent(change.eventIds[0] ?? '')}?phase=${encodeURIComponent(change.phaseId)}`,
      };
    case 'score_jump': {
      const up = change.after > change.before;
      return {
        ...base,
        key: `change_score_jump:${change.eventId}:${change.after}`,
        kind: 'change_score_jump',
        eventIds: [change.eventId],
        title: `Score ${up ? 'stijgt' : 'daalt'} naar ${change.after}: ${change.title}`,
        body: `Van ${change.before} naar ${change.after} sinds de vorige update.`,
        url: `selloutradar://event/${encodeURIComponent(change.eventId)}`,
      };
    }
    case 'soldout':
      return {
        ...base,
        key: `change_soldout:${change.eventId}`,
        kind: 'change_soldout',
        eventIds: [change.eventId],
        title: `Uitverkocht: ${change.title}`,
        body: 'Deze datum is uitverkocht. Houd extra shows en officiële doorverkoop in de gaten.',
        url: `selloutradar://event/${encodeURIComponent(change.eventId)}`,
      };
  }
}
