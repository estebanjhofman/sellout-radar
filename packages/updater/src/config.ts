import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Instellingen uit omgevingsvariabelen (in GitHub: repository secrets en variables).
 * Elke bron is optioneel: zonder sleutel slaat de updater die bron over en meldt dat in het snapshot.
 */
export interface Config {
  /** Map met seed/, watchlist.json, snapshot.json en (zonder Supabase) state/. */
  dataDir: string;
  /** "Nu" als ISO-UTC; vast te zetten met SELLOUT_NOW voor reproduceerbare tests. */
  now: string;
  dryRun: boolean;
  keys: {
    ticketmaster?: string;
    seatgeek?: string;
    lastfm?: string;
    youtube?: string;
    setlistfm?: string;
    anthropic?: string;
    expo?: string;
  };
  anthropicModel: string;
  supabase?: { url: string; serviceKey: string };
  /** Landen voor de Ticketmaster-ontdekking van nieuwe evenementen. */
  discoveryCountries: string[];
  /** Plafond voor taalmodelaanroepen per run (kosten in de hand). */
  maxLlmCallsPerRun: number;
  userAgent: string;
  /** Publieke URL van de repository, voor de User-Agent en bronvermelding. */
  repoUrl?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const opt = (k: string) => {
    const v = env[k]?.trim();
    return v ? v : undefined;
  };
  const repoUrl = opt('GITHUB_SERVER_URL') && opt('GITHUB_REPOSITORY') ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : opt('SELLOUT_REPO_URL');
  const supabaseUrl = opt('SUPABASE_URL');
  const supabaseKey = opt('SUPABASE_SERVICE_ROLE_KEY');
  return {
    dataDir: opt('SELLOUT_DATA_DIR') ?? path.join(REPO_ROOT, 'data'),
    now: opt('SELLOUT_NOW') ?? new Date().toISOString(),
    dryRun: opt('SELLOUT_DRY_RUN') === '1',
    keys: {
      ticketmaster: opt('TICKETMASTER_API_KEY'),
      seatgeek: opt('SEATGEEK_CLIENT_ID'),
      lastfm: opt('LASTFM_API_KEY'),
      youtube: opt('YOUTUBE_API_KEY'),
      setlistfm: opt('SETLISTFM_API_KEY'),
      anthropic: opt('ANTHROPIC_API_KEY'),
      expo: opt('EXPO_ACCESS_TOKEN'),
    },
    anthropicModel: opt('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5',
    supabase: supabaseUrl && supabaseKey ? { url: supabaseUrl, serviceKey: supabaseKey } : undefined,
    discoveryCountries: (opt('SELLOUT_COUNTRIES') ?? 'NL,BE,DE,GB,FR,IE,ES,IT,AT,CH,DK,SE,NO,PL,US,CA,AU').split(',').map((s) => s.trim()),
    maxLlmCallsPerRun: Number(opt('SELLOUT_MAX_LLM_CALLS') ?? 40),
    userAgent: `SelloutRadar/0.1 (+${repoUrl ?? 'persoonlijk project'})`,
    repoUrl,
  };
}
