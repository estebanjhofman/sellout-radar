import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_NOTIFY_SETTINGS, DEFAULT_SCORE_THRESHOLD, type QuietHours } from '@sellout/core';
import { readJson, writeJson } from '../lib/storage';
import { syncPrefsToServer } from '../lib/supabase';
import { usePrefSync, type SyncApi } from './sync';

export interface Settings {
  notificationsEnabled: boolean;
  /** Meldingen standaard aan vanaf deze score; null = alleen gevolgde data. */
  scoreThreshold: number | null;
  leadHours: number;
  extraReminderMinutes: number | null;
  quiet: QuietHours;
  userTz: string;
}

export interface Prefs {
  followedEvents: string[];
  followedTours: string[];
  followedArtists: string[];
  /** Gevolgd, maar zonder meldingen. */
  mutedEvents: string[];
  /** Datums waarvoor je al tickets hebt (geen verkoopherinneringen meer). */
  ownedEvents: string[];
  /**
   * Bewaarde gegevens van datums met tickets, zodat ze na de showdag (als ze uit de data verdwijnen)
   * nog bij Mijn tickets staan.
   */
  ownedInfo: Record<string, OwnedInfo>;
  /** Datums waarvoor je ingeschreven staat: datum-ID → IDs van de inschrijvingen ('' = algemeen). */
  registered: Record<string, string[]>;
  settings: Settings;
}

export interface OwnedInfo {
  title: string;
  /** "za 5 jun 2027" */
  dateText: string;
  place: string;
  /** Begin van de show (ms), als bekend. */
  start: number | null;
}

export const DEFAULT_PREFS: Prefs = {
  followedEvents: [],
  followedTours: [],
  followedArtists: [],
  mutedEvents: [],
  ownedEvents: [],
  ownedInfo: {},
  registered: {},
  settings: {
    notificationsEnabled: true,
    scoreThreshold: DEFAULT_SCORE_THRESHOLD,
    leadHours: DEFAULT_NOTIFY_SETTINGS.leadHours,
    extraReminderMinutes: null,
    quiet: DEFAULT_NOTIFY_SETTINGS.quiet,
    userTz: DEFAULT_NOTIFY_SETTINGS.userTz,
  },
};

const KEY = 'prefs:v1';

export async function loadPrefs(): Promise<Prefs> {
  const p = await readJson<Partial<Prefs>>(KEY);
  return { ...DEFAULT_PREFS, ...(p ?? {}), settings: { ...DEFAULT_PREFS.settings, ...(p?.settings ?? {}) } };
}

interface PrefsState extends SyncApi {
  prefs: Prefs;
  ready: boolean;
  isFollowing: (eventId: string, tourId?: string, artistIds?: string[]) => boolean;
  toggleEvent: (eventId: string) => void;
  toggleTour: (tourId: string) => void;
  toggleArtist: (artistId: string) => void;
  setMuted: (eventId: string, muted: boolean) => void;
  toggleOwned: (eventId: string) => void;
  /** Werkt de bewaarde gegevens van datums met tickets bij (alleen als er iets veranderde). */
  rememberOwned: (info: Record<string, OwnedInfo>) => void;
  /** Zet een inschrijving voor een datum aan of uit (je kunt er meerdere hebben). */
  toggleRegistered: (eventId: string, phaseId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const Ctx = createContext<PrefsState | null>(null);

/** Inschrijvingen van een datum (ook voor oudere opslag met één inschrijving als tekst). */
export function registeredIds(r: Record<string, string[] | string> | undefined, eventId: string): string[] {
  const v = r?.[eventId];
  return v === undefined ? [] : typeof v === 'string' ? [v] : v;
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadPrefs().then((p) => {
      setPrefs(p);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    void writeJson(KEY, prefs);
    const t = setTimeout(() => void syncPrefsToServer(prefs).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [prefs, ready]);

  const syncApi = usePrefSync(prefs, setPrefs, ready);

  const isFollowing = useCallback(
    (eventId: string, tourId?: string, artistIds: string[] = []) =>
      prefs.followedEvents.includes(eventId) ||
      (tourId !== undefined && prefs.followedTours.includes(tourId)) ||
      artistIds.some((a) => prefs.followedArtists.includes(a)),
    [prefs],
  );

  const value = useMemo<PrefsState>(
    () => ({
      ...syncApi,
      prefs,
      ready,
      isFollowing,
      toggleEvent: (id) => setPrefs((p) => ({ ...p, followedEvents: toggle(p.followedEvents, id) })),
      toggleTour: (id) => setPrefs((p) => ({ ...p, followedTours: toggle(p.followedTours, id) })),
      toggleArtist: (id) => setPrefs((p) => ({ ...p, followedArtists: toggle(p.followedArtists, id) })),
      setMuted: (id, muted) =>
        setPrefs((p) => ({ ...p, mutedEvents: muted ? [...new Set([...p.mutedEvents, id])] : p.mutedEvents.filter((x) => x !== id) })),
      toggleRegistered: (id, phaseId) =>
        setPrefs((p) => {
          const r = { ...(p.registered ?? {}) };
          const list = toggle(registeredIds(r, id), phaseId);
          if (list.length) r[id] = list;
          else delete r[id];
          return { ...p, registered: r };
        }),
      toggleOwned: (id) =>
        setPrefs((p) => {
          const ownedEvents = toggle(p.ownedEvents ?? [], id);
          const ownedInfo = { ...(p.ownedInfo ?? {}) };
          if (!ownedEvents.includes(id)) delete ownedInfo[id];
          return { ...p, ownedEvents, ownedInfo };
        }),
      rememberOwned: (info) =>
        setPrefs((p) => {
          const cur = p.ownedInfo ?? {};
          const changed = Object.entries(info).some(([k, v]) => JSON.stringify(cur[k]) !== JSON.stringify(v));
          return changed ? { ...p, ownedInfo: { ...cur, ...info } } : p;
        }),
      updateSettings: (patch) => setPrefs((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
    }),
    [prefs, ready, isFollowing, syncApi],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs buiten PrefsProvider');
  return v;
}
