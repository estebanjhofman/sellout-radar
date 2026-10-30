import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { confidenceLabel, eventBadges, type SalePhase, type SnapshotEvent, type Venue } from '@sellout/core';
import { nextInfo, placeText, shortDate } from '../lib/view';
import { BadgeView, ScorePill, TrendArrow } from './components';
import { IconStar } from './icons';
import { useTheme } from './theme';

interface Props {
  event: SnapshotEvent;
  venue?: Venue;
  phases: SalePhase[];
  followed: boolean;
  now: Date;
  onPress: () => void;
  onToggleFollow: () => void;
}

function EventCardInner({ event, venue, phases, followed, now, onPress, onToggleFollow }: Props) {
  const t = useTheme();
  const next = nextInfo(phases, now);
  const badges = eventBadges(event, phases, { hasConflict: event.conflicts.length > 0 });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${shortDate(event)}, score ${event.score.value}, ${event.score.label}`}
      style={({ pressed }) => ({
        backgroundColor: t.card,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        flexDirection: 'row',
        gap: 12,
        opacity: pressed ? 0.85 : 1,
        borderWidth: 1,
        borderColor: t.border,
      })}
    >
      <View style={{ alignItems: 'center', width: 52 }}>
        <ScorePill score={event.score.value} state={event.score.state} />
        <View style={{ marginTop: 6, height: 16 }}>
          <TrendArrow trend={event.trend} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '700', flex: 1 }} numberOfLines={2}>
            {event.title}
          </Text>
          <Pressable
            onPress={onToggleFollow}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={followed ? 'Niet meer volgen' : 'Volgen'}
          >
            <IconStar color={followed ? '#E5A100' : t.faint} filled={followed} size={21} />
          </Pressable>
        </View>
        <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }} numberOfLines={1}>
          {shortDate(event)} · {placeText(venue)}
        </Text>
        <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2 }}>
          {event.score.state === 'scored' ? `${event.score.label} · betrouwbaarheid ${confidenceLabel(event.score.confidence)}` : event.score.label}
        </Text>
        {next ? (
          <View style={{ marginTop: 7, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '700' }} numberOfLines={1}>
              {next.label}
            </Text>
            {next.countdown ? (
              <Text style={{ color: t.accent, fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {next.countdown === 'nu bezig' ? 'nu bezig' : `over ${next.countdown}`}
              </Text>
            ) : null}
            <Text style={{ color: t.muted, fontSize: 12.5 }}>{next.when}</Text>
          </View>
        ) : null}
        {badges.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>{badges.map((b) => <BadgeView key={b.key} badge={b} />)}</View> : null}
      </View>
    </Pressable>
  );
}

export const EventCard = memo(EventCardInner);
