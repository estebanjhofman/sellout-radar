import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { DateTime } from 'luxon';
import { scoreColor } from '@sellout/core';
import { useTheme } from './theme';

const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;

/** Scoreverloop over de tijd, op een vaste schaal van 0 tot 100. */
export function ScoreChart({ history }: { history: { at: string; score: number }[] }) {
  const t = useTheme();
  const [width, setWidth] = useState(320);
  const height = 150;
  const pad = { l: 28, r: 10, t: 10, b: 22 };
  if (history.length === 0) return <Text style={{ color: t.muted }}>Nog geen scoregeschiedenis.</Text>;
  const pts = [...history].sort((a, b) => a.at.localeCompare(b.at));
  const t0 = Date.parse(pts[0]!.at);
  const t1 = Math.max(Date.parse(pts[pts.length - 1]!.at), t0 + 86_400_000);
  const x = (iso: string) => pad.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (width - pad.l - pad.r);
  const y = (s: number) => pad.t + (1 - s / 100) * (height - pad.t - pad.b);
  // Trapjes: een score geldt tot de volgende meting.
  let d = `M ${x(pts[0]!.at)} ${y(pts[0]!.score)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(pts[i]!.at)} V ${y(pts[i]!.score)}`;
  d += ` H ${width - pad.r}`;
  const last = pts[pts.length - 1]!;
  const fmt = (ms: number) => DateTime.fromMillis(ms).setLocale('nl').toFormat('d LLL');
  return (
    <View onLayout={(e) => setWidth(Math.max(220, e.nativeEvent.layout.width))} accessible accessibilityLabel={`Scoreverloop van ${pts[0]!.score} naar ${last.score}`}>
      <Svg width={width} height={height}>
        {[0, 40, 70, 100].map((v) => (
          <Line key={v} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} strokeDasharray={v === 0 || v === 100 ? undefined : '3 4'} />
        ))}
        {[0, 40, 70, 100].map((v) => (
          <SvgText key={`l${v}`} x={pad.l - 6} y={y(v) + 4} fontSize={10} fill={t.faint} textAnchor="end" fontFamily={FONT}>
            {v}
          </SvgText>
        ))}
        <Rect x={pad.l} y={y(100)} width={width - pad.l - pad.r} height={0} fill="none" />
        <Path d={d} stroke={t.text} strokeWidth={2} fill="none" />
        {pts.map((p, i) => (
          <Circle key={i} cx={x(p.at)} cy={y(p.score)} r={pts.length > 30 ? 2 : 3} fill={scoreColor(p.score)} stroke={t.card} strokeWidth={1} />
        ))}
        <SvgText x={pad.l} y={height - 6} fontSize={10} fill={t.faint} fontFamily={FONT}>
          {fmt(t0)}
        </SvgText>
        <SvgText x={width - pad.r} y={height - 6} fontSize={10} fill={t.faint} textAnchor="end" fontFamily={FONT}>
          {fmt(t1)}
        </SvgText>
      </Svg>
    </View>
  );
}
