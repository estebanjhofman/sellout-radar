import { eventScoreView, rankAvailable, rankSoldOut, saleBucket, type EventScoreView, type SaleBucket, type SnapshotEvent } from '@sellout/core';
import type { DataIndex } from '../state/data';

export interface BucketRow {
  event: SnapshotEvent;
  view: EventScoreView;
}

/** Alle datums verdeeld over de radar en de twee lijsten na de verkoop (elk maximaal 50). */
export function bucketize(events: SnapshotEvent[], index: DataIndex, nowIso: string) {
  const by: Record<SaleBucket, BucketRow[]> = { upcoming: [], onsale: [], soldout: [], available: [] };
  for (const e of events) {
    const phases = index.phasesByEvent.get(e.id) ?? [];
    if (e.status === 'cancelled') continue;
    by[saleBucket(e, phases, nowIso)].push({ event: e, view: eventScoreView(e, phases, nowIso) });
  }
  return { upcoming: by.upcoming, onsale: by.onsale, soldout: rankSoldOut(by.soldout), available: rankAvailable(by.available) };
}
