# Sellout Radar

Sellout Radar volgt aangekondigde evenementen waarvan de kaartverkoop nog moet beginnen of net is begonnen: concerten van club tot stadion, festivals, sportfinales en grand slams, musicals en theater, comedy, K-pop en J-pop, reünie- en afscheidstours en het Songfestival. De app splitst alles in twee tabbladen, **Nog niet in de verkoop** en **Al in de verkoop**, elk met een eigen score van 0 tot 100 met uitleg, ingedeeld per artiest of evenement en per stad. Hij waarschuwt op tijd voor inschrijvingen, presales en de algemene verkoop.

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

## Twee tabbladen, twee scores

Een datum staat bij **Nog niet in de verkoop** zolang er geen presale of algemene verkoop is begonnen (inschrijvingen en lotingen tellen niet als verkoop). Zodra de eerste verkoop begint, schuift hij vanzelf door naar **Al in de verkoop**; de app rekent dat met de klok zelf uit, ook tussen twee updates in. Uitverkochte datums staan daar onderaan.

**Verwachte drukte** (nog niet in de verkoop) zegt hoe moeilijk het wordt om bij de eerste verkoop een kaart te krijgen: de kans dat de datum in de presale of binnen een dag uitverkoopt. Labels: *Extreem druk verwacht*, *Zeer druk*, *Druk*, *Matig druk*, *Rustig*. Signalen:

- populariteit (luisteraars op Last.fm, naar verhouding van het land en de positie in de Last.fm-toplijst van dat land) tegenover het aantal plekken (capaciteit × aantal shows);
- groei en hitnoteringen;
- de vorige tour of editie: hoe groot de zaal was en of die uitverkocht raakte (ook "98% verkocht" telt mee);
- schaarste: afscheid, reünie, loting, enige show in het land, de Benelux of Europa, lang niet geweest;
- het soort fanbase;
- vraag elders op deze tour (uitverkochte data en extra shows).

**Uitverkoopkans** (al in de verkoop) is de kans dat de datum vóór de showdag uitverkoopt, op basis van echte verkoopsignalen: uitverkochte andere data, extra shows, verkoopsnelheid, doorverkoopprijzen en "bijna uitverkocht". De laatste verwachte drukte telt mee als startpunt.

Vlak vóór de eerste verkoop legt de updater de verwachte drukte vast. Na de eerste verkoopdag kijkt hij of het echt druk was (uitverkocht in de presale of binnen een dag) en zet dat als uitkomst bij de datum ("Binnen een dag uitverkocht. De verwachting klopte."). Was een datum al in de verkoop toen de radar hem vond, dan staat er een achteraf geschatte verwachte drukte bij die niet meetelt bij het leren.

Beide scores leren van hun eigen uitkomsten (kalibratie, apart per score); de pagina **Nauwkeurigheid** in de app laat zien hoe goed eerdere scores klopten. Tot er 50 uitkomsten zijn, is de betrouwbaarheid hooguit "middel". Bij elke score staat in gewone taal welke signalen het zwaarst wegen.

Kleuren lopen vloeiend van groen (hoogste score) via geel en oranje naar rood (laagste), altijd met het getal en een label erbij.

## Indeling per artiest

Elk tabblad toont een lijst per artiest of evenement (festival, Songfestival, sportfinale). Uitgeklapt zie je elke stad met datum(s), venue en score, en daaronder alle verkoopmomenten (inschrijvingen, lotingen, presales, algemene verkoop) met lokale tijd én Nederlandse tijd en een aftelklok. Zoeken, filters, volgen (per datum, tour of artiest) en meldingen werken in beide tabbladen.

## Populariteit en geschiedenis

De seeds bevatten per artiest openbare cijfers met bron en controledatum: luisteraars en keer afgespeeld op Last.fm, hitnoteringen, de vorige tour (zaal, capaciteit, uitverkocht ja/nee) en voor festivals en terugkerende evenementen de vorige edities. Wat geen bron heeft, staat er niet in. Met `LASTFM_API_KEY` haalt de updater de Last.fm-cijfers zelf bij, per land via de toplijsten; YouTube-cijfers toont de app alleen ter informatie (zie SETUP.md).

## Wat er in de repository staat

| Map | Inhoud |
|---|---|
| `packages/core` | Gedeelde logica: tijdzones, bronnen en conflicten, verkooptijdlijn, score en uitleg, kalibratie, meldingen, agenda (.ics) |
| `packages/updater` | De updater die in GitHub Actions draait: bronnen ophalen, samenvoegen, scoren, snapshot en pushmeldingen |
| `apps/mobile` | De app (Expo) voor iPhone en web |
| `data/seed` | Handmatig gecontroleerde evenementen met bronnen (26 bestanden, 266 datums op 30 oktober 2026), plus populariteit en geschiedenis per artiest |
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
