import { describe, expect, it } from 'vitest';
import { findWeekdayMismatches, isOfficial, resolveClaims } from '../src/claims';
import type { Claim } from '../src/types';
import { S } from './fixtures';

describe('weekdagcontrole', () => {
  it('ziet dat "Tuesday, October 28th" niet klopt: 28 oktober 2026 is een woensdag (Bon Jovi, The Music Universe)', () => {
    const text =
      'North American presales start on Tuesday, October 28th, ahead of the general sale on Friday, October 30th, at 10 am local time.';
    const m = findWeekdayMismatches(text, 2026);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ stated: 2, actual: 3, date: '2026-10-28' });
  });

  it('accepteert correcte combinaties in meerdere talen', () => {
    expect(findWeekdayMismatches('Monday, April 26, 2027 | Stockholm | Strawberry Arena', 2027)).toEqual([]);
    expect(findWeekdayMismatches('Wednesday, Oct. 28, 2026 at 10 a.m.', 2026)).toEqual([]);
    expect(findWeekdayMismatches('vrijdag 6 november om 10.00 uur', 2026)).toEqual([]);
    expect(findWeekdayMismatches('Samstag, 5. Juni', 2027)).toEqual([]);
  });

  it('vindt fouten ook in het Nederlands', () => {
    expect(findWeekdayMismatches('donderdag 6 november', 2026)).toHaveLength(1);
  });
});

describe('bronvoorrang bij conflicten', () => {
  const venue = (source: (typeof S)[keyof typeof S], value: string): Claim<string> => ({
    entity: 'event:u2-2027-06-30',
    field: 'city',
    value,
    source,
  });

  it('U2 30 juni: officiële bronnen (Berlijn) gaan voor de fansite (München); het conflict blijft zichtbaar', () => {
    const r = resolveClaims([venue(S.u2tours, 'Munich'), venue(S.louder, 'Berlin'), venue(S.u2com, 'Berlin'), venue(S.u2EuStore, 'Berlin')]);
    expect(r.value).toBe('Berlin');
    expect(isOfficial(r.winner!.source)).toBe(true);
    expect(r.conflict).not.toBeNull();
    expect(r.conflict!.alternatives).toEqual([{ value: 'Munich', source: S.u2tours }]);
    expect(r.conflict!.reason).toBe('Gekozen: U2.com tourpagina (officiële bron). Afwijkend: u2tours.com.');
  });

  it('zonder officiële bron: nieuwste wint, conflict gemarkeerd (ATEEZ Incheon)', () => {
    const a: Claim<string[]> = { entity: 'tour:ateez', field: 'incheonDates', value: ['2027-01-22', '2027-01-23', '2027-01-25'], source: S.joongang };
    const b: Claim<string[]> = {
      entity: 'tour:ateez',
      field: 'incheonDates',
      value: ['2027-01-22', '2027-01-23', '2027-01-24'],
      source: { ...S.karlobag, fetchedAt: '2026-10-29T19:00:00.000Z' },
    };
    const r = resolveClaims([a, b]);
    expect(r.value).toEqual(['2027-01-22', '2027-01-23', '2027-01-24']);
    expect(r.conflict!.reason).toMatch(/^Geen officiële bron/);
  });

  it('alleen de laatste bewering per bron telt', () => {
    const older: Claim<string> = { entity: 'e', field: 'status', value: 'onsale', source: { ...S.pollstar, fetchedAt: '2026-10-29T10:00:00Z' } };
    const newer: Claim<string> = { entity: 'e', field: 'status', value: 'soldout', source: { ...S.pollstar, fetchedAt: '2026-10-29T18:00:00Z' } };
    const r = resolveClaims([older, newer]);
    expect(r.value).toBe('soldout');
    expect(r.conflict).toBeNull();
    expect(r.latest).toHaveLength(1);
  });

  it('geen beweringen: niets ingevuld', () => {
    expect(resolveClaims([]).value).toBeNull();
  });

  it('Noah Kahan: twee inschrijfdeadlines per regio botsen niet (aparte fases)', () => {
    const na: Claim<string> = { entity: 'phase:nk-na-artist-registration', field: 'deadline', value: '2026-11-06T04:59:00Z', source: S.pollstar };
    const eu: Claim<string> = { entity: 'phase:nk-eu-laylo-registration', field: 'deadline', value: '2026-11-09T16:00:00Z', source: S.consequence };
    expect(resolveClaims([na]).conflict).toBeNull();
    expect(resolveClaims([eu]).conflict).toBeNull();
  });
});
