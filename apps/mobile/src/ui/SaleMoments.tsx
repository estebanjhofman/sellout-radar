import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DateTime } from 'luxon';
import { saleMoments, type SalePhase, type SnapshotEvent } from '@sellout/core';
import { momentCountdown, momentLabel, momentTimes } from '../lib/view';
import { useTheme } from './theme';

/**
 * Alle verkoopmomenten van een stad: inschrijvingen, lotingen, presales en de algemene verkoop,
 * met lokale tijd, Nederlandse tijd (als die afwijkt) en een aftelklok. Voorbije momenten staan
 * ingeklapt onder "eerdere momenten".
 */
export function SaleMoments({ phases, dates, now }: { phases: SalePhase[]; dates: SnapshotEvent[]; now: Date }) {
  const t = useTheme();
  const [showPast, setShowPast] = useState(false);
  const items = saleMoments(phases, now.toISOString());
  if (items.length === 0) {
    return <Text style={{ color: t.muted, fontSize: 13 }}>Nog niet bekend.</Text>;
  }
  const past = items.filter((i) => i.state === 'past');
  const shown = showPast ? items : items.filter((i) => i.state !== 'past');
  const ids = new Set(dates.map((d) => d.id));
  const onlyFor = (phase: SalePhase): string | null => {
    const mine = phase.eventIds.filter((id) => ids.has(id));
    if (mine.length === ids.size || dates.length < 2) return null;
    const labels = dates
      .filter((d) => mine.includes(d.id) && d.date.localDate)
      .map((d) => DateTime.fromISO(d.date.localDate!).setLocale('nl').toFormat('d LLL'));
    return labels.length ? `alleen ${labels.join(', ')}` : null;
  };
  return (
    <View style={{ gap: 8 }}>
      {shown.map((it) => {
        const times = momentTimes(it);
        const cd = momentCountdown(it, now);
        const active = it.state === 'next' || it.state === 'now';
        const only = onlyFor(it.phase);
        return (
          <View key={it.key} style={{ flexDirection: 'row', gap: 10, opacity: it.state === 'past' ? 0.55 : 1 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                marginTop: 6,
                backgroundColor: active ? t.accent : it.state === 'unknown' ? t.faint : t.border,
              }}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 }}>
                <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '700', flexShrink: 1 }}>{momentLabel(it)}</Text>
                {cd ? (
                  <Text style={{ color: active ? t.accent : t.muted, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{cd}</Text>
                ) : null}
              </View>
              <Text style={{ color: t.text, fontSize: 13, marginTop: 1 }}>{times.local}</Text>
              {times.nl ? <Text style={{ color: t.muted, fontSize: 12.5 }}>{times.nl}</Text> : null}
              {only ? <Text style={{ color: t.muted, fontSize: 12, marginTop: 1 }}>{only}</Text> : null}
            </View>
          </View>
        );
      })}
      {past.length ? (
        <Pressable onPress={() => setShowPast((v) => !v)} accessibilityRole="button" hitSlop={6}>
          <Text style={{ color: t.accent, fontSize: 12.5, fontWeight: '700' }}>
            {showPast ? 'Eerdere momenten verbergen' : `${past.length} ${past.length === 1 ? 'eerder moment' : 'eerdere momenten'} tonen`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
