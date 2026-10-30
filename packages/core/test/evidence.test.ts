import { describe, expect, it } from 'vitest';
import { dateMentioned, timeMentioned, verifyTimePoint } from '../src/evidence';
import { dateOnly, exactLocal, monthOnly, unknownTime } from '../src/time';

/**
 * Een taalmodel mag alleen een datum of tijd opleveren die letterlijk in de bron staat.
 * De fragmenten hieronder zijn echte zinnen uit de startlijstbronnen.
 */
describe('bewijscontrole op echte bronzinnen', () => {
  it('Pollstar, Europese presale: datum en tijd staan erin', () => {
    const ev =
      'Tickets for the European dates will first be available through an artist presale via Laylo, beginning Tuesday, Nov. 10th at 12 p.m. local time.';
    const r = verifyTimePoint(exactLocal('2026-11-10', '12:00', 'Europe/Amsterdam'), ev);
    expect(r.timePoint?.precision).toBe('exact');
    expect(r.warnings).toEqual([]);
  });

  it('Pollstar, Noord-Amerikaanse deadline met tikfout "11:5 9.p.m": tijd onzeker, alleen de datum blijft', () => {
    const ev = 'Fans interested in the artist presale on Tuesday, Nov. 10th at 12 p.m. must sign up before  Nov. 5th at 11:5 9.p.m ET.';
    const r = verifyTimePoint(exactLocal('2026-11-05', '23:59', 'America/New_York'), ev);
    expect(r.timePoint).toEqual({ precision: 'date', tz: 'America/New_York', localDate: '2026-11-05' });
    expect(r.warnings[0]).toMatch(/Tijd 23:59 staat niet in het bewijs/);
  });

  it('Consequence, Europese deadline "Monday, November 9th at 5:00 p.m."', () => {
    const ev = "you'll need to sign up by Monday, November 9th at 5:00 p.m. local time.";
    expect(verifyTimePoint(exactLocal('2026-11-09', '17:00', 'Europe/Amsterdam'), ev).timePoint?.precision).toBe('exact');
  });

  it('U2 EU Store: "12:00pm GMT (1:00pm CET) on Friday 30th October 2026"', () => {
    const ev = 'by 12:00pm GMT (1:00pm CET) on Friday 30th October 2026';
    expect(verifyTimePoint(exactLocal('2026-10-30', '12:00', 'Europe/London'), ev).warnings).toEqual([]);
  });

  it('verzonnen datum wordt verworpen', () => {
    const ev = 'Remaining tickets will be available via the general onsale starting Thursday, Nov. 12 at 12 p.m. local time.';
    const r = verifyTimePoint(exactLocal('2026-11-13', '12:00', 'Europe/Amsterdam'), ev);
    expect(r.timePoint).toBeNull();
  });

  it('zonder bewijsfragment geen tijdstip', () => {
    expect(verifyTimePoint(dateOnly('2026-11-12', 'Europe/Amsterdam'), undefined).timePoint).toBeNull();
    expect(verifyTimePoint(dateOnly('2026-11-12', 'Europe/Amsterdam'), '  ').timePoint).toBeNull();
  });

  it('"nog niet bekend" hoeft geen bewijs', () => {
    expect(verifyTimePoint(unknownTime('Europe/Amsterdam'), undefined).timePoint?.precision).toBe('unknown');
  });

  it('maand alleen met maand én jaar in het fragment (ATEEZ: Europa in april 2027)', () => {
    expect(verifyTimePoint(monthOnly('2027-04', 'Europe/Amsterdam'), 'the 2027 tour will expand its stage to Europe in April').timePoint).not.toBeNull();
    expect(verifyTimePoint(monthOnly('2027-04', 'Europe/Amsterdam'), 'expand its stage to Europe in April').timePoint).toBeNull();
  });
});

describe('datum- en tijdpatronen', () => {
  it('herkent gangbare notaties', () => {
    expect(dateMentioned('2026-11-06', 'Friday 6th November')).toBe(true);
    expect(dateMentioned('2026-11-06', 'vrijdag 6 november')).toBe(true);
    expect(dateMentioned('2026-11-06', 'Fri 6 Nov')).toBe(true);
    expect(dateMentioned('2026-11-06', '06-11-2026')).toBe(true);
    expect(dateMentioned('2026-11-06', '11/6/2026')).toBe(true);
    expect(dateMentioned('2026-11-06', 'vendredi 6 novembre')).toBe(true);
    expect(dateMentioned('2026-11-06', 'November 16')).toBe(false);
    expect(timeMentioned('10:00', '10am local time')).toBe(true);
    expect(timeMentioned('10:00', 'om 10.00 uur')).toBe(true);
    expect(timeMentioned('22:00', 'close Wed 4 Nov, 10pm')).toBe(true);
    expect(timeMentioned('12:00', 'at noon')).toBe(true);
    expect(timeMentioned('10:00', '11am')).toBe(false);
  });
});
