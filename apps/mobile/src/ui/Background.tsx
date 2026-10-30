import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DateTime } from 'luxon';
import { COUNTRY_NL, formatCompact, formatNumber, type ArtistPopularity, type PastVisit, type SourceRef } from '@sellout/core';
import { LinkText } from './components';
import { useTheme } from './theme';

const dateNl = (iso: string) => DateTime.fromISO(iso).setZone('Europe/Amsterdam').setLocale('nl').toFormat('d LLL yyyy');
const where = (country: string) => (country === 'world' ? 'wereldwijd' : `in ${COUNTRY_NL[country] ?? country}`);

/** 3.400.000.000 → "3,4 mld"; daaronder zoals formatCompact. */
function big(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${(v >= 10 ? Math.round(v).toString() : v.toFixed(1)).replace('.', ',')} mld`;
  }
  return formatCompact(n);
}

function Line({ children, muted, small }: { children: React.ReactNode; muted?: boolean; small?: boolean }) {
  const t = useTheme();
  return <Text style={{ color: muted ? t.muted : t.text, fontSize: small ? 12.5 : 14, lineHeight: small ? 17 : 20 }}>{children}</Text>;
}

/** Bronvermelding: naam als link, met de datum van controle. */
export function SourceLine({ sources, label = 'Bron' }: { sources: SourceRef[]; label?: string }) {
  const t = useTheme();
  if (!sources.length) return null;
  const latest = [...sources].map((s) => s.fetchedAt).sort().at(-1)!;
  return (
    <View style={{ marginTop: 2 }}>
      {sources.map((s, i) =>
        s.url ? (
          <LinkText key={`${s.name}-${i}`} url={s.url} label={`${label}: ${s.name}`} />
        ) : (
          <Text key={`${s.name}-${i}`} style={{ color: t.muted, fontSize: 12.5 }}>
            {label}: {s.name}
          </Text>
        ),
      )}
      <Text style={{ color: t.faint, fontSize: 12 }}>Gecontroleerd {dateNl(latest)}</Text>
    </View>
  );
}

/**
 * Openbare cijfers over de artiest: Last.fm (met link terug, zoals de Last.fm-voorwaarden vragen),
 * hitnoteringen, overige cijfers met bron, en YouTube alleen ter informatie.
 */
export function PopularityBlock({ pop, name }: { pop: ArtistPopularity; name: string }) {
  const t = useTheme();
  const lf = pop.lastfmListeners;
  const ranks = pop.lastfmRanks ?? [];
  return (
    <View style={{ gap: 12 }}>
      {lf || pop.lastfmPlaycount ? (
        <View>
          {lf ? (
            <Line>
              <Text style={{ fontWeight: '800' }}>{big(lf.value)}</Text> luisteraars op Last.fm
              {pop.lastfmGrowth90d !== undefined ? (
                <Text style={{ color: pop.lastfmGrowth90d >= 0 ? t.up : t.down }}>{` · ${pop.lastfmGrowth90d >= 0 ? '+' : '−'}${Math.round(Math.abs(pop.lastfmGrowth90d) * 100)}% in 90 dagen`}</Text>
              ) : null}
            </Line>
          ) : null}
          {pop.lastfmPlaycount ? (
            <Line muted small>
              {big(pop.lastfmPlaycount.value)} keer afgespeeld (scrobbles)
            </Line>
          ) : null}
          {ranks.length ? (
            <Line muted small>
              Last.fm-toplijst: {ranks.map((r) => `#${r.rank} ${where(r.country)}`).join(', ')}
            </Line>
          ) : null}
          {(lf ?? pop.lastfmPlaycount)!.source.url ? <LinkText url={(lf ?? pop.lastfmPlaycount)!.source.url!} label="Bekijk op Last.fm" /> : null}
          <Text style={{ color: t.faint, fontSize: 12 }}>{`Gegevens van Last.fm, gemeten ${dateNl((lf ?? pop.lastfmPlaycount)!.at)}`}</Text>
          {pop.lastfmGrowth90d === undefined ? (
            <Text style={{ color: t.faint, fontSize: 12, marginTop: 2 }}>Groei: nog niet bekend (de updater bouwt de metingen per dag op).</Text>
          ) : null}
        </View>
      ) : (
        <Line muted small>{`Luisteraars van ${name}: nog niet bekend.`}</Line>
      )}

      {pop.other?.length ? (
        <View style={{ gap: 6 }}>
          {pop.other.map((o, i) => (
            <View key={i}>
              <Line>
                {o.label}: <Text style={{ fontWeight: '800' }}>{/groei/i.test(o.label) ? `${o.value > 0 ? '+' : ''}${o.value}%` : big(o.value)}</Text>
              </Line>
              <SourceLine sources={[o.source]} />
            </View>
          ))}
        </View>
      ) : null}

      {pop.charts?.length ? (
        <View>
          <Text style={{ color: t.text, fontSize: 13.5, fontWeight: '800', marginBottom: 4 }}>Hitnoteringen</Text>
          {pop.charts.slice(0, 10).map((c, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Line>
                <Text style={{ fontWeight: '800' }}>#{c.peak}</Text> {where(c.country)} · {c.title} ({c.kind === 'album' ? 'album' : 'single'}, {c.year})
              </Line>
              <Line muted small>
                {c.chart}
              </Line>
              {c.source.url ? <LinkText url={c.source.url} label={`Bron: ${c.source.name}`} /> : <Line muted small>{`Bron: ${c.source.name}`}</Line>}
            </View>
          ))}
          {pop.charts.length > 10 ? <Line muted small>{`En nog ${pop.charts.length - 10} noteringen.`}</Line> : null}
        </View>
      ) : null}

      {pop.youtube ? (
        <View>
          <Line>
            YouTube:{' '}
            {[pop.youtube.subscribers !== undefined ? `${big(pop.youtube.subscribers)} abonnees` : null, pop.youtube.views !== undefined ? `${big(pop.youtube.views)} weergaven` : null]
              .filter(Boolean)
              .join(' · ')}
          </Line>
          <Line muted small>
            {`Gemeten ${dateNl(pop.youtube.at)}. Alleen ter informatie: telt niet mee in de score.`}
          </Line>
          {pop.youtube.url ? <LinkText url={pop.youtube.url} label="Kanaal op YouTube" /> : null}
        </View>
      ) : null}
    </View>
  );
}

function visitFacts(v: PastVisit): string {
  const parts: string[] = [];
  if (v.shows) parts.push(`${v.shows} ${v.shows === 1 ? 'show' : 'shows'}`);
  if (v.capacity) parts.push(`${formatNumber(v.capacity)} plekken${v.shows && v.shows > 1 ? ' per show' : ''}`);
  if (v.soldOut === true) parts.push(v.withinHours !== undefined && v.sellThrough === undefined ? `uitverkocht binnen ${hours(v.withinHours)}` : 'uitverkocht');
  if (v.soldOut === false) parts.push('niet uitverkocht');
  if (v.sellThrough !== undefined) parts.push(`${Math.round(v.sellThrough * 100)}% verkocht${v.withinHours !== undefined ? ` binnen ${hours(v.withinHours)}` : ''}`);
  return parts.join(' · ');
}

function hours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minuten`;
  if (h < 48) return `${String(Math.round(h * 10) / 10).replace('.', ',')} uur`;
  return `${Math.round(h / 24)} dagen`;
}

/**
 * Vorige tour (bezoeken) of eerdere edities, elk met bron. Bezoeken aan dezelfde stad en hetzelfde land
 * staan bovenaan; de rest is uitklapbaar.
 */
export function PastVisitsBlock({ visits, near, max = 4 }: { visits: PastVisit[]; near?: { city?: string; country?: string }; max?: number }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const rank = (v: PastVisit) =>
    near?.city && v.city && v.city.toLowerCase() === near.city.toLowerCase() ? 0 : near?.country && v.country === near.country ? 1 : 2;
  const sorted = [...visits].sort((a, b) => rank(a) - rank(b) || b.year - a.year || (b.date ?? '').localeCompare(a.date ?? ''));
  const list = all ? sorted : sorted.slice(0, max);
  return (
    <View style={{ gap: 12 }}>
      {list.map((v, i) => {
        const place = [v.venue, v.city ? `${v.city}${v.country && v.country !== 'NL' ? ` (${COUNTRY_NL[v.country] ?? v.country})` : ''}` : v.country ? (COUNTRY_NL[v.country] ?? v.country) : null]
          .filter(Boolean)
          .join(', ');
        const facts = visitFacts(v);
        return (
          <View key={i} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.border, paddingTop: i === 0 ? 0 : 10 }}>
            <Text style={{ color: t.text, fontSize: 14.5, fontWeight: '800' }}>
              {v.date ? DateTime.fromISO(v.date).setLocale('nl').toFormat('d LLL yyyy') : v.year}
              {v.tour ? <Text style={{ fontWeight: '600', color: t.muted }}>{` · ${v.tour}`}</Text> : null}
            </Text>
            {place ? <Line>{place}</Line> : null}
            {facts ? <Line muted>{facts}</Line> : null}
            {v.detail ? <Line muted small>{v.detail}</Line> : null}
            <SourceLine sources={v.sources} />
          </View>
        );
      })}
      {sorted.length > max ? (
        <Pressable onPress={() => setAll((x) => !x)} accessibilityRole="button" hitSlop={6}>
          <Text style={{ color: t.accent, fontSize: 13.5, fontWeight: '700' }}>{all ? 'Minder tonen' : `Alle ${sorted.length} tonen`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
