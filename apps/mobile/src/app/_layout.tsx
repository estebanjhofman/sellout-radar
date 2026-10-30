import '../lib/background';
import { useEffect } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerBackgroundSync } from '../lib/background';
import {
  configureNotifications,
  getPushToken,
  notificationsSupported,
  onNotificationTap,
  requestPermission,
  syncLocalNotifications,
} from '../lib/notify';
import { planReminders } from '../lib/plan';
import { writeJson } from '../lib/storage';
import { registerDevice, reportScheduled, supabaseEnabled } from '../lib/supabase';
import { DataProvider, useData } from '../state/data';
import { PrefsProvider, usePrefs } from '../state/prefs';
import { useTheme } from '../ui/theme';

/** Houdt de lokale herinneringen gelijk met de nieuwste data en voorkeuren. */
function NotificationManager() {
  const { snapshot } = useData();
  const { prefs, ready } = usePrefs();

  useEffect(() => {
    configureNotifications();
    void registerBackgroundSync();
    return onNotificationTap((url) => {
      const m = /event\/([^?#]+)/.exec(url);
      if (m?.[1]) router.push({ pathname: '/event/[id]', params: { id: decodeURIComponent(m[1]) } });
    });
  }, []);

  useEffect(() => {
    if (!snapshot || !ready || !notificationsSupported) return;
    let cancelled = false;
    (async () => {
      const enabled = prefs.settings.notificationsEnabled && (await requestPermission());
      if (cancelled) return;
      const keys = await syncLocalNotifications(enabled ? planReminders(snapshot, prefs).selected : []);
      const token = enabled ? await getPushToken() : null;
      if (token) {
        await writeJson('push:token', token);
        if (supabaseEnabled()) {
          await registerDevice(token);
          await reportScheduled(token, keys);
        }
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [snapshot, prefs, ready]);

  return null;
}

function AppStack() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <NotificationManager />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
          headerBackTitle: 'Terug',
          // In de browser een eigen terugknop (geen afbeeldingen nodig). Na een directe link of
          // herladen is er geen vorige pagina; dan gaat de knop naar het overzicht.
          ...(Platform.OS === 'web'
            ? {
                headerLeft: () => (
                  <Pressable
                    onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                    accessibilityRole="button"
                    style={{ paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>‹ Terug</Text>
                  </Pressable>
                ),
              }
            : {}),
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Sellout Radar', ...(Platform.OS === 'web' ? { headerLeft: () => null } : {}) }} />
        <Stack.Screen name="event/[id]" options={{ title: '' }} />
        <Stack.Screen name="settings" options={{ title: 'Instellingen' }} />
        <Stack.Screen name="accuracy" options={{ title: 'Nauwkeurigheid' }} />
        <Stack.Screen name="changes" options={{ title: 'Wijzigingen' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DataProvider>
        <PrefsProvider>
          <AppStack />
        </PrefsProvider>
      </DataProvider>
    </SafeAreaProvider>
  );
}
