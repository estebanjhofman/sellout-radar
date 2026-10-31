import path from 'node:path';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFY_SETTINGS } from '@sellout/core';
import { REPO_ROOT } from '../src/config';
import { planPushes, type PushMessage } from '../src/push/plan';
import { isWebPushToken, sendWebPush, webPath } from '../src/push/web';
import { compileSeedDir } from '../src/seed/compile';
import type { PushTarget } from '../src/store/types';

const NOW = '2026-10-29T17:43:00.000Z';
const SUB = JSON.stringify({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'x', auth: 'y' } });

describe('meldingen in de browser (Web Push)', () => {
  it('herkent een browserabonnement en maakt een pad binnen de webversie', () => {
    expect(isWebPushToken(SUB)).toBe(true);
    expect(isWebPushToken('ExponentPushToken[abc]')).toBe(false);
    expect(webPath('selloutradar://event/u2-2027-06-05-amsterdam')).toBe('event/u2-2027-06-05-amsterdam');
    expect(webPath(undefined)).toBe('');
  });

  it('verstuurt alleen naar browserabonnementen; een verlopen abonnement wordt opgeruimd', async () => {
    const msg = { key: 'k', userId: 'u', tokens: [SUB, 'ExponentPushToken[x]', '{"endpoint":"https://gone"}'], title: 'Presale morgen', body: 'b', url: 'selloutradar://event/e1', deliverAt: NOW } as unknown as PushMessage;
    const calls: string[] = [];
    const res = await sendWebPush([msg], { publicKey: 'p', privateKey: 'q', subject: 'https://github.com/x/y' }, async (sub, payload) => {
      if (sub.endpoint === 'https://gone') throw Object.assign(new Error('Gone'), { statusCode: 410 });
      calls.push(payload);
    });
    expect(res.sent).toBe(1);
    expect(res.invalidTokens).toEqual(['{"endpoint":"https://gone"}']);
    expect(JSON.parse(calls[0]!)).toMatchObject({ title: 'Presale morgen', path: 'event/e1' });
  });
});

describe('tickets: wel wijzigingen, geen verkoopherinneringen', () => {
  const seed = compileSeedDir(path.join(REPO_ROOT, 'data', 'seed')).catalog;
  const events = new Map([...seed.events.values()].map((e) => [e.id, { id: e.id, title: e.title, tourId: e.tourId, artistIds: e.artistIds, score: 40 }]));
  const phases = [...seed.phases.values()];
  const target = (over: Partial<PushTarget>): PushTarget => ({
    userId: 'u1',
    tokens: [SUB],
    settings: DEFAULT_NOTIFY_SETTINGS,
    scoreThreshold: null,
    followedEvents: new Set(),
    followedTours: new Set(),
    followedArtists: new Set(),
    mutedEvents: new Set(),
    scheduledKeys: new Set(),
    ...over,
  });

  it('gevolgd: herinnering; met tickets: geen herinnering, wel de melding over een extra show', () => {
    const plan = (t: PushTarget) =>
      planPushes({
        targets: [t],
        events,
        phases,
        changes: [{ type: 'extra_show', eventId: 'u2-2027-06-05-amsterdam', title: 'U2 · Amsterdam' }],
        now: DateTime.fromISO(NOW),
        sent: {},
      });
    const followed = plan(target({ followedEvents: new Set(['u2-2027-06-05-amsterdam']) }));
    expect(followed.some((m) => m.key.startsWith('registration_deadline:u2-gsoe-2027:eu-store-registration'))).toBe(true);
    const owned = plan(target({ ownedEvents: new Set(['u2-2027-06-05-amsterdam']) }));
    expect(owned.some((m) => m.key.startsWith('registration_deadline'))).toBe(false);
    expect(owned.some((m) => m.kind === 'change_extra_show')).toBe(true);
  });
});

describe('Supabase: lange lijsten in de URL', () => {
  it('verdeelt ID-lijsten zo dat elke URL kort genoeg blijft', async () => {
    const { byUrlLength } = await import('../src/store/supabase');
    const ids = Array.from({ length: 700 }, (_, i) => `ticketmaster:Z698xZ2qZa${i}:presale:ticketmaster-verified-fan-onsale`);
    const parts = byUrlLength(ids);
    expect(parts.flat()).toEqual(ids);
    for (const p of parts) expect(p.map((v) => encodeURIComponent(v).length + 3).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3000);
  });
});
