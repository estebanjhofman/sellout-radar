import { describe, expect, it } from 'vitest';
import { eventBadges } from '../src/badges';
import { sameVenue, eventKey, tokenSimilarity } from '../src/dedupe';
import { phaseToGoogleCalendarUrl, phaseToIcs } from '../src/ics';
import { snapshotAgeWarning } from '../src/snapshot';
import { buildTimeline, firstSaleStart, hasKnownSaleDate, nextAction } from '../src/timeline';
import { EVENTS, NOW, PHASES } from './fixtures';

const u2Phases = [
  PHASES.u2AmsGeneral,
  PHASES.u2ArtistPresale,
  PHASES.u2EuStorePresale,
  PHASES.u2FeedbackPresale,
  PHASES.u2ArtistRegistration,
  PHASES.u2EuStoreRegistration,
];

describe('tijdlijn U2 Amsterdam', () => {
  it('zet alle fases chronologisch, met de volgende stap gemarkeerd', () => {
    const tl = buildTimeline(u2Phases, NOW);
    expect(tl.map((i) => i.label)).toEqual([
      'Inschrijving sluit: Inschrijving EU Store-presale',
      'Inschrijving sluit: Inschrijving U2 Artist Presale',
      'U2.com Feedback Group-presale',
      'EU Store-presale',
      'Einde U2.com Feedback Group-presale',
      'U2 Artist Presale',
      'Algemene verkoop',
    ]);
    expect(tl[0]!.state).toBe('next');
    expect(tl.slice(1).every((i) => i.state === 'future')).toBe(true);
  });

  it('volgende actie voor de aftelklok', () => {
    expect(nextAction(u2Phases, NOW)!.phaseId).toBe('u2-eu-store-registration');
    expect(nextAction(u2Phases, '2026-11-05T12:00:00Z')!.phaseId).toBe('u2-general-ams');
  });

  it('een fase die nu loopt heet "now"', () => {
    const tl = buildTimeline(u2Phases, '2026-11-03T12:00:00Z');
    expect(tl.find((i) => i.key === 'u2-feedback-presale-cet:start')!.state).toBe('past');
    expect(tl.find((i) => i.key === 'u2-eu-store-presale-cet:start')!.state).toBe('next');
  });

  it('onbekende momenten staan onderaan, nooit met een geraden datum', () => {
    const tl = buildTimeline([PHASES.ateezAll, PHASES.u2AmsGeneral], NOW);
    expect(tl[1]!.state).toBe('unknown');
    expect(tl[1]!.phaseId).toBe('ateez-eu-sale');
  });

  it('eerste verkoopmoment en bekende verkoopdatum', () => {
    expect(firstSaleStart(u2Phases)!.toUTC().toISO()).toBe('2026-11-02T09:00:00.000Z');
    expect(hasKnownSaleDate([PHASES.ateezAll])).toBe(false);
    expect(hasKnownSaleDate([PHASES.u2EuStorePresale])).toBe(true);
  });
});

describe('badges', () => {
  it('ATEEZ: verkoopdatum nog onbekend en nog niet officieel bevestigd', () => {
    expect(eventBadges(EVENTS.ateezAms, [PHASES.ateezAll]).map((b) => b.label)).toEqual([
      'Verkoopdatum nog onbekend',
      'Nog niet officieel bevestigd',
    ]);
  });
  it('Noah Kahan Wembley: uitverkocht en extra show toegevoegd', () => {
    expect(eventBadges(EVENTS.nkWembley23, []).map((b) => b.label)).toEqual(['Uitverkocht']);
    expect(eventBadges(EVENTS.nkWembley25, [PHASES.nkEuGeneral]).map((b) => b.label)).toEqual([
      'Extra show toegevoegd',
      'Verkoopdatum nog onbekend',
    ]);
  });
  it('conflict wordt een badge', () => {
    expect(eventBadges(EVENTS.u2Ams1, [PHASES.u2AmsGeneral], { hasConflict: true }).map((b) => b.key)).toEqual(['conflict']);
  });
});

describe('agenda (.ics)', () => {
  it('exact moment in UTC, 30 minuten, herinnering een uur vooraf', () => {
    const ics = phaseToIcs({ phase: PHASES.u2AmsGeneral, role: 'start', title: 'Algemene verkoop: U2, Amsterdam', now: NOW })!;
    expect(ics).toContain('DTSTART:20261106T090000Z');
    expect(ics).toContain('DTEND:20261106T093000Z');
    expect(ics).toContain('SUMMARY:Algemene verkoop: U2\\, Amsterdam');
    expect(ics).toContain('TRIGGER:-PT60M');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('alleen datum: hele dag', () => {
    const ics = phaseToIcs({ phase: PHASES.u2EuStorePresale, role: 'start', title: 'EU Store-presale', now: NOW })!;
    expect(ics).toContain('DTSTART;VALUE=DATE:20261104');
    expect(ics).toContain('DTEND;VALUE=DATE:20261105');
    expect(ics).toContain('Tijd nog niet bekend.');
  });
  it('inschrijving: de deadline', () => {
    const ics = phaseToIcs({ phase: PHASES.nkEuRegistration, role: 'deadline', title: 'Deadline Laylo', now: NOW })!;
    expect(ics).toContain('DTSTART:20261109T160000Z');
  });
  it('onbekend: geen agenda-item', () => {
    expect(phaseToIcs({ phase: PHASES.ateezAll, role: 'start', title: 'x', now: NOW })).toBeNull();
  });
  it('Google Agenda-link met dezelfde tijden', () => {
    const exact = new URL(phaseToGoogleCalendarUrl({ phase: PHASES.u2AmsGeneral, role: 'start', title: 'Algemene verkoop: U2, Amsterdam' })!);
    expect(exact.hostname).toBe('calendar.google.com');
    expect(exact.searchParams.get('dates')).toBe('20261106T090000Z/20261106T093000Z');
    expect(exact.searchParams.get('text')).toBe('Algemene verkoop: U2, Amsterdam');
    const day = new URL(phaseToGoogleCalendarUrl({ phase: PHASES.u2EuStorePresale, role: 'start', title: 'EU Store-presale' })!);
    expect(day.searchParams.get('dates')).toBe('20261104/20261105');
    expect(phaseToGoogleCalendarUrl({ phase: PHASES.ateezAll, role: 'start', title: 'x' })).toBeNull();
  });
});

describe('ontdubbelen', () => {
  it('herkent dezelfde venue in andere schrijfwijzen', () => {
    expect(sameVenue({ name: 'Johan Cruijff ArenA', city: 'Amsterdam' }, { name: 'Johan Cruijff Arena', city: 'Amsterdam' })).toBe(true);
    expect(sameVenue({ name: 'Estádio da Luz', city: 'Lisbon' }, { name: 'Estadio da Luz', city: 'Lisbon' })).toBe(true);
    expect(sameVenue({ name: 'Stadio San Siro', city: 'Milan' }, { name: 'San Siro Stadium', city: 'Milan' })).toBe(true);
    expect(sameVenue({ name: 'Olympiastadion', city: 'Berlin' }, { name: 'Olympiastadion', city: 'Munich' })).toBe(false);
    expect(
      sameVenue({ name: 'Ziggo Dome', city: 'Amsterdam', lat: 52.3138, lon: 4.9372 }, { name: 'ZiggoDome', city: 'Amsterdam-Zuidoost', lat: 52.3132, lon: 4.9366 }),
    ).toBe(true);
  });
  it('sleutel per datum', () => {
    expect(eventKey('The Weeknd', 'Amsterdam', '2027-06-05')).toBe('weeknd|amsterdam|2027-06-05');
    expect(eventKey('Beyoncé', 'Düsseldorf', '2027-06-05')).toBe(eventKey('Beyonce', 'Dusseldorf', '2027-06-05'));
    expect(tokenSimilarity('Bon Jovi', 'Bon Jovi')).toBe(1);
  });
});

describe('verouderde data', () => {
  it('waarschuwt na meer dan 10 uur', () => {
    expect(snapshotAgeWarning('2026-10-29T17:43:00Z', NOW)).toBeNull();
    expect(snapshotAgeWarning('2026-10-29T05:43:00Z', NOW)).toBe('Laatste update 12 uur geleden. Dit is de laatst bekende data.');
    expect(snapshotAgeWarning('2026-10-26T05:43:00Z', NOW)).toBe('Laatste update 3 dagen geleden. Dit is de laatst bekende data.');
  });
});
