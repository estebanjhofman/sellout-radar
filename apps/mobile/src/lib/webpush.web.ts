import { VAPID_PUBLIC_KEY } from './config';
import { registerDevice, supabaseEnabled } from './supabase';

/**
 * Meldingen in de browser (Web Push). Op een iPhone werkt dit alleen in de webapp op het beginscherm
 * (Safari → Deel → Zet op beginscherm), vanaf iOS 16.4. De server (de updater) verstuurt de meldingen.
 */
export type WebPushStatus = 'unsupported' | 'needs-home-screen' | 'not-configured' | 'denied' | 'off' | 'on';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Map van de site (waar manifest en service worker staan), bijv. https://naam.github.io/sellout-radar/ */
function siteBase(): string {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  return link?.href ? new URL('.', link.href).href : new URL('/', location.href).href;
}

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration(siteBase());
}

export async function webPushStatus(): Promise<WebPushStatus> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-home-screen';
  if (!VAPID_PUBLIC_KEY || !supabaseEnabled()) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration())?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Aanroepen vanuit een tik op een knop: iOS vraagt alleen dan om toestemming. */
export async function enableWebPush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Meldingen zijn niet toegestaan. Zet ze aan in Instellingen → Meldingen → Sellout Radar.');
  const base = siteBase();
  const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) as BufferSource }));
  await registerDevice(JSON.stringify(sub));
}

export async function disableWebPush(): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  await sub?.unsubscribe();
}

/** Bij het openen: een bestaand abonnement opnieuw aanmelden (het kan door de browser vernieuwd zijn). */
export async function refreshWebPush(): Promise<void> {
  if (!supported() || !VAPID_PUBLIC_KEY || !supabaseEnabled()) return;
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) await registerDevice(JSON.stringify(sub));
}
