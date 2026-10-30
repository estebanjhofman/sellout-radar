# Sellout Radar installeren

Sellout Radar bestaat uit drie delen. Geen van de drie vraagt om een eigen server die altijd aan moet staan.

| Deel | Waar het draait | Wat het doet | Nodig? |
|---|---|---|---|
| **Updater** | GitHub Actions, 3x per dag | Haalt bronnen op, bepaalt verkoopmomenten en scores, schrijft `data/snapshot.json` | Ja |
| **Database** | Supabase (gratis plan) | Bewaart wat je volgt, je apparaten en verstuurde meldingen | Aanbevolen, voor pushmeldingen en meerdere apparaten |
| **App** | Je iPhone (Expo) en je browser (GitHub Pages) | Toont de radar, plant herinneringen, zet momenten in je agenda | Ja |

Zonder API-sleutels werkt alles al met de evenementen in `data/seed/` (de startlijst en de onderzochte evenementen). Met sleutels vindt de updater zelf nieuwe evenementen en verkoopdata.

---

## 1. Code op GitHub zetten

1. Maak op GitHub een nieuwe, **openbare** repository, bijvoorbeeld `sellout-radar`, zonder README.
2. Pak de zip uit en zet de code erin:

   ```bash
   cd sellout-radar
   git init -b main
   git add .
   git commit -m "Sellout Radar"
   git remote add origin https://github.com/JOUW-GITHUB-NAAM/sellout-radar.git
   git push -u origin main
   ```

3. De workflow **Tests** draait meteen. Groen betekent: de code en alle seedbestanden zijn in orde.

Geheime sleutels komen nooit in de code, alleen in **Settings → Secrets and variables → Actions**.

## 2. Sleutels voor de bronnen (allemaal optioneel)

Zet ze als **Repository secret** onder *Settings → Secrets and variables → Actions → Secrets*. Ontbreekt een sleutel, dan slaat de updater die bron over en meldt dat in het logboek.

| Secret | Waar aanmaken | Wat Sellout Radar ermee doet |
|---|---|---|
| `TICKETMASTER_API_KEY` | developer.ticketmaster.com → *My Apps* → Consumer Key (Discovery API) | Nieuwe evenementen, presales, verkoopstart en status per datum |
| `SEATGEEK_CLIENT_ID` | platform.seatgeek.com → account maken en een app registreren | Doorverkoopprijzen (vooral Noord-Amerika) |
| `LASTFM_API_KEY` | last.fm/api/account/create | Luisteraars en keer afgespeeld per artiest (daaruit de groei over 90 dagen), en de Last.fm-toplijst wereldwijd en per land voor de 20 landen met de meeste datums. Telt mee in de verwachte drukte |
| `YOUTUBE_API_KEY` | Google Cloud Console → *YouTube Data API v3* inschakelen → API-sleutel | Abonnees en weergaven van het kanaal, alleen ter informatie op de detailpagina (niet in de score, zie hieronder) |
| `SETLISTFM_API_KEY` | api.setlist.fm | Wanneer en waar een artiest eerder in een stad speelde |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Leest officiële pagina's (`data/watchlist.json`) en nieuws (`data/feeds.json`) en haalt er verkoopdata uit. Een datum telt alleen als de letterlijke tekst in de bron staat. Kost geld per gebruik; zie `SELLOUT_MAX_LLM_CALLS`. |
| `EXPO_ACCESS_TOKEN` | expo.dev → *Account settings* → *Access tokens* | Alleen nodig als je in Expo "enhanced push security" aanzet |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Zie stap 3 | Opslag en pushmeldingen |

Onder **Variables** (zelfde scherm, tabblad *Variables*) kun je instellen:

| Variable | Standaard | Betekenis |
|---|---|---|
| `SELLOUT_COUNTRIES` | `NL,BE,DE,GB,FR,IE,ES,IT,AT,CH,DK,SE,NO,PL,US,CA,AU` | Landen waarin Ticketmaster naar nieuwe evenementen zoekt |
| `SELLOUT_MAX_LLM_CALLS` | `40` | Maximaal aantal taalmodelaanroepen per run (houdt de kosten laag) |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Model voor het lezen van pagina's |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | leeg | Voor de webversie (stap 5), zodat volgen op alle apparaten gelijk loopt |

**Gebruiksvoorwaarden.** Elke bron heeft eigen voorwaarden, ook over het bewaren en tonen van hun gegevens. Omdat de repository openbaar is, is het snapshot dat ook. Lees per bron de voorwaarden voordat je de sleutel toevoegt. De updater gebruikt officiële API's waar die er zijn, maakt zich bekend met een eigen User-Agent, volgt `robots.txt` en vraagt niet vaker dan drie keer per dag.

- **Last.fm**: de API is bedoeld voor niet-commercieel gebruik; de app noemt Last.fm als bron met een link naar de pagina van de artiest. De toplijsten worden hooguit één keer per dag opgehaald.
- **YouTube**: volgens de YouTube API-voorwaarden mag je uit API-gegevens geen eigen maten of scores afleiden en statistieken niet langer dan 30 dagen bewaren. Daarom telt YouTube niet mee in de score, toont de app alleen de laatste meting en wist de updater YouTube-cijfers na 30 dagen.

## 3. Supabase (aanbevolen)

Nodig voor pushmeldingen vanaf de server (bijv. "extra show toegevoegd", "nieuwe presale", "uitverkocht") en om op meerdere apparaten dezelfde lijst met gevolgde evenementen te hebben.

1. Maak op supabase.com een nieuw project (gratis plan). Kies een regio in Europa.
2. Open **SQL Editor**, plak de inhoud van `supabase/migrations/0001_schema.sql` en klik op **Run**. Doe daarna hetzelfde met `supabase/migrations/0002_twee_scores.sql` (de twee scores). Had je Supabase al ingericht met een eerdere versie, voer dan alleen `0002_twee_scores.sql` uit; bestaande gegevens blijven staan.
3. Ga naar **Authentication → Sign In / Providers** en zet **anonieme aanmeldingen** aan. De app meldt zich zo aan zonder e-mailadres of wachtwoord.
4. Ga naar **Project Settings → API keys** en noteer:
   - de **Project URL**;
   - de **anon**- of **publishable**-sleutel (mag openbaar; de toegangsregels in de database beschermen de gegevens);
   - de **service_role**- of **secret**-sleutel (**geheim**: alleen in GitHub zetten, nooit in de app).
5. Zet in GitHub de secrets `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY`.

Zonder Supabase bewaart de updater zijn geheugen in `data/state/` in de repository. De app werkt dan ook, maar alleen met herinneringen die de iPhone zelf inplant; meldingen over wijzigingen komen dan pas binnen als de app de nieuwe gegevens ophaalt.

## 4. De eerste update

1. Ga naar **Actions → Sellout Radar bijwerken → Run workflow**.
2. Na een paar minuten staat er een commit "Update …" met een nieuwe `data/snapshot.json`.
3. Daarna draait de update vanzelf om 06:43, 12:43 en 18:43 Nederlandse tijd, zodat de gegevens er rond 07:00, 13:00 en 19:00 zijn. GitHub start geplande runs soms later; daarom plant de app herinneringen ruim van tevoren en stuurt de server een melding liever te vroeg dan te laat.

Lukt het vastleggen niet (fout 403), zet dan onder **Settings → Actions → General → Workflow permissions** de optie **Read and write permissions** aan.

## 5. Webversie op je computer (GitHub Pages)

1. Zet onder **Settings → Pages** de bron (*Source*) op **GitHub Actions**.
2. Start **Actions → Webversie publiceren → Run workflow** (hij draait daarna vanzelf bij wijzigingen in de app).
3. De radar staat op `https://JOUW-GITHUB-NAAM.github.io/sellout-radar/`.

De webversie haalt het snapshot steeds vers op uit de repository; opnieuw bouwen na elke update is niet nodig. In de browser werken het overzicht, de detailpagina's, "Zet in agenda" (.ics) en de link naar Google Agenda. Pushmeldingen komen op de iPhone binnen, niet in de browser. Via je browser kun je de pagina aan je Dock of startmenu toevoegen.

## 6. De iPhone-app

Wat je nodig hebt: een computer met **Node.js 22**, een gratis **Expo**-account en een **Apple Developer**-account (betaald jaarabonnement) om de app via TestFlight op je iPhone te zetten.

1. Installeer en koppel het project:

   ```bash
   cd apps/mobile
   npm ci
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

   `init` maakt een Expo-project aan en toont de **project-ID**.

2. Vul in `apps/mobile/eas.json` onder `build.base.env` je eigen waarden in:

   | Waarde | Voorbeeld |
   |---|---|
   | `EXPO_PUBLIC_SNAPSHOT_URL` | `https://raw.githubusercontent.com/JOUW-GITHUB-NAAM/sellout-radar/main/data/snapshot.json` |
   | `EXPO_PUBLIC_SUPABASE_URL` | Project URL uit stap 3 |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable-sleutel uit stap 3 |
   | `EAS_PROJECT_ID` | De ID uit `eas init` |
   | `IOS_BUNDLE_ID` | Iets unieks, bijv. `nl.jouwnaam.selloutradar` |

3. Bouw de app en zet hem klaar voor TestFlight:

   ```bash
   npx eas-cli@latest build --platform ios --profile production
   npx eas-cli@latest submit --platform ios --latest
   ```

   EAS vraagt om in te loggen met je Apple ID en maakt de certificaten en de pushsleutel zelf aan. Zeg **ja** als het vraagt om pushmeldingen in te stellen.

4. Installeer de app via **TestFlight** op je iPhone. Bij de eerste start vraagt de app of hij meldingen mag sturen.

Snel uitproberen zonder Apple-account kan met de app **Expo Go**: `npx expo start` en de QR-code scannen. Meldingen en verversen op de achtergrond werken in Expo Go niet volledig; daarvoor is de TestFlight-versie nodig.

### Meldingen in de app

- Standaard krijg je meldingen voor evenementen die je volgt en voor evenementen met score 70 of hoger. Vóór de verkoop telt daarvoor de verwachte drukte, daarna de uitverkoopkans. Beide stel je in onder **Instellingen**.
- Presale en algemene verkoop: minstens 12 uur van tevoren. Inschrijvingen: zodra ze opengaan en minstens 12 uur voor de deadline.
- Optioneel een herinnering 1 uur vooraf.
- Wijzigingen: extra show, andere verkoopdatum, nieuwe presale, score +15 of meer, uitverkocht.
- Valt een melding in je stille uren, dan komt hij eerder, nooit later.

## 7. Evenementen toevoegen

- **Seedbestanden** (`data/seed/*.json`): handmatig gecontroleerde evenementen, met bron per datum en per verkoopfase. Het formaat staat beschreven in `packages/updater/src/seed/schema.ts`. Een tijd die niet in een bron staat, laat je weg; de app toont dan "nog niet bekend".
- **Officiële pagina's** (`data/watchlist.json`): tourpagina's, promotors en zalen die elke run worden gelezen (met `ANTHROPIC_API_KEY`).
- **Nieuws** (`data/feeds.json`): RSS-feeds waarin de updater zoekt naar aankondigingen, extra shows en verkoopdata.

Controleer seeds altijd met `npm run seed:check`. Die controleert onder meer bronverwijzingen, tijdzones en of een weekdag in een notitie klopt bij de datum, en telt hoeveel artiesten populariteit, hitnoteringen en een vorige tour of editie hebben.

**Populariteit en geschiedenis in een seed.** Vul alleen in wat een bron noemt, met de bron in `sources` (met `checked`, de datum van controle). Zonder bron: weglaten.

```json
"popularity": {
  "metrics": [{ "metric": "lastfm_listeners", "value": 1700000, "source": "lastfm" }],
  "charts": [{ "chart": "Album Top 100", "country": "NL", "title": "The Great Divide", "kind": "album", "peak": 1, "year": 2026, "source": "wikiTGD" }]
},
"history": {
  "previousVisits": [{ "tour": "…", "year": 2024, "date": "2024-08-24", "city": "Amsterdam", "country": "NL", "venue": "Ziggo Dome", "capacity": 17000, "shows": 1, "soldOut": true, "sources": ["…"] }],
  "previousEditions": [{ "year": 2025, "sellThrough": 0.92, "withinHours": 2, "sources": ["…"] }]
}
```

`previousVisits` is de vorige tour van de artiest, `previousEditions` de vorige edities van een festival of terugkerend evenement. `sellThrough` (0–1) en `withinHours` vul je alleen in als de bron ze noemt. Een venue-capaciteit (`capacity`) heeft altijd een `capacitySource` nodig. Met `LASTFM_API_KEY` neemt de updater de Last.fm-cijfers later vanzelf over; de seedwaarde is dan de eerste meting.

## 8. Lokaal draaien en testen

```bash
npm ci                 # in de hoofdmap
npm test               # alle tests
npm run typecheck
npm run seed:check
npm run update         # een volledige run; zonder sleutels alleen met de seeds
cd apps/mobile && npm ci && npx expo start --web
```

## 9. Problemen oplossen

| Wat je ziet | Wat je doet |
|---|---|
| Workflow faalt bij "Snapshot vastleggen" (403) | Stap 4: *Read and write permissions* aanzetten |
| App: "Er is nog geen snapshot-URL ingesteld" | `EXPO_PUBLIC_SNAPSHOT_URL` invullen in `eas.json` en opnieuw bouwen |
| App: melding dat de gegevens oud zijn | Kijk bij **Actions** of de laatste runs gelukt zijn |
| Geen pushmeldingen | Meldingen aan op de iPhone? Supabase-sleutels in de app én in GitHub? In Supabase moet je toestel in de tabel `device` staan |
| Ticketmaster geeft fout 429 (te veel aanvragen) | Minder landen in `SELLOUT_COUNTRIES` |
| Geplande runs stoppen | GitHub zet geplande workflows uit in repositories zonder activiteit; zet ze weer aan onder **Actions** |

## 10. Kosten

- **GitHub**: Actions en Pages zijn gratis voor openbare repositories.
- **Supabase**: het gratis plan is ruim genoeg.
- **Expo**: het gratis plan is genoeg voor af en toe een nieuwe build.
- **Apple Developer Program**: betaald jaarabonnement, nodig voor TestFlight.
- **Anthropic**: betalen per gebruik; begrensd met `SELLOUT_MAX_LLM_CALLS`.
