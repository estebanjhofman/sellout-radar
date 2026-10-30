import type { ExpoConfig } from 'expo/config';

/**
 * App-configuratie. Waarden uit de omgeving (zie SETUP.md):
 *  - EXPO_PUBLIC_SNAPSHOT_URL: waar de app het snapshot ophaalt (raw GitHub-URL van data/snapshot.json)
 *  - EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY: voor volgen op meerdere apparaten en pushmeldingen
 *  - EAS_PROJECT_ID: Expo-project voor pushmeldingen
 *  - IOS_BUNDLE_ID: je eigen bundle-ID voor de App Store/TestFlight
 *  - WEB_BASE_URL: submap voor GitHub Pages, bijv. /sellout-radar
 */
const config: ExpoConfig = {
  name: 'Sellout Radar',
  slug: 'sellout-radar',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'selloutradar',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'nl.selloutradar.app',
    infoPlist: {
      UIBackgroundModes: ['fetch', 'remote-notification'],
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? 'nl.selloutradar.app',
    adaptiveIcon: {
      backgroundColor: '#0B0F14',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    output: 'single',
    name: 'Sellout Radar',
    shortName: 'Sellout Radar',
    themeColor: '#0B0F14',
    backgroundColor: '#0B0F14',
  },
  plugins: [
    ['expo-router', { asyncRoutes: { web: false } }],
    'expo-background-task',
    'expo-web-browser',
    'expo-sharing',
    [
      'expo-notifications',
      {
        color: '#E5484D',
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission: 'Sellout Radar zet verkoopmomenten in je agenda als je daarom vraagt.',
      },
    ],
  ],
  experiments: {
    ...(process.env.WEB_BASE_URL ? { baseUrl: process.env.WEB_BASE_URL } : {}),
  },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
