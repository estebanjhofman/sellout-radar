/**
 * Testdata uit de startlijst, zoals gecontroleerd op 29 oktober 2026.
 * Elke waarde komt uit de genoemde bron; onbekende tijden blijven onbekend.
 */
import type { EventDate, SalePhase, SourceRef } from '../src/types';
import { dateOnly, exactLocal, monthOnly, unknownTime } from '../src/time';

/** Moment van de avondrun op 29 oktober: 19:00 Nederlandse tijd. */
export const NOW = '2026-10-29T18:00:00.000Z';

const src = (name: string, kind: SourceRef['kind'], url: string): SourceRef => ({ name, kind, url, fetchedAt: NOW });

export const S = {
  u2com: src('U2.com tourpagina', 'artist', 'https://www.u2.com/tour'),
  u2EuStore: src('U2 EU Store, presalevoorwaarden', 'official_store', 'https://shopeu.u2.com/pages/pre-sale-terms-08716489247478392284'),
  louder: src('Louder', 'news', 'https://www.loudersound.com/news/u2-announce-2027-uk-europe-tour-dates-greatest-show-on-earth-2026'),
  nme: src('NME', 'news', 'https://www.nme.com/news/music/u2-announce-the-greatest-show-on-earth-2027-uk-and-european-stadium-tour-with-wolf-alice-tickets-3974542'),
  u2tours: src('u2tours.com', 'fansite', 'https://u2tours.com/tours/the-greatest-show-on-earth-tour'),
  pollstar: src('Pollstar', 'news', 'https://news.pollstar.com/2026/10/29/noah-kahan-announces-the-last-of-the-bugs-world-tour-for-2027/'),
  consequence: src('Consequence', 'news', 'https://consequence.net/2026/10/noah-kahan-2027-world-tour-how-to-get-tickets/'),
  seatgeek: src('SeatGeek', 'news', 'https://seatgeek.ca/blog/bon-jovi-forever-tour-2027-dates-schedule-presales-tickets-and-what-to-expect'),
  musicUniverse: src('The Music Universe', 'news', 'https://themusicuniverse.com/bon-jovi-reveals-global-2027-forever-tour/'),
  joongang: src('Korea JoongAng Daily', 'news', 'https://www.koreajoongangdaily.com/entertainment/ateez-to-open-2027-zero-to-all-world-tour-in-incheonnbsp/12913665'),
  karlobag: src('Karlobag', 'news', 'https://karlobag.eu/en/music/ateez-announces-zero-to-all-world-tour-for-2027-with-european-concerts-in-london-btafi/'),
};

const AMS = 'Europe/Amsterdam';

export const PHASES = {
  bonJoviNjGeneral: {
    id: 'bonjovi-na-general',
    kind: 'general_sale',
    name: 'Algemene verkoop Noord-Amerika',
    region: 'NA',
    eventIds: ['bonjovi-2027-07-15-east-rutherford'],
    start: exactLocal('2026-10-30', '10:00', 'America/New_York'),
    sources: [S.seatgeek],
  },
  bonJoviChicagoGeneral: {
    id: 'bonjovi-na-general-chicago',
    kind: 'general_sale',
    name: 'Algemene verkoop Noord-Amerika',
    region: 'NA',
    eventIds: ['bonjovi-2027-07-21-chicago'],
    start: exactLocal('2026-10-30', '10:00', 'America/Chicago'),
    sources: [S.seatgeek],
  },
  u2EuStoreRegistration: {
    id: 'u2-eu-store-registration',
    kind: 'registration',
    name: 'Inschrijving EU Store-presale',
    region: 'EU',
    eventIds: ['u2-2027-06-05-amsterdam', 'u2-2027-06-06-amsterdam'],
    start: unknownTime('Europe/London'),
    deadline: exactLocal('2026-10-30', '12:00', 'Europe/London'),
    whereToRegister: 'shopeu.u2.com (gratis formulier of album pre-order)',
    unlocksPhaseId: 'u2-eu-store-presale-cet',
    sources: [S.u2EuStore],
  },
  u2ArtistRegistration: {
    id: 'u2-artist-presale-registration',
    kind: 'registration',
    name: 'Inschrijving U2 Artist Presale',
    region: 'EU',
    eventIds: ['u2-2027-06-05-amsterdam', 'u2-2027-06-06-amsterdam'],
    start: unknownTime(AMS),
    deadline: dateOnly('2026-11-01', AMS),
    whereToRegister: 'u2.com',
    unlocksPhaseId: 'u2-artist-presale-cet',
    sources: [S.u2com],
  },
  u2FeedbackPresale: {
    id: 'u2-feedback-presale-cet',
    kind: 'presale',
    type: 'fanclub',
    name: 'U2.com Feedback Group-presale',
    region: 'EU',
    eventIds: ['u2-2027-06-05-amsterdam', 'u2-2027-06-06-amsterdam'],
    start: exactLocal('2026-11-02', '10:00', AMS),
    end: exactLocal('2026-11-04', '22:00', AMS),
    requiresCode: true,
    sources: [S.u2com],
  },
  u2EuStorePresale: {
    id: 'u2-eu-store-presale-cet',
    kind: 'presale',
    type: 'artist_store',
    name: 'EU Store-presale',
    region: 'EU',
    eventIds: ['u2-2027-06-05-amsterdam', 'u2-2027-06-06-amsterdam'],
    // "approximately 10:00am local time": het uur is niet zeker, dus alleen de datum.
    start: dateOnly('2026-11-04', AMS),
    requiresCode: true,
    ticketLimit: 4,
    sources: [S.u2EuStore],
  },
  u2ArtistPresale: {
    id: 'u2-artist-presale-cet',
    kind: 'presale',
    type: 'artist',
    name: 'U2 Artist Presale',
    region: 'EU',
    eventIds: ['u2-2027-06-05-amsterdam', 'u2-2027-06-06-amsterdam'],
    start: exactLocal('2026-11-05', '10:00', AMS),
    sources: [S.u2com],
  },
  u2AmsGeneral: {
    id: 'u2-general-ams',
    kind: 'general_sale',
    name: 'Algemene verkoop',
    region: 'NL',
    eventIds: ['u2-2027-06-05-amsterdam', 'u2-2027-06-06-amsterdam'],
    start: exactLocal('2026-11-06', '10:00', AMS),
    sources: [S.u2com, S.u2EuStore],
  },
  u2LondonGeneral: {
    id: 'u2-general-london',
    kind: 'general_sale',
    name: 'Algemene verkoop',
    region: 'GB',
    eventIds: ['u2-2027-06-18-london', 'u2-2027-06-19-london'],
    start: exactLocal('2026-11-06', '10:00', 'Europe/London'),
    sources: [S.u2com, S.u2EuStore],
  },
  nkEuRegistration: {
    id: 'nk-eu-laylo-registration',
    kind: 'registration',
    name: 'Inschrijving artist presale (Laylo)',
    region: 'EU',
    eventIds: ['nk-2027-07-01-groningen'],
    start: unknownTime(AMS),
    deadline: exactLocal('2026-11-09', '17:00', AMS),
    whereToRegister: 'Laylo',
    unlocksPhaseId: 'nk-eu-laylo-presale',
    sources: [S.consequence],
  },
  nkEuPresale: {
    id: 'nk-eu-laylo-presale',
    kind: 'presale',
    type: 'artist',
    name: 'Artist presale (Laylo)',
    region: 'EU',
    eventIds: ['nk-2027-07-01-groningen'],
    start: exactLocal('2026-11-10', '12:00', AMS),
    sources: [S.pollstar, S.consequence],
  },
  nkEuGeneral: {
    id: 'nk-eu-general-groningen',
    kind: 'general_sale',
    name: 'Algemene verkoop',
    region: 'EU',
    eventIds: ['nk-2027-07-01-groningen'],
    start: exactLocal('2026-11-12', '12:00', AMS),
    sources: [S.pollstar, S.consequence],
  },
  nkNaRegistration: {
    id: 'nk-na-artist-registration',
    kind: 'registration',
    name: 'Inschrijving artist presale Noord-Amerika',
    region: 'NA',
    eventIds: ['nk-2027-06-18-east-rutherford'],
    start: unknownTime('America/New_York'),
    deadline: exactLocal('2026-11-05', '23:59', 'America/New_York'),
    sources: [S.pollstar],
  },
  ateezAll: {
    id: 'ateez-eu-sale',
    kind: 'general_sale',
    name: 'Verkoop Europa',
    region: 'EU',
    eventIds: ['ateez-2027-04-12-amsterdam'],
    start: unknownTime(AMS),
    sources: [S.karlobag],
  },
} satisfies Record<string, SalePhase>;

const ev = (
  id: string,
  title: string,
  venueId: string,
  localDate: string,
  tz: string,
  extra: Partial<EventDate> = {},
): EventDate => ({
  id,
  title,
  type: 'concert',
  artistIds: [id.split('-')[0]!],
  venueId,
  date: dateOnly(localDate, tz),
  status: 'announced',
  verification: 'official',
  sources: [],
  ...extra,
});

export const EVENTS = {
  u2Ams1: ev('u2-2027-06-05-amsterdam', 'U2 · Amsterdam', 'johan-cruijff-arena', '2027-06-05', AMS, { sources: [S.u2com, S.u2EuStore] }),
  u2Ams2: ev('u2-2027-06-06-amsterdam', 'U2 · Amsterdam', 'johan-cruijff-arena', '2027-06-06', AMS, { sources: [S.u2com, S.u2EuStore] }),
  nkGroningen: ev('nk-2027-07-01-groningen', 'Noah Kahan · Groningen', 'stadspark-groningen', '2027-07-01', AMS, { sources: [S.pollstar, S.consequence] }),
  nkWembley23: ev('nk-2027-07-23-london', 'Noah Kahan · Londen', 'wembley', '2027-07-23', 'Europe/London', { status: 'soldout', sources: [S.pollstar, S.consequence] }),
  nkWembley25: ev('nk-2027-07-25-london', 'Noah Kahan · Londen', 'wembley', '2027-07-25', 'Europe/London', {
    addedShow: true,
    addedShowReason: 'Toegevoegd nadat 23 en 24 juli uitverkochten',
    sources: [S.pollstar],
  }),
  ateezAms: ev('ateez-2027-04-12-amsterdam', 'ATEEZ · Amsterdam', 'unknown-venue-amsterdam', '2027-04-12', AMS, {
    verification: 'unconfirmed',
    sources: [S.karlobag],
  }),
};

export const ATEEZ_EUROPE_MONTH = monthOnly('2027-04', AMS);
