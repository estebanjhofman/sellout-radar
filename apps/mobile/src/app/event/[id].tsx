import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import {
  confidenceLabel,
  eventBadges,
  eventScoreView,
  formatTimePoint,
  isOfficial,
  SCORE_KIND_HELP,
  SCORE_KIND_LABEL,
  STAGE_LABEL,
  type Conflict,
  type EventScoreView,
} from '@sellout/core';
import { cityNl, placeText, shortDate, showDateText, SOURCE_KIND_NL, timeAgo, typeLabel } from '../../lib/view';
import { useData } from '../../state/data';
import { usePrefs } from '../../state/prefs';
import { PastVisitsBlock, PopularityBlock } from '../../ui/Background';
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

const nlTime = (iso: string) => DateTime.fromISO(iso).setZone('Europe/Amsterdam').setLocale('nl').toFormat("ccc d LLL yyyy 'om' HH:mm");

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

/** De verwachte drukte van vlak vóór de verkoop, met de uitkomst zodra die bekend is. */
function RushBefore({ before }: { before: NonNullable<EventScoreView['before']> }) {
  const t = useTheme();
  const how = before.pending
    ? 'Verwachting van vlak vóór de verkoop. De volgende update legt die vast.'
    : before.reconstructed
      ? 'Achteraf geschat: de datum was al in de verkoop toen de radar hem vond. Deze verwachting is dus niet vóór de verkoop vastgelegd en telt niet mee bij het leren.'
      : `Vastgelegd vlak vóór de eerste verkoop${before.firstSaleAt ? ` (${nlTime(before.firstSaleAt)}, Nederlandse tijd)` : ''}.`;
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <ScorePill score={before.value} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '800' }}>{before.label}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>Betrouwbaarheid {confidenceLabel(before.confidence)}</Text>
        </View>
      </View>
      <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 10, lineHeight: 19 }}>{how}</Text>
      {before.outcome ? (
        <Text style={{ color: t.text, fontSize: 14.5, marginTop: 8, lineHeight: 20 }}>
          <Text style={{ fontWeight: '800' }}>Uitkomst: </Text>
          {before.outcome.text}
        </Text>
      ) : !before.reconstructed ? (
        <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 8, lineHeight: 19 }}>
          Uitkomst: nog niet bekend. De radar kijkt of de datum in de presale of binnen een dag na de eerste verkoop uitverkoopt.
        </Text>
      ) : null}
    </Card>
  );
}

export default function EventDetail() {
  const t = useTheme();
  const now = useNow(30_000);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { index, snapshot } = useData();
  const { prefs, isFollowing, toggleEvent, toggleTour, toggleArtist, setMuted } = usePrefs();
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
  const nowIso = now.toISOString();
  const venue = index.venues.get(ev.venueId);
  const tour = ev.tourId ? index.tours.get(ev.tourId) : undefined;
  const phases = index.phasesByEvent.get(ev.id) ?? [];
  const view = eventScoreView(ev, phases, nowIso);
  const s = view.score;
  const artist = index.artists.get(ev.artistIds[0] ?? '');
  const followedDirect = prefs.followedEvents.includes(ev.id);
  const followedTour = !!tour && prefs.followedTours.includes(tour.id);
  const followedArtist = !!artist && prefs.followedArtists.includes(artist.id);
  const followed = isFollowing(ev.id, ev.tourId, ev.artistIds);
  const muted = prefs.mutedEvents.includes(ev.id);
  const badges = eventBadges(ev, phases, { hasConflict: ev.conflicts.length > 0 });
  const siblings = (tour ? (index.eventsByTour.get(tour.id) ?? []) : []).filter((x) => x.id !== ev.id);
  const allSources = [...ev.sources].sort((a, b) => Number(isOfficial(b)) - Number(isOfficial(a)) || a.name.localeCompare(b.name));
  const artistName = artist?.name ?? ev.title;
  const chartKind = ev.score.kind ?? (ev.stage === 'upcoming' ? 'rush' : 'sellout');
  const performer = ev.type === 'concert' || ev.type === 'comedy' || ev.type === 'theatre';
  const visits = tour?.previousVisits ?? [];
  const editions = tour?.previousEditions ?? [];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      <Stack.Screen options={{ title: artistName }} />

      <Text style={{ color: t.text, fontSize: 24, fontWeight: '800' }}>{ev.title}</Text>
      {tour ? (
        <Text style={{ color: t.muted, fontSize: 14.5, marginTop: 2 }}>
          {tour.name}
          {tour.leg ? ` · ${tour.leg}` : ''}
        </Text>
      ) : null}
      <Text style={{ color: t.text, fontSize: 15.5, marginTop: 8, fontWeight: '600' }}>{showDateText(ev)}</Text>
      <Text style={{ color: t.muted, fontSize: 14.5, marginTop: 2 }}>
        {placeText(venue)} · {typeLabel(ev.type)}
      </Text>
      <Text style={{ color: t.accent, fontSize: 13, marginTop: 4, fontWeight: '700' }}>{STAGE_LABEL[view.stage]}</Text>
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
        {artist ? (
          <Pressable
            onPress={() => toggleArtist(artist.id)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: followedArtist ? t.chipActive : t.chip, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}
          >
            <Text style={{ color: followedArtist ? t.chipActiveText : t.text, fontWeight: '700' }}>{followedArtist ? `${artist.name} gevolgd` : `Volg ${artist.name}`}</Text>
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
        {view.movedLocally ? (
          <Banner tone="info">
            De eerste verkoop is begonnen sinds de laatste update. Deze datum staat nu bij "Al in de verkoop". De uitverkoopkans is alvast berekend; de volgende update werkt hem bij met echte verkoopsignalen.
          </Banner>
        ) : null}
        {ev.conflicts.map((c, i) => (
          <ConflictBox key={i} c={c} />
        ))}
      </View>

      <SectionTitle>{SCORE_KIND_LABEL[view.kind]}</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <ScorePill score={s.value} size={68} state={s.state} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '800' }}>{s.label}</Text>
            {s.state === 'scored' ? <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>Betrouwbaarheid {confidenceLabel(s.confidence)}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              {view.movedLocally ? null : <TrendArrow trend={ev.trend} />}
              <Text style={{ color: t.faint, fontSize: 12.5 }}>berekend {timeAgo(s.computedAt, now)}</Text>
            </View>
          </View>
        </View>
        <Text style={{ color: t.muted, fontSize: 13, marginTop: 10, lineHeight: 18 }}>{SCORE_KIND_HELP[view.kind]}</Text>
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
          <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13.5 }}>Hoe goed kloppen de scores?</Text>
        </Pressable>
      </Card>

      {view.stage === 'onsale' && view.before ? (
        <>
          <SectionTitle>Verwachte drukte vooraf</SectionTitle>
          <RushBefore before={view.before} />
        </>
      ) : null}

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

      {artist?.popularity || performer ? (
        <>
          <SectionTitle>Populariteit</SectionTitle>
          <Card>
            {artist?.popularity ? <PopularityBlock pop={artist.popularity} name={artist.name} /> : <Text style={{ color: t.muted }}>Nog niet bekend: geen openbare cijfers met bron gevonden.</Text>}
          </Card>
        </>
      ) : null}

      {editions.length ? (
        <>
          <SectionTitle>Eerdere edities</SectionTitle>
          <Card>
            <PastVisitsBlock visits={editions} near={{ city: venue?.city, country: venue?.country }} />
          </Card>
        </>
      ) : null}
      {visits.length || (performer && !editions.length) ? (
        <>
          <SectionTitle>Vorige tour</SectionTitle>
          <Card>{visits.length ? <PastVisitsBlock visits={visits} near={{ city: venue?.city, country: venue?.country }} /> : <Text style={{ color: t.muted }}>Nog niet bekend: geen eerder bezoek met bron gevonden.</Text>}</Card>
        </>
      ) : null}

      {siblings.length ? (
        <>
          <SectionTitle>Andere data van deze tour</SectionTitle>
          <Card style={{ paddingVertical: 6 }}>
            {siblings.map((x) => {
              const v = index.venues.get(x.venueId);
              const sv = eventScoreView(x, index.phasesByEvent.get(x.id) ?? [], nowIso);
              return (
                <Pressable
                  key={x.id}
                  onPress={() => router.push({ pathname: '/event/[id]', params: { id: x.id } })}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}
                >
                  <ScorePill score={sv.score.value} size={32} state={sv.score.state} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: 14.5, fontWeight: '600' }}>
                      {shortDate(x)} · {cityNl(v?.city ?? '', v?.country)}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 12.5 }}>
                      {sv.score.state === 'scored' ? `${SCORE_KIND_LABEL[sv.kind]}: ${sv.score.label.toLowerCase()}` : sv.score.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionTitle>{`Verloop van de ${SCORE_KIND_LABEL[chartKind].toLowerCase()}`}</SectionTitle>
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
