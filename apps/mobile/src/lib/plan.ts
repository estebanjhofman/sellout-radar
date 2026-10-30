import { DateTime } from 'luxon';
import {
  eventScoreView,
  inNotifyScope,
  planPhaseNotifications,
  selectForLocalSchedule,
  type NotifySettings,
  type PlannedNotification,
  type SalePhase,
  type Snapshot,
} from '@sellout/core';
import { registeredIds, type Prefs } from '../state/prefs';

export function notifySettings(prefs: Prefs): NotifySettings {
  const s = prefs.settings;
  return { userTz: s.userTz, quiet: s.quiet, leadHours: Math.max(12, s.leadHours), extraReminderMinutes: s.extraReminderMinutes };
}

/**
 * Datums waarvoor herinneringen aan staan: gevolgd, of score boven de drempel (en niet uitgezet).
 * De score is die van het tabblad: de verwachte drukte zolang de verkoop niet begonnen is, daarna de
 * uitverkoopkans.
 */
export function eventsInScope(snapshot: Snapshot, prefs: Prefs, now = DateTime.now()): Set<string> {
  const out = new Set<string>();
  if (!prefs.settings.notificationsEnabled) return out;
  const muted = new Set(prefs.mutedEvents);
  // Al tickets: geen verkoopherinneringen meer voor die datum.
  const owned = new Set(prefs.ownedEvents ?? []);
  const phasesByEvent = new Map<string, SalePhase[]>();
  for (const p of snapshot.phases) for (const id of p.eventIds) phasesByEvent.set(id, [...(phasesByEvent.get(id) ?? []), p]);
  for (const e of snapshot.events) {
    if (e.status === 'cancelled' || e.status === 'soldout' || owned.has(e.id)) continue;
    const followed =
      registeredIds(prefs.registered, e.id).length > 0 ||
      prefs.followedEvents.includes(e.id) ||
      (e.tourId !== undefined && prefs.followedTours.includes(e.tourId)) ||
      e.artistIds.some((a) => prefs.followedArtists.includes(a));
    const score = eventScoreView(e, phasesByEvent.get(e.id) ?? [], now).score.value;
    if (inNotifyScope(e.id, score, { followed: followed ? new Set([e.id]) : new Set(), muted, scoreThreshold: prefs.settings.scoreThreshold })) out.add(e.id);
  }
  return out;
}

/** Alle herinneringen, en de selectie die het toestel inplant (iOS: max 64). */
export function planReminders(snapshot: Snapshot, prefs: Prefs, now = DateTime.now()): { all: PlannedNotification[]; selected: PlannedNotification[] } {
  const scope = eventsInScope(snapshot, prefs, now);
  const titles = new Map(snapshot.events.map((e) => [e.id, e.title]));
  const settings = notifySettings(prefs);
  const all: PlannedNotification[] = [];
  for (const phase of snapshot.phases) {
    const ids = phase.eventIds.filter((id) => scope.has(id));
    if (ids.length === 0) continue;
    const names = [...new Set(ids.map((id) => titles.get(id)).filter(Boolean) as string[])];
    const subject = names.length > 1 ? `${names[0]} en nog ${names.length - 1}` : (names[0] ?? phase.name);
    all.push(...planPhaseNotifications(phase, { now, settings, subject }));
  }
  return { all, selected: selectForLocalSchedule(all, now, 64) };
}
