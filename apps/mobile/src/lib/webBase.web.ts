/**
 * Voor de losse webdemo: de pagina kan in een submap staan (bijv. /artifact/abc/index.html).
 * Expo Router verwacht routes vanaf "/". We onthouden de map van de pagina (voor snapshot.json)
 * en zetten het adres terug naar "/" voordat de router start.
 * Alleen actief als EXPO_PUBLIC_DEMO_ROOT_FIX=1 (de GitHub Pages-versie gebruikt baseUrl).
 */
declare global {
  // eslint-disable-next-line no-var
  var __SR_BASE__: string | undefined;
}

if (typeof window !== 'undefined') {
  globalThis.__SR_BASE__ = new URL('.', window.location.href).href;
  if (process.env.EXPO_PUBLIC_DEMO_ROOT_FIX === '1') {
    const known = /^\/(event\/[^/]+|settings|accuracy|changes)?\/?$/;
    if (!known.test(window.location.pathname)) {
      try {
        window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`);
      } catch {
        // Lukt het niet, dan toont de router de pagina "niet gevonden" met een link naar het overzicht.
      }
    }
  }
}

export {};
