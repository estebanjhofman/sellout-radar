import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { confidenceLabel, eventBadges, formatTimePoint, isOfficial, type Conflict } from '@sellout/core';
import { cityNl, placeText, shortDate, showDateText, SOURCE_KIND_NL, timeAgo, typeLabel } from '../../lib/view';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { BadgeView, Banner, Card, KeyValue, LinkText, ScorePill, SectionTitle, TrendArrow, useNow } from '../../ui/components';
import { IconArrow, IconBell, IconStar } from '../../ui/icons';
import { ScoreChart } from '../../ui/ScoreChart';
import { Timeline } from '../../ui/Timeline';
import { useTheme } from '../../ui/theme';

function money(n: number | undefined, currency: string): string {
  if (n === undefined) return '?';
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : `${currency} `;
  return `${sym}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace('.', ',')}`;
}

function conflictValue(v: unknown): string {
  if (v && typeof v === 'object' && 'precision' in (v as object)) return formatTimePoint(v as never);
  return String(v);
}

function ConflictBox({ c }: { c: Conflict }) {
  const t = useTheme();
  const field: Record<string, string> = { venue: 'Locatie', date: 'Datum', status: 'Status', start: 'Starttijd', deadline: 'Deadline', end: 'Eindtijd' };
  return (
    <View style={{ backgroundColor: t.warnBg, borderRadius: 12, padding: 12, marginBottom: 8 }}>
      <Text style={{ color: t.warnText, fontWeight: '800', fontSize: 13.5 }}>Bronnen spreken elkaar tegen: {field[c.field] ?? c.field}</Text>
      <Text style={{ color: t.warnText, fontSize: 13.5, marginTop: 4 }}>Getoond: {conflictValue(c.chosen)}</Text>
      {c.alternatives.map((a, i) => (
        <Text key={i} style={{ color: t.warnText, fontSize: 13.5, marginTop: 2 }}>
          Volgens {a.source.name} ({SOURCE_KIND_NL[a.source.kind].toLowerCase()}): {conflictValue(a.value)}
        </Text>
      ))}
      <Text style={{ color: t.warnText, fontSize: 12.5, marginTop: 4 }}>{c.reason}</Text>
    </View>
  );
}

export default function EventDetail() {
  const t = useTheme();
  const now = useNow(30_000);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { index, snapshot } = useData();
  const { prefs, isFollowing, toggleEvent, toggleTour, setMuted } = usePrefs();
  const ev = index?.events.get(String(id));

  if (!snapshot || !index) return <Text style={{ color: t.muted, padding: 20 }}>Data laden…</Text>;
  if (!ev) {
    return (
      <View style={{ padding: 20 }}>
        <Stack.Screen options={{ title: 'Niet gevonden' }} />
        <Text style={{ color: t.text, fontSize: 16 }}>Deze datum staat niet (meer) in de lijst.</Text>
      </View>
    );
  }
  const venue = index.venues.get(ev.venueId);
  const tour = ev.tourId ? index.tours.get(ev.tourId) : undefined;
  const phases = index.phasesByEvent.get(ev.id) ?? [];
  const followedDirect = prefs.followedEvents.includes(ev.id);
  const followedTour = !!tour && prefs.followedTours.includes(tour.id);
  const followed = isFollowing(ev.id, ev.tourId, ev.artistIds);
  const muted = prefs.mutedEvents.includes(ev.id);
  const badges = eventBadges(ev, phases, { hasConflict: ev.conflicts.length > 0 });
  const siblings = (tour ? (index.eventsByTour.get(tour.id) ?? []) : []).filter((x) => x.id !== ev.id);
  const s = ev.score;
  const allSources = [...ev.sources].sort((a, b) => Number(isOfficial(b)) - Number(isOfficial(a)) || a.name.localeCompare(b.name));
  const artistName = index.artists.get(ev.artistIds[0] ?? '')?.name ?? ev.title;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      <Stack.Screen options={{ title: artistName }} />

      <Text style={{ color: t.text, fontSize: 24, fontWeight: '800' }}>{ev.title}</Text>
      {tour ? <Text style={{ color: t.muted, fontSize: 14.5, marginTop: 2 }}>{tour.name}{tour.leg ? ` · ${tour.leg}` : ''}</Text> : null}
      <Text style={{ color: t.text, fontSize: 15.5, marginTop: 8, fontWeight: '600' }}>{showDateText(ev)}</Text>
      <Text style={{ color: t.muted, fontSize: 14.5, marginTop: 2 }}>
        {placeText(venue)} · {typeLabel(ev.type)}
      </Text>
      {badges.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>{badges.map((b) => <BadgeView key={b.key} badge={b} />)}</View> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        <Pressable
          onPress={() => toggleEvent(ev.id)}
          accessibilityRole="button"
          style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: followedDirect ? t.chipActive : t.chip, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}
        >
          <IconStar color={followedDirect ? '#E5A100' : t.text} filled={followedDirect} size={18} />
          <Text style={{ color: followedDirect ? t.chipActiveText : t.text, fontWeight: '700' }}>{followedDirect ? 'Gevolgd' : 'Volg deze datum'}</Text>
        </Pressable>
        {tour ? (
          <Pressable
            onPress={() => toggleTour(tour.id)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: followedTour ? t.chipActive : t.chip, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}
          >
            <Text style={{ color: followedTour ? t.chipActiveText : t.text, fontWeight: '700' }}>{followedTour ? 'Hele tour gevolgd' : 'Volg hele tour'}</Text>
          </Pressable>
        ) : null}
        {followed || s.value >= (prefs.settings.scoreThreshold ?? 101) ? (
          <Pressable
            onPress={() => setMuted(ev.id, !muted)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: t.chip, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}
          >
            <IconBell color={t.text} filled={!muted} size={17} />
            <Text style={{ color: t.text, fontWeight: '700' }}>{muted ? 'Meldingen uit' : 'Meldingen aan'}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginTop: 16 }}>
        {ev.stale ? <Banner tone="warn">{ev.stale.message}</Banner> : null}
        {ev.conflicts.map((c, i) => (
          <ConflictBox key={i} c={c} />
        ))}
      </View>

      <SectionTitle>Sellout-score</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <ScorePill score={s.value} size={68} state={s.state} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '800' }}>{s.label}</Text>
            {s.state === 'scored' ? (
              <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>
                Betrouwbaarheid {confidenceLabel(s.confidence)} · kans op uitverkopen vóór de showdag
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <TrendArrow trend={ev.trend} />
              <Text style={{ color: t.faint, fontSize: 12.5 }}>berekend {timeAgo(s.computedAt, now)}</Text>
            </View>
          </View>
        </View>
        {s.lines.length ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            {s.lines.map((l, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <View style={{ marginTop: 2 }}>
                  <IconArrow dir={l.direction} color={l.direction === 'up' ? t.up : t.down} size={14} />
                </View>
                <Text style={{ color: t.text, fontSize: 14.5, lineHeight: 20, flex: 1 }}>{l.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {s.speedText ? <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 10 }}>{s.speedText}</Text> : null}
        {s.caveat ? <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 8, fontStyle: 'italic' }}>{s.caveat}</Text> : null}
        <Pressable onPress={() => router.push('/accuracy')} style={{ marginTop: 10 }}>
          <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13.5 }}>Hoe goed klopt de score?</Text>
        </Pressable>
      </Card>

      <SectionTitle>Verkoopmomenten</SectionTitle>
      <Card>
        <Timeline phases={phases} now={now} eventTitle={ev.title} />
      </Card>

      {ev.priceRange || ev.ticketLimit || ev.officialSellers?.length || ev.notes?.length ? (
        <>
          <SectionTitle>Kaarten en details</SectionTitle>
          <Card>
            {ev.priceRange ? <KeyValue k="Prijs" v={`${money(ev.priceRange.min, ev.priceRange.currency)} – ${money(ev.priceRange.max, ev.priceRange.currency)}`} /> : null}
            {ev.ticketLimit ? <KeyValue k="Ticketlimiet" v={`${ev.ticketLimit} per bestelling`} /> : null}
            {ev.officialSellers?.map((o) => (o.url ? <LinkText key={o.name} url={o.url} label={`Officiële verkoop: ${o.name}`} /> : <KeyValue key={o.name} k="Officiële verkoop" v={o.name} />))}
            {ev.notes?.map((n) => (
              <Text key={n} style={{ color: t.muted, fontSize: 13.5, marginTop: 6, lineHeight: 19 }}>
                {n}
              </Text>
            ))}
          </Card>
        </>
      ) : null}

      {siblings.length ? (
        <>
          <SectionTitle>Andere data van deze tour</SectionTitle>
          <Card style={{ paddingVertical: 6 }}>
            {siblings.map((x) => {
              const v = index.venues.get(x.venueId);
              return (
                <Pressable
                  key={x.id}
                  onPress={() => router.push({ pathname: '/event/[id]', params: { id: x.id } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}
                >
                  <ScorePill score={x.score.value} size={32} state={x.score.state} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: 14.5, fontWeight: '600' }}>
                      {shortDate(x)} · {cityNl(v?.city ?? '', v?.country)}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 12.5 }}>{x.score.label}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionTitle>Scoreverloop</SectionTitle>
      <Card>
        <ScoreChart history={ev.history} />
      </Card>

      <SectionTitle>Bronnen</SectionTitle>
      <Card>
        {allSources.map((src) => (
          <View key={src.name} style={{ paddingVertical: 6 }}>
            {src.url ? <LinkText url={src.url} label={src.name} /> : <Text style={{ color: t.text, fontWeight: '600' }}>{src.name}</Text>}
            <Text style={{ color: t.muted, fontSize: 12.5 }}>
              {SOURCE_KIND_NL[src.kind]} · laatst gecontroleerd {timeAgo(src.fetchedAt, now)}
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
