import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import type { ChangeLogEntry } from '@sellout/core';
import { useData } from '../state/data';
import { useTheme } from '../ui/theme';

const KIND: Record<ChangeLogEntry['kind'], string> = {
  extra_show: 'Extra show',
  new_phase: 'Nieuwe fase',
  sale_date: 'Verkoopdatum',
  score_jump: 'Score',
  soldout: 'Uitverkocht',
  new_event: 'Nieuw',
  conflict: 'Conflict',
};

export default function Changes() {
  const t = useTheme();
  const { snapshot, index } = useData();
  const rows = snapshot?.changes ?? [];
  return (
    <FlatList
      data={rows}
      keyExtractor={(c, i) => `${c.at}-${i}`}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      ListEmptyComponent={<Text style={{ color: t.muted }}>De afgelopen twee weken zijn er geen wijzigingen gevonden.</Text>}
      renderItem={({ item }) => {
        const target = item.eventIds.find((id) => index?.events.has(id));
        return (
          <Pressable
            disabled={!target}
            onPress={() => target && router.push({ pathname: '/event/[id]', params: { id: target } })}
            style={({ pressed }) => ({ backgroundColor: t.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.8 : 1 })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.accent, fontWeight: '800', fontSize: 12.5 }}>{KIND[item.kind]}</Text>
              <Text style={{ color: t.faint, fontSize: 12 }}>{DateTime.fromISO(item.at).setZone('Europe/Amsterdam').setLocale('nl').toFormat('ccc d LLL HH:mm')}</Text>
            </View>
            <Text style={{ color: t.text, fontSize: 14.5, marginTop: 4, lineHeight: 20 }}>{item.text}</Text>
          </Pressable>
        );
      }}
    />
  );
}
