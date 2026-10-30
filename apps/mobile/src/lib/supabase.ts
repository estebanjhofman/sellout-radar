import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import type { Prefs } from '../state/prefs';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

/**
 * Optionele koppeling met Supabase: volglijst en instellingen op de server, zodat de updater
 * pushmeldingen kan sturen bij wijzigingen. Zonder Supabase werkt alles lokaal.
 * Inloggen gebeurt anoniem; er is geen account of e-mailadres nodig.
 */
let client: SupabaseClient | null = null;

export function supabaseEnabled(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

function sb(): SupabaseClient | null {
  if (!supabaseEnabled()) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

async function userId(): Promise<string | null> {
  const c = sb();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: d, error } = await c.auth.signInAnonymously();
  if (error) throw error;
  return d.user?.id ?? null;
}

export async function syncPrefsToServer(prefs: Prefs): Promise<void> {
  const c = sb();
  const uid = await userId();
  if (!c || !uid) return;
  const s = prefs.settings;
  await c.from('settings').upsert({
    user_id: uid,
    user_tz: s.userTz,
    quiet_enabled: s.quiet.enabled,
    quiet_start: s.quiet.start,
    quiet_end: s.quiet.end,
    lead_hours: Math.max(12, s.leadHours),
    extra_reminder_minutes: s.extraReminderMinutes,
    score_threshold: s.notificationsEnabled ? s.scoreThreshold : null,
    updated_at: new Date().toISOString(),
  });
  const notify = s.notificationsEnabled;
  const rows = [
    ...prefs.followedEvents.map((ref) => ({ user_id: uid, kind: 'event', ref, notify: notify && !prefs.mutedEvents.includes(ref) })),
    ...prefs.mutedEvents.filter((ref) => !prefs.followedEvents.includes(ref)).map((ref) => ({ user_id: uid, kind: 'event', ref, notify: false })),
    ...prefs.followedTours.map((ref) => ({ user_id: uid, kind: 'tour', ref, notify })),
    ...prefs.followedArtists.map((ref) => ({ user_id: uid, kind: 'artist', ref, notify })),
  ];
  await c.from('follow').delete().eq('user_id', uid);
  if (rows.length) await c.from('follow').insert(rows);
}

export async function registerDevice(token: string): Promise<void> {
  const c = sb();
  if (!c || !(await userId())) return;
  await c.rpc('register_device', { p_token: token, p_platform: Platform.OS });
}

/** Meldt welke herinneringen het toestel zelf heeft ingepland, zodat de server die niet dubbel stuurt. */
export async function reportScheduled(token: string, keys: string[]): Promise<void> {
  const c = sb();
  if (!c || !(await userId())) return;
  await c.from('device').update({ scheduled: keys, last_sync_at: new Date().toISOString() }).eq('push_token', token);
}
