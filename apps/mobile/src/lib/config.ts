/**
 * Instellingen die bij het bouwen worden ingevuld (zie SETUP.md).
 * Zonder snapshot-URL leest de webversie "snapshot.json" naast de pagina (handig voor de demo).
 */
export const SNAPSHOT_URL = process.env.EXPO_PUBLIC_SNAPSHOT_URL ?? '';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** Openbare VAPID-sleutel voor meldingen in de browser (Web Push). */
export const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';
export const APP_VERSION = '1.0.0';
