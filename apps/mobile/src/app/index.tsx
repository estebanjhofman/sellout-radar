import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { BENELUX, continentOf, earliestInstant, nextAction, normalizeText, type SnapshotEvent } from '@sellout/core';
import { timeAgo } from '../lib/view';
import { useData } from '../state/data';
import { usePrefs } from '../state/prefs';
import { Banner, Button, Chip, useNow } from '../ui/components';
import { EventCard } from '../ui/EventCard';
import { IconGear, IconList, IconSearch } from '../ui/icons';
import { useTheme } from '../ui/theme';

type Quick = 'all' | '40' | '70' | 'followed';
type Kind = 'all' | SnapshotEvent['type'];
type Region = 'all' | 'NL' | 'BENELUX' | 'EU';
type Sort = 'score' | 'next' | 'date';


export default function Overview() {
  const t = useTheme();
  const now = useNow(30_000);
  const { snapshot, index, loading, error, staleWarning, refresh, fetchedAt } = useData();
  const { isFollowing, toggleEvent } = usePrefs();
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [region, setRegion] = useState<Region>('all');
  const [soon, setSoon] = useState(false);
  const [sort, setSort] = useState<Sort>('score');
  const [showFilters, setShowFilters] = useState(false);

  const list = useMemo(() => {
    if (!snapshot || !index) return [];
    const q = normalizeText(query.trim());
    const nowIso = now.toISOString();
    const in7d = now.getTime() + 7 * 86_400_000;
    const rows = snapshot.events.filter((e) => {
      const v = index.venues.get(e.venueId);
      if (quick === '40' && e.score.value < 40) return false;
      if (quick === '70' && e.score.value < 70) return false;
      if (quick === 'followed' && !isFollowing(e.id, e.tourId, e.artistIds)) return false;
      if (kind !== 'all' && e.type !== kind) return false;
      if (region === 'NL' && v?.country !== 'NL') return false;
      if (region === 'BENELUX' && !BENELUX.has(v?.country ?? '')) return false;
      if (region === 'EU' && continentOf(v?.country ?? '') !== 'EU') return false;
      if (soon) {
        const na = nextAction(index.phasesByEvent.get(e.id) ?? [], nowIso);
        const at = na ? earliestInstant(na.at)?.toMillis() : undefined;
        if (!at || at > in7d) return false;
      }
      if (q) {
        const artists = e.artistIds.map((a) => index.artists.get(a)?.name ?? '').join(' ');
        const tour = e.tourId ? (index.tours.get(e.tourId)?.name ?? '') : '';
        const hay = normalizeText(`${e.title} ${artists} ${tour} ${v?.city ?? ''} ${v?.name ?? ''}`);
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    if (sort === 'next') {
      const key = (e: SnapshotEvent) => {
        const na = nextAction(index.phasesByEvent.get(e.id) ?? [], nowIso);
        return na ? (earliestInstant(na.at)?.toMillis() ?? Infinity) : Infinity;
      };
      rows.sort((a, b) => key(a) - key(b) || b.score.value - a.score.value);
    } else if (sort === 'date') {
      rows.sort((a, b) => (a.date.localDate ?? '').localeCompare(b.date.localDate ?? ''));
    } else {
      // Al uitverkocht of geannuleerd: de uitkomst staat vast, dus onderaan; de radar gaat over wat nog kan.
      const settled = (e: SnapshotEvent) => (e.status === 'soldout' || e.status === 'cancelled' ? 1 : 0);
      rows.sort(
        (a, b) => settled(a) - settled(b) || b.score.value - a.score.value || (a.date.localDate ?? '').localeCompare(b.date.localDate ?? ''),
      );
    }
    return rows;
  }, [snapshot, index, query, quick, kind, region, soon, sort, now, isFollowing]);

  const renderItem = useCallback(
    ({ item }: { item: SnapshotEvent }) => (
      <EventCard
        event={item}
        venue={index?.venues.get(item.venueId)}
        phases={index?.phasesByEvent.get(item.id) ?? []}
        followed={isFollowing(item.id, item.tourId, item.artistIds)}
        now={now}
        onPress={() => router.push({ pathname: '/event/[id]', params: { id: item.id } })}
        onToggleFollow={() => toggleEvent(item.id)}
      />
    ),
    [index, isFollowing, now, toggleEvent],
  );

  const header = (
    <View>
      {error && snapshot ? <Banner tone="warn">{`Bijwerken lukte niet: ${error} Je ziet de laatst bekende data.`}</Banner> : null}
      {staleWarning ? <Banner tone="warn">{staleWarning}</Banner> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, marginBottom: 12 }}>
        <IconSearch color={t.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Zoek artiest, stad of venue"
          placeholderTextColor={t.faint}
          style={{ flex: 1, color: t.text, fontSize: 15.5, paddingVertical: 11, paddingHorizontal: 8 }}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Zoeken"
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="Alles" active={quick === 'all'} onPress={() => setQuick('all')} />
        <Chip label="40+" active={quick === '40'} onPress={() => setQuick('40')} />
        <Chip label="70+" active={quick === '70'} onPress={() => setQuick('70')} />
        <Chip label="Gevolgd" active={quick === 'followed'} onPress={() => setQuick('followed')} />
        <Chip label={showFilters ? 'Minder filters' : 'Filters'} active={showFilters} onPress={() => setShowFilters((s) => !s)} />
      </View>
      {showFilters ? (
        <View style={{ marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(
              [
                ['all', 'Alle soorten'],
                ['concert', 'Concerten'],
                ['festival', 'Festivals'],
                ['sport', 'Sport'],
                ['theatre', 'Theater'],
                ['comedy', 'Comedy'],
                ['other', 'Overig'],
              ] as [Kind, string][]
            ).map(([k, l]) => (
              <Chip key={k} label={l} active={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(
              [
                ['all', 'Overal'],
                ['NL', 'Nederland'],
                ['BENELUX', 'Benelux'],
                ['EU', 'Europa'],
              ] as [Region, string][]
            ).map(([k, l]) => (
              <Chip key={k} label={l} active={region === k} onPress={() => setRegion(k)} />
            ))}
            <Chip label="Verkoop binnen 7 dagen" active={soon} onPress={() => setSoon((s) => !s)} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Op score" active={sort === 'score'} onPress={() => setSort('score')} />
            <Chip label="Eerstvolgende verkoop" active={sort === 'next'} onPress={() => setSort('next')} />
            <Chip label="Op showdatum" active={sort === 'date'} onPress={() => setSort('date')} />
          </View>
        </View>
      ) : null}
      <Text style={{ color: t.muted, fontSize: 12.5, marginBottom: 8, marginTop: 2 }}>
        {list.length} {list.length === 1 ? 'datum' : 'datums'}
        {snapshot ? ` · bijgewerkt ${timeAgo(snapshot.generatedAt, now)}` : ''}
      </Text>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18, paddingRight: 4 }}>
              <Pressable onPress={() => router.push('/changes')} accessibilityRole="button" accessibilityLabel="Wijzigingen" hitSlop={8}>
                <IconList color={t.text} />
              </Pressable>
              <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Instellingen" hitSlop={8}>
                <IconGear color={t.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      {!snapshot ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {loading ? (
            <View style={{ alignItems: 'center', marginTop: 60, gap: 12 }}>
              <ActivityIndicator />
              <Text style={{ color: t.muted }}>Data laden…</Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Banner tone="warn">{`Kon geen data laden. ${error ?? ''}`}</Banner>
              <Button label="Opnieuw proberen" kind="primary" onPress={() => void refresh()} />
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={{ color: t.muted, marginTop: 20, textAlign: 'center' }}>Geen datums met deze filters.</Text>}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 860, width: '100%', alignSelf: 'center' }}
          initialNumToRender={12}
          windowSize={9}
          refreshControl={<RefreshControl refreshing={loading && !!fetchedAt} onRefresh={() => void refresh()} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </>
  );
}
