import { DateTime } from 'luxon';
import {
  changeNotification,
  earliestInstant,
  inNotifyScope,
  isUrgentChange,
  NL_TZ,
  planPhaseNotifications,
  quietWindowContaining,
  relativeDay,
  relativeMoment,
  type Change,
  type PlannedNotification,
  type SalePhase,
} from '@sellout/core';
import type { PushTarget } from '../store/types';

export interface PushMessage extends PlannedNotification {
  userId: string;
  tokens: string[];
  /** Wanneer deze run hem verstuurt (nu, of na korte wachttijd tot het einde van de stille uren). */
  deliverAt: string;
}

export interface EventInfo {
  id: string;
  title: string;
  /** De score die bij het tabblad hoort (verwachte drukte of uitverkoopkans). */
  score?: number;
  tourId?: string;
  artistIds: string[];
}

/** De vaste runs: 06:43, 12:43 en 18:43 Nederlandse tijd. */
export const RUN_SLOTS = ['06:43', '12:43', '18:43'];

export function nextRunAfter(now: DateTime): DateTime {
  const local = now.setZone(NL_TZ);
  for (let d = 0; d < 2; d++) {
    for (const s of RUN_SLOTS) {
      const [h, m] = s.split(':').map(Number);
      const t = local.plus({ days: d }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (t > local.plus({ minutes: 5 })) return t.toUTC();
    }
  }
  return local.plus({ hours: 6 }).toUTC();
}

/** GitHub start geplande runs soms later; reken met een marge zodat niets te laat komt. */
const RUN_DELAY_MARGIN_MIN = 75;
/** Hoe lang een run maximaal wacht om een melding precies na de stille uren te versturen. */
export const MAX_WAIT_MIN = 30;

function subjectFor(phase: SalePhase, events: Map<string, EventInfo>, inScope: (id: string) => boolean): string {
  // Eerst de data die de gebruiker volgt (of die boven de drempel zitten).
  const ids = [...phase.eventIds.filter(inScope), ...phase.eventIds.filter((id) => !inScope(id))];
  const relevant = phase.eventIds.filter(inScope);
  const titles = [...new Set((relevant.length ? relevant : ids).map((id) => events.get(id)?.title).filter(Boolean) as string[])];
  if (titles.length === 0) return phase.name;
  if (titles.length === 1) return titles[0]!;
  return `${titles[0]} en nog ${titles.length - 1}`;
}

/** Herinneringstekst opnieuw opbouwen vanaf het werkelijke verstuurmoment. */
function retitle(n: PlannedNotification, phase: SalePhase, at: DateTime, tz: string, subject: string): PlannedNotification {
  const target = n.kind === 'registration_deadline' ? (phase.deadline ?? phase.end) : phase.start;
  const t = earliestInstant(target);
  if (!t || !target) return n;
  const when = target.precision === 'exact' ? relativeMoment(t, at, tz) : relativeDay(t.setZone(target.tz), at, tz);
  if (n.kind === 'registration_deadline') return { ...n, title: `${phase.kind === 'lottery' ? 'Loting' : 'Inschrijving'} sluit ${when}: ${subject}` };
  if (n.kind === 'phase_start') return { ...n, title: `${phase.kind === 'general_sale' ? 'Algemene verkoop' : 'Presale'} ${when}: ${subject}` };
  return n;
}

export function planPushes(args: {
  targets: PushTarget[];
  events: Map<string, EventInfo>;
  phases: SalePhase[];
  changes: Change[];
  now: DateTime;
  sent: Record<string, string>;
}): PushMessage[] {
  const { now } = args;
  const next = nextRunAfter(now).plus({ minutes: RUN_DELAY_MARGIN_MIN });
  const out: PushMessage[] = [];
  for (const t of args.targets) {
    const inScope = (eventId: string) => {
      const ev = args.events.get(eventId);
      if (!ev) return false;
      const followed =
        t.followedEvents.has(eventId) || (ev.tourId !== undefined && t.followedTours.has(ev.tourId)) || ev.artistIds.some((a) => t.followedArtists.has(a));
      return inNotifyScope(eventId, ev.score, {
        followed: followed ? new Set([eventId]) : new Set(),
        muted: t.mutedEvents,
        scoreThreshold: t.scoreThreshold,
      });
    };
    const deliverAt = (sendAt: DateTime): DateTime => {
      // In de stille uren: wachten tot het einde (als dat binnen de wachttijd valt).
      const w = quietWindowContaining(now, t.settings);
      const earliest = w ? w.end.toUTC() : now;
      const ideal = sendAt > earliest ? sendAt : earliest;
      if (ideal.diff(now, 'minutes').minutes <= MAX_WAIT_MIN) return ideal;
      if (earliest.diff(now, 'minutes').minutes <= MAX_WAIT_MIN) return earliest;
      return now;
    };
    const push = (n: PlannedNotification, at: DateTime) => {
      const k = `${n.key}|${t.userId}`;
      if (args.sent[k]) return;
      args.sent[k] = now.toUTC().toISO()!;
      out.push({ ...n, userId: t.userId, tokens: t.tokens, deliverAt: at.toUTC().toISO()! });
    };

    // 1. Wijzigingen (extra show, nieuwe fase, nieuwe verkoopdatum, scoresprong, uitverkocht).
    for (const c of args.changes) {
      // "Verkoop begonnen" staat alleen in het logboek; de herinneringen voor de verkoop zelf gaan al.
      if (c.type === 'sale_started') continue;
      const ids = 'eventIds' in c ? c.eventIds : [c.eventId];
      if (!ids.some(inScope)) continue;
      const urgent = isUrgentChange(c, args.phases, now, t.settings.leadHours);
      const n = changeNotification(c, now, t.settings, urgent);
      push(n, urgent ? now : deliverAt(DateTime.fromISO(n.sendAt)));
    }

    // 2. Vangnet voor herinneringen die het toestel niet zelf heeft ingepland
    //    (bijv. de webversie op de computer): liever eerder dan te laat.
    for (const phase of args.phases) {
      if (!phase.eventIds.some(inScope)) continue;
      const subject = subjectFor(phase, args.events, inScope);
      for (const n of planPhaseNotifications(phase, { now, settings: t.settings, subject })) {
        if (t.scheduledKeys.has(n.key)) continue;
        const sendAt = DateTime.fromISO(n.sendAt);
        if (sendAt > next) continue; // een volgende run is op tijd
        const at = deliverAt(sendAt);
        push(retitle(n, phase, at, t.settings.userTz, subject), at);
      }
    }
  }
  return out;
}
