import { DateTime } from 'luxon';
import type { TimePoint } from './types';
import { MONTH_WORDS, normalizeText } from './claims';

/**
 * Bewijscontrole voor LLM-extractie: een datum of tijd telt alleen als ze letterlijk
 * terug te vinden is in het tekstfragment waarop de extractie steunt.
 * Zo kan een taalmodel geen verkoopdata verzinnen.
 */

const MONTH_NAMES_BY_NUMBER: Record<number, string[]> = {};
for (const [name, n] of Object.entries(MONTH_WORDS)) {
  (MONTH_NAMES_BY_NUMBER[n] ??= []).push(name);
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Staat deze kalenderdatum (YYYY-MM-DD) in de tekst? Ondersteunt NL/EN/DE/FR/ES en cijfervormen. */
export function dateMentioned(localDate: string, text: string): boolean {
  const dt = DateTime.fromISO(localDate);
  if (!dt.isValid) return false;
  const t = normalizeText(text);
  const d = dt.day;
  const m = dt.month;
  const names = (MONTH_NAMES_BY_NUMBER[m] ?? []).map(esc).join('|');
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ord = '(?:st|nd|rd|th|e|er)?';
  const patterns = [
    `\\b(?:${names})\\.?\\s+${d}${ord}\\b`, // November 10, Nov. 10th
    `\\b0?${d}${ord}\\.?\\s+(?:of\\s+|de\\s+)?(?:${names})\\b`, // 10 november, 10th of November
    `\\b${dt.year}-${mm}-${dd}\\b`, // ISO
    `\\b0?${d}[./-]0?${m}(?:[./-](?:${dt.year}|${String(dt.year).slice(2)}))?\\b`, // 10/11, 10-11-2026
    `\\b0?${m}/0?${d}(?:/(?:${dt.year}|${String(dt.year).slice(2)}))?\\b`, // 11/10 (VS-notatie)
  ];
  return patterns.some((p) => new RegExp(p).test(t));
}

/** Staat dit tijdstip (HH:mm, 24-uurs) in de tekst? */
export function timeMentioned(localTime: string, text: string): boolean {
  const mt = /^(\d{1,2}):(\d{2})$/.exec(localTime);
  if (!mt) return false;
  const h = Number(mt[1]);
  const min = Number(mt[2]);
  const t = normalizeText(text);
  const mm = String(min).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'a' : 'p';
  const patterns = [
    `\\b0?${h}[:.]${mm}\\b`, // 10:00, 10.00
    `\\b${h12}(?:[:.]${mm})?\\s*${ampm}\\.?\\s*m\\b\\.?`, // 10am, 10 a.m., 12:00 p.m.
  ];
  if (min === 0) {
    patterns.push(`\\b${h}\\s*(?:uur|u)\\b`); // 10 uur
    patterns.push(`\\b${h}h\\b`); // 10h (FR)
    if (h === 12) patterns.push('\\bnoon\\b', '\\bmiddag\\b');
  }
  return patterns.some((p) => new RegExp(p).test(t));
}

export interface EvidenceCheck {
  /** Het tijdstip na controle, of null als de datum niet in het bewijs staat. */
  timePoint: TimePoint | null;
  warnings: string[];
}

/**
 * Controleert een geëxtraheerd tijdstip tegen het bewijsfragment.
 * - Datum niet gevonden: verworpen.
 * - Datum wel, tijd niet: teruggezet naar alleen-datum.
 */
export function verifyTimePoint(tp: TimePoint, evidence: string | undefined): EvidenceCheck {
  const warnings: string[] = [];
  if (tp.precision === 'unknown') return { timePoint: tp, warnings };
  if (!evidence || evidence.trim().length < 6) {
    return { timePoint: null, warnings: ['Geen bewijsfragment; tijdstip verworpen.'] };
  }
  if (tp.precision === 'month') {
    const [y, m] = tp.localMonth!.split('-').map(Number);
    const names = (MONTH_NAMES_BY_NUMBER[m!] ?? []).map(esc).join('|');
    const ok = new RegExp(`\\b(?:${names})\\b`).test(normalizeText(evidence)) && evidence.includes(String(y));
    return ok ? { timePoint: tp, warnings } : { timePoint: null, warnings: ['Maand niet in bewijs; verworpen.'] };
  }
  const localDate =
    tp.precision === 'exact' ? DateTime.fromISO(tp.utc!, { zone: 'utc' }).setZone(tp.tz).toISODate()! : tp.localDate!;
  if (!dateMentioned(localDate, evidence)) {
    return { timePoint: null, warnings: [`Datum ${localDate} staat niet in het bewijs; verworpen.`] };
  }
  if (tp.precision === 'exact') {
    const localTime = DateTime.fromISO(tp.utc!, { zone: 'utc' }).setZone(tp.tz).toFormat('HH:mm');
    if (!timeMentioned(localTime, evidence)) {
      warnings.push(`Tijd ${localTime} staat niet in het bewijs; alleen de datum is overgenomen.`);
      return { timePoint: { precision: 'date', tz: tp.tz, localDate }, warnings };
    }
  }
  return { timePoint: tp, warnings };
}
