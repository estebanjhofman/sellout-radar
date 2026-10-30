import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import {
  diffSnapshots,
  featureVector,
  formatTimePoint,
  recalibrate,
  scoreEvent,
  type Change,
  type ChangeLogEntry,
  type ChangeSnapshot,
  type Observation,
  type SalePhase,
  type ScoreResult,
  type Snapshot,
} from '@sellout/core';
import type { Config } from '../config';
import { LastFmConnector, SeatGeekConnector, SetlistFmConnector, YouTubeConnector } from '../connectors/signals';
import { LlmBudget, NewsConnector, WatchlistConnector } from '../connectors/text';
import { TicketmasterConnector } from '../connectors/ticketmaster';
import { emptyResult, type Connector, type ConnectorResult } from '../connectors/types';
import type { Extractor } from '../extract/llm';
import type { Fetcher } from '../http';
import { sendExpoPush } from '../push/expo';
import { planPushes, type EventInfo, type PushMessage } from '../push/plan';
import { compileSeedDir } from '../seed/compile';
import { emptyDelta, pruneState, serializeCatalog, type RunDelta, type ScorePoint } from '../state';
import type { RunSummary, Store } from '../store/types';
import { buildScoreInputs, indexObservations } from './inputs';
import { mergeAll } from './merge';
import { detectOutcomes } from './outcomes';
import { buildSnapshot } from './snapshot';

export interface RunDeps {
  store: Store;
  http: Fetcher;
  extractor?: Extractor;
  /** Vervangt de standaardbronnen (tests). */
  connectors?: Connector[];
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface RunOutput {
  snapshot: Snapshot;
  summary: RunSummary;
  delta: RunDelta;
  messages: PushMessage[];
  changes: Change[];
  seedIssues: { file: string; level: string; message: string }[];
}

export function defaultConnectors(extractor: Extractor | undefined, budget: LlmBudget): Connector[] {
  return [
    new TicketmasterConnector(),
    new WatchlistConnector(extractor, budget),
    new NewsConnector(extractor, budget),
    new SeatGeekConnector(),
    new LastFmConnector(),
    new YouTubeConnector(),
    new SetlistFmConnector(),
  ];
}

function slotName(now: string): string {
  const h = DateTime.fromISO(now).setZone('Europe/Amsterdam').hour;
  return h < 10 ? 'ochtend' : h < 16 ? 'middag' : 'avond';
}

function changeText(c: Change, events: Map<string, { title: string; localDate?: string }>, phases: Map<string, SalePhase>): ChangeLogEntry {
  const date = (id: string) => {
    const d = events.get(id)?.localDate;
    return d ? DateTime.fromISO(d).setLocale('nl').toFormat('d LLL yyyy') : '';
  };
  const title = (id: string) => `${events.get(id)?.title ?? id}${date(id) ? ` (${date(id)})` : ''}`;
  const at = new Date().toISOString();
  switch (c.type) {
    case 'extra_show':
      return { at, kind: 'extra_show', eventIds: [c.eventId], text: `Extra show toegevoegd: ${title(c.eventId)}` };
    case 'soldout':
      return { at, kind: 'soldout', eventIds: [c.eventId], text: `Uitverkocht: ${title(c.eventId)}` };
    case 'score_jump':
      return { at, kind: 'score_jump', eventIds: [c.eventId], text: `Score ${c.before} → ${c.after}: ${title(c.eventId)}` };
    case 'new_phase': {
      const p = phases.get(c.phaseId);
      return { at, kind: 'new_phase', eventIds: c.eventIds, phaseId: c.phaseId, text: `Nieuwe verkoopfase: ${c.name}${p ? `, ${formatTimePoint(p.start)}` : ''} – ${title(c.eventIds[0] ?? '')}` };
    }
    case 'sale_date':
      return {
        at,
        kind: 'sale_date',
        eventIds: c.eventIds,
        phaseId: c.phaseId,
        text: `Verkoopdatum gewijzigd: ${c.name}: ${formatTimePoint(c.before)} → ${formatTimePoint(c.after)} – ${title(c.eventIds[0] ?? '')}`,
      };
  }
}

export async function runUpdate(cfg: Config, deps: RunDeps): Promise<RunOutput> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = cfg.now;
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const delta = emptyDelta();
  const state = await deps.store.load();
  log(`Sellout Radar-update ${now} (opslag: ${deps.store.kind})`);

  // Seed
  const seed = compileSeedDir(path.join(cfg.dataDir, 'seed'));
  for (const i of seed.issues) {
    log(`  seed ${i.level === 'error' ? 'FOUT' : 'let op'} ${i.file}: ${i.message}`);
    if (i.level === 'error') errors.push(`seed ${i.file}: ${i.message}`);
  }
  log(`  seed: ${seed.files.length} bestanden, ${seed.catalog.events.size} datums, ${seed.catalog.phases.size} fases`);

  // Bronnen
  const base = mergeAll({ seed: seed.catalog, previous: state.catalog, storedClaims: state.claims, results: [], now }).catalog;
  const budget = new LlmBudget(cfg.maxLlmCallsPerRun);
  const connectors = deps.connectors ?? defaultConnectors(deps.extractor, budget);
  const results: ConnectorResult[] = [];
  for (const c of connectors) {
    const t0 = Date.now();
    let r: ConnectorResult;
    try {
      r = await c.run({ cfg, http: deps.http, now, state, catalog: base, log: (m) => log(m) });
    } catch (e) {
      r = { ...emptyResult(c.name, c.kind), ok: false, message: (e as Error).message };
    }
    results.push(r);
    const prev = state.health[c.name];
    state.health[c.name] = {
      name: c.name,
      kind: c.kind,
      ok: r.ok,
      lastAttemptAt: now,
      ...(r.ok && !r.skipped ? { lastSuccessAt: now } : prev?.lastSuccessAt ? { lastSuccessAt: prev.lastSuccessAt } : {}),
      ...(r.message ? { message: r.message } : {}),
    };
    if (!r.ok) errors.push(`${c.name}: ${r.message ?? 'fout'}`);
    log(`  ${c.name}: ${r.skipped ? 'overgeslagen' : r.ok ? 'ok' : 'FOUT'} – ${r.message ?? ''} (${Math.round((Date.now() - t0) / 1000)} s)`);
    for (const d of r.documents) delta.documents.push({ sourceName: c.name, url: d.url, fetchedAt: now, hash: d.hash });
  }

  // Samenvoegen
  const merged = mergeAll({ seed: seed.catalog, previous: state.catalog, storedClaims: state.claims, results, now });
  for (const l of merged.log) log(`  ${l}`);
  const cat = merged.catalog;
  delta.claims.push(...merged.newClaims);
  delta.externalIds.push(...merged.externalIds, ...results.flatMap((r) => r.externalIds));
  state.claims.push(...merged.newClaims);
  state.conflicts = merged.conflicts;

  // Metingen: alleen bij verandering (of minstens wekelijks een punt voor groeiberekeningen)
  const lastObs = new Map<string, Observation>();
  for (const o of state.observations) {
    const k = `${o.entity}|${o.metric}|${o.dimension ?? ''}`;
    const p = lastObs.get(k);
    if (!p || p.observedAt < o.observedAt) lastObs.set(k, o);
  }
  for (const o of results.flatMap((r) => r.observations)) {
    const k = `${o.entity}|${o.metric}|${o.dimension ?? ''}`;
    const p = lastObs.get(k);
    const weekOld = p ? DateTime.fromISO(o.observedAt).diff(DateTime.fromISO(p.observedAt), 'days').days >= 7 : true;
    if (!p || p.value !== o.value || weekOld) {
      state.observations.push(o);
      delta.observations.push(o);
      lastObs.set(k, o);
    }
  }

  // Scores
  const phasesByEvent = new Map<string, SalePhase[]>();
  for (const p of cat.phases.values()) for (const e of p.eventIds) phasesByEvent.set(e, [...(phasesByEvent.get(e) ?? []), p]);
  const obsIndex = indexObservations(state.observations);
  const setlistVisits = (state.kv['setlistfm:visits'] ?? {}) as Parameters<typeof buildScoreInputs>[2]['setlistVisits'];
  const scores = new Map<string, ScoreResult>();
  const today = DateTime.fromISO(now).toISODate()!;
  for (const ev of cat.events.values()) {
    const inputs = buildScoreInputs(ev, cat, { now, observations: state.observations, setlistVisits, phasesByEvent }, obsIndex);
    const r = scoreEvent(inputs, state.model);
    scores.set(ev.id, r);
    if ((ev.date.localDate ?? '9999') < today) continue;
    const hist = (state.scoreHistory[ev.id] ??= []);
    const last = hist[hist.length - 1];
    const stale = last ? DateTime.fromISO(now).diff(DateTime.fromISO(last.at), 'days').days >= 3 : true;
    if (!last || last.score !== r.score || last.confidence !== r.confidence || stale) {
      const point: ScorePoint = { at: now, score: r.score, probability: r.probability, confidence: r.confidence, modelVersion: r.modelVersion, features: featureVector(r.factors) };
      hist.push(point);
      delta.scorePoints.push({ eventId: ev.id, point, factors: r.factors.map((f) => ({ key: f.key, signal: f.signal, coverage: f.coverage, contribution: f.contribution })), explanation: r.top.map((f) => f.key) });
    }
  }

  // Uitkomsten en kalibratie
  const outcomes = detectOutcomes(cat, phasesByEvent, state.scoreHistory, state.outcomes, now);
  state.outcomes.push(...outcomes);
  delta.outcomes.push(...outcomes);
  const lastCal = state.lastCalibration;
  const due = !lastCal || state.outcomes.length - lastCal.outcomes >= 30 || DateTime.fromISO(now).diff(DateTime.fromISO(lastCal.at), 'days').days >= 30;
  if (due && state.outcomes.length >= 30) {
    const rep = recalibrate(state.model, state.outcomes, now);
    log(`  kalibratie: ${rep.reason}`);
    if (rep.applied) {
      state.model = rep.model;
      delta.modelChanged = true;
    }
    state.lastCalibration = { at: now, outcomes: state.outcomes.length };
  }

  // Wijzigingen sinds de vorige run
  const current: ChangeSnapshot = {
    events: [...cat.events.values()].map((e) => ({ id: e.id, title: e.title, status: e.status, ...(e.addedShow ? { addedShow: true } : {}), score: scores.get(e.id)?.score })),
    phases: [...cat.phases.values()].map((p) => ({ id: p.id, name: p.name, kind: p.kind, start: p.start, eventIds: p.eventIds })),
  };
  const changes = state.lastChangeSnapshot ? diffSnapshots(state.lastChangeSnapshot, current) : [];
  state.lastChangeSnapshot = current;
  const evInfo = new Map([...cat.events.values()].map((e) => [e.id, { title: e.title, localDate: e.date.localDate }]));
  for (const c of changes) {
    const entry = { ...changeText(c, evInfo, cat.phases), at: now };
    state.changes.push(entry);
    delta.changes.push(entry);
  }
  for (const id of merged.createdEventIds.slice(0, 100)) {
    const e = cat.events.get(id)!;
    const entry: ChangeLogEntry = { at: now, kind: 'new_event', eventIds: [id], text: `Nieuw gevonden: ${e.title}${e.date.localDate ? ` (${e.date.localDate})` : ''}` };
    state.changes.push(entry);
    delta.changes.push(entry);
  }

  // Pushmeldingen (alleen met Supabase: daar staan apparaten en volglijsten)
  let messages: PushMessage[] = [];
  const targets = await deps.store.pushTargets().catch((e) => {
    errors.push(`pushdoelen: ${(e as Error).message}`);
    return [];
  });
  if (targets.length) {
    const events = new Map<string, EventInfo>(
      [...cat.events.values()].map((e) => [e.id, { id: e.id, title: e.title, score: scores.get(e.id)?.score, ...(e.tourId ? { tourId: e.tourId } : {}), artistIds: e.artistIds }]),
    );
    messages = planPushes({ targets, events, phases: [...cat.phases.values()], changes, now: DateTime.fromISO(now), sent: state.sent });
    for (const m of messages) {
      delta.sent.push({ key: m.key, userId: m.userId, kind: m.kind, eventIds: m.eventIds, ...(m.phaseId ? { phaseId: m.phaseId } : {}), idealAt: m.idealAt, sendAt: m.deliverAt, title: m.title, body: m.body });
    }
    if (!cfg.dryRun && messages.length) {
      const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
      const groups = new Map<string, PushMessage[]>();
      for (const m of messages) groups.set(m.deliverAt, [...(groups.get(m.deliverAt) ?? []), m]);
      for (const at of [...groups.keys()].sort()) {
        const wait = Date.parse(at) - Date.now();
        if (wait > 0) {
          log(`  wacht ${Math.round(wait / 60000)} min tot ${at} (einde stille uren)`);
          await sleep(wait);
        }
        const res = await sendExpoPush(deps.http, groups.get(at)!, cfg.keys.expo);
        log(`  push: ${res.sent} verstuurd, ${res.failed} mislukt`);
        if (res.invalidTokens.length) await deps.store.removePushTokens(res.invalidTokens).catch(() => undefined);
        errors.push(...res.errors.slice(0, 3).map((e) => `push: ${e}`));
      }
    }
  }

  // Snapshot
  const pinned = new Set<string>([...seed.catalog.events.keys(), ...targets.flatMap((t) => [...t.followedEvents])]);
  const snapshot = buildSnapshot({
    catalog: cat,
    scores,
    history: state.scoreHistory,
    conflicts: merged.conflicts,
    health: state.health,
    changes: state.changes,
    outcomes: state.outcomes,
    model: state.model,
    now,
    pinned,
  });
  if (!cfg.dryRun) {
    const file = path.join(cfg.dataDir, 'snapshot.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(snapshot));
    fs.renameSync(`${file}.tmp`, file);
  }

  // Opslaan
  state.catalog = serializeCatalog(cat);
  state.updatedAt = now;
  pruneState(state, now);
  const summary: RunSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    slot: slotName(now),
    ok: errors.length === 0,
    counts: {
      datums: cat.events.size,
      inSnapshot: snapshot.events.length,
      fases: cat.phases.size,
      nieuweDatums: merged.createdEventIds.length,
      beweringen: merged.newClaims.length,
      metingen: delta.observations.length,
      wijzigingen: changes.length,
      push: messages.length,
      taalmodel: budget.used,
      conflicten: merged.conflicts.length,
    },
    errors,
  };
  if (!cfg.dryRun) await deps.store.save(state, delta, summary);
  log(`  klaar: ${JSON.stringify(summary.counts)}`);
  return { snapshot, summary, delta, messages, changes, seedIssues: seed.issues };
}
