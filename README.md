# Quiz Show (Jeopardy-Stil) – Version 3.4

Ein Spielleiter leitet das Spiel, Spieler treten im Browser mit Raumcode bei. Es muss nichts heruntergeladen werden.
Board: bis zu 15 Kategorien × 10 Stufen, Punktwerte frei wählbar (Standard 100 bis 800).

## Ablauf einer Frage
1. **Wählen:** Die Spieler sind in fester Reihenfolge dran (Beitrittsreihenfolge, in der Lobby per ▲▼ sortierbar). Wer dran ist, klickt ein Feld. Der Spielleiter kann jederzeit selbst wählen.
2. **Vorlesen:** Nur der Spielleiter sieht die Frage. Die Spieler sehen Kategorie und Punktwert – und können jetzt einen Joker setzen (**einer pro Frage**, wer zuerst kommt).
3. **Freigeben:** Bei normalen Buzzer-Fragen gibt es zwei Schritte: „Buzzer freigeben" öffnet nur den Buzzer – die Spieler dürfen schon während des Vorlesens drücken, sehen die Frage aber noch nicht. „Frage einblenden" zeigt Text, Bild und Sound (geht vor, während oder nach einem Buzz). „Buzzer + Frage freigeben" macht beides in einem Klick. Bei Reveal- und Schätzfragen wird die Frage mit der Freigabe sofort sichtbar.
4. **Antworten:** siehe Fragentypen unten.
5. **Auflösung → Zurück zum Board:** das Feld ist verbraucht, der nächste Spieler ist dran. Ist das Board leer, beginnt das Finale (falls vorhanden), sonst die Siegerehrung.

## Fragentypen
**Buzzer (Standard):** Wer zuerst drückt, antwortet mündlich. Danach läuft ein Timer (Standard 10 s). Bei 0 ertönt ein Signal und der Falsch-Knopf blinkt – der Spielleiter entscheidet trotzdem selbst.
Richtig = voller Wert. Falsch = halber Wert Abzug, und der Spieler ist für diese Frage gesperrt. Dann geht der Buzzer für die anderen wieder auf.

**Schätzfrage** (`"typ": "schaetzen"`): Alle tippen eine Zahl ein (90 s, pro Frage per `"zeit"` änderbar). Der Spielleiter sieht die Schätzungen live und kann die Zeit vorzeitig beenden. Danach deckt er die Antworten einzeln auf (die am weitesten entfernte zuerst), ohne Bewertung. Sind alle offen, markiert er jede Schätzung mit ✓ (Gewinner) oder ✗ – ohne Vorgaben vom Server, mehrere Gewinner sind möglich. Die Spieler sehen die Markierungen live. „Auswerten" geht erst, wenn alle Zeilen markiert sind; jeder Gewinner bekommt den vollen Feldwert, alle anderen 0 – kein Abzug. Rückgängig nimmt die Auswertung zurück.
Eingaben wie `1.200`, `12,50` oder `ca. 300 €` werden verstanden; die Reihenfolge beim Aufdecken richtet sich nach dem Abstand zur hinterlegten Antwort.

**Reveal** (`"typ": "reveal"`, braucht `bild` oder `sound`): Je früher gebuzzert wird, desto mehr Punkte – vier Stufen mit Faktor **×2 → ×1,5 → ×1,25 → ×1**. Der Abzug bei falscher Antwort bleibt der normale halbe Wert.
- *Mit Bild:* Das Bild startet stark verpixelt und wird automatisch schärfer, über `"dauer"` Sekunden (Standard 20). Das Verpixeln passiert im Browser, der Server merkt sich nur den Buzz-Zeitpunkt.
- *Mit Sound:* Erst 2 s, dann 5 s, dann 10 s, dann komplett – der Spielleiter schaltet per „Länger abspielen" weiter.

## Finale mit Einsatz
Ein optionaler Block `"finale"` mit beliebig vielen Fragen. Es startet automatisch, wenn das Board leer ist, oder jederzeit über „Finale starten". Ablauf pro Frage:
1. **Vorlesen:** Nur der Spielleiter sieht die Frage.
2. **Frage zeigen → Entscheiden (20 s):** Alle sehen die Frage und wählen „Spielen" oder „Aussetzen". Der Spielleiter sieht live, wer was gewählt hat; die Spieler sehen nur, wie viele sich schon entschieden haben. Haben alle gewählt, geht es sofort weiter. Wer sich nicht entscheidet, setzt aus.
3. **Spielen (Schätz-/Finalzeit, Standard 90 s):** Wer mitspielt, setzt in einem Fenster seinen Einsatz (0 bis Punktestand; im Minus bis 100) und tippt seine Antwort. Beides ist bis zum Ende änderbar. Aussetzer sehen zu, ohne etwas zu gewinnen oder zu verlieren.
4. **Aufdecken** vom Letzten zum Ersten: Klick für Klick eine Antwort, ohne Bewertung. Einsätze bleiben verdeckt.
5. **Bewerten:** Sind alle Antworten offen, markiert der Spielleiter jede Zeile mit ✓ oder ✗ – ohne Vorgaben vom Server, mehrere ✓ sind möglich. Die Spieler sehen die Markierungen live, können aber nichts tun. Einzige Voreinstellung: Wer gespielt, aber nichts geantwortet hat, steht auf ✗ (umschaltbar).
6. **Auswerten:** Erst wenn alle Zeilen bewertet sind, deckt ein Klick die Einsätze auf und verrechnet sie auf einmal. Rückgängig nimmt die ganze Auswertung zurück.
7. **Nächste Finalfrage** oder Siegerehrung.

## Spielgefühl
- **Farbe und Avatar:** Beim Beitreten wählt jeder eine Farbe und ein Emoji (in der Lobby änderbar). Beides erscheint auf Chips, Buzzer, Listen und Siegerehrung.
- **Reaktionszeiten:** Nach jedem Buzz sehen alle, wer wie schnell war („Reaktion: 🦊 Anna 0,38 s · 🐼 Basti 0,41 s"). Gezeigt werden alle, die im 250-ms-Fenster gedrückt haben.
- **Serien-Bonus:** Drei richtige Antworten in Folge geben einen Bonus in Höhe des kleinsten Feldwerts, danach alle weiteren drei wieder. Eine falsche Antwort setzt die Serie zurück, Nicht-Antworten nicht. Spieler mit laufender Serie tragen ein 🔥-Badge.
- **Comeback:** Nach jeder 20. Frage (in der Lobby einstellbar, 0 = aus) bekommt der Letzte eine Jokerwahl – bei Gleichstand alle Letzten.
- **Zwischenstand:** Ist eine Kategorie komplett abgeräumt, erscheint 9 Sekunden lang ein animiertes Ranking bei allen. Der Spielleiter kann es mit „Weiter" früher schließen.
- **Rückgängig:** Der Spielleiter kann die letzte Wertung zurücknehmen (Richtig/Falsch, Überspringen, Schätz-Auswertung, Finale-Auswertung) – auch noch nach „Zurück zum Board", bis die nächste Frage gewählt ist. Punkte, Joker, Serie, Board und Zugreihenfolge werden komplett zurückgesetzt.

## Siegerehrung und Awards
Podium plus Awards, die der Server aus dem Spielverlauf berechnet: Schnellster Buzzer (kürzeste Reaktionszeit), Treffsicher, Jackpot (größter Einzelgewinn), Dauerdrücker, Schätzkönig, Jokerfreund, Serientäter (längste Serie), Mut zur Lücke. Bei Gleichstand teilen sich mehrere den Award.

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

## Fragen-Editor (im Browser)
Unter `/editor.html` (Link auf der Startseite und in der Lobby) gibt es einen Editor für komplette Fragenpakete: Kategorien, Punktwerte, alle Fragentypen, Joker-Felder, Finale, Bilder und Sounds per Datei oder https-Link. Bilder werden automatisch auf 1280 px verkleinert und als JPEG gespeichert. Der Entwurf wird im Browser gespeichert (Text im localStorage, Dateien in der IndexedDB) – nichts geht an den Server, bis du exportierst.

Zwei Export-Wege:
- **Repo-Paket (ZIP):** `fragen.json` + `media/`. Ins Projekt entpacken, committen, pushen. **Dauerhaft** – das ist der Normalfall.
- **Sofort-Paket (`.quiz.json`):** eine Datei mit eingebetteten Medien, Upload in der Lobby unter „Fragen". Die Medien liegen danach **nur im Arbeitsspeicher des Servers**: Nach einem Neustart oder wenn der Gratis-Server einschläft, sind sie weg und das Paket muss vor dem nächsten Spiel neu hochgeladen werden. Maximal 40 MB. Die Lobby warnt beim Upload.

„Paket laden" liest `fragen.json`, `.quiz.json` und Repo-ZIPs wieder ein. Die Prüfung rechts unten listet fehlende Antworten, Schätzfragen ohne Zahl, fehlende Dateien und Lücken im Board auf – Klick springt zur Stelle.

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
- Bei Schätzfragen sollte `antwort` eine Zahl sein – sie bestimmt die Reihenfolge beim Aufdecken. Gewinner bestimmt der Spielleiter ohnehin selbst.
- Dateien in `media/` gehören mit ins GitHub-Repository, sonst fehlen sie auf dem Server.

## Lokal testen
Node.js ab Version 18, dann im Projektordner `npm install` und `npm start`, danach http://localhost:3000 öffnen.

## Online stellen (Render)
Projekt in GitHub aktualisieren, Render deployt automatisch neu. Build Command `npm install`, Start Command `npm start`.
Der Gratis-Server schläft nach etwa 15 Minuten ohne Aufrufe ein; verbundene Spieler halten ihn über einen kleinen Ping alle 5 Minuten wach. Der Spielstand liegt nur im Arbeitsspeicher – vor dem Spielabend einmal die Seite aufrufen.
Nach jedem Update die Versionsnummer in `public/index.html` und `public/editor.html` (`?v=10`) hochzählen, dann holen alle Browser garantiert die neuen Dateien.
