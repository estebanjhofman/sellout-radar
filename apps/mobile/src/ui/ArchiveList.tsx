import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ARCHIVE_SIZE, SPEED_LABELS } from '@sellout/core';
import { bucketize, type BucketRow } from '../lib/buckets';
import { cityNl, shortDate } from '../lib/view';
import { useData } from '../state/data';
import { ScorePill, useNow } from './components';
import { useTheme } from './theme';

/** Lijst na de verkoop: Uitverkocht (snelst eerst) of Nog beschikbaar (hoogste uitverkoopkans eerst). */
export function ArchiveList({ kind }: { kind: 'soldout' | 'available' }) {
  const t = useTheme();
  const now = useNow(60_000);
  const { snapshot, index } = useData();
  const nowIso = now.toISOString();
  const rows = useMemo(() => (snapshot && index ? bucketize(snapshot.events, index, nowIso)[kind] : []), [snapshot, index, nowIso, kind]);
  if (!snapshot || !index) return <Text style={{ color: t.muted, padding: 20 }}>Data laden…</Text>;

  const line = ({ event: e, view }: BucketRow) => {
    if (kind === 'soldout') {
      const speed = e.rushFinal?.outcome?.speed;
      const how = speed ? `Uitverkocht ${SPEED_LABELS[speed]}` : 'Uitverkocht';
      return e.rushFinal ? `${how} · verwachte drukte vooraf ${e.rushFinal.value} (${e.rushFinal.label.toLowerCase()})` : how;
    }
    return `Uitverkoopkans: ${view.score.label.toLowerCase()}`;
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.event.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      ListHeaderComponent={
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18, marginBottom: 12 }}>
          {kind === 'soldout'
            ? `De verkoop is voorbij en de datum is uitverkocht. De ${ARCHIVE_SIZE} snelst uitverkochte staan hier, tot de showdag.`
            : `De verkoop is voorbij maar de datum is niet uitverkocht. De ${ARCHIVE_SIZE} met de hoogste uitverkoopkans staan hier, tot de showdag. Raakt er een alsnog uitverkocht, dan gaat hij naar Uitverkocht.`}
        </Text>
      }
      ListEmptyComponent={<Text style={{ color: t.muted, marginTop: 12 }}>Nog niets.</Text>}
      renderItem={({ item, index: i }) => {
        const v = index.venues.get(item.event.venueId);
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.event.id } })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 12, marginBottom: 8, opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: t.faint, width: 22, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{i + 1}</Text>
            <ScorePill score={kind === 'soldout' ? (item.event.rushFinal?.value ?? 100) : item.view.score.value} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{item.event.title}</Text>
              <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>
                {shortDate(item.event)} · {v ? `${cityNl(v.city, v.country)} · ${v.name}` : ''}
              </Text>
              <Text style={{ color: t.muted, fontSize: 12.5 }} numberOfLines={2}>{line(item)}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
