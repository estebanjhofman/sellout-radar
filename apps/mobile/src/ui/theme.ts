import { useSyncExternalStore } from 'react';
import { Platform, useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  accentText: string;
  chip: string;
  chipActive: string;
  chipActiveText: string;
  warnBg: string;
  warnText: string;
  infoBg: string;
  infoText: string;
  up: string;
  down: string;
}

const light: Theme = {
  dark: false,
  bg: '#F5F6F8',
  card: '#FFFFFF',
  cardAlt: '#F0F2F5',
  text: '#11161D',
  muted: '#5A6573',
  faint: '#8A94A1',
  border: '#E1E5EA',
  accent: '#2459D8',
  accentText: '#FFFFFF',
  chip: '#EBEEF2',
  chipActive: '#11161D',
  chipActiveText: '#FFFFFF',
  warnBg: '#FFF4E0',
  warnText: '#7A4A00',
  infoBg: '#E8F0FF',
  infoText: '#1D3F8F',
  up: '#1E8E4E',
  down: '#C2362F',
};

const dark: Theme = {
  dark: true,
  bg: '#0B0F14',
  card: '#151B22',
  cardAlt: '#1B232C',
  text: '#E9EEF3',
  muted: '#9AA5B2',
  faint: '#6E7986',
  border: '#26303B',
  accent: '#6E9BFF',
  accentText: '#0B0F14',
  chip: '#1E2731',
  chipActive: '#E9EEF3',
  chipActiveText: '#0B0F14',
  warnBg: '#3A2A10',
  warnText: '#FFD48A',
  infoBg: '#16264A',
  infoText: '#B9CCFF',
  up: '#4CC27E',
  down: '#FF7B72',
};

/**
 * Op het web kan de omringende pagina een expliciete keuze maken met data-theme="dark" of "light"
 * op het root-element (bijv. als de demo als artifact wordt getoond). Die keuze gaat voor;
 * anders volgen we het systeem.
 */
const hostListeners = new Set<() => void>();
let hostObserver: MutationObserver | null = null;

function readHostTheme(): 'light' | 'dark' | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const v = document.documentElement.getAttribute('data-theme');
  return v === 'dark' || v === 'light' ? v : null;
}

function subscribeHostTheme(cb: () => void): () => void {
  hostListeners.add(cb);
  if (!hostObserver && Platform.OS === 'web' && typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    hostObserver = new MutationObserver(() => hostListeners.forEach((l) => l()));
    hostObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  return () => {
    hostListeners.delete(cb);
  };
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const host = useSyncExternalStore(subscribeHostTheme, readHostTheme, () => null);
  return (host ?? system) === 'dark' ? dark : light;
}

/** Donkere of lichte tekst op een gekleurde achtergrond (leesbaar op geel én rood). */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.33 ? '#11161D' : '#FFFFFF';
}
