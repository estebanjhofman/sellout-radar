import type { PlannedNotification } from '@sellout/core';

/**
 * In de browser kan de app geen meldingen inplannen. Herinneringen komen op de iPhone;
 * op de computer laat de aftelklok zien wat eraan komt.
 */
export function configureNotifications(): void {}
export const notificationsSupported = false;
export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  return 'denied';
}
export async function requestPermission(): Promise<boolean> {
  return false;
}
export async function syncLocalNotifications(_selected: PlannedNotification[]): Promise<string[]> {
  return [];
}
export async function scheduledCount(): Promise<number> {
  return 0;
}
export function onNotificationTap(_handler: (url: string) => void): () => void {
  return () => undefined;
}
export async function getPushToken(): Promise<string | null> {
  return null;
}
