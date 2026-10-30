import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { timeAgo } from '../lib/view';
import { usePrefs } from '../state/prefs';
import { Button, Card } from './components';
import { useTheme } from './theme';

/** Koppelcode: telefoon en computer delen dezelfde sterren, tickets en inschrijvingen. */
export function SyncCard() {
  const t = useTheme();
  const { sync, createSyncCode, joinSyncCode, leaveSync, syncNow } = usePrefs();
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!sync.available) {
    return (
      <Card>
        <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>
          Synchroniseren werkt pas als Supabase is ingesteld (zie SETUP.md). In deze versie zijn je lijsten alleen op dit apparaat bewaard.
        </Text>
      </Card>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sync.code ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      {sync.code ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 14.5, lineHeight: 20 }}>
            Dit apparaat is gekoppeld. Vul dezelfde code in op je andere apparaat; daarna delen ze je sterren, tickets en inschrijvingen.
          </Text>
          <Text selectable style={{ color: t.accent, fontSize: 21, fontWeight: '800', letterSpacing: 0.5, fontVariant: ['tabular-nums'] }}>
            {sync.code}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {Platform.OS === 'web' ? <Button label={copied ? 'Gekopieerd' : 'Kopieer code'} onPress={() => void copy()} /> : null}
            <Button label={sync.status === 'busy' ? 'Bezig…' : 'Nu synchroniseren'} onPress={() => void syncNow()} />
          </View>
          <Text style={{ color: t.muted, fontSize: 12.5 }}>
            {sync.status === 'error' ? sync.message : sync.lastAt ? `Laatst gesynchroniseerd ${timeAgo(sync.lastAt)}` : 'Bezig met synchroniseren…'}
          </Text>
          <Text style={{ color: t.faint, fontSize: 12, lineHeight: 17 }}>
            Houd de code voor jezelf: wie hem heeft, kan je lijsten zien en aanpassen. Instellingen zoals stille uren blijven per apparaat.
          </Text>
          {confirmLeave ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: t.text, fontSize: 13.5 }}>Ontkoppelen? Je lijsten blijven op dit apparaat staan, maar synchroniseren niet meer.</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="Ja, ontkoppelen" onPress={() => { leaveSync(); setConfirmLeave(false); }} />
                <Button label="Annuleren" onPress={() => setConfirmLeave(false)} />
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setConfirmLeave(true)} accessibilityRole="button">
              <Text style={{ color: t.down, fontSize: 13.5, fontWeight: '700' }}>Dit apparaat ontkoppelen</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ color: t.text, fontSize: 14.5, lineHeight: 20 }}>
            Koppel je telefoon en computer, zodat ze dezelfde sterren, tickets en inschrijvingen hebben.
          </Text>
          <Text style={{ color: t.text, fontWeight: '700' }}>Eerste apparaat</Text>
          <Button label={sync.status === 'busy' ? 'Bezig…' : 'Maak een koppelcode'} kind="primary" onPress={() => void createSyncCode()} />
          <Text style={{ color: t.text, fontWeight: '700', marginTop: 6 }}>Al een code op je andere apparaat?</Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor={t.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Koppelcode"
            style={{ color: t.text, fontSize: 17, letterSpacing: 1, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: t.bg }}
          />
          <Text style={{ color: t.faint, fontSize: 12, lineHeight: 17 }}>De lijsten van je andere apparaat vervangen dan die van dit apparaat.</Text>
          <Button label="Koppelen" onPress={() => void joinSyncCode(input)} />
          {sync.status === 'error' && sync.message ? <Text style={{ color: t.down, fontSize: 13 }}>{sync.message}</Text> : null}
        </View>
      )}
    </Card>
  );
}
