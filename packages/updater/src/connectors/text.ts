import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseHtml } from 'node-html-parser';
import { DateTime } from 'luxon';
import { normalizeText, type SourceKind, type SourceRef } from '@sellout/core';
import { verifyExtraction, type Extractor } from '../extract/llm';
import { emptyResult, type Connector, type ConnectorContext, type ConnectorResult } from './types';

/**
 * Tekstbronnen: nieuwsfeeds (RSS/Atom) en een volglijst van officiële pagina's
 * (artiesten, promotors, venues). Nieuwe of gewijzigde tekst gaat door de extractie
 * met bewijscontrole. Pagina's worden alleen opgehaald als robots.txt dat toestaat.
 */

export interface FeedConfig {
  name: string;
  url: string;
  /** Taal van de feed, voor de trefwoordfilter. */
  lang?: string;
}

export interface WatchPage {
  name: string;
  url: string;
  kind: SourceKind;
  note?: string;
}

/** Zet HTML om in leesbare tekst (zonder menu's, scripts en voetteksten). */
export function htmlToText(html: string): string {
  const root = parseHtml(html, { blockTextElements: { script: false, style: false, noscript: false } });
  for (const sel of ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form', 'svg', 'iframe']) {
    for (const el of root.querySelectorAll(sel)) el.remove();
  }
  const main = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
  return main.structuredText
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Trefwoorden die op een aankondiging of verkoopnieuws wijzen (EN, NL, DE, FR, ES). */
const KEYWORDS = [
  'tour', 'tickets', 'presale', 'pre-sale', 'on sale', 'onsale', 'general sale', 'sold out', 'sells out', 'extra show',
  'added', 'announce', 'stadium', 'arena', 'festival', 'line-up', 'lineup', 'ballot', 'reunion', 'farewell', 'world tour',
  'tournee', 'concert', 'voorverkoop', 'kaartverkoop', 'uitverkocht', 'toegevoegd', 'kondigt', 'extra concert',
  'tournee', 'vorverkauf', 'ausverkauft', 'zusatzkonzert', 'billetterie', 'complet', 'gira', 'entradas', 'agotado',
];

export function looksRelevant(title: string, summary = ''): boolean {
  const t = normalizeText(`${title} ${summary}`);
  return KEYWORDS.some((k) => t.includes(k));
}

interface FeedItem {
  title: string;
  link: string;
  description: string;
  published?: string;
}

export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const doc = parser.parse(xml) as Record<string, any>;
  const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'object' && v && '#text' in (v as object) ? String((v as any)['#text']) : '');
  const items: FeedItem[] = [];
  const rssItems = doc?.rss?.channel?.item;
  for (const it of Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : []) {
    items.push({
      title: text(it.title),
      link: text(it.link) || text(it.guid),
      description: text(it['content:encoded']) || text(it.description),
      published: text(it.pubDate) || undefined,
    });
  }
  const entries = doc?.feed?.entry;
  for (const it of Array.isArray(entries) ? entries : entries ? [entries] : []) {
    const links = Array.isArray(it.link) ? it.link : [it.link];
    const href = links.find((l: any) => !l?.['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'] ?? '';
    items.push({ title: text(it.title), link: href, description: text(it.content) || text(it.summary), published: text(it.published) || text(it.updated) || undefined });
  }
  return items.filter((i) => i.link);
}

function parseDate(s?: string): DateTime | null {
  if (!s) return null;
  const a = DateTime.fromRFC2822(s);
  if (a.isValid) return a;
  const b = DateTime.fromISO(s);
  return b.isValid ? b : null;
}

/** Gedeelde LLM-teller per run. */
export class LlmBudget {
  used = 0;
  constructor(public max: number) {}
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

async function extractInto(res: ConnectorResult, ctx: ConnectorContext, extractor: Extractor, text: string, source: SourceRef, publishedAt?: string) {
  const raw = await extractor.extract({ text, source, publishedAt });
  const v = verifyExtraction(raw, text, source, ctx.catalog);
  res.discovered.push(...v.events);
  res.loosePhases.push(...v.loosePhases);
  for (const r of v.rejected) ctx.log(`  verworpen (${source.name}): ${r}`);
}

export class NewsConnector implements Connector {
  name = 'Nieuws';
  kind = 'news' as const;
  constructor(private extractor: Extractor | undefined, private budget: LlmBudget) {}

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    if (!this.extractor) return { ...res, skipped: true, message: 'Niet ingesteld (ANTHROPIC_API_KEY ontbreekt): nieuws wordt niet gelezen.' };
    const file = path.join(ctx.cfg.dataDir, 'feeds.json');
    const feeds = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as FeedConfig[]) : [];
    const seen = (ctx.state.kv['news:seen'] ?? {}) as Record<string, string>;
    const cutoff = DateTime.fromISO(ctx.now).minus({ hours: 72 });
    const failures: string[] = [];
    let considered = 0;
    for (const feed of feeds) {
      let items: FeedItem[];
      try {
        const r = await ctx.http.get(feed.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        items = parseFeed(r.text);
      } catch (e) {
        failures.push(`${feed.name}: ${(e as Error).message}`);
        continue;
      }
      for (const it of items) {
        const pub = parseDate(it.published);
        if (seen[it.link] || (pub && pub < cutoff)) continue;
        if (!looksRelevant(it.title, it.description.slice(0, 500))) {
          seen[it.link] = ctx.now;
          continue;
        }
        if (!this.budget.take()) break;
        considered++;
        seen[it.link] = ctx.now;
        let text = htmlToText(it.description);
        try {
          const page = await ctx.http.get(it.link, { respectRobots: true });
          if (page.ok) {
            const full = htmlToText(page.text);
            if (full.length > text.length) text = full;
          }
        } catch {
          // Valt terug op de tekst uit de feed.
        }
        if (text.length < 80) continue;
        const source: SourceRef = { name: feed.name, kind: 'news', url: it.link, fetchedAt: ctx.now };
        res.documents.push({ url: it.link, hash: sha256(text) });
        try {
          await extractInto(res, ctx, this.extractor, `${it.title}\n\n${text}`, source, pub?.toISO() ?? undefined);
          res.llmCalls = (res.llmCalls ?? 0) + 1;
        } catch (e) {
          failures.push(`${feed.name} (extractie): ${(e as Error).message}`);
        }
      }
    }
    // Houd de lijst gezien-items beperkt tot een week.
    const weekAgo = DateTime.fromISO(ctx.now).minus({ days: 7 }).toISO()!;
    for (const [k, v] of Object.entries(seen)) if (v < weekAgo) delete seen[k];
    ctx.state.kv['news:seen'] = seen;
    res.ok = failures.length < Math.max(1, feeds.length);
    res.message = `${considered} berichten gelezen, ${res.discovered.length} datums en ${res.loosePhases.length} fases gevonden.${failures.length ? ` Problemen: ${failures.slice(0, 5).join('; ')}` : ''}`;
    return res;
  }
}

export class WatchlistConnector implements Connector {
  name = 'Officiële pagina’s';
  kind = 'artist' as const;
  constructor(private extractor: Extractor | undefined, private budget: LlmBudget) {}

  async run(ctx: ConnectorContext) {
    const res = emptyResult(this.name, this.kind);
    const file = path.join(ctx.cfg.dataDir, 'watchlist.json');
    const pages = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as WatchPage[]) : [];
    if (!this.extractor) return { ...res, skipped: true, message: 'Niet ingesteld (ANTHROPIC_API_KEY ontbreekt): officiële pagina’s worden niet gelezen.' };
    const hashes = (ctx.state.kv['page:hashes'] ?? {}) as Record<string, string>;
    const failures: string[] = [];
    let changed = 0;
    for (const p of pages) {
      try {
        const r = await ctx.http.get(p.url, { respectRobots: true });
        if (r.status === 999) {
          failures.push(`${p.name}: robots.txt staat lezen niet toe`);
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = htmlToText(r.text);
        const hash = sha256(text);
        if (hashes[p.url] === hash) continue;
        if (text.length < 80) continue;
        if (!this.budget.take()) break;
        changed++;
        res.documents.push({ url: p.url, hash });
        const source: SourceRef = { name: p.name, kind: p.kind, url: p.url, fetchedAt: ctx.now };
        await extractInto(res, ctx, this.extractor, text, source, ctx.now);
        res.llmCalls = (res.llmCalls ?? 0) + 1;
        hashes[p.url] = hash;
      } catch (e) {
        failures.push(`${p.name}: ${(e as Error).message}`);
      }
    }
    ctx.state.kv['page:hashes'] = hashes;
    res.ok = failures.length < Math.max(1, pages.length);
    res.message = `${pages.length} pagina's gecontroleerd, ${changed} gewijzigd.${failures.length ? ` Problemen: ${failures.slice(0, 5).join('; ')}` : ''}`;
    return res;
  }
}
