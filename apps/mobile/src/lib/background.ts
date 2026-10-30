import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { cacheSnapshot, fetchSnapshot } from '../state/data';
import { loadPrefs } from '../state/prefs';
import { syncLocalNotifications } from './notify';
import { planReminders } from './plan';
import { readJson } from './storage';
import { reportScheduled } from './supabase';

/**
 * Achtergrondsynchronisatie: haalt af en toe het nieuwste snapshot op en plant de
 * herinneringen opnieuw in. iOS bepaalt zelf wanneer dit gebeurt (minstens om de 15 minuten,
 * vaak minder vaak); de server stuurt daarom bij wijzigingen ook een pushmelding.
 */
const TASK = 'sellout-radar-sync';

TaskManager.defineTask(TASK, async () => {
  try {
    const snapshot = await fetchSnapshot();
    await cacheSnapshot(snapshot);
    const prefs = await loadPrefs();
    const keys = await syncLocalNotifications(planReminders(snapshot, prefs).selected);
    const token = await readJson<string>('push:token');
    if (token) await reportScheduled(token, keys);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 });
  } catch {
    // Niet beschikbaar (bijv. simulator of Expo Go): de app synchroniseert dan bij openen.
  }
}
