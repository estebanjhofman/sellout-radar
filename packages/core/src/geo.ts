/** Landen en werelddelen, gedeeld door de updater en de app. */

/** Landcode (ISO 3166-1 alpha-2) naar werelddeel, voor de regioweging van bewezen vraag en het regiofilter. */
const CONTINENT: Record<string, string> = {};
const put = (c: string, codes: string) => codes.split(' ').forEach((k) => (CONTINENT[k] = c));
put('EU', 'NL BE LU DE FR GB IE ES PT IT AT CH SE NO DK FI IS PL CZ SK HU SI HR RS BA ME MK AL GR RO BG EE LV LT MT CY MC AD LI SM TR UA');
put('NA', 'US CA');
put('LATAM', 'MX GT CR PA CO PE CL AR BR UY PY BO EC VE DO PR');
put('AS', 'KR JP CN TW HK MO SG TH PH ID MY VN IN AE SA QA KW BH IL');
put('OC', 'AU NZ');
put('AF', 'ZA MA EG NG KE');

export function continentOf(country: string): string {
  return CONTINENT[country.toUpperCase()] ?? 'OTHER';
}

export const BENELUX = new Set(['NL', 'BE', 'LU']);

/** Nederlandse landnamen. */
export const COUNTRY_NL: Record<string, string> = {
  NL: 'Nederland', BE: 'België', LU: 'Luxemburg', DE: 'Duitsland', FR: 'Frankrijk', GB: 'Verenigd Koninkrijk',
  IE: 'Ierland', ES: 'Spanje', PT: 'Portugal', IT: 'Italië', AT: 'Oostenrijk', CH: 'Zwitserland', SE: 'Zweden',
  NO: 'Noorwegen', DK: 'Denemarken', FI: 'Finland', IS: 'IJsland', PL: 'Polen', CZ: 'Tsjechië', SK: 'Slowakije',
  HU: 'Hongarije', SI: 'Slovenië', HR: 'Kroatië', RS: 'Servië', BA: 'Bosnië en Herzegovina', ME: 'Montenegro',
  MK: 'Noord-Macedonië', AL: 'Albanië', GR: 'Griekenland', RO: 'Roemenië', BG: 'Bulgarije', EE: 'Estland',
  LV: 'Letland', LT: 'Litouwen', MT: 'Malta', CY: 'Cyprus', MC: 'Monaco', AD: 'Andorra', LI: 'Liechtenstein',
  SM: 'San Marino', TR: 'Turkije', UA: 'Oekraïne',
  US: 'Verenigde Staten', CA: 'Canada', MX: 'Mexico', GT: 'Guatemala', CR: 'Costa Rica', PA: 'Panama',
  CO: 'Colombia', PE: 'Peru', CL: 'Chili', AR: 'Argentinië', BR: 'Brazilië', UY: 'Uruguay', PY: 'Paraguay',
  BO: 'Bolivia', EC: 'Ecuador', VE: 'Venezuela', DO: 'Dominicaanse Republiek', PR: 'Puerto Rico',
  KR: 'Zuid-Korea', JP: 'Japan', CN: 'China', TW: 'Taiwan', HK: 'Hongkong', MO: 'Macau', SG: 'Singapore',
  TH: 'Thailand', PH: 'Filipijnen', ID: 'Indonesië', MY: 'Maleisië', VN: 'Vietnam', IN: 'India',
  AE: 'Verenigde Arabische Emiraten', SA: 'Saoedi-Arabië', QA: 'Qatar', KW: 'Koeweit', BH: 'Bahrein', IL: 'Israël',
  AU: 'Australië', NZ: 'Nieuw-Zeeland', ZA: 'Zuid-Afrika', MA: 'Marokko', EG: 'Egypte', NG: 'Nigeria', KE: 'Kenia',
};

export function countryNl(code: string): string {
  return COUNTRY_NL[code.toUpperCase()] ?? code;
}
