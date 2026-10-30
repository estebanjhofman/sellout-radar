import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import {
  BENELUX,
  continentOf,
  earliestInstant,
  eventScoreView,
  groupEvents,
  nextAction,
  normalizeText,
  STAGE_LABEL,
  type EventGroup,
  type GroupDate,
  type GroupSort,
  type SaleStage,
  type SnapshotEvent,
} from '@sellout/core';
import { readJson, writeJson } from '../lib/storage';
import { timeAgo } from '../lib/view';
import { useData } from '../state/data';
import { usePrefs } from '../state/prefs';
import { Banner, Button, Chip, Segmented, useNow } from '../ui/components';
import { GroupCard } from '../ui/GroupCard';
import { IconGear, IconList, IconSearch } from '../ui/icons';
import { useTheme } from '../ui/theme';

type Quick = 'all' | '40' | '70' | 'followed';
type Kind = 'all' | SnapshotEvent['type'];
type Region = 'all' | 'NL' | 'BENELUX' | 'EU';

const TAB_KEY = 'ui:tab';

export default function Overview() {
  const t = useTheme();
  const now = useNow(30_000);
  const { snapshot, index, loading, error, staleWarning, refresh, fetchedAt } = useData();
  const { prefs, isFollowing, toggleEvent, toggleArtist } = usePrefs();
  const [tab, setTab] = useState<SaleStage>('upcoming');
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [region, setRegion] = useState<Region>('all');
  const [soon, setSoon] = useState(false);
  const [sort, setSort] = useState<GroupSort>('score');
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Laatst gekozen tabblad onthouden (alleen op dit toestel).
  useEffect(() => {
    void readJson<SaleStage>(TAB_KEY).then((v) => {
      if (v === 'upcoming' || v === 'onsale') setTab(v);
    });
  }, []);
  const chooseTab = useCallback((v: SaleStage) => {
    setTab(v);
    void writeJson(TAB_KEY, v);
  }, []);

  // Elke datum met het tabblad en de score van nu: een datum schuift door zodra de eerste verkoop begint.
  const rows = useMemo(() => {
    if (!snapshot || !index) return [] as GroupDate[];
    const nowIso = now.toISOString();
    return snapshot.events.map((e) => ({ event: e, view: eventScoreView(e, index.phasesByEvent.get(e.id) ?? [], nowIso), venue: index.venues.get(e.venueId) }));
  }, [snapshot, index, now]);

  const filtered = useMemo(() => {
    if (!index) return [] as GroupDate[];
    const q = normalizeText(query.trim());
    const nowIso = now.toISOString();
    const in7d = now.getTime() + 7 * 86_400_000;
    return rows.filter(({ event: e, view, venue: v }) => {
      if (quick === '40' && view.score.value < 40) return false;
      if (quick === '70' && view.score.value < 70) return false;
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
  }, [rows, index, query, quick, kind, region, soon, now, isFollowing]);

  const counts = useMemo(() => {
    let upcoming = 0;
    for (const r of filtered) if (r.view.stage === 'upcoming') upcoming++;
    return { upcoming, onsale: filtered.length - upcoming };
  }, [filtered]);

  const groups = useMemo(() => {
    if (!index) return [] as EventGroup[];
    return groupEvents(
      filtered.filter((r) => r.view.stage === tab),
      { artists: index.artists, tours: index.tours, phasesByEvent: index.phasesByEvent, now: now.toISOString() },
      sort,
    );
  }, [filtered, tab, index, sort, now]);

  const searching = query.trim().length > 0;
  const toggleGroup = useCallback((key: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: EventGroup }) => (
      <GroupCard
        group={item}
        now={now}
        expanded={searching || groups.length === 1 ? !expanded.has(`${tab}:${item.key}`) : expanded.has(`${tab}:${item.key}`)}
        onToggle={() => toggleGroup(`${tab}:${item.key}`)}
        followedArtist={prefs.followedArtists.includes(item.artistId)}
        onToggleFollowArtist={() => toggleArtist(item.artistId)}
        isFollowingEvent={(e) => prefs.followedEvents.includes(e.id)}
        onToggleFollowEvent={toggleEvent}
        onOpenEvent={(id) => router.push({ pathname: '/event/[id]', params: { id } })}
      />
    ),
    [now, tab, searching, groups.length, expanded, toggleGroup, prefs.followedArtists, prefs.followedEvents, toggleArtist, toggleEvent],
  );

  const header = (
    <View>
      {error && snapshot ? <Banner tone="warn">{`Bijwerken lukte niet: ${error} Je ziet de laatst bekende data.`}</Banner> : null}
      {staleWarning ? <Banner tone="warn">{staleWarning}</Banner> : null}
      <Segmented
        value={tab}
        onChange={chooseTab}
        options={[
          { key: 'upcoming', label: STAGE_LABEL.upcoming, count: counts.upcoming },
          { key: 'onsale', label: STAGE_LABEL.onsale, count: counts.onsale },
        ]}
      />
      <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 10 }}>
        {tab === 'upcoming'
          ? 'Score = verwachte drukte: hoe moeilijk het wordt om bij de eerste verkoop een kaart te krijgen. Een datum schuift door zodra de eerste presale of algemene verkoop begint.'
          : 'Score = uitverkoopkans: de kans dat de datum vóór de showdag uitverkoopt, op basis van echte verkoopsignalen. Uitverkochte datums staan onderaan.'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, marginBottom: 12 }}>
        <IconSearch color={t.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Zoek artiest, evenement, stad of venue"
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
            <Chip label="Verkoopmoment binnen 7 dagen" active={soon} onPress={() => setSoon((s) => !s)} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Op score" active={sort === 'score'} onPress={() => setSort('score')} />
            <Chip label="Eerstvolgend verkoopmoment" active={sort === 'next'} onPress={() => setSort('next')} />
            <Chip label="Op showdatum" active={sort === 'date'} onPress={() => setSort('date')} />
          </View>
        </View>
      ) : null}
      <Text style={{ color: t.muted, fontSize: 12.5, marginBottom: 8, marginTop: 2 }}>
        {groups.length} {groups.length === 1 ? 'artiest of evenement' : 'artiesten en evenementen'} · {tab === 'upcoming' ? counts.upcoming : counts.onsale}{' '}
        {(tab === 'upcoming' ? counts.upcoming : counts.onsale) === 1 ? 'datum' : 'datums'}
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
          data={groups}
          keyExtractor={(g) => g.key}
          renderItem={renderItem}
          extraData={expanded}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <Text style={{ color: t.muted, marginTop: 20, textAlign: 'center' }}>
              {tab === 'upcoming' ? 'Geen datums die nog in de verkoop moeten, met deze filters.' : 'Geen datums in de verkoop, met deze filters.'}
            </Text>
          }
          contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 860, width: '100%', alignSelf: 'center' }}
          initialNumToRender={10}
          windowSize={9}
          refreshControl={<RefreshControl refreshing={loading && !!fetchedAt} onRefresh={() => void refresh()} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </>
  );
}
