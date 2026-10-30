import type { Config } from '../config';
import { FileStore } from './file';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

export function createStore(cfg: Config): Store {
  return cfg.supabase ? new SupabaseStore(cfg.supabase.url, cfg.supabase.serviceKey, cfg.now) : new FileStore(cfg.dataDir);
}

export type { PushTarget, RunSummary, Store } from './types';
