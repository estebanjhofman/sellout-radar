import webpush from 'web-push';
import type { PushResult } from './expo';
import type { PushMessage } from './plan';

/**
 * Meldingen in de browser (Web Push), bijv. de webversie op het beginscherm van een iPhone.
 * Het "token" van zo'n apparaat is het abonnement van de browser, als JSON (begint met "{").
 * Versturen gaat versleuteld via de pushdienst van de browser (bij iPhones die van Apple),
 * ondertekend met het VAPID-sleutelpaar uit de instellingen.
 */
export function isWebPushToken(token: string): boolean {
  return token.trimStart().startsWith('{');
}

/** "selloutradar://event/u2-…" → "event/u2-…" (pad binnen de webversie). */
export function webPath(url: string | undefined): string {
  const m = /event\/([^?#]+)/.exec(url ?? '');
  return m ? `event/${m[1]}` : '';
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** Contact voor de pushdienst: een https-adres of mailto:. */
  subject: string;
}

type Sender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

export async function sendWebPush(messages: PushMessage[], vapid: VapidConfig, send?: Sender): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [], errors: [] };
  const doSend: Sender = send ?? ((s, p, o) => webpush.sendNotification(s, p, o));
  for (const m of messages) {
    for (const token of m.tokens.filter(isWebPushToken)) {
      let sub: webpush.PushSubscription;
      try {
        sub = JSON.parse(token) as webpush.PushSubscription;
      } catch {
        result.failed++;
        result.invalidTokens.push(token);
        continue;
      }
      const payload = JSON.stringify({ title: m.title, body: m.body, path: webPath(m.url), key: m.key });
      try {
        await doSend(sub, payload, {
          vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: 12 * 3600,
          urgency: 'high',
        });
        result.sent++;
      } catch (e) {
        result.failed++;
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: het abonnement bestaat niet meer (app verwijderd of meldingen uitgezet).
        if (status === 404 || status === 410) result.invalidTokens.push(token);
        else result.errors.push(`webpush ${status ?? ''} ${(e as Error).message}`.trim());
      }
    }
  }
  return result;
}
