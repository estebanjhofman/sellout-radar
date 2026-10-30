import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { syncPrefsToServer } from '../lib/supabase';
import { disableWebPush, enableWebPush, webPushStatus, type WebPushStatus } from '../lib/webpush';
import { usePrefs } from '../state/prefs';
import { Button } from './components';
import { useTheme } from './theme';

const TEXT: Record<WebPushStatus, string> = {
  unsupported: 'Deze browser ondersteunt geen meldingen. Op de iPhone werken ze in de webapp op je beginscherm.',
  'needs-home-screen': 'Op de iPhone werken meldingen alleen in de webapp op je beginscherm: open deze pagina in Safari, tik op Deel → Zet op beginscherm, en open hem daarvandaan.',
  'not-configured': 'Meldingen zijn nog niet ingesteld: de VAPID-sleutels of Supabase ontbreken (zie SETUP.md).',
  denied: 'Meldingen staan uit voor Sellout Radar. Zet ze aan in de instellingen van je telefoon of browser.',
  off: 'Meldingen staan uit op dit apparaat.',
  on: 'Meldingen staan aan op dit apparaat. Je krijgt herinneringen vóór presales en meldingen bij wijzigingen.',
};

/** Meldingen in de webversie aan- of uitzetten. */
export function WebPushCard() {
  const t = useTheme();
  const { prefs } = usePrefs();
  const [status, setStatus] = useState<WebPushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void webPushStatus().then(setStatus);
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableWebPush();
      await syncPrefsToServer(prefs);
      setStatus(await webPushStatus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    await disableWebPush().catch(() => undefined);
    setStatus(await webPushStatus());
    setBusy(false);
  };

  if (!status) return null;
  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      <Text style={{ color: status === 'on' ? t.up : t.muted, fontSize: 13.5, lineHeight: 19 }}>{TEXT[status]}</Text>
      {status === 'off' ? <Button label={busy ? 'Bezig…' : 'Meldingen aanzetten op dit apparaat'} kind="primary" onPress={() => void turnOn()} /> : null}
      {status === 'on' ? <Button label={busy ? 'Bezig…' : 'Meldingen uitzetten op dit apparaat'} onPress={() => void turnOff()} /> : null}
      {error ? <Text style={{ color: t.down, fontSize: 13 }}>{error}</Text> : null}
      {status === 'on' ? (
        <Text style={{ color: t.faint, fontSize: 12, lineHeight: 17 }}>
          De server stuurt meldingen bij elke update (rond 07:00, 13:00 en 19:00). Een herinnering komt daarom soms eerder dan je instelling, nooit later.
        </Text>
      ) : null}
    </View>
  );
}
