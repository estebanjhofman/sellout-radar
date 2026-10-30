/**
 * Inwoners per land in miljoenen, afgerond op 0,1 miljoen.
 * Bron: Wikipedia, "List of countries and dependencies by population"
 * (https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population), gecontroleerd op 30 oktober 2026.
 *
 * Gebruikt voor "populariteit tegenover plekken": zonder cijfers per land verdelen we de luisteraars
 * van een artiest naar verhouding van het inwonertal. Met de Last.fm-toplijst per land (zie de updater)
 * wordt dat bijgesteld naar hoe populair de artiest in dat land echt is.
 */
export const POPULATION_M: Record<string, number> = {
  NL: 18.2, BE: 11.9, LU: 0.7, DE: 83.5, FR: 69.1, GB: 69.5, IE: 5.5, ES: 49.8, PT: 11.4, IT: 58.9,
  AT: 9.2, CH: 9.2, SE: 10.6, NO: 5.6, DK: 6.0, FI: 5.7, IS: 0.4, PL: 37.2, CZ: 10.9, SK: 5.4,
  HU: 9.5, SI: 2.1, HR: 3.9, RS: 6.5, BA: 3.4, ME: 0.6, MK: 1.8, AL: 2.3, GR: 10.4, RO: 19.0,
  BG: 6.4, EE: 1.4, LV: 1.8, LT: 2.9, MT: 0.6, CY: 1.0, MC: 0.04, AD: 0.1, LI: 0.04, SM: 0.03,
  TR: 86.1, UA: 28.7,
  US: 341.8, CA: 41.4, MX: 131.2, GT: 18.3, CR: 5.2, PA: 4.1, CO: 53.4, PE: 34.2, CL: 20.2, AR: 46.5,
  BR: 214.2, UY: 3.5, PY: 6.1, BO: 11.4, EC: 18.2, VE: 28.6, DO: 10.8, PR: 3.2,
  KR: 51.1, JP: 122.7, CN: 1404.9, TW: 23.2, HK: 7.5, MO: 0.7, SG: 6.1, TH: 70.3, PH: 114.8, ID: 288.3,
  MY: 34.4, VN: 102.3, IN: 1429.4, AE: 11.3, SA: 35.3, QA: 3.4, KW: 4.9, BH: 1.6, IL: 10.3,
  AU: 27.8, NZ: 5.4, ZA: 63.5, MA: 37.3, EG: 108.6, NG: 223.8, KE: 54.2,
};

export function populationM(country: string): number | undefined {
  return POPULATION_M[country.toUpperCase()];
}
