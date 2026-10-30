# Wijzigingen (30 oktober 2026)

## Twee tabbladen
- **Nog niet in de verkoop**: er is nog geen presale of algemene verkoop begonnen (inschrijvingen en lotingen tellen niet als verkoop).
- **Al in de verkoop**: minstens één verkoopfase is begonnen. Uitverkochte datums staan onderaan.
- Een datum schuift vanzelf door zodra de eerste verkoop begint. De app rekent dat met de klok zelf uit, ook tussen twee updates in (`packages/core/src/stage.ts`).

## Twee scores
- **Verwachte drukte** (0–100): hoe moeilijk het wordt om bij de eerste verkoop een kaart te krijgen. Signalen: populariteit tegenover plekken (capaciteit × shows), groei en hitnoteringen, vorige tour of editie (zaalgrootte, uitverkocht, verkocht deel), schaarste (afscheid, reünie, loting, enige show in land/Benelux/Europa, lang niet geweest), soort fanbase en vraag elders op de tour. Labels: Extreem druk verwacht, Zeer druk, Druk, Matig druk, Rustig.
- **Uitverkoopkans** (0–100): kans dat de datum vóór de showdag uitverkoopt, uit echte verkoopsignalen: uitverkochte data, extra shows, verkoopsnelheid, doorverkoop, bijna uitverkocht, met de verwachte drukte vooraf als startpunt.
- Vlak vóór de eerste verkoop wordt de verwachte drukte vastgelegd. Na de eerste verkoopdag staat bij de datum wat er gebeurde ("Binnen een dag uitverkocht. De verwachting klopte."). Datums die al in de verkoop waren toen de radar ze vond, krijgen een achteraf geschatte waarde die niet meetelt bij het leren.
- Elke score heeft een eigen model en eigen kalibratie. De uitleg toont nu de vier zwaarste signalen, met betrouwbaarheid en dezelfde kleurschaal.
- Pagina **Nauwkeurigheid**: per score een overzicht, per scoreband, en de laatste vergelijkingen "verwacht → wat er gebeurde".

## Indeling per artiest of evenement
- Per tabblad een lijst per artiest of evenement (festival, Songfestival, sportfinale), met de hoogste score, het aantal steden en datums en het eerstvolgende verkoopmoment met aftelklok.
- Uitgeklapt: elke stad met venue, datum(s) en score per datum, en alle verkoopmomenten (inschrijvingen, lotingen, presales, algemene verkoop) met lokale tijd, Nederlandse tijd en aftelklok.
- Zoeken, filters (40+, 70+, gevolgd, soort, regio, verkoop binnen 7 dagen, sorteren), volgen per datum, tour of artiest, en meldingen werken in beide tabbladen. De drempel voor meldingen gebruikt de score van het tabblad.
- Detailpagina: de score met uitleg, "Verwachte drukte vooraf" met uitkomst, populariteit (Last.fm met link, hitnoteringen), vorige tour of eerdere edities met bron, en andere data van de tour.

## Populariteit en geschiedenis in de seeds
- Nieuwe velden `popularity` en `history` in `data/seed/*.json`, elk cijfer met bron en controledatum (30 oktober 2026). Wat geen bron heeft, is leeg gelaten.
- Stand: 15 artiesten met Last.fm-luisteraars, 11 met hitnoteringen, 20 van de 26 seeds met een vorige tour of editie, 21 venues met capaciteit en bron.
- `npm run seed:check` controleert de nieuwe velden en telt de dekking.

## Updater
- Last.fm (`LASTFM_API_KEY`): luisteraars en keer afgespeeld per artiest, en de toplijst wereldwijd en per land (de 20 landen met de meeste datums, hooguit één keer per dag). De app noemt Last.fm met een link.
- YouTube (`YOUTUBE_API_KEY`): alleen ter informatie op de detailpagina, niet in de score, en na 30 dagen gewist (YouTube-voorwaarden).
- Snapshot blijft schema 1 (oudere apps blijven werken); het geheugen (`data/state`) gaat naar versie 2 met automatische omzetting.
- Supabase: nieuwe migratie `supabase/migrations/0002_twee_scores.sql`.
- Wijzigingenlijst: nieuw soort "Verkoop begonnen".

## Controles
- `npm test`: core 125 tests, updater 30 tests, alles groen.
- `npm run typecheck`, `npm run seed:check` en `npx tsc --noEmit` in `apps/mobile`: geen fouten.
- Startlijst (U2, Noah Kahan, ATEEZ, Bon Jovi) zit in de tests, inclusief de overgang van "nog niet" naar "al in de verkoop".
