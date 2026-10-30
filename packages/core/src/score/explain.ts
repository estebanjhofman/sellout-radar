import { countryNl } from '../geo';
import { cityNl } from '../names';
import type { FactorKey, ScoreKind } from './factors';
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

/** 12500 → "12.500" (zonder Intl, zodat het overal hetzelfde werkt). */
export function formatNumber(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const withDots = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${withDots}` : withDots;
}

/** 5612345 → "5,6 mln"; 84000 → "84.000". */
export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const v = n / 1_000_000;
    return `${(v >= 10 ? Math.round(v).toString() : v.toFixed(1)).replace('.', ',')} mln`;
  }
  return formatNumber(n);
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
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const sentence = (parts: string[]) => (parts.length ? `${cap(parts.join('; '))}.` : null);
const cities = (x: unknown) =>
  Array.isArray(x)
    ? (x as string[]).map((c) => {
        const [city, cc] = c.split('|');
        return cityNl(city ?? c, cc);
      })
    : [];

function lineFor(f: FactorContribution): string | null {
  const x = f.facts;
  const up = f.signal > 0;
  switch (f.key) {
    // ----- Verwachte drukte -----
    case 'demand_supply': {
      const listeners = num(x.listeners);
      const seats = num(x.seats);
      if (listeners === undefined || seats === undefined) return null;
      const shows = num(x.shows) ?? 1;
      const land = countryNl(str(x.country) ?? '');
      const level = str(x.level);
      const verdict =
        level === 'krap' ? 'naar verhouding veel vraag voor weinig plekken' : level === 'ruim' ? 'naar verhouding ruim voldoende plekken' : 'vraag en plekken ongeveer in evenwicht';
      let s = `${formatCompact(listeners)} luisteraars op Last.fm tegenover ${formatNumber(seats)} plekken in ${land}${shows > 1 ? ` (${shows} shows)` : ''}: ${verdict}.`;
      const local = num(x.localFactor);
      const rank = num(x.countryRank);
      if (local !== undefined && local >= 1.3) s += ` In ${land} populairder dan gemiddeld${rank ? ` (#${rank} in de Last.fm-toplijst)` : ''}.`;
      else if (local !== undefined && local <= 0.77) s += ` In ${land} minder populair dan gemiddeld.`;
      return s;
    }
    case 'growth': {
      const parts: string[] = [];
      const lg = num(x.listenerGrowthPct);
      if (lg !== undefined && lg >= 10) parts.push(`${lg}% meer luisteraars dan drie maanden geleden`);
      if (lg !== undefined && lg <= -10) parts.push(`${Math.abs(lg)}% minder luisteraars dan drie maanden geleden`);
      const rank = num(x.countryRank);
      if (rank !== undefined) parts.push(`#${rank} in de Last.fm-toplijst van ${countryNl(str(x.country) ?? '')}`);
      const peak = num(x.chartPeak);
      if (peak !== undefined && str(x.chartTitle)) {
        parts.push(`'${str(x.chartTitle)}' kwam op ${peak === 1 ? 'nummer 1' : `#${peak}`} in de ${str(x.chartName)} (${num(x.chartYear)})`);
      }
      if (x.newRelease === true) parts.push('nieuwe release rond de verkoopstart');
      return sentence(parts);
    }
    case 'previous_tour': {
      const year = num(x.year);
      const fastH = num(x.fastHours);
      const fastTxt = x.fast === true && fastH !== undefined ? ` (binnen ${fastH <= 1 ? 'een uur' : `${Math.round(fastH)} uur`})` : '';
      const pct = num(x.sellThroughPct);
      if (x.edition === true) {
        const which = year ? `De editie van ${year}` : 'De vorige editie';
        if (x.prevSoldOut === true) return `${which} was uitverkocht${fastTxt}.`;
        if (pct !== undefined) return x.fast === true ? `Van ${which.charAt(0).toLowerCase()}${which.slice(1)} was binnen ${fastH} uur ${pct}% van de kaarten verkocht.` : `${which} was voor ${pct}% uitverkocht.`;
        if (x.prevSoldOut === false) return `${which} was niet uitverkocht.`;
        return null;
      }
      const where = str(x.place) ? cityNl(str(x.place)!) : x.scope === 'country' ? 'dit land' : 'deze stad';
      const detail = [str(x.tourName), str(x.venueName), year ? String(year) : undefined].filter(Boolean).join(', ');
      const prevTxt = detail ? ` (${detail})` : '';
      const ratio = num(x.ratio);
      const partTxt = pct !== undefined ? `, dat voor ${pct}% uitverkocht was` : '';
      if (ratio === undefined) {
        if (pct !== undefined) return `Het vorige bezoek aan ${where}${prevTxt} was voor ${pct}% uitverkocht.`;
        if (x.prevSoldOut === true) return `Het vorige bezoek aan ${where}${prevTxt} was uitverkocht${fastTxt}.`;
        if (x.prevSoldOut === false) return `Het vorige bezoek aan ${where}${prevTxt} was niet uitverkocht.`;
        return null;
      }
      const r = String(ratio).replace('.', ',');
      if (ratio > 1.15) {
        return x.prevSoldOut === true
          ? `Nu ${r}× zo veel plekken als bij het vorige bezoek aan ${where}${prevTxt}, maar dat was uitverkocht${fastTxt}.`
          : `Nu ${r}× zo veel plekken als bij het vorige bezoek aan ${where}${prevTxt}${partTxt || (x.prevSoldOut === false ? ', dat niet uitverkocht was' : '')}.`;
      }
      if (ratio < 0.87) return `Minder plekken dan bij het vorige bezoek aan ${where}${prevTxt}${x.prevSoldOut === true ? ', dat uitverkocht was' : partTxt}.`;
      if (x.prevSoldOut === true) return `Ongeveer even veel plekken als bij het vorige, uitverkochte bezoek aan ${where}${prevTxt}${fastTxt}.`;
      if (pct !== undefined) return `Ongeveer even veel plekken als bij het vorige bezoek aan ${where}${prevTxt}${partTxt}.`;
      if (x.prevSoldOut === false) return `Ongeveer even veel plekken als bij het vorige bezoek aan ${where}${prevTxt}; dat was niet uitverkocht.`;
      return `Ongeveer even veel plekken als bij het vorige bezoek aan ${where}${prevTxt}.`;
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
      return sentence(parts);
    }
    case 'fandom':
      return x.organized === true ? 'Georganiseerde fanbase: fans kopen massaal en snel, vaak al in de presale.' : null;
    case 'tour_demand': {
      const soldCities = cities(x.soldCities);
      const soldCount = num(x.soldCount) ?? 0;
      const added = num(x.added) ?? 0;
      const fastest = num(x.fastestHours);
      if (up) {
        const parts: string[] = [];
        if (soldCount > 0) {
          parts.push(
            soldCount === 1
              ? `een andere datum van deze tour is al uitverkocht (${joinList(soldCities)})`
              : `${soldCount} andere data van deze tour zijn al uitverkocht (${joinList(soldCities)})`,
          );
        }
        if (added > 0) parts.push(added === 1 ? 'er is al een extra show bijgekomen' : `er zijn al ${added} extra shows bijgekomen`);
        if (fastest !== undefined && fastest <= 24) parts.push('elders binnen een dag uitverkocht');
        return sentence(parts) ?? 'Andere data van deze tour verkopen goed.';
      }
      return 'Andere data van deze tour zijn al even in de verkoop en nog niet uitverkocht.';
    }

    // ----- Uitverkoopkans -----
    case 'prior': {
      const rush = num(x.rush);
      if (rush === undefined) return null;
      const label = scoreBand(rush, 'rush').label.toLowerCase();
      return x.frozen === true
        ? `Verwachte drukte vlak vóór de verkoop: ${rush} (${label}).`
        : `Geschatte drukte vooraf: ${rush} (${label}). Die is niet vóór de verkoop vastgelegd.`;
    }
    case 'sold_out_dates': {
      const soldCities = cities(x.soldCities);
      const soldCount = num(x.soldCount) ?? 0;
      const sameCity = num(x.soldSameCity) ?? 0;
      const lingering = num(x.lingering) ?? 0;
      if (up) {
        if (sameCity > 0) return sameCity === 1 ? 'Een andere datum in dezelfde stad is al uitverkocht.' : `${sameCity} andere data in dezelfde stad zijn al uitverkocht.`;
        if (soldCount > 0) {
          return soldCount === 1
            ? `Een andere datum van deze tour is al uitverkocht (${joinList(soldCities)}).`
            : `${soldCount} andere data van deze tour zijn al uitverkocht (${joinList(soldCities)}).`;
        }
        return null;
      }
      if (lingering > 0) {
        return lingering === 1
          ? 'Een andere datum van deze tour is al meer dan een week te koop en nog niet uitverkocht.'
          : `${lingering} andere data van deze tour zijn al meer dan een week te koop en nog niet uitverkocht.`;
      }
      return null;
    }
    case 'added_shows': {
      if (x.isAddedShow === true) return 'Dit is een extra toegevoegde show; die verkopen meestal trager.';
      const inCity = num(x.addedInCity) ?? 0;
      const added = num(x.added) ?? 0;
      const city = str(x.city) ? cityNl(str(x.city)!, str(x.country)) : 'deze stad';
      if (inCity > 0) return `${city} kreeg er ${inCity === 1 ? 'een extra show' : `${inCity} extra shows`} bij wegens de vraag.`;
      if (added > 0) return added === 1 ? 'Er is al een extra show bijgekomen wegens de vraag.' : `Er zijn al ${added} extra shows bijgekomen wegens de vraag.`;
      return null;
    }
    case 'sales_speed': {
      const parts: string[] = [];
      if (x.presaleSellout === true) parts.push('elders al in de presale uitverkocht');
      const h = num(x.fastestHours);
      if (h !== undefined && h <= 24) parts.push(`elders binnen ${h <= 1 ? 'een uur' : `${h} uur`} uitverkocht`);
      else if (h !== undefined && h <= 24 * 7) parts.push(`elders binnen ${Math.ceil(h / 24)} dagen uitverkocht`);
      const d = num(x.daysOnSale);
      if (d !== undefined && d >= 7) parts.push(`al ${d} dagen te koop zonder melding dat de datum uitverkocht is`);
      const left = num(x.daysLeft);
      if (left !== undefined) parts.push(left <= 1 ? 'de show is al heel dichtbij' : `nog ${left} dagen tot de show`);
      const q = num(x.queueSize);
      if (q !== undefined) parts.push(`wachtrij van ${formatNumber(q)} mensen`);
      return sentence(parts);
    }
    case 'resale': {
      const prem = num(x.premiumPct);
      if (prem !== undefined) {
        return prem >= 0
          ? `Doorverkoopprijzen liggen ${prem}% boven de nominale prijs.`
          : `Op doorverkoopsites zijn kaarten onder de nominale prijs te koop (${prem}%).`;
      }
      if (num(x.listingsPer1000) !== undefined) return up ? 'Er worden weinig kaarten doorverkocht.' : 'Er worden veel kaarten doorverkocht.';
      return null;
    }
    case 'few_left': {
      const parts: string[] = [];
      if (x.fewTicketsLeft === true) parts.push('de ticketverkoper meldt dat er nog weinig kaarten zijn');
      if (x.extraRelease === true) parts.push('er zijn extra kaarten vrijgegeven');
      return sentence(parts);
    }
  }
}

const CAVEAT: Record<ScoreKind, string> = {
  rush: 'Nog weinig gegevens over deze datum. De verwachting leunt vooral op het gemiddelde en wordt scherper zodra er cijfers over de artiest of verkoop elders bijkomen.',
  sellout: 'Nog weinig verkoopsignalen. De kans leunt vooral op de verwachte drukte vooraf en verandert zodra er data uitverkopen of extra shows bijkomen.',
};

export function explainScore(r: ScoreResult): Explanation {
  if (r.state === 'soldout') return { headline: 'Uitverkocht', lines: [] };
  if (r.state === 'cancelled') return { headline: 'Geannuleerd', lines: [] };
  const band = scoreBand(r.score, r.kind);
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
  if (r.confidence === 'low') explanation.caveat = CAVEAT[r.kind];
  return explanation;
}
