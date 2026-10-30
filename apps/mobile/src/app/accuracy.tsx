import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DateTime } from 'luxon';
import { bandsFor, MIN_OUTCOMES_FOR_HIGH_CONFIDENCE, scoreBand, scoreColor, SCORE_KIND_LABEL, SPEED_LABELS, type AccuracySummary, type ScoreKind } from '@sellout/core';
import { useData } from '../state/data';
import { Card, KeyValue, ScorePill, SectionTitle, Segmented } from '../ui/components';
import { useTheme } from '../ui/theme';

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);

const INTRO: Record<ScoreKind, string> = {
  rush:
    'De verwachte drukte zegt hoe moeilijk het wordt om bij de eerste verkoop een kaart te krijgen. Vlak vóór de eerste presale of algemene verkoop legt de radar die verwachting vast. Daarna kijkt hij wat er gebeurde: "druk" als de datum in de presale of binnen een dag uitverkocht raakte, anders "rustig". Met genoeg uitkomsten worden de gewichten bijgesteld.',
  sellout:
    'De uitverkoopkans is de kans dat een datum via de officiële verkoop uitverkocht raakt vóór de showdag, op basis van echte verkoopsignalen. Na de showdag vergelijkt de radar de kans met wat er echt gebeurde. Met genoeg uitkomsten worden de gewichten bijgesteld.',
};

function Overview({ kind, a, model }: { kind: ScoreKind; a?: AccuracySummary; model?: { version: string; outcomesUsed: number } }) {
  const t = useTheme();
  const rush = kind === 'rush';
  return (
    <Card>
      <KeyValue k="Uitkomsten" v={String(a?.n ?? 0)} />
      <KeyValue k={rush ? 'Waarvan druk (binnen een dag uitverkocht)' : 'Waarvan uitverkocht'} v={String(a?.soldOut ?? 0)} />
      <KeyValue k={rush ? 'Drukte ≥ 70 die echt druk werd' : 'Kans ≥ 70 die uitverkocht raakte'} v={pct(a?.highScoreHitRate)} />
      <KeyValue k={rush ? 'Verrassingen (drukte < 40, toch druk)' : 'Verrassingen (kans < 40, toch uitverkocht)'} v={String(a?.lowScoreSurprises ?? 0)} />
      <KeyValue k="Brier-score (lager is beter)" v={a?.brier === null || a?.brier === undefined ? '–' : a.brier.toFixed(3).replace('.', ',')} />
      <KeyValue k="Model" v={model ? `${model.version} (${model.outcomesUsed} uitkomsten gebruikt)` : '–'} />
      {!a || a.n === 0 ? (
        <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 8, lineHeight: 19 }}>
          {`Nog geen uitkomsten. Zodra ${rush ? 'verkopen zijn gestart en de eerste dag voorbij is' : 'shows zijn geweest of uitverkocht raakten'}, verschijnen hier de resultaten. Tot er ${MIN_OUTCOMES_FOR_HIGH_CONFIDENCE} uitkomsten zijn, is de betrouwbaarheid van elke score hooguit "middel".`}
        </Text>
      ) : null}
    </Card>
  );
}

function Bands({ kind, a }: { kind: ScoreKind; a?: AccuracySummary }) {
  const t = useTheme();
  return (
    <Card>
      {bandsFor(kind).map((band) => {
        const bin = a?.bins.find((b) => b.lo === band.min);
        return (
          <View key={band.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: scoreColor((band.min + band.max) / 2) }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>
                {band.min}–{band.max} · {band.label}
              </Text>
              <Text style={{ color: t.muted, fontSize: 12.5 }}>
                {bin && bin.n > 0
                  ? `${bin.n} datums · voorspeld ${pct(bin.meanPredicted)} · werkelijk ${kind === 'rush' ? 'druk' : 'uitverkocht'} ${pct(bin.observedRate)}`
                  : 'nog geen uitkomsten'}
              </Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

export default function Accuracy() {
  const t = useTheme();
  const { snapshot, index } = useData();
  const [kind, setKind] = useState<ScoreKind>('rush');
  const a = kind === 'rush' ? snapshot?.rushAccuracy : snapshot?.accuracy;
  const model = snapshot?.models?.[kind] ?? (kind === 'sellout' ? snapshot?.model : undefined);
  const recent = snapshot?.rushAccuracy?.recent ?? [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { key: 'rush', label: SCORE_KIND_LABEL.rush },
          { key: 'sellout', label: SCORE_KIND_LABEL.sellout },
        ]}
      />
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 22 }}>{INTRO[kind]}</Text>

      <SectionTitle>Overzicht</SectionTitle>
      <Overview kind={kind} a={a} model={model} />

      <SectionTitle>Per scoreband</SectionTitle>
      <Bands kind={kind} a={a} />

      {kind === 'rush' ? (
        <>
          <SectionTitle>Laatste vergelijkingen</SectionTitle>
          <Card>
            {recent.length === 0 ? <Text style={{ color: t.muted, fontSize: 13.5 }}>Nog geen verkopen afgerond met een vastgelegde verwachting.</Text> : null}
            {recent.map((r) => {
              const exists = !!index?.events.get(r.eventId);
              return (
                <Pressable
                  key={r.eventId}
                  disabled={!exists}
                  onPress={() => router.push({ pathname: '/event/[id]', params: { id: r.eventId } })}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}
                >
                  <ScorePill score={r.predicted} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                      {r.title}
                      {r.localDate ? <Text style={{ color: t.muted, fontWeight: '500' }}>{` · ${DateTime.fromISO(r.localDate).setLocale('nl').toFormat('d LLL yyyy')}`}</Text> : null}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 12.5 }}>
                      {`Verwacht: ${scoreBand(r.predicted, 'rush').label.toLowerCase()} → `}
                      <Text style={{ color: r.result === 'busy' ? t.down : t.up, fontWeight: '700' }}>
                        {r.result === 'busy' ? `druk (uitverkocht ${r.speed ? SPEED_LABELS[r.speed] : 'binnen een dag'})` : 'rustig'}
                      </Text>
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </>
      ) : (
        <>
          <SectionTitle>Hoe snel uitverkocht</SectionTitle>
          <Card>
            {(Object.keys(SPEED_LABELS) as (keyof typeof SPEED_LABELS)[]).map((k) => (
              <KeyValue key={k} k={SPEED_LABELS[k][0]!.toUpperCase() + SPEED_LABELS[k].slice(1)} v={String(a?.bySpeed[k] ?? 0)} />
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
