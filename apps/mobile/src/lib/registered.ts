import { DateTime } from 'luxon';
import { countdown, earliestInstant, formatDual, formatTimePoint, type SalePhase, type TimePoint } from '@sellout/core';

/** Inschrijvingen en lotingen van een datum: daar kun je je voor inschrijven. */
export function registrationPhases(phases: SalePhase[]): SalePhase[] {
  return phases.filter((p) => p.kind === 'registration' || p.kind === 'lottery');
}

export interface RegistrationTarget {
  /** Waar de aftelklok naartoe telt, bijv. "U2 Artist Presale". */
  label: string;
  at: TimePoint | undefined;
  /** "over 3 d 4 u", "nu bezig", "voorbij" of null als het moment nog niet bekend is. */
  countdown: string | null;
  /** Tijd in de lokale tijd en (als die afwijkt) in Nederlandse tijd. */
  when: string;
  /** Voor het sorteren (ms), Infinity als onbekend. */
  sortAt: number;
}

/**
 * Alle doelen van je inschrijvingen voor een datum, het eerstvolgende eerst (voorbije achteraan).
 * Twee inschrijvingen die naar dezelfde verkoop leiden, tellen als één.
 */
export function registrationTargets(phases: SalePhase[], phaseIds: string[], now: Date): RegistrationTarget[] {
  const seen = new Set<string>();
  const out: RegistrationTarget[] = [];
  for (const id of phaseIds) {
    const t = registrationTarget(phases, id, now);
    const key = `${t.label}|${t.sortAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  const done = (t: RegistrationTarget) => (t.countdown === 'voorbij' ? 1 : 0);
  return out.sort((a, b) => done(a) - done(b) || a.sortAt - b.sortAt);
}

/**
 * Waar telt de aftelklok naartoe voor iemand die ingeschreven staat?
 * Naar de presale die de inschrijving ontsluit; bij een loting zonder presale naar de uitslag;
 * anders naar de eerstvolgende presale of algemene verkoop van de datum.
 * phaseId leeg = "ingeschreven" zonder specifieke inschrijving.
 */
export function registrationTarget(phases: SalePhase[], phaseId: string, now: Date): RegistrationTarget {
  const reg = phases.find((p) => p.id === phaseId);
  // De updater splitst fases soms per stad ("…:artist-presale:europe-amsterdam"); de verwijzing
  // gebruikt dan de basis-ID. Zoek eerst exact, daarna op die basis.
  const u = reg?.unlocksPhaseId;
  const unlocked = u ? (phases.find((p) => p.id === u) ?? phases.find((p) => p.id.startsWith(`${u}:`))) : undefined;
  let label: string;
  let at: TimePoint | undefined;
  if (unlocked) {
    label = unlocked.name;
    at = unlocked.start;
  } else if (reg?.kind === 'lottery' && reg.drawAt) {
    label = `Uitslag ${reg.name}`;
    at = reg.drawAt;
  } else {
    const nowMs = now.getTime();
    const sales = phases
      .filter((p) => p.kind === 'presale' || p.kind === 'general_sale')
      .map((p) => ({ p, ms: earliestInstant(p.start)?.toMillis() ?? Infinity }))
      .filter((x) => x.ms === Infinity || x.ms > nowMs - 3_600_000)
      .sort((a, b) => a.ms - b.ms);
    const first = sales[0]?.p;
    label = first ? first.name : 'Verkoop';
    at = first?.start;
  }
  const inst = earliestInstant(at);
  const ms = inst?.toMillis() ?? Infinity;
  let cd: string | null = null;
  if (inst) {
    const diff = ms - now.getTime();
    cd = diff > 0 ? `over ${countdown(inst, DateTime.fromJSDate(now))}` : diff > -3_600_000 ? 'nu bezig' : 'voorbij';
  }
  let when = 'nog niet bekend';
  if (at && at.precision === 'exact') {
    const d = formatDual(at);
    when = d.same ? d.local : `${d.local} · ${d.user} NL`;
  } else if (at) when = formatTimePoint(at);
  return { label, at, countdown: cd, when, sortAt: ms };
}
