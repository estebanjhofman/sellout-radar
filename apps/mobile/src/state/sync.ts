import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { readJson, writeJson } from '../lib/storage';
import { supabaseEnabled, syncGet, syncPut } from '../lib/supabase';
import type { Prefs } from './prefs';

/**
 * Koppelcode: alle apparaten met dezelfde code delen hun sterren, tickets en inschrijvingen.
 * Instellingen (meldingen, stille uren) blijven per apparaat.
 *
 * Werkwijze: bij het openen en daarna elke minuut haalt de app de gedeelde lijsten op; is die nieuwer
 * dan wat dit apparaat het laatst zag, dan neemt de app hem over. Een wijziging op dit apparaat gaat na
 * anderhalve seconde naar de server. Bij gelijktijdige wijzigingen wint de laatste.
 */
const SYNC_KEY = 'sync:v1';
const SYNC_FIELDS = ['followedEvents', 'followedTours', 'followedArtists', 'mutedEvents', 'ownedEvents', 'ownedInfo', 'registered'] as const;
type SyncField = (typeof SYNC_FIELDS)[number];

export interface SyncState {
  available: boolean;
  /** Koppelcode, met streepjes (XXXX-XXXX-XXXX-XXXX), of null als dit apparaat niet gekoppeld is. */
  code: string | null;
  status: 'off' | 'busy' | 'ok' | 'error';
  message?: string;
  /** Laatste keer dat de gedeelde lijsten zijn opgehaald of opgeslagen. */
  lastAt?: string;
}

export interface SyncApi {
  sync: SyncState;
  createSyncCode: () => Promise<void>;
  joinSyncCode: (code: string) => Promise<void>;
  leaveSync: () => void;
  syncNow: () => Promise<void>;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 16 tekens uit 31 mogelijke (ongeveer 79 bits): niet te raden. */
function newCode(): string {
  const bytes = new Uint32Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 2 ** 32);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** "k7p4 qx92-m…" → "K7P4QX92M…" (zonder streepjes, hoofdletters). */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

function part(p: Prefs): Record<SyncField, unknown> {
  return Object.fromEntries(SYNC_FIELDS.map((k) => [k, p[k] ?? (k === 'ownedInfo' || k === 'registered' ? {} : [])])) as Record<SyncField, unknown>;
}

/** Alleen bekende velden met het juiste soort waarde overnemen. */
function sanitize(remote: Record<string, unknown>): Partial<Prefs> {
  const out: Record<string, unknown> = {};
  for (const k of SYNC_FIELDS) {
    const v = remote[k];
    const isObj = k === 'ownedInfo' || k === 'registered';
    if (isObj ? v && typeof v === 'object' && !Array.isArray(v) : Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v;
  }
  return out as Partial<Prefs>;
}

export function usePrefSync(prefs: Prefs, setPrefs: Dispatch<SetStateAction<Prefs>>, ready: boolean): SyncApi {
  const available = supabaseEnabled();
  const [sync, setSync] = useState<SyncState>({ available, code: null, status: 'off' });
  const codeRef = useRef<string | null>(null);
  const remoteAtRef = useRef<string | null>(null);
  /** JSON van de gedeelde velden zoals laatst verstuurd of overgenomen. */
  const lastJson = useRef('');
  /** Pas versturen na de eerste keer ophalen, zodat oude lokale lijsten de server niet overschrijven. */
  const pulled = useRef(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const save = useCallback(() => {
    void writeJson(SYNC_KEY, { code: codeRef.current, remoteAt: remoteAtRef.current });
  }, []);

  const push = useCallback(async () => {
    const code = codeRef.current;
    if (!code || !pulled.current) return;
    const p = part(prefsRef.current);
    const json = JSON.stringify(p);
    if (json === lastJson.current) return;
    setSync((s) => ({ ...s, status: 'busy' }));
    try {
      const at = await syncPut(code, p);
      lastJson.current = json;
      remoteAtRef.current = at;
      save();
      setSync((s) => ({ ...s, status: 'ok', message: undefined, lastAt: new Date().toISOString() }));
    } catch (e) {
      setSync((s) => ({ ...s, status: 'error', message: `Opslaan lukte niet: ${(e as Error).message}` }));
    }
  }, [save]);

  /** Ophalen; true als er gedeelde lijsten bestaan. */
  const pull = useCallback(async (): Promise<boolean> => {
    const code = codeRef.current;
    if (!code) return false;
    try {
      const r = await syncGet(code);
      if (!r) {
        setSync((s) => ({ ...s, status: 'error', message: 'Deze koppelcode is niet (meer) bekend.' }));
        return false;
      }
      if (!remoteAtRef.current || r.updatedAt > remoteAtRef.current) {
        const remote = sanitize(r.prefs);
        setPrefs((p) => {
          const next = { ...p, ...remote };
          lastJson.current = JSON.stringify(part(next));
          return next;
        });
        remoteAtRef.current = r.updatedAt;
        save();
      }
      pulled.current = true;
      setSync((s) => ({ ...s, status: 'ok', message: undefined, lastAt: new Date().toISOString() }));
      return true;
    } catch (e) {
      setSync((s) => ({ ...s, status: 'error', message: `Ophalen lukte niet: ${(e as Error).message}` }));
      return false;
    }
  }, [save, setPrefs]);

  // Opstarten: bewaarde koppelcode laden en meteen ophalen.
  useEffect(() => {
    if (!ready || !available) return;
    void readJson<{ code: string | null; remoteAt: string | null }>(SYNC_KEY).then(async (s) => {
      if (!s?.code) return;
      codeRef.current = s.code;
      remoteAtRef.current = s.remoteAt;
      setSync((x) => ({ ...x, code: formatCode(s.code!), status: 'busy' }));
      if (await pull()) void push(); // wijzigingen van terwijl het apparaat offline was
    });
  }, [ready, available, pull, push]);

  // Elke minuut, en zodra de app weer in beeld komt.
  useEffect(() => {
    if (!available) return;
    const t = setInterval(() => void pull(), 60_000);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void pull();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [available, pull]);

  // Wijziging op dit apparaat: na anderhalve seconde versturen.
  useEffect(() => {
    if (!ready || !codeRef.current) return;
    const t = setTimeout(() => void push(), 1500);
    return () => clearTimeout(t);
  }, [prefs, ready, push]);

  const createSyncCode = useCallback(async () => {
    const code = newCode();
    setSync((s) => ({ ...s, status: 'busy' }));
    const p = part(prefsRef.current);
    try {
      const at = await syncPut(code, p);
      codeRef.current = code;
      remoteAtRef.current = at;
      lastJson.current = JSON.stringify(p);
      pulled.current = true;
      save();
      setSync((s) => ({ ...s, code: formatCode(code), status: 'ok', message: undefined, lastAt: new Date().toISOString() }));
    } catch (e) {
      setSync((s) => ({ ...s, status: 'error', message: `Koppelcode maken lukte niet: ${(e as Error).message}` }));
    }
  }, [save]);

  const joinSyncCode = useCallback(
    async (input: string) => {
      const code = normalizeCode(input);
      if (code.length !== 16) {
        setSync((s) => ({ ...s, status: 'error', message: 'Een koppelcode heeft 16 tekens.' }));
        return;
      }
      const prevCode = codeRef.current;
      const prevAt = remoteAtRef.current;
      codeRef.current = code;
      remoteAtRef.current = null; // altijd overnemen
      setSync((s) => ({ ...s, status: 'busy' }));
      if (await pull()) {
        save();
        setSync((s) => ({ ...s, code: formatCode(code) }));
      } else {
        codeRef.current = prevCode;
        remoteAtRef.current = prevAt;
      }
    },
    [pull, save],
  );

  const leaveSync = useCallback(() => {
    codeRef.current = null;
    remoteAtRef.current = null;
    pulled.current = false;
    lastJson.current = '';
    save();
    setSync({ available, code: null, status: 'off' });
  }, [available, save]);

  const syncNow = useCallback(async () => {
    if (await pull()) await push();
  }, [pull, push]);

  return { sync, createSyncCode, joinSyncCode, leaveSync, syncNow };
}
