import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { scoreColor, type Badge, type Trend } from '@sellout/core';
import { IconArrow, IconLink, IconWarning } from './icons';
import { textOn, useTheme, type Theme } from './theme';

/** Herrendert elke `ms` milliseconden, voor aftelklokken. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function openUrl(url: string): void {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  void WebBrowser.openBrowserAsync(url);
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: 14 }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 }}>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' }}>{children}</Text>
      {right}
    </View>
  );
}

/** Ronde scoremarkering: altijd het getal, de kleur is extra. */
export function ScorePill({ score, size = 46, state }: { score: number; size?: number; state?: 'scored' | 'soldout' | 'cancelled' }) {
  const t = useTheme();
  if (state === 'cancelled') {
    return (
      <View style={[styles.pill, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.chip }]}>
        <Text style={{ color: t.muted, fontWeight: '800', fontSize: size * 0.24 }}>–</Text>
      </View>
    );
  }
  const bg = scoreColor(score);
  return (
    <View
      accessible
      accessibilityLabel={state === 'soldout' ? 'Uitverkocht' : `Score ${score} van 100`}
      style={[styles.pill, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
    >
      <Text style={{ color: textOn(bg), fontWeight: '800', fontSize: size * 0.38, fontVariant: ['tabular-nums'] }}>{score}</Text>
    </View>
  );
}

const badgeColors = (t: Theme, tone: Badge['tone']) =>
  tone === 'strong'
    ? { bg: t.text, fg: t.bg }
    : tone === 'warning'
      ? { bg: t.warnBg, fg: t.warnText }
      : tone === 'info'
        ? { bg: t.infoBg, fg: t.infoText }
        : { bg: t.chip, fg: t.muted };

export function BadgeView({ badge }: { badge: Badge }) {
  const t = useTheme();
  const c = badgeColors(t, badge.tone);
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 6, marginTop: 6 }}>
      <Text style={{ color: c.fg, fontSize: 11.5, fontWeight: '700' }}>{badge.label}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        {
          backgroundColor: active ? t.chipActive : t.chip,
          borderRadius: 999,
          paddingHorizontal: 12,
          paddingVertical: 7,
          marginRight: 8,
          marginBottom: 8,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={{ color: active ? t.chipActiveText : t.text, fontSize: 13.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** Twee of meer tabbladen naast elkaar (bijv. "Nog niet in de verkoop" / "Al in de verkoop"). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, padding: 3, marginBottom: 12 }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 9,
              paddingHorizontal: 6,
              borderRadius: 9,
              backgroundColor: active ? t.card : 'transparent',
              opacity: pressed ? 0.75 : 1,
              ...(active ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}),
            })}
          >
            <Text style={{ color: active ? t.text : t.muted, fontSize: 14, fontWeight: '800', textAlign: 'center' }} numberOfLines={1}>
              {o.label}
            </Text>
            {o.count !== undefined ? (
              <Text style={{ color: active ? t.accent : t.faint, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {o.count} {o.count === 1 ? 'datum' : 'datums'}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function TrendArrow({ trend }: { trend: Trend | null }) {
  const t = useTheme();
  if (!trend) return null;
  const color = trend === 'up' ? t.up : trend === 'down' ? t.down : t.faint;
  const label = trend === 'up' ? 'Score stijgt' : trend === 'down' ? 'Score daalt' : 'Score gelijk';
  return (
    <View accessible accessibilityLabel={label}>
      <IconArrow dir={trend} color={color} size={15} />
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  const t = useTheme();
  const bg = tone === 'warn' ? t.warnBg : t.infoBg;
  const fg = tone === 'warn' ? t.warnText : t.infoText;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8, marginBottom: 12 }}>
      {tone === 'warn' ? <IconWarning color={fg} size={16} /> : null}
      <Text style={{ color: fg, fontSize: 13.5, lineHeight: 19, flex: 1 }}>{children}</Text>
    </View>
  );
}

export function LinkText({ url, label }: { url: string; label: string }) {
  const t = useTheme();
  const style = { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 } as const;
  const content = (
    <>
      <Text style={{ color: t.accent, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <IconLink color={t.accent} />
    </>
  );
  if (Platform.OS === 'web') {
    // Op het web een echte <a href>: in een ingesloten pagina werkt window.open niet altijd.
    const anchor = { href: url, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } as object;
    return (
      <View {...anchor} accessibilityRole="link" style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable onPress={() => openUrl(url)} accessibilityRole="link" style={style}>
      {content}
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'secondary', icon }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; icon?: ReactNode }) {
  const t = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        backgroundColor: primary ? t.accent : t.chip,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon}
      <Text style={{ color: primary ? t.accentText : t.text, fontWeight: '700', fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
      <Text style={{ color: t.muted, fontSize: 14 }}>{k}</Text>
      {typeof v === 'string' ? <Text style={{ color: t.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text> : v}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignItems: 'center', justifyContent: 'center' },
});
