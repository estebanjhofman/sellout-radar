# Sellout Radar

Sellout Radar volgt aangekondigde evenementen waarvan de kaartverkoop nog moet beginnen of net is begonnen: concerten van club tot stadion, festivals, sportfinales en grand slams, musicals en theater, comedy, K-pop en J-pop, reünie- en afscheidstours en het Songfestival. Per datum geeft de app een **sellout-score** van 0 tot 100 met uitleg, en waarschuwt op tijd voor inschrijvingen, presales en de algemene verkoop.

- **Op je iPhone**: een app met meldingen, ook als de app dicht is.
- **Op je computer**: dezelfde app in de browser, via GitHub Pages.
- **Geen eigen server**: GitHub Actions werkt de gegevens drie keer per dag bij (07:00, 13:00 en 19:00 Nederlandse tijd).

Installatie stap voor stap: **[SETUP.md](SETUP.md)**.

## Kwaliteitsregels

- Verzin nooit verkoopdata: onbekend is "nog niet bekend".
- Bij tegenstrijdige bronnen: toon beide, markeer het conflict en geef voorrang aan de officiële bron.
- Test alles met de startlijst.
- Gebruik officiële API's waar mogelijk en respecteer de gebruiksvoorwaarden van elke bron.

Zo is dat in de code geregeld:

- Elke datum, tijd en verkoopfase heeft een bron met het moment van de laatste controle. Een tijd zonder bron wordt weggelaten; een datum zonder tijd blijft een datum.
- Gegevens uit pagina's en nieuws tellen alleen als de letterlijke tekst in de bron staat. Noemt de bron een weekdag die niet bij de datum past, dan krijgt die datum een waarschuwing.
- Conflicten worden opgeslagen met alle waarden; de app toont ze met de reden van de keuze (officiële bron eerst, daarna de meerderheid).
- Tijden worden in UTC opgeslagen en per tijdzone getoond, lokaal én in Nederlandse tijd, ook rond de wisseling van zomer- en wintertijd.

## De score

De score is de kans (in procenten) dat een datum uitverkoopt vóór de showdag. Hij combineert negen signalen: bewezen vraag op dezelfde tour, doorverkoopprijzen, de schaalsprong ten opzichte van een vorig bezoek, het aantal shows tegenover de markt, schaarste (afscheid, reünie, loting, lang niet geweest), momentum, het soort fanbase, praktische zaken (dag, seizoen, buiten) en signalen tijdens de verkoop. Bij elke score staat welke signalen meetellen en hoe betrouwbaar hij is.

Elke afgelopen verkoop wordt een uitkomst. Daarmee stelt het model zich bij (kalibratie); de pagina **Nauwkeurigheid** in de app laat zien hoe goed eerdere scores klopten. Tot er 50 uitkomsten zijn, is de betrouwbaarheid hooguit "middel".

Kleuren lopen vloeiend van groen (hoogste score) via geel en oranje naar rood (laagste), altijd met het getal en een label erbij.

## Wat er in de repository staat

| Map | Inhoud |
|---|---|
| `packages/core` | Gedeelde logica: tijdzones, bronnen en conflicten, verkooptijdlijn, score en uitleg, kalibratie, meldingen, agenda (.ics) |
| `packages/updater` | De updater die in GitHub Actions draait: bronnen ophalen, samenvoegen, scoren, snapshot en pushmeldingen |
| `apps/mobile` | De app (Expo) voor iPhone en web |
| `data/seed` | Handmatig gecontroleerde evenementen met bronnen (26 bestanden, 266 datums op 30 oktober 2026) |
| `data/watchlist.json`, `data/feeds.json` | Officiële pagina's en nieuwsfeeds die de updater leest |
| `data/snapshot.json` | Wat de app toont; wordt door de updater geschreven |
| `supabase/migrations` | Databaseschema met toegangsregels |
| `.github/workflows` | `update.yml` (3x per dag), `test.yml`, `web.yml` (webversie) |

## Startlijst

De vier evenementen uit de opdracht staan erin met alle bekende data en verkoopfases: U2 *The Greatest Show On Earth* 2027, Noah Kahan *The Last Of The Bugs* 2027 (met Stadspark Groningen op 1 juli 2027), ATEEZ *Zero To All* 2027 en Bon Jovi *Forever Tour* 2027. De tests gebruiken deze startlijst.

Daarnaast o.a. Oasis, Rod Stewart, Bruce Dickinson, Santana, Tame Impala, aespa, ENHYPEN, TXT, EVNNE, Roxy Dekker, Ricky Gervais, *The Traitors* op West End, het Songfestival 2027, de Champions League-finale 2027, Wimbledon 2027 en de festivals Pinkpop, Rock Werchter, Best Kept Secret, Paaspop, Zwarte Cross, Graspop en Glastonbury.

## Ontwikkelen

```bash
npm ci
npm test            # core en updater
npm run typecheck
npm run seed:check  # controleert alle seedbestanden
npm run update      # volledige run; zonder sleutels alleen met de seeds

cd apps/mobile
npm ci
npx expo start      # iPhone (Expo Go) of web
npm run build:demo  # losse webdemo in apps/mobile/demo/
```
