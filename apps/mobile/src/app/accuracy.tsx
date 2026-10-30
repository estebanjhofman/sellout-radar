import { ScrollView, Text, View } from 'react-native';
import { SCORE_BANDS, scoreColor, SPEED_LABELS } from '@sellout/core';
import { useData } from '../state/data';
import { Card, KeyValue, SectionTitle } from '../ui/components';
import { useTheme } from '../ui/theme';

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);

export default function Accuracy() {
  const t = useTheme();
  const { snapshot } = useData();
  const a = snapshot?.accuracy;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <Text style={{ color: t.text, fontSize: 15, lineHeight: 22 }}>
        De score is de kans dat een datum via de officiële verkoop uitverkocht raakt vóór de showdag. Na elke verkoop vergelijken we de score van vlak
        vóór de verkoopstart met wat er echt gebeurde. Met genoeg uitkomsten worden de gewichten bijgesteld.
      </Text>

      <SectionTitle>Overzicht</SectionTitle>
      <Card>
        <KeyValue k="Uitkomsten" v={String(a?.n ?? 0)} />
        <KeyValue k="Waarvan uitverkocht" v={String(a?.soldOut ?? 0)} />
        <KeyValue k="Score ≥ 70 die uitverkocht raakte" v={pct(a?.highScoreHitRate)} />
        <KeyValue k="Verrassingen (score < 40, toch uitverkocht)" v={String(a?.lowScoreSurprises ?? 0)} />
        <KeyValue k="Brier-score (lager is beter)" v={a?.brier === null || a?.brier === undefined ? '–' : a.brier.toFixed(3).replace('.', ',')} />
        <KeyValue k="Model" v={snapshot ? `${snapshot.model.version}` : '–'} />
        {!a || a.n === 0 ? (
          <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 8, lineHeight: 19 }}>
            Nog geen uitkomsten. Zodra verkopen zijn afgelopen, verschijnen hier de resultaten. Tot er 50 uitkomsten zijn, is de betrouwbaarheid
            van elke score hooguit "middel".
          </Text>
        ) : null}
      </Card>

      <SectionTitle>Per scoreband</SectionTitle>
      <Card>
        {SCORE_BANDS.slice()
          .reverse()
          .map((band) => {
            const bin = a?.bins.find((b) => b.lo === band.min);
            return (
              <View key={band.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: scoreColor((band.min + band.max) / 2) }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>
                    {band.min}–{band.max} · {band.label}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 12.5 }}>
                    {bin && bin.n > 0 ? `${bin.n} datums · voorspeld ${pct(bin.meanPredicted)} · werkelijk uitverkocht ${pct(bin.observedRate)}` : 'nog geen uitkomsten'}
                  </Text>
                </View>
              </View>
            );
          })}
      </Card>

      <SectionTitle>Hoe snel uitverkocht</SectionTitle>
      <Card>
        {(Object.keys(SPEED_LABELS) as (keyof typeof SPEED_LABELS)[]).map((k) => (
          <KeyValue key={k} k={SPEED_LABELS[k][0]!.toUpperCase() + SPEED_LABELS[k].slice(1)} v={String(a?.bySpeed[k] ?? 0)} />
        ))}
      </Card>
    </ScrollView>
  );
}
