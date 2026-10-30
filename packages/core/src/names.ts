/** Nederlandse namen voor steden en landen, voor uitleg en weergave. */

/** Stad → [Nederlandse naam, landcodes waarvoor die vertaling geldt]. */
const CITY_NL: Record<string, [string, string[]]> = {
  London: ['Londen', ['GB']], Paris: ['Parijs', ['FR']], Milan: ['Milaan', ['IT']], Lisbon: ['Lissabon', ['PT']],
  Berlin: ['Berlijn', ['DE']], Seville: ['Sevilla', ['ES']], Cologne: ['Keulen', ['DE']], Antwerp: ['Antwerpen', ['BE']],
  Brussels: ['Brussel', ['BE']], Munich: ['München', ['DE']], Vienna: ['Wenen', ['AT']], Prague: ['Praag', ['CZ']],
  Warsaw: ['Warschau', ['PL']], Copenhagen: ['Kopenhagen', ['DK']], 'Mexico City': ['Mexico-Stad', ['MX']],
  Kraków: ['Krakau', ['PL']], Krakow: ['Krakau', ['PL']], Tokyo: ['Tokio', ['JP']], Seoul: ['Seoel', ['KR']],
  Athens: ['Athene', ['GR']], Venice: ['Venetië', ['IT']], Gothenburg: ['Göteborg', ['SE']], Zurich: ['Zürich', ['CH']],
  Geneva: ['Genève', ['CH']], Dusseldorf: ['Düsseldorf', ['DE']], Bucharest: ['Boekarest', ['RO']], Naples: ['Napels', ['IT']],
  Turin: ['Turijn', ['IT']], Moscow: ['Moskou', ['RU']], Istanbul: ['Istanboel', ['TR']], Ghent: ['Gent', ['BE']],
  Liege: ['Luik', ['BE']], Liège: ['Luik', ['BE']], Aachen: ['Aken', ['DE']], Bruges: ['Brugge', ['BE']],
  Montreal: ['Montréal', ['CA']], Lille: ['Rijsel', ['FR']], Dunkirk: ['Duinkerke', ['FR']],
  Belgrade: ['Belgrado', ['RS']], Luxembourg: ['Luxemburg', ['LU']], Burgas: ['Boergas', ['BG']],
  Hanover: ['Hannover', ['DE']],
};

/** Nederlandse stadsnaam, alleen als het land klopt (Athens in Georgia blijft Athens). */
export function cityNl(city: string, country?: string): string {
  const e = CITY_NL[city];
  if (!e) return city;
  if (country && !e[1].includes(country.toUpperCase())) return city;
  return e[0];
}

/** Landen op het zuidelijk halfrond (winter in juni–augustus). */
export const SOUTHERN = new Set(['AU', 'NZ', 'AR', 'CL', 'UY', 'PY', 'ZA', 'BR']);
/** Tropische landen: geen echte winter voor openluchtshows. */
export const TROPICAL = new Set(['MX', 'SG', 'TH', 'PH', 'ID', 'MY', 'VN', 'IN', 'CO', 'PE', 'VE', 'EC', 'CR', 'PA', 'DO', 'PR', 'AE', 'QA', 'SA', 'BH', 'KW', 'HK', 'TW']);
