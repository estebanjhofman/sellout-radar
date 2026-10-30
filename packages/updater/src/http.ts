/**
 * HTTP met nette manieren: per host een minimale pauze tussen verzoeken, een paar
 * herhaalpogingen bij tijdelijke fouten, een herkenbare User-Agent en respect voor robots.txt
 * bij het lezen van webpagina's (niet bij officiële API's, die hun eigen voorwaarden hebben).
 */

export interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  url: string;
  headers: Headers;
}

export interface Fetcher {
  get(url: string, opts?: { headers?: Record<string, string>; respectRobots?: boolean; timeoutMs?: number }): Promise<FetchResult>;
  post(url: string, body: unknown, opts?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<FetchResult>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimale pauze per host (ms). Ticketmaster staat 5 verzoeken per seconde toe. */
const HOST_INTERVAL: Record<string, number> = {
  'app.ticketmaster.com': 250,
  'api.seatgeek.com': 250,
  'ws.audioscrobbler.com': 250,
  'api.setlist.fm': 600,
  'www.googleapis.com': 100,
};
const DEFAULT_INTERVAL = 1000;

export class HttpFetcher implements Fetcher {
  private lastByHost = new Map<string, number>();
  private robots = new Map<string, RobotsRules | null>();

  constructor(private userAgent: string) {}

  private async throttle(host: string) {
    const interval = HOST_INTERVAL[host] ?? DEFAULT_INTERVAL;
    const last = this.lastByHost.get(host) ?? 0;
    const wait = last + interval - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastByHost.set(host, Date.now());
  }

  private async allowedByRobots(url: URL): Promise<boolean> {
    const key = url.origin;
    if (!this.robots.has(key)) {
      try {
        const res = await this.raw(`${url.origin}/robots.txt`, 'GET', undefined, {}, 10_000);
        this.robots.set(key, res.ok ? parseRobots(res.text) : null);
      } catch {
        this.robots.set(key, null);
      }
    }
    const rules = this.robots.get(key);
    return rules ? isAllowed(rules, url.pathname + url.search) : true;
  }

  private async raw(url: string, method: 'GET' | 'POST', body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<FetchResult> {
    const u = new URL(url);
    await this.throttle(u.host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json, text/html;q=0.9, */*;q=0.5',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        redirect: 'follow',
      });
      return { ok: res.ok, status: res.status, text: await res.text(), url: res.url, headers: res.headers };
    } finally {
      clearTimeout(timer);
    }
  }

  private async withRetry(fn: () => Promise<FetchResult>): Promise<FetchResult> {
    let last: FetchResult | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        last = await fn();
        if (last.status !== 429 && last.status < 500) return last;
        const retryAfter = Number(last.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1500 * (attempt + 1));
      } catch (e) {
        lastErr = e;
        await sleep(1500 * (attempt + 1));
      }
    }
    if (last) return last;
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async get(url: string, opts: { headers?: Record<string, string>; respectRobots?: boolean; timeoutMs?: number } = {}): Promise<FetchResult> {
    if (opts.respectRobots && !(await this.allowedByRobots(new URL(url)))) {
      return { ok: false, status: 999, text: 'Geblokkeerd door robots.txt', url, headers: new Headers() };
    }
    return this.withRetry(() => this.raw(url, 'GET', undefined, opts.headers ?? {}, opts.timeoutMs ?? 20_000));
  }

  async post(url: string, body: unknown, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<FetchResult> {
    return this.withRetry(() => this.raw(url, 'POST', body, opts.headers ?? {}, opts.timeoutMs ?? 20_000));
  }
}

// ---------------------------------------------------------------------------
// robots.txt (alleen de regels voor * en voor onze eigen naam)
// ---------------------------------------------------------------------------

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string, agent = 'selloutradar'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' && value) current.allow.push(value);
    if (field === 'disallow' && value) current.disallow.push(value);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function ruleMatches(rule: string, path: string): number {
  // Ondersteunt * en $ zoals Google; geeft de lengte van de match (langste regel wint).
  const re = new RegExp(
    '^' +
      rule
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')
        .replace(/\\\$$/, '$'),
  );
  return re.test(path) ? rule.length : -1;
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  const a = Math.max(-1, ...rules.allow.map((r) => ruleMatches(r, path)));
  const d = Math.max(-1, ...rules.disallow.map((r) => ruleMatches(r, path)));
  return d < 0 || a >= d;
}
