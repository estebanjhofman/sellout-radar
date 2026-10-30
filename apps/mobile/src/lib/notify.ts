import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { PlannedNotification } from '@sellout/core';
import { readJson, writeJson } from './storage';

/** Lokale herinneringen op de iPhone, en het pushtoken voor meldingen van de server. */

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('default', {
      name: 'Verkoopmomenten',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
}

export const notificationsSupported = true;

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<boolean> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return true;
  if (!p.canAskAgain) return false;
  const r = await Notifications.requestPermissionsAsync();
  return r.granted;
}

const MAP_KEY = 'scheduled:v1';

/**
 * Brengt de ingeplande meldingen in lijn met de planning: verdwenen of gewijzigde meldingen
 * eruit, nieuwe erin. Geeft de sleutels terug die nu ingepland staan.
 */
export async function syncLocalNotifications(selected: PlannedNotification[]): Promise<string[]> {
  if ((await permissionStatus()) !== 'granted') return [];
  const known = (await readJson<Record<string, string>>(MAP_KEY)) ?? {};
  const existing = new Set((await Notifications.getAllScheduledNotificationsAsync()).map((r) => r.identifier));
  const wanted = new Map(selected.map((n) => [n.key, n]));
  const sig = (n: PlannedNotification) => `${n.sendAt}|${n.title}|${n.body}`;
  for (const id of existing) {
    const n = wanted.get(id);
    if (!n || known[id] !== sig(n)) {
      await Notifications.cancelScheduledNotificationAsync(id);
      existing.delete(id);
      delete known[id];
    }
  }
  for (const n of selected) {
    if (existing.has(n.key)) continue;
    const at = new Date(n.sendAt);
    if (at.getTime() <= Date.now() + 5_000) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: n.key,
      content: { title: n.title, body: n.body, data: { url: n.url }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    known[n.key] = sig(n);
  }
  for (const k of Object.keys(known)) if (!wanted.has(k)) delete known[k];
  await writeJson(MAP_KEY, known);
  return Object.keys(known);
}

export async function scheduledCount(): Promise<number> {
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}

/** Tik op een melding: open de detailpagina (ook als de app daardoor opstart). */
export function onNotificationTap(handler: (url: string) => void): () => void {
  const last = Notifications.getLastNotificationResponse();
  const url0 = last?.notification.request.content.data?.url;
  if (typeof url0 === 'string') setTimeout(() => handler(url0), 0);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const url = r.notification.request.content.data?.url;
    if (typeof url === 'string') handler(url);
  });
  return () => sub.remove();
}

/** Expo-pushtoken (alleen op een echt toestel en met een EAS-project). */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    const t = await Notifications.getExpoPushTokenAsync({ projectId });
    return t.data;
  } catch {
    return null;
  }
}
