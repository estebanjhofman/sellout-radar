import fs from 'node:fs';
import path from 'node:path';
import { emptyState, migrateState, type RunDelta, type State } from '../state';
import type { PushTarget, RunSummary, Store } from './types';

/**
 * Opslag in een JSON-bestand in de repository. Bedoeld voor lokaal testen en als terugval
 * zonder Supabase; dan zijn er geen gebruikersgegevens en dus geen pushmeldingen
 * (de herinneringen plant de app zelf in).
 */
export class FileStore implements Store {
  readonly kind = 'file' as const;
  private file: string;
  private runsFile: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'state', 'state.json');
    this.runsFile = path.join(dataDir, 'state', 'runs.jsonl');
  }

  async load(): Promise<State> {
    if (!fs.existsSync(this.file)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<State>;
    return migrateState(parsed);
  }

  async save(state: State, _delta: RunDelta, run: RunSummary): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, this.file);
    fs.appendFileSync(this.runsFile, `${JSON.stringify(run)}\n`);
    // Houd het runlog kort.
    const lines = fs.readFileSync(this.runsFile, 'utf8').trim().split('\n');
    if (lines.length > 300) fs.writeFileSync(this.runsFile, `${lines.slice(-300).join('\n')}\n`);
  }

  async pushTargets(): Promise<PushTarget[]> {
    return [];
  }

  async removePushTokens(): Promise<void> {}
}
