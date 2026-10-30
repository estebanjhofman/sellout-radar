import type { Fetcher } from '../http';
import type { PushMessage } from './plan';

/**
 * Versturen via de Expo Push API (gratis). Ongeldige tokens (app verwijderd) komen terug
 * zodat ze uit de database kunnen.
 * Documentatie: https://docs.expo.dev/push-notifications/sending-notifications/
 */
export interface PushResult {
  sent: number;
  failed: number;
  invalidTokens: string[];
  errors: string[];
}

export async function sendExpoPush(http: Fetcher, messages: PushMessage[], accessToken?: string): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, invalidTokens: [], errors: [] };
  const flat = messages.flatMap((m) =>
    m.tokens.map((to) => ({
      to,
      title: m.title,
      body: m.body,
      sound: 'default',
      priority: 'high',
      data: { url: m.url, key: m.key },
    })),
  );
  for (let i = 0; i < flat.length; i += 100) {
    const batch = flat.slice(i, i + 100);
    try {
      const r = await http.post('https://exp.host/--/api/v2/push/send', batch, {
        headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      });
      if (!r.ok) {
        result.failed += batch.length;
        result.errors.push(`Expo HTTP ${r.status}`);
        continue;
      }
      const data = (JSON.parse(r.text) as { data?: { status: string; message?: string; details?: { error?: string } }[] }).data ?? [];
      data.forEach((t, j) => {
        if (t.status === 'ok') result.sent++;
        else {
          result.failed++;
          if (t.details?.error === 'DeviceNotRegistered') result.invalidTokens.push(batch[j]!.to);
          else if (t.message) result.errors.push(t.message);
        }
      });
    } catch (e) {
      result.failed += batch.length;
      result.errors.push((e as Error).message);
    }
  }
  return result;
}
