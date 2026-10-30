import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { DateTime } from 'luxon';
import { countdown, earliestInstant, eventScoreView, SCORE_KIND_LABEL, type SnapshotEvent } from '@sellout/core';
import { cityNl, nextInfo, shortDate } from '../lib/view';
import { registrationTargets } from '../lib/registered';
import { useData } from '../state/data';
import { registeredIds, usePrefs } from '../state/prefs';
import { Banner, Card, ScorePill, SectionTitle, useNow } from '../ui/components';
import { IconGear, IconList, IconTicket } from '../ui/icons';
import { useTheme } from '../ui/theme';

/** Begin van de show (ms), of null als alleen een maand bekend is. */
function showStart(e: SnapshotEvent): number | null {
  if (e.date.utc) return Date.parse(e.date.utc);
  if (e.date.localDate) return DateTime.fromISO(e.date.localDate, { zone: e.date.tz }).toMillis();
  return null;
}

/** Startpagina: mijn tickets, waar ik in geïnteresseerd ben, en de ingang naar de radar. */
export default function Home() {
  const t = useTheme();
  const now = useNow(30_000);
  const { snapshot, index, loading, error, staleWarning } = useData();
  const { prefs, isFollowing, toggleOwned } = usePrefs();
  const nowIso = now.toISOString();
  const owned = new Set(prefs.ownedEvents ?? []);

  const { tickets, registered, followed, radar } = useMemo(() => {
    const evs = snapshot?.events ?? [];
    const tickets = evs.filter((e) => owned.has(e.id)).sort((a, b) => (showStart(a) ?? Infinity) - (showStart(b) ?? Infinity));
    // Ingeschreven: aftellen naar de verkoop waarvoor je ingeschreven staat (zonder tickets).
    const isReg = (id: string) => registeredIds(prefs.registered, id).length > 0;
    const registered = evs
      .filter((e) => isReg(e.id) && !owned.has(e.id))
      .map((e) => {
        const targets = registrationTargets(index?.phasesByEvent.get(e.id) ?? [], registeredIds(prefs.registered, e.id), now);
        return { e, target: targets[0]!, more: targets.slice(1) };
      })
      .sort((a, b) => a.target.sortAt - b.target.sortAt);
    // Geïnteresseerd: alles wat je volgt, en ook de datums waarvoor je tickets hebt of ingeschreven staat.
    const followed = evs
      .filter((e) => owned.has(e.id) || isReg(e.id) || isFollowing(e.id, e.tourId, e.artistIds))
      .map((e) => {
        const next = nextInfo(index?.phasesByEvent.get(e.id) ?? [], now);
        const at = next ? (earliestInstant(next.item.at)?.toMillis() ?? Infinity) : Infinity;
        return { e, next, at };
      })
      .sort((a, b) => a.at - b.at || (showStart(a.e) ?? Infinity) - (showStart(b.e) ?? Infinity));
    // Radar: aantallen per tabblad en de drukste datums die nog in de verkoop moeten.
    let upcoming = 0;
    const hot: { e: SnapshotEvent; score: number }[] = [];
    for (const e of evs) {
      const v = eventScoreView(e, index?.phasesByEvent.get(e.id) ?? [], nowIso);
      if (v.stage === 'upcoming') {
        upcoming++;
        if (v.score.state === 'scored') hot.push({ e, score: v.score.value });
      }
    }
    hot.sort((a, b) => b.score - a.score);
    return { tickets, registered, followed, radar: { upcoming, onsale: evs.length - upcoming, hot: hot.slice(0, 3) } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, index, prefs, nowIso]);

  const header = (
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
  );
  if (!snapshot || !index)
    return (
      <View style={{ padding: 20, gap: 12 }}>
        {header}
        {loading ? <ActivityIndicator /> : <Banner tone="warn">{`Kon geen data laden. ${error ?? ''}`}</Banner>}
      </View>
    );
  const place = (e: SnapshotEvent) => {
    const v = index.venues.get(e.venueId);
    return v ? `${cityNl(v.city, v.country)} · ${v.name}` : '';
  };
  const open = (id: string) => router.push({ pathname: '/event/[id]', params: { id } });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      {header}
      {staleWarning ? <Banner tone="warn">{staleWarning}</Banner> : null}
      <Pressable
        onPress={() => router.push('/radar')}
        accessibilityRole="button"
        accessibilityLabel="Open de radar"
        style={({ pressed }) => ({ backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14, marginTop: 4, opacity: pressed ? 0.85 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 19, fontWeight: '800' }}>Radar</Text>
            <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>
              {radar.upcoming} nog niet in de verkoop · {radar.onsale} al in de verkoop
            </Text>
          </View>
        </View>
        {radar.hot.length ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>Drukst verwacht</Text>
            {radar.hot.map(({ e, score }) => (
              <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ScorePill score={score} size={30} />
                <Text style={{ color: t.text, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {e.title} <Text style={{ color: t.muted, fontWeight: '400' }}>· {shortDate(e)}</Text>
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      <SectionTitle>Mijn tickets</SectionTitle>
      <Card style={{ paddingVertical: 6 }}>
        {tickets.length === 0 ? (
          <Text style={{ color: t.muted, fontSize: 13.5, paddingVertical: 8, lineHeight: 19 }}>
            Nog geen tickets gemarkeerd. Tik bij een datum op het ticket-icoon of op "Ik heb tickets" op de detailpagina.
          </Text>
        ) : null}
        {tickets.map((e) => {
          const start = showStart(e);
          const left = start && start > now.getTime() ? `over ${countdown(DateTime.fromMillis(start), DateTime.fromJSDate(now))}` : start ? 'geweest' : null;
          return (
            <Pressable key={e.id} onPress={() => open(e.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, opacity: pressed ? 0.7 : 1 })}>
              <IconTicket color={t.up} filled size={24} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{e.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{shortDate(e)} · {place(e)}</Text>
                {e.status === 'cancelled' ? <Text style={{ color: t.down, fontSize: 13, fontWeight: '700' }}>Geannuleerd</Text> : null}
                {e.status === 'postponed' ? <Text style={{ color: t.down, fontSize: 13, fontWeight: '700' }}>Uitgesteld</Text> : null}
              </View>
              {left ? <Text style={{ color: t.accent, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{left}</Text> : null}
              <Pressable onPress={() => toggleOwned(e.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Toch geen tickets">
                <Text style={{ color: t.faint, fontSize: 18 }}>×</Text>
              </Pressable>
            </Pressable>
          );
        })}
      </Card>

      <SectionTitle>Ingeschreven</SectionTitle>
      <Card style={{ paddingVertical: 6 }}>
        {registered.length === 0 ? (
          <Text style={{ color: t.muted, fontSize: 13.5, paddingVertical: 8, lineHeight: 19 }}>
            Nog nergens ingeschreven. Kies op de pagina van een datum bij "Ingeschreven" waarvoor je je hebt aangemeld.
          </Text>
        ) : null}
        {registered.map(({ e, target, more }) => (
          <Pressable key={e.id} onPress={() => open(e.id)} style={({ pressed }) => ({ paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{e.title}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{shortDate(e)} · {place(e)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, marginTop: 4 }}>
              <Text style={{ color: t.accent, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{target.countdown ?? 'Datum nog niet bekend'}</Text>
              <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>{target.label}</Text>
            </View>
            <Text style={{ color: t.muted, fontSize: 12.5 }}>{target.when}</Text>
            {more.map((m, i) => (
              <Text key={i} style={{ color: t.text, fontSize: 13, marginTop: 4, opacity: m.countdown === 'voorbij' ? 0.5 : 1 }} numberOfLines={1}>
                <Text style={{ color: t.accent, fontWeight: '800' }}>{m.countdown ?? 'nog niet bekend'}</Text> · {m.label}
              </Text>
            ))}
          </Pressable>
        ))}
      </Card>

      <SectionTitle>Geïnteresseerd</SectionTitle>
      <Card style={{ paddingVertical: 6 }}>
        {followed.length === 0 ? (
          <Text style={{ color: t.muted, fontSize: 13.5, paddingVertical: 8, lineHeight: 19 }}>
            Nog niets. Tik in de radar op een ster bij een artiest of datum.
          </Text>
        ) : null}
        {followed.map(({ e, next }) => {
          const v = eventScoreView(e, index.phasesByEvent.get(e.id) ?? [], nowIso);
          return (
            <Pressable key={e.id} onPress={() => open(e.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, opacity: pressed ? 0.7 : 1 })}>
              <ScorePill score={v.score.value} size={36} state={v.score.state} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{e.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{shortDate(e)} · {place(e)}</Text>
                {owned.has(e.id) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <IconTicket color={t.up} filled size={14} />
                    <Text style={{ color: t.up, fontSize: 12.5, fontWeight: '700' }}>Je hebt tickets</Text>
                  </View>
                ) : null}
                <Text style={{ color: t.muted, fontSize: 12.5 }} numberOfLines={1}>
                  {v.score.state === 'scored' ? `${SCORE_KIND_LABEL[v.kind]}: ${v.score.label.toLowerCase()}` : v.score.label}
                </Text>
                {next && !owned.has(e.id) ? (
                  <Text style={{ color: t.text, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                    {next.label}{' '}
                    <Text style={{ color: t.accent, fontWeight: '800' }}>{next.countdown === 'nu bezig' ? 'nu bezig' : next.countdown ? `over ${next.countdown}` : ''}</Text>
                    <Text style={{ color: t.muted }}>{` · ${next.when}${next.item.at.precision === 'exact' ? ' (NL)' : ''}`}</Text>
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </Card>
    </ScrollView>
  );
}
