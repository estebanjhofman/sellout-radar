import { DateTime } from 'luxon';
import {
  inNotifyScope,
  planPhaseNotifications,
  selectForLocalSchedule,
  type NotifySettings,
  type PlannedNotification,
  type Snapshot,
} from '@sellout/core';
import type { Prefs } from '../state/prefs';

export function notifySettings(prefs: Prefs): NotifySettings {
  const s = prefs.settings;
  return { userTz: s.userTz, quiet: s.quiet, leadHours: Math.max(12, s.leadHours), extraReminderMinutes: s.extraReminderMinutes };
}

/** Datums waarvoor herinneringen aan staan: gevolgd, of score boven de drempel (en niet uitgezet). */
export function eventsInScope(snapshot: Snapshot, prefs: Prefs): Set<string> {
  const out = new Set<string>();
  if (!prefs.settings.notificationsEnabled) return out;
  const muted = new Set(prefs.mutedEvents);
  for (const e of snapshot.events) {
    if (e.status === 'cancelled' || e.status === 'soldout') continue;
    const followed =
      prefs.followedEvents.includes(e.id) ||
      (e.tourId !== undefined && prefs.followedTours.includes(e.tourId)) ||
      e.artistIds.some((a) => prefs.followedArtists.includes(a));
    if (inNotifyScope(e.id, e.score.value, { followed: followed ? new Set([e.id]) : new Set(), muted, scoreThreshold: prefs.settings.scoreThreshold })) out.add(e.id);
  }
  return out;
}

/** Alle herinneringen, en de selectie die het toestel inplant (iOS: max 64). */
export function planReminders(snapshot: Snapshot, prefs: Prefs, now = DateTime.now()): { all: PlannedNotification[]; selected: PlannedNotification[] } {
  const scope = eventsInScope(snapshot, prefs);
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
