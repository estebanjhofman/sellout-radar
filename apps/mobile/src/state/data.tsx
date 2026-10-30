import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import {
  isValidSnapshot,
  snapshotAgeWarning,
  type Artist,
  type SalePhase,
  type Snapshot,
  type SnapshotEvent,
  type Tour,
  type Venue,
} from '@sellout/core';
import { SNAPSHOT_URL } from '../lib/config';
import { readJson, writeJson } from '../lib/storage';

const CACHE_KEY = 'snapshot:v1';

export interface DataIndex {
  events: Map<string, SnapshotEvent>;
  phasesByEvent: Map<string, SalePhase[]>;
  phases: Map<string, SalePhase>;
  venues: Map<string, Venue>;
  artists: Map<string, Artist>;
  tours: Map<string, Tour>;
  eventsByTour: Map<string, SnapshotEvent[]>;
}

export interface DataState {
  snapshot: Snapshot | null;
  index: DataIndex | null;
  loading: boolean;
  /** Foutmelding van de laatste poging; de laatst bekende data blijft zichtbaar. */
  error: string | null;
  /** Waarschuwing als de data oud is. */
  staleWarning: string | null;
  fetchedAt: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<DataState | null>(null);

export function snapshotUrl(): string {
  if (SNAPSHOT_URL) return SNAPSHOT_URL;
  // Webdemo: snapshot.json staat naast de pagina.
  return Platform.OS === 'web' ? `${globalThis.__SR_BASE__ ?? ''}snapshot.json` : '';
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const url = snapshotUrl();
  if (!url) throw new Error('Er is nog geen snapshot-URL ingesteld (EXPO_PUBLIC_SNAPSHOT_URL, zie SETUP.md).');
  // Elke 10 minuten een andere URL, zodat een CDN-cache ons niet te lang oude data geeft.
  const bust = SNAPSHOT_URL ? `${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 600_000)}` : '';
  const res = await fetch(`${url}${bust}`);
  if (!res.ok) throw new Error(`Het snapshot is niet bereikbaar (HTTP ${res.status}).`);
  const json: unknown = await res.json();
  if (!isValidSnapshot(json)) throw new Error('Het snapshot heeft een onbekend formaat. Werk de app bij.');
  return json;
}

export async function readCachedSnapshot(): Promise<{ snapshot: Snapshot; fetchedAt: string } | null> {
  const c = await readJson<{ snapshot: Snapshot; fetchedAt: string }>(CACHE_KEY);
  return c && isValidSnapshot(c.snapshot) ? c : null;
}

export async function cacheSnapshot(snapshot: Snapshot): Promise<string> {
  const fetchedAt = new Date().toISOString();
  await writeJson(CACHE_KEY, { snapshot, fetchedAt });
  return fetchedAt;
}

export function buildIndex(s: Snapshot): DataIndex {
  const phasesByEvent = new Map<string, SalePhase[]>();
  for (const p of s.phases) for (const e of p.eventIds) phasesByEvent.set(e, [...(phasesByEvent.get(e) ?? []), p]);
  const eventsByTour = new Map<string, SnapshotEvent[]>();
  for (const e of s.events) if (e.tourId) eventsByTour.set(e.tourId, [...(eventsByTour.get(e.tourId) ?? []), e]);
  for (const list of eventsByTour.values()) list.sort((a, b) => (a.date.localDate ?? '').localeCompare(b.date.localDate ?? ''));
  return {
    events: new Map(s.events.map((e) => [e.id, e])),
    phasesByEvent,
    phases: new Map(s.phases.map((p) => [p.id, p])),
    venues: new Map(s.venues.map((v) => [v.id, v])),
    artists: new Map(s.artists.map((a) => [a.id, a])),
    tours: new Map(s.tours.map((t) => [t.id, t])),
    eventsByTour,
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const s = await fetchSnapshot();
      setSnapshot(s);
      setFetchedAt(await cacheSnapshot(s));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCachedSnapshot();
      if (alive && cached) {
        setSnapshot(cached.snapshot);
        setFetchedAt(cached.fetchedAt);
      }
      await refresh();
    })();
    // Bij terugkeer naar de app: opnieuw ophalen als het langer dan 15 minuten geleden is.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setFetchedAt((f) => {
        if (!f || Date.now() - Date.parse(f) > 15 * 60_000) void refresh();
        return f;
      });
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [refresh]);

  const index = useMemo(() => (snapshot ? buildIndex(snapshot) : null), [snapshot]);
  const staleWarning = useMemo(
    () => (snapshot ? snapshotAgeWarning(snapshot.generatedAt, new Date().toISOString()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, fetchedAt],
  );

  const value = useMemo<DataState>(
    () => ({ snapshot, index, loading, error, staleWarning, fetchedAt, refresh }),
    [snapshot, index, loading, error, staleWarning, fetchedAt, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData buiten DataProvider');
  return v;
}
