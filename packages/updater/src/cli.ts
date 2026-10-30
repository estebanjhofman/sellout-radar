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
    process.exit(issues.some((i) => i.level === 'error') ? 1 : 0);
  }

  const store = createStore(cfg);
  const http = new HttpFetcher(cfg.userAgent);

  if (cmd === 'calibrate') {
    const state = await store.load();
    const rep = recalibrate(state.model, state.outcomes, cfg.now);
    console.log(JSON.stringify({ reason: rep.reason, applied: rep.applied, before: rep.before, after: rep.after, accuracy: accuracySummary(state.outcomes) }, null, 2));
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
