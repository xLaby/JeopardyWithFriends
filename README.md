# Quiz Show (Jeopardy-Stil) – Version 2

Ein Spielleiter leitet das Spiel, Spieler treten im Browser mit Raumcode bei. Es muss nichts heruntergeladen werden.
Board: bis zu 13 Kategorien × 8 Stufen (100 bis 800 Punkte).

## Ablauf einer Frage
1. **Wählen:** Die Spieler sind in fester Reihenfolge dran (Beitrittsreihenfolge, in der Lobby per ▲▼ sortierbar). Wer dran ist, klickt ein Feld. Der Spielleiter kann jederzeit selbst wählen oder per Klick auf einen Namen jemanden dransetzen.
2. **Vorlesen:** Nur der Spielleiter sieht die Frage. Die Spieler sehen Kategorie und Punktwert – und können jetzt einen Joker setzen (**einer pro Frage**, wer zuerst kommt).
3. **Freigeben:** Mit „Buzzer freigeben" bzw. „Schätzen freigeben" wird die Frage (inkl. Bild/Sound) bei allen sichtbar. Ein hinterlegter Sound startet automatisch.
4. **Antworten:** siehe Fragentypen unten.
5. **Auflösung → Zurück zum Board:** das Feld ist verbraucht, der nächste Spieler ist dran.

## Fragentypen
**Buzzer (Standard):** Wer zuerst drückt, antwortet mündlich. Danach läuft ein Timer (Standard 10 s, einstellbar). Bei 0 ertönt ein Signal und der Falsch-Knopf blinkt – der Spielleiter entscheidet trotzdem selbst.
Richtig = voller Wert. Falsch = halber Wert Abzug, und der Spieler ist für diese Frage gesperrt. Dann geht der Buzzer für die anderen wieder auf.

**Schätzfrage** (`"typ": "schaetzen"`): Alle tippen eine Zahl ein (90 s, pro Frage per `"zeit"` änderbar). Der Spielleiter sieht die Schätzungen live und kann die Zeit vorzeitig beenden. Danach deckt er die Antworten einzeln auf (die am weitesten entfernte zuerst, die beste zuletzt) und drückt „Auflösung". Wer am nächsten dran ist, bekommt den vollen Wert, alle anderen 0 – kein Abzug. Bei Gleichstand gewinnen beide. Per Klick auf eine Schätzung kann der Spielleiter den Gewinner ändern.
Eingaben wie `1.200`, `12,50` oder `ca. 300 €` werden verstanden.

## Buzzer-Fairness
Jedes Gerät misst selbst die Zeit zwischen „Buzzer wird sichtbar" und „Spieler drückt". Der Server sammelt nach dem ersten Buzz noch 250 ms lang weitere und nimmt die kürzeste Reaktionszeit – unabhängig davon, wessen Internet schneller ist. Wer drückt, bevor der Buzzer frei ist, wird 1 Sekunde gesperrt.

## Joker
Joker gewinnt man, indem man ein **Joker-Feld** richtig beantwortet (bei Schätzfragen: gewinnt). Der Spieler sucht sich dann einen Joker aus (max. 3 im Besitz). Joker werden gesetzt, solange die Frage vorgelesen wird, und wirken auf genau diese Frage:

| Joker | Wirkung |
|---|---|
| ×2 **Doppelte Punkte** | Gewinn und Verlust zählen doppelt. |
| ☕ **Kaffeepause** | Ein gewählter Mitspieler darf bei dieser Frage nicht buzzern bzw. nicht schätzen. |
| ⚡ **Risiko** | Richtig: dreifache Punkte. Falsch, nicht geantwortet oder jemand anders war schneller: doppelter Fragenwert Abzug. |

Wird eine Frage beim Vorlesen übersprungen, bekommt der Spieler seinen Joker zurück.

**Joker-Felder festlegen:** In der Lobby per Klick auf das Mini-Board (★), zusätzlich per `"joker": true` in der JSON. Die Einstellung „Joker-Felder gesamt" füllt den Rest beim Start zufällig auf. Im Spiel kann der Spielleiter über „Joker-Felder bearbeiten" nachträglich ändern. Nur der Spielleiter sieht die Marker.

## Fragen, Bilder und Sounds
Die Datei `fragen.json` (oder Upload in der Lobby) enthält bis zu 13 Kategorien mit je bis zu 8 Fragen:

    {
      "titel": "Mein Quiz",
      "kategorien": [
        { "name": "Wo sind wir?", "fragen": [
          { "frage": "In welchem Land steht das?", "antwort": "Island",
            "bild": "ort1.jpg", "antwortBild": "ort1-karte.jpg" },
          { "frage": "Welcher Film?", "antwort": "Star Wars", "sound": "intro1.mp3", "joker": true }
        ] },
        { "name": "Guess The Price", "fragen": [
          { "frage": "Was kostet ein Liter Milch?", "antwort": "1,19",
            "typ": "schaetzen", "einheit": "€", "zeit": 90 }
        ] }
      ]
    }

- Pflicht: `frage`, `antwort`. Die Reihenfolge der Fragen ergibt die Punktwerte 100, 200, … 800.
- Optional: `bild`, `sound`, `antwortBild` (Dateiname aus `media/` oder https-Link), `joker`, `typ` (`"schaetzen"`), `einheit`, `zeit` (Sekunden).
- `antwortBild` erscheint erst bei der Auflösung.
- Bei Schätzfragen muss `antwort` eine Zahl sein, sonst kann der Server den Gewinner nicht berechnen (dann wählt ihn der Spielleiter per Klick).
- Dateien in `media/` gehören mit ins GitHub-Repository, sonst fehlen sie auf dem Server.

## Lokal testen
Node.js ab Version 18, dann im Projektordner `npm install` und `npm start`, danach http://localhost:3000 öffnen.

## Online stellen (Render)
Projekt in GitHub aktualisieren, Render deployt automatisch neu. Build Command `npm install`, Start Command `npm start`.
Der Gratis-Server schläft nach etwa 15 Minuten ohne Aufrufe ein und der Spielstand liegt nur im Arbeitsspeicher – also vor dem Spielabend einmal die Seite aufrufen und während des Spiels nicht alle gleichzeitig weggehen.
