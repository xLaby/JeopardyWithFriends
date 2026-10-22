# Quiz Show (Jeopardy-Stil) – Version 3

Ein Spielleiter leitet das Spiel, Spieler treten im Browser mit Raumcode bei. Es muss nichts heruntergeladen werden.
Board: bis zu 15 Kategorien × 10 Stufen, Punktwerte frei wählbar (Standard 100 bis 800).

## Ablauf einer Frage
1. **Wählen:** Die Spieler sind in fester Reihenfolge dran (Beitrittsreihenfolge, in der Lobby per ▲▼ sortierbar). Wer dran ist, klickt ein Feld. Der Spielleiter kann jederzeit selbst wählen.
2. **Vorlesen:** Nur der Spielleiter sieht die Frage. Die Spieler sehen Kategorie und Punktwert – und können jetzt einen Joker setzen (**einer pro Frage**, wer zuerst kommt).
3. **Freigeben:** Mit „Buzzer freigeben" bzw. „Schätzen freigeben" wird die Frage (inkl. Bild/Sound) bei allen sichtbar. Ein hinterlegter Sound startet automatisch.
4. **Antworten:** siehe Fragentypen unten.
5. **Auflösung → Zurück zum Board:** das Feld ist verbraucht, der nächste Spieler ist dran. Ist das Board leer, beginnt das Finale (falls vorhanden), sonst die Siegerehrung.

## Fragentypen
**Buzzer (Standard):** Wer zuerst drückt, antwortet mündlich. Danach läuft ein Timer (Standard 10 s). Bei 0 ertönt ein Signal und der Falsch-Knopf blinkt – der Spielleiter entscheidet trotzdem selbst.
Richtig = voller Wert. Falsch = halber Wert Abzug, und der Spieler ist für diese Frage gesperrt. Dann geht der Buzzer für die anderen wieder auf.

**Schätzfrage** (`"typ": "schaetzen"`): Alle tippen eine Zahl ein (90 s, pro Frage per `"zeit"` änderbar). Der Spielleiter sieht die Schätzungen live, kann die Zeit vorzeitig beenden, deckt die Antworten einzeln auf (die am weitesten entfernte zuerst) und drückt „Auflösung". Wer am nächsten dran ist, bekommt den vollen Wert, alle anderen 0. Bei Gleichstand gewinnen beide. Per Klick auf eine Schätzung lässt sich der Gewinner ändern.
Eingaben wie `1.200`, `12,50` oder `ca. 300 €` werden verstanden.

**Reveal** (`"typ": "reveal"`, braucht `bild` oder `sound`): Je früher gebuzzert wird, desto mehr Punkte – vier Stufen mit Faktor **×2 → ×1,5 → ×1,25 → ×1**. Der Abzug bei falscher Antwort bleibt der normale halbe Wert.
- *Mit Bild:* Das Bild startet stark verpixelt und wird automatisch schärfer, über `"dauer"` Sekunden (Standard 20). Das Verpixeln passiert im Browser, der Server merkt sich nur den Buzz-Zeitpunkt.
- *Mit Sound:* Erst 2 s, dann 5 s, dann 10 s, dann komplett – der Spielleiter schaltet per „Länger abspielen" weiter.

## Finale mit Einsatz
Ein optionaler Block `"finale"` mit beliebig vielen Fragen. Es startet automatisch, wenn das Board leer ist, oder jederzeit über „Finale starten".
Pro Frage: **Einsatz** (45 s, jeder setzt verdeckt 0 bis Punktestand; wer im Minus ist, darf bis 100 setzen) → **Frage zeigen**, alle tippen ihre Antwort (Schätz-/Finalzeit) → **Aufdecken** vom Letzten zum Ersten: Antwort zeigen, richtig/falsch, Einsatz wird dazugezählt oder abgezogen. Wer nicht antwortet, verliert seinen Einsatz automatisch. Danach die nächste Finalfrage oder die Siegerehrung.

## Siegerehrung und Awards
Podium plus Awards, die der Server aus dem Spielverlauf berechnet: Schnellster Buzzer (kürzeste Reaktionszeit), Treffsicher, Jackpot (größter Einzelgewinn), Dauerdrücker, Schätzkönig, Jokerfreund, Mut zur Lücke. Bei Gleichstand teilen sich mehrere den Award.

## Buzzer-Fairness
Jedes Gerät misst selbst die Zeit zwischen „Buzzer wird sichtbar" und „Spieler drückt". Der Server sammelt nach dem ersten Buzz noch 250 ms lang weitere und nimmt die kürzeste Reaktionszeit. Wer drückt, bevor der Buzzer frei ist, wird 1 Sekunde gesperrt.

## Joker
Joker gewinnt man, indem man ein **Joker-Feld** richtig beantwortet. Der Spieler sucht sich dann einen Joker aus (max. 3 im Besitz). Joker werden gesetzt, solange die Frage vorgelesen wird, und wirken auf genau diese Frage:

| Joker | Wirkung |
|---|---|
| ×2 **Doppelte Punkte** | Gewinn und Verlust zählen doppelt. |
| ☕ **Kaffeepause** | Ein gewählter Mitspieler darf bei dieser Frage nicht buzzern bzw. nicht schätzen. |
| ⚡ **Risiko** | Richtig: dreifache Punkte. Falsch, nicht geantwortet oder jemand anders war schneller: doppelter Fragenwert Abzug. |

Wird eine Frage beim Vorlesen übersprungen, bekommt der Spieler seinen Joker zurück.

**Joker-Felder festlegen:** In der Lobby per Klick auf das Mini-Board (★) oder per `"joker": true` in der JSON. „Joker-Felder gesamt" füllt den Rest zufällig auf. Im Spiel: „Joker-Felder bearbeiten". Nur der Spielleiter sieht die Marker.

## Spieler-Menü des Spielleiters
Klick auf einen Spieler-Chip öffnet ein Menü: Punkte ±, beliebiger Betrag, als Nächstes dransetzen, Joker geben oder nehmen, Spieler entfernen.

## Fragen, Bilder und Sounds
Die Datei `fragen.json` (oder Upload in der Lobby):

    {
      "titel": "Mein Quiz",
      "werte": [100, 200, 300, 400, 500, 600, 700, 800],
      "kategorien": [
        { "name": "Wo sind wir?", "fragen": [
          { "frage": "In welchem Land steht das?", "antwort": "Island",
            "typ": "reveal", "bild": "ort1.jpg", "antwortBild": "ort1-karte.jpg", "dauer": 20 },
          { "frage": "Welcher Film?", "antwort": "Star Wars", "typ": "reveal", "sound": "intro1.mp3", "joker": true }
        ] },
        { "name": "Guess The Price", "fragen": [
          { "frage": "Was kostet ein Liter Milch?", "antwort": "1,19", "typ": "schaetzen", "einheit": "€", "zeit": 90 }
        ] }
      ],
      "finale": { "name": "Finale", "fragen": [
        { "frage": "Wie viele Bundesländer hat Deutschland?", "antwort": "16" }
      ] }
    }

- **Board-Größe:** bis zu 15 Kategorien. Die Stufenzahl ergibt sich aus `"werte"` (bis zu 10 Werte) – oder, wenn `"werte"` fehlt, aus der längsten Kategorie mit `"schritt"` (Standard 100: 100, 200, 300 …). Jedes Paket hat also seine eigene Board-Größe.
- Pflicht pro Frage: `frage`, `antwort`. Optional: `bild`, `sound`, `antwortBild` (Dateiname aus `media/` oder https-Link), `joker`, `typ` (`schaetzen`, `reveal`), `einheit`, `zeit`, `dauer`.
- Bei Schätzfragen muss `antwort` eine Zahl sein, sonst wählt der Spielleiter den Gewinner per Klick.
- Dateien in `media/` gehören mit ins GitHub-Repository, sonst fehlen sie auf dem Server.

## Lokal testen
Node.js ab Version 18, dann im Projektordner `npm install` und `npm start`, danach http://localhost:3000 öffnen.

## Online stellen (Render)
Projekt in GitHub aktualisieren, Render deployt automatisch neu. Build Command `npm install`, Start Command `npm start`.
Der Gratis-Server schläft nach etwa 15 Minuten ohne Aufrufe ein; verbundene Spieler halten ihn über einen kleinen Ping alle 5 Minuten wach. Der Spielstand liegt nur im Arbeitsspeicher – vor dem Spielabend einmal die Seite aufrufen.
Nach jedem Update die Versionsnummer in `public/index.html` (`?v=3`) hochzählen, dann holen alle Browser garantiert die neuen Dateien.
