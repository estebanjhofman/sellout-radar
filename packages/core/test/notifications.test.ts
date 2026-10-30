import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  changeNotification,
  DEFAULT_NOTIFY_SETTINGS,
  diffSnapshots,
  inNotifyScope,
  isUrgentChange,
  planPhaseNotifications,
  selectForLocalSchedule,
  shiftOutOfQuietHours,
  type ChangeSnapshot,
  type NotifySettings,
  type PlannedNotification,
} from '../src/notifications';
import { dateOnly, exactLocal } from '../src/time';
import type { SalePhase } from '../src/types';
import { NOW, PHASES } from './fixtures';

const now = DateTime.fromISO(NOW); // do 29 okt 19:00 NL
const ctx = (subject: string, at = now, settings: NotifySettings = DEFAULT_NOTIFY_SETTINGS) => ({ now: at, settings, subject });
const nl = (iso: string) => DateTime.fromISO(iso).setZone('Europe/Amsterdam').toFormat('ccc dd LLL HH:mm');

describe('meldingen 12 uur vooraf, stille uren 23:00–07:00: eerder, nooit later', () => {
  it('Bon Jovi algemene verkoop vr 30 okt 15:00 NL → do 29 okt 22:59', () => {
    const [n] = planPhaseNotifications(PHASES.bonJoviNjGeneral, ctx('Bon Jovi · East Rutherford'));
    expect(nl(n!.idealAt)).toBe('Fri 30 Oct 03:00');
    expect(nl(n!.sendAt)).toBe('Thu 29 Oct 22:59');
    expect(n!.title).toBe('Algemene verkoop morgen 15:00: Bon Jovi · East Rutherford');
    expect(n!.body).toContain('10:00 EDT');
    expect(n!.body).toContain('15:00 NL');
  });

  it('U2 Amsterdam algemene verkoop vr 6 nov 10:00 → do 5 nov 22:00 (buiten stille uren)', () => {
    const [n] = planPhaseNotifications(PHASES.u2AmsGeneral, ctx('U2 · Amsterdam'));
    expect(nl(n!.sendAt)).toBe('Thu 05 Nov 22:00');
    expect(n!.url).toBe('selloutradar://event/u2-2027-06-05-amsterdam?phase=u2-general-ams');
  });

  it('Noah Kahan inschrijfdeadline ma 9 nov 17:00 → zo 8 nov 22:59', () => {
    const ns = planPhaseNotifications(PHASES.nkEuRegistration, ctx('Noah Kahan · Groningen'));
    const deadline = ns.find((n) => n.kind === 'registration_deadline')!;
    expect(nl(deadline.idealAt)).toBe('Mon 09 Nov 05:00');
    expect(nl(deadline.sendAt)).toBe('Sun 08 Nov 22:59');
    expect(deadline.title).toBe('Inschrijving sluit morgen 17:00: Noah Kahan · Groningen');
  });

  it('Noah Kahan presale di 10 nov 12:00 → ma 9 nov 22:59', () => {
    const [n] = planPhaseNotifications(PHASES.nkEuPresale, ctx('Noah Kahan · Groningen'));
    expect(nl(n!.idealAt)).toBe('Tue 10 Nov 00:00');
    expect(nl(n!.sendAt)).toBe('Mon 09 Nov 22:59');
  });

  it('een open inschrijving meldt meteen, en de deadline 12 uur vooraf (U2 EU Store)', () => {
    const ns = planPhaseNotifications(PHASES.u2EuStoreRegistration, ctx('U2 · Amsterdam'));
    const open = ns.find((n) => n.kind === 'registration_open')!;
    const deadline = ns.find((n) => n.kind === 'registration_deadline')!;
    expect(open.sendAt).toBe(now.toUTC().toISO());
    expect(open.title).toBe('Inschrijving is open: U2 · Amsterdam');
    expect(open.body).toContain('13:00 NL');
    expect(nl(deadline.sendAt)).toBe('Thu 29 Oct 22:59');
  });

  it('is het ideale moment al voorbij, dan gaat de melding meteen', () => {
    const late = DateTime.fromISO('2026-10-29T22:30:00Z'); // 23:30 NL, al in de stille uren
    const [n] = planPhaseNotifications(PHASES.bonJoviNjGeneral, ctx('Bon Jovi', late));
    expect(n!.sendAt).toBe(late.toUTC().toISO());
  });

  it('geen melding meer als het moment zelf voorbij is', () => {
    const after = DateTime.fromISO('2026-10-30T15:00:00Z');
    expect(planPhaseNotifications(PHASES.bonJoviNjGeneral, ctx('Bon Jovi', after))).toEqual([]);
  });

  it('alleen een datum bekend: rekent vanaf 00:00 lokale tijd (EU Store-presale wo 4 nov)', () => {
    const [n] = planPhaseNotifications(PHASES.u2EuStorePresale, ctx('U2 · Amsterdam'));
    expect(nl(n!.idealAt)).toBe('Tue 03 Nov 12:00');
    expect(nl(n!.sendAt)).toBe('Tue 03 Nov 12:00');
    expect(n!.title).toBe('Presale morgen: U2 · Amsterdam');
    expect(n!.body).toContain('tijd nog niet bekend');
    expect(n!.body).toContain('Code nodig');
  });

  it('inschrijfdeadline met alleen een datum (U2 artist presale, zo 1 nov): melding za 31 okt 12:00', () => {
    const ns = planPhaseNotifications(PHASES.u2ArtistRegistration, ctx('U2 · Amsterdam'));
    const deadline = ns.find((n) => n.kind === 'registration_deadline')!;
    expect(nl(deadline.sendAt)).toBe('Sat 31 Oct 12:00');
    expect(deadline.title).toBe('Inschrijving sluit morgen: U2 · Amsterdam');
    expect(deadline.body).toContain('tijd nog niet bekend');
  });

  it('onbekende verkoopdatum: geen tijdmelding (ATEEZ)', () => {
    expect(planPhaseNotifications(PHASES.ateezAll, ctx('ATEEZ · Amsterdam'))).toEqual([]);
  });

  it('extra herinnering 1 uur vooraf, ook in de stille uren eerder', () => {
    const s = { ...DEFAULT_NOTIFY_SETTINGS, extraReminderMinutes: 60 };
    const ns = planPhaseNotifications(PHASES.nkEuPresale, ctx('Noah Kahan · Groningen', now, s));
    const extra = ns.find((n) => n.kind === 'phase_extra')!;
    expect(nl(extra.sendAt)).toBe('Tue 10 Nov 11:00');
    expect(extra.title).toBe('Over 1 uur: Artist presale (Laylo)');

    const early: SalePhase = { ...PHASES.nkEuPresale, id: 'x', start: exactLocal('2026-11-10', '07:30', 'Europe/Amsterdam') };
    const e2 = planPhaseNotifications(early, ctx('test', now, s)).find((n) => n.kind === 'phase_extra')!;
    expect(nl(e2.sendAt)).toBe('Mon 09 Nov 22:59');
  });

  it('meldtermijn is minimaal 12 uur, ook als de instelling lager staat', () => {
    const s = { ...DEFAULT_NOTIFY_SETTINGS, leadHours: 2 };
    const [n] = planPhaseNotifications(PHASES.u2AmsGeneral, ctx('U2', now, s));
    expect(nl(n!.idealAt)).toBe('Thu 05 Nov 22:00');
  });

  it('stille uren uit: precies 12 uur vooraf', () => {
    const s = { ...DEFAULT_NOTIFY_SETTINGS, quiet: { enabled: false, start: '23:00', end: '07:00' } };
    const [n] = planPhaseNotifications(PHASES.bonJoviNjGeneral, ctx('Bon Jovi', now, s));
    expect(nl(n!.sendAt)).toBe('Fri 30 Oct 03:00');
  });

  it('venster binnen één dag (bijv. 13:00–14:00) werkt ook', () => {
    const s = { ...DEFAULT_NOTIFY_SETTINGS, quiet: { enabled: true, start: '13:00', end: '14:00' } };
    const at = DateTime.fromISO('2026-11-05T12:30:00Z'); // 13:30 NL
    expect(nl(shiftOutOfQuietHours(at, s).toISO()!)).toBe('Thu 05 Nov 12:59');
  });
});

describe('selectie voor lokale meldingen (iOS: max 64)', () => {
  it('kiest de eerstvolgende 64 en ontdubbelt', () => {
    const planned: PlannedNotification[] = Array.from({ length: 100 }, (_, i) => ({
      key: `k${i % 90}`,
      kind: 'phase_start',
      eventIds: ['e'],
      idealAt: now.plus({ hours: i + 1 }).toUTC().toISO()!,
      sendAt: now.plus({ hours: i + 1 }).toUTC().toISO()!,
      title: 't',
      body: 'b',
      url: 'u',
    }));
    const sel = selectForLocalSchedule(planned, now);
    expect(sel).toHaveLength(64);
    expect(sel[0]!.key).toBe('k0');
    expect(new Set(sel.map((n) => n.key)).size).toBe(64);
  });
});

describe('wijzigingen', () => {
  const prev: ChangeSnapshot = {
    events: [
      { id: 'nk-2027-07-23-london', title: 'Noah Kahan · Londen', status: 'onsale', score: 88 },
      { id: 'u2-2027-06-05-amsterdam', title: 'U2 · Amsterdam', status: 'announced', score: 45 },
    ],
    phases: [{ id: 'u2-general-ams', name: 'Algemene verkoop', kind: 'general_sale', start: dateOnly('2026-11-06', 'Europe/Amsterdam'), eventIds: ['u2-2027-06-05-amsterdam'] }],
  };
  const next: ChangeSnapshot = {
    events: [
      { id: 'nk-2027-07-23-london', title: 'Noah Kahan · Londen', status: 'soldout', score: 100 },
      { id: 'nk-2027-07-25-london', title: 'Noah Kahan · Londen', status: 'announced', addedShow: true, score: 70 },
      { id: 'u2-2027-06-05-amsterdam', title: 'U2 · Amsterdam', status: 'announced', score: 61 },
    ],
    phases: [
      { id: 'u2-general-ams', name: 'Algemene verkoop', kind: 'general_sale', start: PHASES.u2AmsGeneral.start, eventIds: ['u2-2027-06-05-amsterdam'] },
      { id: 'u2-artist-presale-cet', name: 'U2 Artist Presale', kind: 'presale', start: PHASES.u2ArtistPresale.start, eventIds: ['u2-2027-06-05-amsterdam'] },
    ],
  };

  it('vindt uitverkocht, extra show, scoresprong ≥ 15, nieuwe fase en gewijzigde verkoopdatum', () => {
    const changes = diffSnapshots(prev, next);
    // Wembley 88 → 100 is een sprong van 12: dat meldt "uitverkocht", geen scoresprong.
    expect(changes.map((c) => c.type).sort()).toEqual(['extra_show', 'new_phase', 'sale_date', 'score_jump', 'soldout']);
    expect(changes.find((c) => c.type === 'score_jump')).toMatchObject({ eventId: 'u2-2027-06-05-amsterdam', before: 45, after: 61 });
  });

  it('scoresprong van 14 telt niet', () => {
    const p2 = { ...prev, events: [{ ...prev.events[1]!, score: 47 }] };
    expect(diffSnapshots(p2, { ...next, phases: prev.phases }).filter((c) => c.type === 'score_jump')).toHaveLength(0);
  });

  it('wijziging in de stille uren gaat om 07:00, behalve als ze urgent is', () => {
    const at0643 = DateTime.fromISO('2026-11-02T05:43:00Z'); // 06:43 NL
    const change = { type: 'extra_show' as const, eventId: 'nk-2027-07-25-london', title: 'Noah Kahan · Londen' };
    expect(nl(changeNotification(change, at0643, DEFAULT_NOTIFY_SETTINGS).sendAt)).toBe('Mon 02 Nov 07:00');
    expect(changeNotification(change, at0643, DEFAULT_NOTIFY_SETTINGS, true).sendAt).toBe(at0643.toUTC().toISO());
  });

  it('nieuwe fase die binnen 12 uur begint is urgent', () => {
    const at = DateTime.fromISO('2026-11-05T05:43:00Z'); // 06:43 NL, artist presale om 10:00
    const c = { type: 'new_phase' as const, phaseId: 'u2-artist-presale-cet', name: 'U2 Artist Presale', eventIds: [] };
    expect(isUrgentChange(c, [PHASES.u2ArtistPresale], at)).toBe(true);
    expect(isUrgentChange(c, [PHASES.u2ArtistPresale], now)).toBe(false);
  });

  it('gewijzigde verkoopdatum noemt oud en nieuw', () => {
    const c = diffSnapshots(prev, next).find((x) => x.type === 'sale_date')!;
    const n = changeNotification(c, now, DEFAULT_NOTIFY_SETTINGS);
    expect(n.body).toBe('Was vr 6 nov 2026 (tijd nog niet bekend), nu vr 6 nov 2026, 10:00 CET.');
  });
});

describe('voor welke data meldingen aan staan', () => {
  const scope = { followed: new Set(['nk-2027-07-01-groningen']), muted: new Set(['u2-2027-06-06-amsterdam']), scoreThreshold: 70 };
  it('gevolgd, score ≥ 70, of uitgezet', () => {
    expect(inNotifyScope('nk-2027-07-01-groningen', 20, scope)).toBe(true);
    expect(inNotifyScope('x', 70, scope)).toBe(true);
    expect(inNotifyScope('x', 69, scope)).toBe(false);
    expect(inNotifyScope('u2-2027-06-06-amsterdam', 95, scope)).toBe(false);
    expect(inNotifyScope('x', 95, { ...scope, scoreThreshold: null })).toBe(false);
  });
});
