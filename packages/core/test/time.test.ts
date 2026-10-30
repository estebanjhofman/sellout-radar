import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  countdown,
  dateOnly,
  earliestInstant,
  exactLocal,
  formatDual,
  formatTimePoint,
  latestInstant,
  monthOnly,
  relativeMoment,
  sameTimePoint,
  unknownTime,
  zoneAbbr,
} from '../src/time';
import { PHASES } from './fixtures';

describe('tijdzones en zomertijd', () => {
  it('Bon Jovi East Rutherford: 10:00 EDT op 30 okt is 15:00 in Nederland (5 uur verschil in de DST-week)', () => {
    const tp = PHASES.bonJoviNjGeneral.start;
    expect(tp.utc).toBe('2026-10-30T14:00:00.000Z');
    const d = formatDual(tp);
    expect(d.local).toBe('vr 30 okt 2026, 10:00 EDT');
    expect(d.user).toBe('vr 30 okt 2026, 15:00 NL');
    expect(d.same).toBe(false);
  });

  it('Bon Jovi Chicago: 10:00 CDT is 16:00 in Nederland', () => {
    const d = formatDual(PHASES.bonJoviChicagoGeneral.start);
    expect(d.local).toBe('vr 30 okt 2026, 10:00 CDT');
    expect(d.user).toBe('vr 30 okt 2026, 16:00 NL');
  });

  it('U2 Londen: 10:00 GMT is 11:00 in Nederland', () => {
    const d = formatDual(PHASES.u2LondonGeneral.start);
    expect(d.local).toBe('vr 6 nov 2026, 10:00 GMT');
    expect(d.user).toBe('vr 6 nov 2026, 11:00 NL');
  });

  it('U2 Amsterdam: lokale tijd en NL-tijd zijn gelijk', () => {
    const d = formatDual(PHASES.u2AmsGeneral.start);
    expect(d.same).toBe(true);
    expect(d.local).toBe('vr 6 nov 2026, 10:00 CET');
  });

  it('U2 EU Store-deadline: 12:00 GMT is 13:00 CET', () => {
    const d = formatDual(PHASES.u2EuStoreRegistration.deadline);
    expect(d.user).toBe('vr 30 okt 2026, 13:00 NL');
  });

  it('Noah Kahan Noord-Amerika: 23:59 EST op 5 nov is 05:59 op 6 nov in Nederland (VS al in wintertijd)', () => {
    const d = formatDual(PHASES.nkNaRegistration.deadline);
    expect(d.local).toBe('do 5 nov 2026, 23:59 EST');
    expect(d.user).toBe('vr 6 nov 2026, 05:59 NL');
  });

  it('kent DST-overgangen in de zoneafkorting', () => {
    expect(zoneAbbr(DateTime.fromISO('2027-06-05T20:00', { zone: 'Europe/Amsterdam' }))).toBe('CEST');
    expect(zoneAbbr(DateTime.fromISO('2027-03-04T19:00', { zone: 'Australia/Melbourne' }))).toBe('AEDT');
    expect(zoneAbbr(DateTime.fromISO('2027-04-12T19:00', { zone: 'Asia/Kolkata' }))).toBe('UTC+5:30');
  });
});

describe('onbekend blijft onbekend', () => {
  it('formatteert elke precisie zonder iets in te vullen', () => {
    expect(formatTimePoint(unknownTime('Europe/Amsterdam'))).toBe('nog niet bekend');
    expect(formatTimePoint(undefined)).toBe('nog niet bekend');
    expect(formatTimePoint(dateOnly('2026-11-04', 'Europe/Amsterdam'))).toBe('wo 4 nov 2026 (tijd nog niet bekend)');
    expect(formatTimePoint(monthOnly('2027-04', 'Europe/Amsterdam'))).toBe('april 2027 (dag nog niet bekend)');
  });

  it('heeft geen moment voor onbekende tijden', () => {
    expect(earliestInstant(unknownTime('UTC'))).toBeNull();
    expect(latestInstant(unknownTime('UTC'))).toBeNull();
  });

  it('rekent bij alleen een datum met het vroegst en laatst mogelijke moment', () => {
    const tp = dateOnly('2026-11-04', 'Europe/Amsterdam');
    expect(earliestInstant(tp)!.toISO()).toBe('2026-11-03T23:00:00.000Z');
    expect(latestInstant(tp)!.toUTC().toISO()).toBe('2026-11-04T22:59:59.999Z');
  });

  it('weigert ongeldige invoer in plaats van te gokken', () => {
    expect(() => dateOnly('4 nov', 'Europe/Amsterdam')).toThrow();
    expect(() => exactLocal('2026-11-31', '10:00', 'Europe/Amsterdam')).toThrow();
  });

  it('vergelijkt tijdstippen inclusief precisie', () => {
    expect(sameTimePoint(dateOnly('2026-11-04', 'Europe/Amsterdam'), dateOnly('2026-11-04', 'Europe/Amsterdam'))).toBe(true);
    expect(sameTimePoint(dateOnly('2026-11-04', 'Europe/Amsterdam'), exactLocal('2026-11-04', '10:00', 'Europe/Amsterdam'))).toBe(false);
  });
});

describe('weergave', () => {
  const now = DateTime.fromISO('2026-10-29T18:00:00Z');
  it('relatieve momenten', () => {
    expect(relativeMoment(DateTime.fromISO('2026-10-30T14:00:00Z'), now)).toBe('morgen 15:00');
    expect(relativeMoment(DateTime.fromISO('2026-10-29T21:00:00Z'), now)).toBe('vandaag 22:00');
    expect(relativeMoment(DateTime.fromISO('2026-11-06T09:00:00Z'), now)).toBe('vr 6 nov 10:00');
  });
  it('aftelklok', () => {
    expect(countdown(DateTime.fromISO('2026-11-06T09:00:00Z'), now)).toBe('7 d 15 u');
    expect(countdown(DateTime.fromISO('2026-10-29T20:30:00Z'), now)).toBe('2 u 30 m');
    expect(countdown(DateTime.fromISO('2026-10-29T17:00:00Z'), now)).toBe('nu');
  });
});
