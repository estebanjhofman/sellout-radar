import { cityNl } from '../names';
import type { FactorKey } from './factors';
import { confidenceLabel, scoreBand } from './labels';
import { SPEED_LABELS, type FactorContribution, type ScoreResult } from './model';

/**
 * Uitleg in gewone taal. Vaste zinnen per factor, gevuld met de feiten uit de berekening:
 * geen taalmodel, dus de uitleg zegt nooit meer dan de data.
 */

export interface ExplanationLine {
  factor: FactorKey;
  direction: 'up' | 'down';
  text: string;
}

export interface Explanation {
  headline: string;
  lines: ExplanationLine[];
  speed?: string;
  caveat?: string;
}

const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** 12500 → "12.500" (zonder Intl, zodat het overal hetzelfde werkt). */
export function formatNumber(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const withDots = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${withDots}` : withDots;
}

/** ["A","B","C","D"] → "A, B, C en nog 1". */
export function joinList(items: string[], max = 3): string {
  if (items.length === 0) return '';
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} en nog ${rest}`;
  if (shown.length === 1) return shown[0]!;
  return `${shown.slice(0, -1).join(', ')} en ${shown[shown.length - 1]}`;
}

const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function lineFor(f: FactorContribution): string | null {
  const x = f.facts;
  const up = f.signal > 0;
  switch (f.key) {
    case 'proven_demand': {
      const cities = Array.isArray(x.soldCities) ? (x.soldCities as string[]).map((c) => { const [city, cc] = c.split('|'); return cityNl(city ?? c, cc); }) : [];
      const soldCount = num(x.soldCount) ?? 0;
      const added = num(x.added) ?? 0;
      const fastest = num(x.fastestHours);
      if (up) {
        const parts: string[] = [];
        if (soldCount > 0) {
          parts.push(
            soldCount === 1
              ? `Een andere datum van deze tour is al uitverkocht (${joinList(cities)})`
              : `${soldCount} andere data van deze tour zijn al uitverkocht (${joinList(cities)})`,
          );
        }
        if (added > 0) parts.push(added === 1 ? 'er is al een extra show bijgekomen' : `er zijn al ${added} extra shows bijgekomen`);
        if (fastest !== undefined && fastest <= 24) parts.push('elders binnen een dag uitverkocht');
        if (parts.length === 0) return 'Andere data van deze tour verkopen goed.';
        const s = parts.join('; ');
        return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
      }
      return 'Andere data van deze tour zijn al even in de verkoop en nog niet uitverkocht.';
    }
    case 'resale': {
      const prem = num(x.premiumPct);
      if (prem !== undefined) {
        return prem >= 0
          ? `Doorverkoopprijzen liggen ${prem}% boven de nominale prijs.`
          : `Op doorverkoopsites zijn kaarten onder de nominale prijs te koop (${prem}%).`;
      }
      const l = num(x.listingsPer1000);
      if (l !== undefined) {
        return up ? 'Er worden weinig kaarten doorverkocht.' : 'Er worden veel kaarten doorverkocht.';
      }
      return null;
    }
    case 'scale_jump': {
      const ratio = num(x.ratio);
      const where = str(x.place) ? cityNl(str(x.place)!) : x.scope === 'country' ? 'dit land' : 'deze stad';
      const prev = str(x.venueName);
      const prevTxt = prev ? ` (${prev})` : '';
      if (ratio === undefined) return null;
      // Terugkerende evenementen (festival, sport, Songfestival) op dezelfde plek: vergelijk met de vorige editie.
      if (x.edition === true && x.sameVenue === true) {
        if (x.prevSoldOut === true) return `De vorige editie op dezelfde plek${prevTxt} was uitverkocht.`;
        if (x.prevSoldOut === false) return `De vorige editie op dezelfde plek${prevTxt} was niet uitverkocht.`;
        return null;
      }
      if (ratio > 1.15) {
        return up
          ? `De zaal is ${String(ratio).replace('.', ',')}× zo groot als bij het vorige bezoek aan ${where}${prevTxt}, maar dat was uitverkocht.`
          : `De zaal is ${String(ratio).replace('.', ',')}× zo groot als bij het vorige bezoek aan ${where}${prevTxt}.`;
      }
      if (ratio < 0.87) return `De zaal is kleiner dan bij het vorige bezoek aan ${where}${prevTxt}.`;
      return x.prevSoldOut === true
        ? `Ongeveer even grote zaal als bij het vorige, uitverkochte bezoek aan ${where}${prevTxt}.`
        : `Ongeveer even grote zaal als bij het vorige bezoek aan ${where}${prevTxt}.`;
    }
    case 'market': {
      const shows = num(x.showsInCity) ?? 1;
      const idx = num(x.indexInCity) ?? 0;
      const city = str(x.city) ? cityNl(str(x.city)!, str(x.country)) : 'deze stad';
      if (x.isAddedShow === true) return 'Dit is een extra toegevoegde show; die verkopen meestal trager.';
      if ((num(x.addedInCity) ?? 0) > 0 && up) return `${city} kreeg er extra shows bij.`;
      if (shows <= 1) return up ? `Dit is de enige show in ${city}.` : `De markt in ${city} is klein voor deze capaciteit.`;
      if (idx > 0) return `${city} krijgt ${shows} shows; dit is nummer ${idx + 1}.`;
      return up ? `${city} krijgt ${shows} shows; dit is de eerste.` : `${city} krijgt ${shows} shows, dat spreidt de vraag.`;
    }
    case 'scarcity': {
      const parts: string[] = [];
      if (x.farewell === true) parts.push('het is een afscheidstour');
      if (x.reunion === true) parts.push('het is een reünie');
      if (x.ballot === true) parts.push('kaarten gaan via een loting, dus de organisator verwacht meer vraag dan plaatsen');
      const only = str(x.onlyShowIn);
      if (only === 'europe') parts.push('dit is de enige show in Europa');
      else if (only === 'benelux') parts.push('dit is de enige show in de Benelux');
      else if (only === 'country') parts.push('dit is de enige show in het land');
      const years = num(x.yearsSinceLastVisit);
      if (years !== undefined && years >= 3) parts.push(`al ${years} jaar niet meer in het land geweest`);
      if (!up && years !== undefined && years <= 1) return 'Was hier minder dan een jaar geleden nog.';
      if (parts.length === 0) return null;
      const s = parts.join('; ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
    case 'momentum': {
      const parts: string[] = [];
      if (x.newRelease === true) parts.push('nieuwe release rond de verkoopstart');
      const lg = num(x.listenerGrowthPct);
      if (lg !== undefined && lg >= 10) parts.push(`${lg}% meer luisteraars dan drie maanden geleden`);
      if (lg !== undefined && lg <= -10) parts.push(`${Math.abs(lg)}% minder luisteraars dan drie maanden geleden`);
      const vg = num(x.videoGrowthPct);
      if (vg !== undefined && Math.abs(vg) >= 10) parts.push(`video's ${vg > 0 ? 'groeien' : 'krimpen'} (${vg > 0 ? '+' : ''}${vg}%)`);
      if (x.charting === true) parts.push('staat in de hitlijsten');
      if (parts.length === 0) return null;
      const s = parts.join('; ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
    case 'fandom':
      return x.organized === true ? 'Georganiseerde fanbase: fans kopen massaal en snel, vaak al in de presale.' : null;
    case 'practical': {
      const parts: string[] = [];
      const wd = num(x.weekday);
      if (wd !== undefined) {
        const name = WEEKDAYS[wd - 1]!;
        if (wd === 5 || wd === 6) parts.push(`valt op een ${name}`);
        else if (wd !== 7 && !up) parts.push(`valt op een ${name}`);
      }
      if (x.outdoorWinter === true) parts.push('openlucht in de winter');
      const exp = num(x.expensive);
      if (exp !== undefined) parts.push(`${exp}% duurder dan vergelijkbare shows`);
      const cheap = num(x.cheap);
      if (cheap !== undefined) parts.push(`${cheap}% goedkoper dan vergelijkbare shows`);
      if (x.poorAccess === true) parts.push('slecht bereikbaar');
      if (parts.length === 0) return null;
      const s = parts.join('; ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
    case 'live': {
      const parts: string[] = [];
      if (x.fewTicketsLeft === true) parts.push('de ticketverkoper meldt dat er nog weinig kaarten zijn');
      const q = num(x.queueSize);
      if (q !== undefined) parts.push(`wachtrij van ${formatNumber(q)} mensen`);
      if (x.extraRelease === true) parts.push('er zijn extra kaarten vrijgegeven');
      if (parts.length === 0) return null;
      const s = parts.join('; ');
      return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
    }
  }
}

export function explainScore(r: ScoreResult): Explanation {
  if (r.state === 'soldout') {
    return { headline: 'Uitverkocht', lines: [] };
  }
  if (r.state === 'cancelled') {
    return { headline: 'Geannuleerd', lines: [] };
  }
  const band = scoreBand(r.score);
  const lines: ExplanationLine[] = [];
  for (const f of r.top) {
    const text = lineFor(f);
    if (text) lines.push({ factor: f.key, direction: f.contribution >= 0 ? 'up' : 'down', text });
  }
  const explanation: Explanation = {
    headline: `${r.score} · ${band.label} · betrouwbaarheid ${confidenceLabel(r.confidence)}`,
    lines,
  };
  if (r.speed) explanation.speed = `Verwachte snelheid (schatting): ${SPEED_LABELS[r.speed]}.`;
  if (r.confidence === 'low') {
    explanation.caveat =
      'Nog weinig gegevens over deze datum. De score leunt vooral op het gemiddelde en verandert zodra de verkoop elders begint.';
  }
  return explanation;
}
