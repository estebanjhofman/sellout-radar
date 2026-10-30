import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { APP_VERSION } from '../lib/config';
import { notificationsSupported, permissionStatus, requestPermission, scheduledCount } from '../lib/notify';
import { planReminders } from '../lib/plan';
import { supabaseEnabled } from '../lib/supabase';
import { SOURCE_KIND_NL, timeAgo } from '../lib/view';
import { snapshotUrl, useData } from '../state/data';
import { usePrefs } from '../state/prefs';
import { Banner, Button, Card, Chip, KeyValue, SectionTitle } from '../ui/components';
import { SyncCard } from '../ui/SyncCard';
import { WebPushCard } from '../ui/WebPushCard';
import { useTheme } from '../ui/theme';

export default function Settings() {
  const t = useTheme();
  const { prefs, updateSettings } = usePrefs();
  const { snapshot, refresh, loading, fetchedAt, error } = useData();
  const s = prefs.settings;
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [count, setCount] = useState(0);

  useEffect(() => {
    void permissionStatus().then(setPerm);
    void scheduledCount().then(setCount);
  }, [prefs, snapshot]);

  const planned = snapshot ? planReminders(snapshot, prefs) : { all: [], selected: [] };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
      <SectionTitle>Meldingen</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: t.text, fontSize: 15.5, fontWeight: '600' }}>Herinneringen en wijzigingen</Text>
          <Switch
            value={s.notificationsEnabled}
            onValueChange={async (v) => {
              updateSettings({ notificationsEnabled: v });
              if (v && notificationsSupported) setPerm((await requestPermission()) ? 'granted' : 'denied');
            }}
          />
        </View>
        {!notificationsSupported ? (
          <WebPushCard />
        ) : perm === 'denied' && s.notificationsEnabled ? (
          <Text style={{ color: t.down, fontSize: 13.5, marginTop: 8 }}>Meldingen staan uit in de iOS-instellingen voor Sellout Radar.</Text>
        ) : null}
        <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 10, lineHeight: 19 }}>
          Je krijgt minstens {Math.max(12, s.leadHours)} uur vóór elke presale en algemene verkoop een melding, een melding zodra een inschrijving
          opent en {Math.max(12, s.leadHours)} uur vóór de deadline. Valt een melding in je stille uren, dan komt hij eerder, nooit later.
        </Text>

        <Text style={{ color: t.text, fontWeight: '700', marginTop: 16, marginBottom: 4 }}>Automatisch meldingen vanaf score</Text>
        <Text style={{ color: t.muted, fontSize: 13, marginBottom: 8, lineHeight: 18 }}>
          Vóór de verkoop telt de verwachte drukte, daarna de uitverkoopkans. Gevolgde datums krijgen altijd meldingen.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[null, 40, 50, 60, 70, 80, 90].map((v) => (
            <Chip key={String(v)} label={v === null ? 'Alleen gevolgd' : `${v}+`} active={s.scoreThreshold === v} onPress={() => updateSettings({ scoreThreshold: v })} />
          ))}
        </View>

        <Text style={{ color: t.text, fontWeight: '700', marginTop: 10, marginBottom: 8 }}>Hoe lang van tevoren</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[12, 24, 48].map((v) => (
            <Chip key={v} label={`${v} uur`} active={s.leadHours === v} onPress={() => updateSettings({ leadHours: v })} />
          ))}
        </View>

        <Text style={{ color: t.text, fontWeight: '700', marginTop: 10, marginBottom: 8 }}>Extra herinnering vlak voor de start</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[null, 15, 30, 60].map((v) => (
            <Chip key={String(v)} label={v === null ? 'Uit' : v === 60 ? '1 uur' : `${v} min`} active={s.extraReminderMinutes === v} onPress={() => updateSettings({ extraReminderMinutes: v })} />
          ))}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <Text style={{ color: t.text, fontWeight: '700' }}>Stille uren</Text>
          <Switch value={s.quiet.enabled} onValueChange={(v) => updateSettings({ quiet: { ...s.quiet, enabled: v } })} />
        </View>
        {s.quiet.enabled ? (
          <>
            <Text style={{ color: t.muted, fontSize: 13, marginTop: 8, marginBottom: 6 }}>Vanaf</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {['21:00', '22:00', '23:00', '00:00'].map((v) => (
                <Chip key={v} label={v} active={s.quiet.start === v} onPress={() => updateSettings({ quiet: { ...s.quiet, start: v } })} />
              ))}
            </View>
            <Text style={{ color: t.muted, fontSize: 13, marginTop: 4, marginBottom: 6 }}>Tot</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {['06:00', '07:00', '08:00', '09:00'].map((v) => (
                <Chip key={v} label={v} active={s.quiet.end === v} onPress={() => updateSettings({ quiet: { ...s.quiet, end: v } })} />
              ))}
            </View>
          </>
        ) : null}

        <View style={{ marginTop: 10 }}>
          <KeyValue k="Geplande herinneringen" v={`${planned.all.filter((n) => Date.parse(n.sendAt) > Date.now()).length}`} />
          {notificationsSupported ? <KeyValue k="Ingepland op dit toestel" v={`${count}${planned.all.length > 64 ? ' (iOS: max 64, de rest volgt)' : ''}`} /> : null}
          <KeyValue k="Pushmeldingen bij wijzigingen" v={supabaseEnabled() ? 'aan (via de server)' : 'niet ingesteld'} />
        </View>
      </Card>

      <SectionTitle>Synchroniseren</SectionTitle>
      <SyncCard />

      <SectionTitle>Data</SectionTitle>
      <Card>
        {error ? <Banner tone="warn">{error}</Banner> : null}
        <KeyValue k="Laatste update" v={snapshot ? timeAgo(snapshot.generatedAt) : 'nog niet'} />
        <KeyValue k="Opgehaald" v={fetchedAt ? timeAgo(fetchedAt) : 'nog niet'} />
        <KeyValue k="Datums" v={snapshot ? String(snapshot.events.length) : '–'} />
        <KeyValue
          k="Model verwachte drukte"
          v={snapshot?.models?.rush ? `${snapshot.models.rush.version} (${snapshot.models.rush.outcomesUsed} uitkomsten)` : '–'}
        />
        <KeyValue
          k="Model uitverkoopkans"
          v={snapshot ? `${(snapshot.models?.sellout ?? snapshot.model).version} (${(snapshot.models?.sellout ?? snapshot.model).outcomesUsed} uitkomsten)` : '–'}
        />
        <Text style={{ color: t.faint, fontSize: 12, marginTop: 6 }} selectable>
          Bron: {snapshotUrl() || 'niet ingesteld'}
        </Text>
        <View style={{ marginTop: 10 }}>
          <Button label={loading ? 'Bezig…' : 'Nu bijwerken'} onPress={() => void refresh()} />
        </View>
      </Card>

      <SectionTitle>Bronnen bij de laatste update</SectionTitle>
      <Card>
        {(snapshot?.sources ?? []).length === 0 ? <Text style={{ color: t.muted }}>Nog geen gegevens.</Text> : null}
        {(snapshot?.sources ?? []).map((src) => (
          <View key={src.name} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: t.text, fontWeight: '700' }}>{src.name}</Text>
              <Text style={{ color: src.ok ? t.up : t.down, fontWeight: '700', fontSize: 13 }}>
                {src.message?.startsWith('Niet ingesteld') ? 'niet ingesteld' : src.ok ? 'ok' : 'fout'}
              </Text>
            </View>
            <Text style={{ color: t.muted, fontSize: 12.5 }}>
              {SOURCE_KIND_NL[src.kind] ?? src.kind}
              {src.lastSuccessAt ? ` · laatst gelukt ${timeAgo(src.lastSuccessAt)}` : ''}
            </Text>
            {src.message ? <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2 }}>{src.message}</Text> : null}
          </View>
        ))}
      </Card>

      <SectionTitle>Meer</SectionTitle>
      <Card>
        <Pressable onPress={() => router.push('/accuracy')} style={{ paddingVertical: 8 }}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>Nauwkeurigheid van de scores</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/changes')} style={{ paddingVertical: 8 }}>
          <Text style={{ color: t.accent, fontWeight: '700' }}>Recente wijzigingen</Text>
        </Pressable>
        <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 8, lineHeight: 18 }}>
          De scores zijn kansen, geen garantie. Verkoopdata komen uit de genoemde bronnen; wat geen bron noemt, staat er als "nog niet bekend". Versie {APP_VERSION}.
        </Text>
      </Card>
    </ScrollView>
  );
}
