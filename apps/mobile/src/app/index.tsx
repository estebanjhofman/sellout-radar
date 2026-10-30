import { useEffect, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { DateTime } from 'luxon';
import { countdown, earliestInstant, eventScoreView, SCORE_KIND_LABEL, SPEED_LABELS, type SnapshotEvent } from '@sellout/core';
import { bucketize } from '../lib/buckets';
import { cityNl, nextInfo, shortDate } from '../lib/view';
import { registrationTargets } from '../lib/registered';
import { useData } from '../state/data';
import { registeredIds, usePrefs, type OwnedInfo } from '../state/prefs';
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
  const { prefs, isFollowing, toggleOwned, rememberOwned } = usePrefs();
  const nowIso = now.toISOString();
  const owned = new Set(prefs.ownedEvents ?? []);

  const { tickets, registered, followed, radar, soldout, available, ownedNow } = useMemo(() => {
    const evs = snapshot?.events ?? [];
    // Mijn tickets: uit de data, en na de showdag uit de bewaarde gegevens (die blijven tot je ze weghaalt).
    const inData = new Map(evs.filter((e) => owned.has(e.id)).map((e) => [e.id, e]));
    const ownedNow: Record<string, OwnedInfo> = {};
    for (const e of inData.values()) {
      const v = index?.venues.get(e.venueId);
      ownedNow[e.id] = { title: e.title, dateText: shortDate(e), place: v ? `${cityNl(v.city, v.country)} · ${v.name}` : '', start: showStart(e) };
    }
    const tickets = [...owned]
      .map((id) => ({ id, event: inData.get(id), info: ownedNow[id] ?? prefs.ownedInfo?.[id] }))
      .filter((x): x is { id: string; event: SnapshotEvent | undefined; info: OwnedInfo } => !!x.info)
      .sort((a, b) => {
        const past = (x: { info: OwnedInfo }) => (x.info.start !== null && x.info.start < now.getTime() ? 1 : 0);
        return past(a) - past(b) || (a.info.start ?? Infinity) - (b.info.start ?? Infinity);
      });
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
    // Radar en de twee lijsten na de verkoop.
    const b = index ? bucketize(evs, index, nowIso) : { upcoming: [], onsale: [], soldout: [], available: [] };
    const hot = b.upcoming
      .filter((r) => r.view.score.state === 'scored')
      .sort((x, y) => y.view.score.value - x.view.score.value)
      .slice(0, 3)
      .map((r) => ({ e: r.event, score: r.view.score.value }));
    return {
      tickets,
      registered,
      followed,
      ownedNow,
      radar: { upcoming: b.upcoming.length, onsale: b.onsale.length, hot },
      soldout: b.soldout,
      available: b.available,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, index, prefs, nowIso]);

  // Gegevens van datums met tickets bewaren, voor na de showdag.
  useEffect(() => {
    if (Object.keys(ownedNow).length) rememberOwned(ownedNow);
  }, [ownedNow, rememberOwned]);

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
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 1180, width: '100%', alignSelf: 'center' }}>
      {header}
      {staleWarning ? <Banner tone="warn">{staleWarning}</Banner> : null}
      {/* Drie tegels naast elkaar (op een smal scherm onder elkaar). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
        <Tile
          title="Radar"
          sub={`${radar.upcoming} nog niet in de verkoop · ${radar.onsale} in de verkoop`}
          label="Drukst verwacht"
          onPress={() => router.push('/radar')}
          rows={radar.hot.map(({ e, score }) => ({ id: e.id, score, title: e.title, sub: shortDate(e) }))}
        />
        <Tile
          title="Uitverkocht"
          sub={`Verkoop voorbij · top ${soldout.length}, snelst eerst`}
          label="Snelst uitverkocht"
          onPress={() => router.push('/uitverkocht')}
          rows={soldout.slice(0, 3).map((r) => ({
            id: r.event.id,
            score: r.event.rushFinal?.value ?? 100,
            title: r.event.title,
            sub: r.event.rushFinal?.outcome?.speed ? SPEED_LABELS[r.event.rushFinal.outcome.speed] : shortDate(r.event),
          }))}
        />
        <Tile
          title="Nog beschikbaar"
          sub={`Verkoop voorbij, niet uitverkocht · top ${available.length}`}
          label="Hoogste uitverkoopkans"
          onPress={() => router.push('/beschikbaar')}
          rows={available.slice(0, 3).map((r) => ({ id: r.event.id, score: r.view.score.value, title: r.event.title, sub: shortDate(r.event) }))}
        />
      </View>

      <SectionTitle>Mijn tickets</SectionTitle>
      <Card style={{ paddingVertical: 6 }}>
        {tickets.length === 0 ? (
          <Text style={{ color: t.muted, fontSize: 13.5, paddingVertical: 8, lineHeight: 19 }}>
            Nog geen tickets gemarkeerd. Tik bij een datum op het ticket-icoon of op "Ik heb tickets" op de detailpagina.
          </Text>
        ) : null}
        {tickets.map(({ id, event: e, info }) => {
          const start = info.start;
          const left = start && start > now.getTime() ? `over ${countdown(DateTime.fromMillis(start), DateTime.fromJSDate(now))}` : start ? 'geweest' : null;
          return (
            <Pressable key={id} disabled={!e} onPress={() => open(id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, opacity: pressed ? 0.7 : e ? 1 : 0.6 })}>
              <IconTicket color={t.up} filled size={24} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{info.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{info.dateText} · {info.place}</Text>
                {e?.status === 'cancelled' ? <Text style={{ color: t.down, fontSize: 13, fontWeight: '700' }}>Geannuleerd</Text> : null}
                {e?.status === 'postponed' ? <Text style={{ color: t.down, fontSize: 13, fontWeight: '700' }}>Uitgesteld</Text> : null}
              </View>
              {left ? <Text style={{ color: t.accent, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{left}</Text> : null}
              <Pressable onPress={() => toggleOwned(id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Toch geen tickets">
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

/** Tegel op de startpagina: titel, korte uitleg en de bovenste drie datums. */
function Tile({ title, sub, label, rows, onPress }: { title: string; sub: string; label: string; rows: { id: string; score: number; title: string; sub: string }[]; onPress: () => void }) {
  const t = useTheme();
  let body: ReactNode = <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>Nog niets.</Text>;
  if (rows.length)
    body = (
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</Text>
        {rows.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ScorePill score={r.score} size={30} />
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {r.title} <Text style={{ color: t.muted, fontWeight: '400' }}>· {r.sub}</Text>
            </Text>
          </View>
        ))}
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 300, minWidth: 0, backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14, opacity: pressed ? 0.85 : 1 })}
    >
      <Text style={{ color: t.text, fontSize: 19, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>{sub}</Text>
      {body}
    </Pressable>
  );
}
