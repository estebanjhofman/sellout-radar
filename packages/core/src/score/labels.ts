import type { ScoreKind } from './factors';

/**
 * Labels en kleuren bij de scores. De kleur staat nooit alleen: elk getal krijgt een label,
 * zodat de score ook leesbaar is bij kleurenblindheid. Beide scores gebruiken dezelfde vloeiende
 * kleurschaal (groen–geel–oranje–rood).
 */

export interface ScoreBand {
  min: number;
  max: number;
  key: string;
  label: string;
}

/** Uitverkoopkans (Al in de verkoop). */
export const SELLOUT_BANDS: ScoreBand[] = [
  { min: 80, max: 100, key: 'very_likely', label: 'Zeer waarschijnlijk uitverkocht' },
  { min: 60, max: 79, key: 'likely', label: 'Waarschijnlijk uitverkocht' },
  { min: 40, max: 59, key: 'possible', label: 'Mogelijk uitverkocht' },
  { min: 20, max: 39, key: 'unlikely', label: 'Eerder niet uitverkocht' },
  { min: 0, max: 19, key: 'very_unlikely', label: 'Waarschijnlijk niet uitverkocht' },
];

/** Verwachte drukte (Nog niet in de verkoop). */
export const RUSH_BANDS: ScoreBand[] = [
  { min: 80, max: 100, key: 'extreme', label: 'Extreem druk verwacht' },
  { min: 60, max: 79, key: 'very_busy', label: 'Zeer druk' },
  { min: 40, max: 59, key: 'busy', label: 'Druk' },
  { min: 20, max: 39, key: 'moderate', label: 'Matig druk' },
  { min: 0, max: 19, key: 'quiet', label: 'Rustig' },
];

/** Oude naam (één score); gelijk aan de banden van de uitverkoopkans. */
export const SCORE_BANDS = SELLOUT_BANDS;

export function bandsFor(kind: ScoreKind): ScoreBand[] {
  return kind === 'rush' ? RUSH_BANDS : SELLOUT_BANDS;
}

export function scoreBand(score: number, kind: ScoreKind = 'sellout'): ScoreBand {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return bandsFor(kind).find((b) => s >= b.min && s <= b.max)!;
}

export const SCORE_KIND_LABEL: Record<ScoreKind, string> = {
  rush: 'Verwachte drukte',
  sellout: 'Uitverkoopkans',
};

export const SCORE_KIND_HELP: Record<ScoreKind, string> = {
  rush: 'Hoe moeilijk het wordt om bij de eerste verkoop een kaart te krijgen: de kans dat de datum in de presale of binnen een dag na de eerste verkoopstart uitverkoopt.',
  sellout: 'De kans dat de datum vóór de showdag uitverkoopt, op basis van echte verkoopsignalen.',
};

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export function confidenceLabel(c: ConfidenceLevel): string {
  return c === 'high' ? 'hoog' : c === 'medium' ? 'middel' : 'laag';
}

// ---------------------------------------------------------------------------
// Kleur: vloeiend van rood (0) via oranje en geel naar groen (100), berekend in OKLCH.
// ---------------------------------------------------------------------------

type Oklch = [number, number, number];

/** Kleurstops [score, L, C, hue]. */
const STOPS: [number, ...Oklch][] = [
  [0, 0.58, 0.2, 27], // rood
  [30, 0.7, 0.17, 52], // oranje
  [55, 0.84, 0.16, 92], // geel
  [80, 0.76, 0.17, 128], // geelgroen
  [100, 0.64, 0.17, 150], // groen
];

function interpolate(score: number): Oklch {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]!;
    const b = STOPS[i + 1]!;
    if (s >= a[0] && s <= b[0]) {
      const t = (s - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const last = STOPS[STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

function oklchToHex([L, C, h]: Oklch): string {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const toHex = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  return `#${lin.map(toHex).join('')}`;
}

/** Kleur voor een score (hex). */
export function scoreColor(score: number): string {
  return oklchToHex(interpolate(score));
}
