import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DateTime } from 'luxon';
import { confidenceLabel, COUNTRY_NL, eventBadges, formatDate, formatTimePoint, joinList, type EventGroup, type GroupDate } from '@sellout/core';
import { nextInfo } from '../lib/view';
import { BadgeView, ScorePill } from './components';
import { IconArrow, IconStar } from './icons';
import { SaleMoments } from './SaleMoments';
import { useTheme } from './theme';

interface Props {
  group: EventGroup;
  now: Date;
  expanded: boolean;
  onToggle: () => void;
  followedArtist: boolean;
  onToggleFollowArtist: () => void;
  isFollowingEvent: (e: GroupDate['event']) => boolean;
  onToggleFollowEvent: (id: string) => void;
  onOpenEvent: (id: string) => void;
}

function dateText(d: GroupDate): string {
  const e = d.event;
  if (e.date.precision === 'exact' && e.date.utc) {
    const l = DateTime.fromISO(e.date.utc).setZone(e.date.tz);
    return `${formatDate(l)}, ${l.toFormat('HH:mm')}`;
  }
  if (e.date.localDate) return formatDate(DateTime.fromISO(e.date.localDate));
  return formatTimePoint(e.date);
}

function DateRow({ d, followed, onToggleFollow, onOpen }: { d: GroupDate; followed: boolean; onToggleFollow: () => void; onOpen: () => void }) {
  const t = useTheme();
  const s = d.view.score;
  const badges = eventBadges(d.event, [], { hasConflict: d.event.conflicts.length > 0 }).filter((b) => b.key !== 'sale_date_unknown');
  const title = d.event.type === 'concert' || d.event.type === 'comedy' ? null : d.event.title;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${title ?? ''} ${dateText(d)}, ${s.state === 'scored' ? `${d.view.kind === 'rush' ? 'verwachte drukte' : 'uitverkoopkans'} ${s.value}, ${s.label}` : s.label}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
    >
      <ScorePill score={s.value} size={34} state={s.state} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <Text style={{ color: t.text, fontSize: 14, fontWeight: title ? '500' : '700' }}>{dateText(d)}</Text>
        <Text style={{ color: t.muted, fontSize: 12.5 }} numberOfLines={2}>
          {s.state === 'scored' ? `${s.label} · betrouwbaarheid ${confidenceLabel(s.confidence)}` : s.label}
          {d.view.movedLocally ? ' · verkoop net begonnen' : ''}
        </Text>
        {badges.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{badges.map((b) => <BadgeView key={b.key} badge={b} />)}</View> : null}
      </View>
      <Pressable onPress={onToggleFollow} hitSlop={10} accessibilityRole="button" accessibilityLabel={followed ? 'Datum niet meer volgen' : 'Datum volgen'}>
        <IconStar color={followed ? '#E5A100' : t.faint} filled={followed} size={19} />
      </Pressable>
    </Pressable>
  );
}

function GroupCardInner({ group, now, expanded, onToggle, followedArtist, onToggleFollowArtist, isFollowingEvent, onToggleFollowEvent, onOpenEvent }: Props) {
  const t = useTheme();
  const allPhases = group.cities.flatMap((c) => c.phases);
  const next = nextInfo(allPhases, now);
  const best = group.settled ? { value: 100, state: 'soldout' as const } : { value: group.best, state: 'scored' as const };
  const kind = group.cities[0]?.dates[0]?.view.kind ?? 'rush';
  const cityCount = group.cities.length;
  // Voor welke steden geldt het eerstvolgende moment? (Niet nodig als het voor alle steden geldt.)
  const nextCities = next
    ? group.cities
        .filter((c) => {
          const n = nextInfo(c.phases, now);
          return !!n && n.label === next.label && n.when === next.when;
        })
        .map((c) => c.city)
    : [];
  const nextWhere = nextCities.length && nextCities.length < cityCount ? joinList(nextCities, 2) : null;
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${group.title}, ${cityCount} ${cityCount === 1 ? 'stad' : 'steden'}, ${group.count} ${group.count === 1 ? 'datum' : 'datums'}, hoogste ${kind === 'rush' ? 'verwachte drukte' : 'uitverkoopkans'} ${group.best}`}
        style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 12, opacity: pressed ? 0.85 : 1 })}
      >
        <View style={{ alignItems: 'center', width: 52 }}>
          <ScorePill score={best.value} state={best.state} />
          <Text style={{ color: t.faint, fontSize: 10.5, marginTop: 4, textAlign: 'center' }}>{group.count > 1 ? 'hoogste' : ''}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ color: t.text, fontSize: 16.5, fontWeight: '800', flex: 1 }} numberOfLines={2}>
              {group.title}
            </Text>
            <Pressable onPress={onToggleFollowArtist} hitSlop={10} accessibilityRole="button" accessibilityLabel={followedArtist ? 'Niet meer volgen' : 'Alles van deze artiest of dit evenement volgen'}>
              <IconStar color={followedArtist ? '#E5A100' : t.faint} filled={followedArtist} size={21} />
            </Pressable>
          </View>
          {group.subtitle ? (
            <Text style={{ color: t.muted, fontSize: 13, marginTop: 1 }} numberOfLines={1}>
              {group.subtitle}
            </Text>
          ) : null}
          <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 3 }} numberOfLines={1}>
            {cityCount} {cityCount === 1 ? 'stad' : 'steden'} · {group.count} {group.count === 1 ? 'datum' : 'datums'} ·{' '}
            {group.cities
              .slice(0, 4)
              .map((c) => c.city)
              .join(', ')}
            {cityCount > 4 ? ' …' : ''}
          </Text>
          {next ? (
            <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 }}>
              <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>
                {next.label}
                {nextWhere ? <Text style={{ fontWeight: '500', color: t.muted }}>{` · ${nextWhere}`}</Text> : null}
              </Text>
              {next.countdown ? (
                <Text style={{ color: t.accent, fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {next.countdown === 'nu bezig' ? 'nu bezig' : `over ${next.countdown}`}
                </Text>
              ) : null}
              <Text style={{ color: t.muted, fontSize: 12.5 }}>{`${next.when}${next.item.at.precision === 'exact' ? ' (NL)' : ''}`}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <IconArrow dir={expanded ? 'up' : 'down'} color={t.accent} size={13} />
            <Text style={{ color: t.accent, fontSize: 12.5, fontWeight: '700' }}>{expanded ? 'Inklappen' : 'Steden, datums en verkoopmomenten'}</Text>
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: t.border }}>
          {group.cities.map((c, i) => {
            const venues = [...new Set(c.dates.map((d) => d.venue?.name).filter(Boolean) as string[])];
            return (
              <View key={c.key} style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.border, backgroundColor: c.settled ? t.cardAlt : t.card }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '800' }}>
                  {c.city}
                  {c.country && c.country !== 'NL' ? <Text style={{ color: t.muted, fontWeight: '600' }}>{` · ${COUNTRY_NL[c.country] ?? c.country}`}</Text> : null}
                </Text>
                {venues.length ? (
                  <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={2}>
                    {venues.join(' · ')}
                  </Text>
                ) : null}
                <View style={{ marginTop: 4 }}>
                  {c.dates.map((d) => (
                    <DateRow
                      key={d.event.id}
                      d={d}
                      followed={isFollowingEvent(d.event)}
                      onToggleFollow={() => onToggleFollowEvent(d.event.id)}
                      onOpen={() => onOpenEvent(d.event.id)}
                    />
                  ))}
                </View>
                <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 8, marginBottom: 6 }}>Verkoopmomenten</Text>
                <SaleMoments phases={c.phases} dates={c.dates.map((d) => d.event)} now={now} />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export const GroupCard = memo(GroupCardInner);
