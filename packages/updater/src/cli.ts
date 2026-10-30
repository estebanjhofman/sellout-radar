import path from 'node:path';
import { accuracySummary, recalibrate } from '@sellout/core';
import { loadConfig } from './config';
import { ClaudeExtractor } from './extract/llm';
import { HttpFetcher } from './http';
import { runUpdate } from './pipeline/run';
import { compileSeedDir } from './seed/compile';
import { createStore } from './store/index';

/**
 * Gebruik:
 *   npm run update        – volledige run (bronnen ophalen, scores, snapshot, meldingen)
 *   npm run snapshot      – alleen opnieuw rekenen en het snapshot schrijven, zonder bronnen
 *   npm run seed:check    – seedbestanden controleren
 *   npm run calibrate     – kalibratierapport tonen
 */
async function main() {
  const cmd = process.argv[2] ?? 'run';
  const cfg = loadConfig();

  if (cmd === 'seed-check') {
    const { issues, files, catalog } = compileSeedDir(path.join(cfg.dataDir, 'seed'));
    for (const i of issues) console.log(`${i.level === 'error' ? 'FOUT ' : 'let op'} ${i.file}: ${i.message}`);
    console.log(`${files.length} bestanden, ${catalog.events.size} datums, ${catalog.phases.size} fases, ${catalog.venues.size} venues.`);
    const withListeners = new Set(catalog.observations.filter((o) => o.metric === 'lastfm_listeners').map((o) => o.entity)).size;
    const withCharts = [...catalog.facts.values()].filter((f) => f.charts.length).length;
    const tours = [...catalog.tours.values()];
    const withHistory = tours.filter((t) => t.previousVisits?.length || t.previousEditions?.length).length;
    const withCapacity = [...catalog.venues.values()].filter((v) => v.capacity).length;
    console.log(
      `Populariteit: ${withListeners} met Last.fm-luisteraars, ${withCharts} met hitnoteringen; ${withHistory} van ${tours.length} met vorige tour of editie; ${withCapacity} venues met capaciteit.`,
    );
    process.exit(issues.some((i) => i.level === 'error') ? 1 : 0);
  }

  const store = createStore(cfg);
  const http = new HttpFetcher(cfg.userAgent);

  if (cmd === 'calibrate') {
    const state = await store.load();
    const report = (kind: 'rush' | 'sellout') => {
      const records = kind === 'rush' ? state.rushOutcomes : state.outcomes;
      const rep = recalibrate(state.models[kind], records, cfg.now);
      return { model: state.models[kind].version, reason: rep.reason, applied: rep.applied, before: rep.before, after: rep.after, accuracy: accuracySummary(records) };
    };
    console.log(JSON.stringify({ verwachteDrukte: report('rush'), uitverkoopkans: report('sellout') }, null, 2));
    return;
  }

  const extractor = cfg.keys.anthropic ? new ClaudeExtractor(cfg.keys.anthropic, cfg.anthropicModel) : undefined;
  const out = await runUpdate(cfg, { store, http, extractor, ...(cmd === 'snapshot' ? { connectors: [] } : {}) });
  if (out.summary.errors.length) {
    console.log('Waarschuwingen:');
    for (const e of out.summary.errors) console.log(`  - ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
