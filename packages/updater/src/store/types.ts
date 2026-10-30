import type { NotifySettings } from '@sellout/core';
import type { RunDelta, State } from '../state';

/** Eén gebruiker (anonieme login in de app) met zijn apparaten, volglijst en instellingen. */
export interface PushTarget {
  userId: string;
  tokens: string[];
  settings: NotifySettings;
  /** Meldingen standaard aan vanaf deze score; null = alleen gevolgde data. */
  scoreThreshold: number | null;
  followedEvents: Set<string>;
  followedTours: Set<string>;
  followedArtists: Set<string>;
  /** Volgen met meldingen uit. */
  mutedEvents: Set<string>;
  /** Meldingsleutels die het toestel zelf lokaal heeft ingepland. */
  scheduledKeys: Set<string>;
  lastSyncAt?: string;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  slot: string;
  ok: boolean;
  counts: Record<string, number>;
  errors: string[];
}

export interface Store {
  readonly kind: 'file' | 'supabase';
  load(): Promise<State>;
  save(state: State, delta: RunDelta, run: RunSummary): Promise<void>;
  pushTargets(): Promise<PushTarget[]>;
  /** Tokens van verwijderde apps opruimen. */
  removePushTokens(tokens: string[]): Promise<void>;
}
