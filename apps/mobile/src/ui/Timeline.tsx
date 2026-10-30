import { useState } from 'react';
import { Text, View } from 'react-native';
import { buildTimeline, formatDual, isOfficial, unlockedPhase, type SalePhase, type TimelineItem } from '@sellout/core';
import { addToCalendar, canSaveCalendarFile, webCalendarLink } from '../lib/calendar';
import { SOURCE_KIND_NL, timeAgo } from '../lib/view';
import { Button, LinkText } from './components';
import { IconCalendar } from './icons';
import { useTheme } from './theme';

const STATE_LABEL: Record<TimelineItem['state'], string> = {
  past: 'Voorbij',
  now: 'Nu bezig',
  next: 'Volgende',
  future: '',
  unknown: 'Nog niet bekend',
};

function TimeLines({ item }: { item: TimelineItem }) {
  const t = useTheme();
  const d = formatDual(item.at);
  if (item.at.precision !== 'exact') return <Text style={{ color: t.text, fontSize: 14.5, marginTop: 2 }}>{d.local}</Text>;
  return (
    <View style={{ marginTop: 2 }}>
      <Text style={{ color: t.text, fontSize: 14.5, fontWeight: '600' }}>{d.local}</Text>
      {!d.same ? <Text style={{ color: t.muted, fontSize: 13.5 }}>{d.user}</Text> : null}
    </View>
  );
}

export function Timeline({ phases, now, eventTitle }: { phases: SalePhase[]; now: Date; eventTitle: string }) {
  const t = useTheme();
  const [msg, setMsg] = useState<Record<string, string>>({});
  const items = buildTimeline(phases, now.toISOString());
  if (items.length === 0) {
    return <Text style={{ color: t.muted, fontSize: 14 }}>Er zijn nog geen verkoopfases bekend. Verkoopdatum: nog niet bekend.</Text>;
  }
  return (
    <View>
      {items.map((it, i) => {
        const p = it.phase;
        const dim = it.state === 'past';
        const dot = it.state === 'next' || it.state === 'now' ? t.accent : it.state === 'past' ? t.border : t.faint;
        const isStartLike = it.role === 'start' || it.role === 'opens' || it.role === 'deadline';
        const showDetails = it.role !== 'end';
        const unlock = p.kind === 'registration' ? unlockedPhase(p, phases) : undefined;
        const facts = [
          p.requiresCode ? 'Code nodig' : p.requiresCode === false ? 'Geen code nodig' : null,
          p.ticketLimit ? `Max. ${p.ticketLimit} tickets` : null,
          p.region ? `Regio: ${p.region}` : null,
        ].filter(Boolean) as string[];
        return (
          <View key={it.key} style={{ flexDirection: 'row', gap: 12, opacity: dim ? 0.55 : 1 }}>
            <View style={{ alignItems: 'center', width: 14 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: dot, marginTop: 4 }} />
              {i < items.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: t.border, marginTop: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 18 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700', flex: 1 }}>{it.label}</Text>
                {STATE_LABEL[it.state] ? (
                  <Text style={{ color: it.state === 'next' || it.state === 'now' ? t.accent : t.muted, fontSize: 12, fontWeight: '700' }}>{STATE_LABEL[it.state]}</Text>
                ) : null}
              </View>
              <TimeLines item={it} />
              {showDetails && facts.length ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>{facts.join(' · ')}</Text> : null}
              {showDetails && p.whereToRegister ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>Inschrijven: {p.whereToRegister}</Text> : null}
              {showDetails && unlock ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>Geeft toegang tot: {unlock.name}</Text> : null}
              {showDetails && p.conditions ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 2, lineHeight: 18 }}>{p.conditions}</Text> : null}
              {showDetails && p.notes?.length
                ? p.notes.map((n) => (
                    <Text key={n} style={{ color: t.warnText, fontSize: 12.5, marginTop: 4, lineHeight: 17 }}>
                      {n}
                    </Text>
                  ))
                : null}
              {showDetails && it.state !== 'past' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  {isStartLike && (it.at.precision === 'exact' || it.at.precision === 'date')
                    ? (() => {
                        const req = {
                          phase: p,
                          role: it.role === 'deadline' ? ('deadline' as const) : ('start' as const),
                          title: `${it.label} – ${eventTitle}`,
                          description: `${eventTitle}. ${p.name}.${p.whereToRegister ? ` Inschrijven: ${p.whereToRegister}.` : ''}`,
                          url: p.url,
                        };
                        const google = webCalendarLink(req);
                        return (
                          <>
                            {canSaveCalendarFile() ? (
                              <Button
                                label="Zet in agenda"
                                icon={<IconCalendar color={t.text} />}
                                onPress={async () => {
                                  const r = await addToCalendar(req);
                                  setMsg((m) => ({ ...m, [it.key]: r }));
                                }}
                              />
                            ) : null}
                            {google ? <LinkText url={google} label="Google Agenda" /> : null}
                          </>
                        );
                      })()
                    : null}
                  {p.url ? <LinkText url={p.url} label="Open link" /> : null}
                </View>
              ) : null}
              {msg[it.key] ? <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 4 }}>{msg[it.key]}</Text> : null}
              {showDetails ? (
                <Text style={{ color: t.faint, fontSize: 12, marginTop: 6 }}>
                  Bron: {p.sources.map((s) => `${s.name}${isOfficial(s) ? ' (officieel)' : ` (${SOURCE_KIND_NL[s.kind].toLowerCase()})`}`).join(', ')}
                  {p.sources[0] ? ` · gecontroleerd ${timeAgo(p.sources.map((s) => s.fetchedAt).sort().at(-1)!)}` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
