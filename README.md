# Quiz Show (Jeopardy-Stil) – Version 4.0

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

## Spielstand sichern und laden
- **Sichern:** Im Spiel (und im Finale) hat der Spielleiter den Knopf „Spielstand sichern" – lädt eine JSON-Datei mit allem herunter: Punkte, Joker, Serie, Board, aktuelle Frage, Einstellungen, Finale-Stand, hochgeladene Medien.
- **Laden:** In der Lobby eines neuen Raums unter „Spielstand laden" die Datei auswählen. Der Raum übernimmt den gesicherten Stand. Ist der alte Raumcode noch frei (typisch nach einem Server-Neustart), bleibt er erhalten und die Spieler müssen nur ihre Seite neu laden. Ist er belegt, bekommt der Raum den neuen Code und die Spieler treten mit ihrem bisherigen Namen erneut bei – Punkte und Joker bleiben.
- **Platz zurückholen:** Wer die Verbindung verliert oder nach einem Neustart auf der Startseite landet, kann im laufenden Spiel mit seinem bisherigen Namen wieder beitreten, solange sein Platz nicht verbunden ist. Code und Name sind dann schon vorausgefüllt.
- Eine laufende Antwort- oder Schätzzeit wird nach dem Laden nicht fortgesetzt; der Spielleiter beendet sie per Knopf.

## Spielgefühl
- **Farbe und Avatar:** Beim Beitreten wählt jeder eine Farbe und ein Emoji (in der Lobby änderbar). Beides erscheint auf Chips, Buzzer, Listen und Siegerehrung.
- **Reaktionszeiten:** Nach jedem Buzz sehen alle, wer wie schnell war („Reaktion: 🦊 Anna 0,38 s · 🐼 Basti 0,41 s"). Gezeigt werden alle, die im 250-ms-Fenster gedrückt haben.
- **Serien-Bonus:** Drei richtige Antworten in Folge geben einen Bonus in Höhe des kleinsten Feldwerts, danach alle weiteren drei wieder. Eine falsche Antwort setzt die Serie zurück, Nicht-Antworten nicht. Spieler mit laufender Serie tragen ein 🔥-Badge.
- **Comeback:** Nach jeder 20. Frage (in der Lobby einstellbar, 0 = aus) bekommt der Letzte eine Jokerwahl – bei Gleichstand alle Letzten.
- **Zwischenstand:** Ist eine Kategorie komplett abgeräumt, erscheint 9 Sekunden lang ein animiertes Ranking bei allen. Der Spielleiter kann es mit „Weiter" früher schließen.
- **Rückgängig:** Der Spielleiter kann die letzte Wertung zurücknehmen (Richtig/Falsch, Überspringen, Schätz-Auswertung, Finale-Auswertung) – auch noch nach „Zurück zum Board", bis die nächste Frage gewählt ist. Punkte, Joker, Serie, Board und Zugreihenfolge werden komplett zurückgesetzt.

## Effekte und Sounds
- **Buzz-Moment:** Wer buzzert, erscheint bei allen eine Sekunde lang groß in seiner Spielerfarbe, die Frage-Karte wackelt kurz.
- **Punkte:** Jede Änderung zählt animiert hoch oder runter, das Delta („+400" / „−200") fliegt vom Chip weg.
- **Richtig/Falsch:** grüner Glow bzw. roter Flash der Karte, kleines Konfetti bei einem gewonnenen Joker-Feld.
- **Ticken** in den letzten drei Sekunden der Antwortzeit.
- **Eigene Sounds:** Liegt in `media/sfx/` eine Datei mit passendem Namen (`buzz.mp3`, `richtig.mp3`, `falsch.mp3`, `joker.mp3`, `zeit.mp3`, `tick.mp3`, `finale.mp3`, `serie.mp3` …, komplette Liste in `media/sfx/LIESMICH.txt`), wird sie statt des eingebauten Synth-Tons gespielt. `lobby.mp3` läuft als Schleife in der Lobby und endet mit dem Spielstart. Fehlt eine Datei, bleibt alles wie bisher.

## Siegerehrung und Awards
Podium plus Awards, die der Server aus dem Spielverlauf berechnet: Schnellster Buzzer (kürzeste Reaktionszeit), Treffsicher, Jackpot (größter Einzelgewinn), Dauerdrücker, Schätzkönig, Jokerfreund, Serientäter (längste Serie), Mut zur Lücke. Bei Gleichstand teilen sich mehrere den Award.

## Buzzer-Fairness
Jedes Gerät misst selbst die Zeit zwischen „Buzzer wird sichtbar" und „Spieler drückt". Der Server sammelt nach dem ersten Buzz noch 250 ms lang weitere und nimmt die kürzeste Reaktionszeit. Wer drückt, bevor der Buzzer frei ist, wird 1 Sekunde gesperrt.

## Mini-Games (neu in Version 4)
Drei neue Fragentypen, bei denen **alle gleichzeitig auf dem eigenen Gerät spielen**. Die Punkte gibt es **nach Rang**: Platz 1 bekommt den vollen Feldwert, Platz 2 75 %, Platz 3 50 %, Platz 4 25 %, alle dahinter nichts. Bei gleichem Ergebnis gewinnt, wer schneller auf „Fertig“ gedrückt hat. Sind alle fertig, wird sofort ausgewertet, sonst nach Ablauf der Zeit oder wenn der Spielleiter „Zeit beenden“ drückt.
- **Sortieren:** Begriffe oder Bilder (auch beides) in die richtige Reihenfolge bringen, per Ziehen am Griff (☰) oder mit ▲▼. Gewertet wird, wie viele an der richtigen Stelle stehen. Optional Beschriftungen für oben und unten (z. B. „älteste zuerst“).
- **Zuordnen:** Paare verbinden (links antippen, dann rechts). Text und Bilder möglich. Gewertet wird die Zahl der richtigen Paare.
- **Geoguessr:** Pin auf einer Weltkarte setzen (ohne Beschriftungen, damit Ortsnamen nichts verraten). Optional ein Bild zur Frage. Wer am nächsten dran ist, gewinnt; bei der Auflösung sieht man alle Pins mit Linien zum Ziel und die Entfernung in km.
- **Joker:** Gelten wie sonst. Doppelt verdoppelt die Punkte, Risiko zählt nur mit Platz 1 (dreifach), sonst gibt es den doppelten Wert als Abzug. Kaffeepause sperrt den Spieler für diese Frage. Joker-Felder geben dem Sieger (Platz 1) einen Joker.
- **Rückgängig:** Die Auswertung lässt sich wie jede andere Wertung zurücknehmen.
- **Kein Sound/Reveal:** Mini-Games laufen immer mit Zeitlimit (Standard 60 s bei Sortieren und Zuordnen, 45 s bei Geoguessr, pro Frage mit `zeit` änderbar).

### Fragen-Editor
Im Editor gibt es beim Typ die drei Mini-Games. Elemente, Paare und Bilder trägst du direkt ein, bei Geoguessr wählst du das Ziel mit „Auf Karte wählen“ (mit Ortssuche). Die Prüfung meldet unvollständige Mini-Games.

### Format in der fragen.json
```json
{ "typ": "sortieren", "frage": "Sortiere nach Alter.", "items": ["Buchdruck", {"text": "Telefon"}, {"bild": "x.jpg"}],
  "anfang": "älteste", "ende": "neueste", "zeit": 60 }
{ "typ": "zuordnen", "frage": "Land und Hauptstadt", "paare": [ {"links": "Deutschland", "rechts": "Berlin"}, {"links": {"bild": "fr.png"}, "rechts": "Paris"} ] }
{ "typ": "geo", "frage": "Wo steht der Eiffelturm?", "antwort": "Paris", "ziel": {"lat": 48.8584, "lng": 2.2945}, "bild": "optional.jpg" }
```
Bei Sortieren steht die **richtige Reihenfolge von oben nach unten** in `items` (die Spieler sehen sie gemischt). Es sind 2 bis 8 Elemente bzw. Paare möglich. Ein Beispielpaket zum Ausprobieren ist `beispiel-minigames.json` (in der Lobby beim Hochladen verlinkt).

**Hinweis Karte:** Die Karte nutzt Leaflet (liegt im Projekt unter `public/vendor/leaflet`) und lädt die Kartenkacheln von CARTO/OpenStreetMap aus dem Internet. Die Spieler brauchen dafür eine Internetverbindung, wie für die Schriften auch.

## Designs
In der Lobby gibt es ein Panel **Design**. Jedes Design ändert nicht nur die Farben, sondern das ganze Grunddesign: Schrift, Formen, Hintergrund, Animationen sowie das Layout von Board und Buzzer.
- **Showbühne** (Standard): Vorhang, Scheinwerfer, Lichterrahmen, runder Buzzer.
- **Retro-Arcade:** 8-Bit mit Pixel-Schrift, Scanlines, eckiges Board mit blinkenden Feldern, Pixel-Buzzer.
- **Sci-Fi Hologramm:** Neon-Linien, Sternenhimmel mit Raster, Datenleisten als Kategorien, abgeschrägte Felder, Hexagon-Buzzer, Frage klappt als Hologramm auf.
- **Comic Pop-Art:** dicke Umrandungen, Rasterpunkte, leicht gekippte Panels, Starburst-Buzzer.
- **Anime:** Pastell mit Sternchen, Bubble-Board, Frage als Visual-Novel-Textbox am unteren Rand, Herz-Buzzer.

Der Spielleiter wählt, das Design gilt sofort für alle im Raum und wird beim Spielstand sichern mitgespeichert. Geändert werden kann es nur in der Lobby.

## Profilbilder
Spieler können beim Beitreten oder in der Lobby ein eigenes Bild hochladen (Knopf unter den Emoji-Avataren). Das Bild wird im Browser auf 192×192 Pixel zugeschnitten und als JPEG verkleinert. Es erscheint überall dort, wo sonst das Emoji steht (Chips, Buzz-Anzeige, Listen, Siegerehrung). Ein Emoji auswählen oder „Bild entfernen“ schaltet zurück aufs Emoji.
- Die Bilder liegen nur im Arbeitsspeicher des Servers (wie der Spielstand) und werden beim Spielstand sichern mit in die Datei geschrieben.
- Der Spielleiter kann ein Bild jederzeit im Spieler-Menü (Klick auf den Chip) entfernen.
- Das Bild bleibt im Browser gespeichert und wird beim nächsten Beitreten automatisch wieder verwendet.

## Handicap (Debuff durch den Spielleiter)
Im Spieler-Menü (Klick auf den Chip) gibt es die Zeile **Handicap** mit 🐢 **Buzzer-Verzögerung** 1 / 2 / 3 / 5 s. Das Handicap bleibt, bis der Spielleiter es wieder abschaltet (erneuter Klick auf den aktiven Wert oder „Aus"), und ist für alle als Badge am Chip sichtbar.
- Der Buzzer des Spielers wird erst entsprechend später frei, mit Countdown auf seinem Knopf. Der Server erzwingt das: Buzzes während der Verzögerung werden ignoriert.
- Gilt für Buzzer- und Reveal-Fragen, nicht für Schätzfragen und Finale. Öffnet der Buzzer nach einer falschen Antwort erneut, gilt die Verzögerung wieder ab diesem Moment.
- Die Verzögerung bleibt beim Spielstand sichern und laden erhalten.

## Joker
Joker gewinnt man, indem man ein **Joker-Feld** richtig beantwortet. Der Spieler sucht sich dann einen Joker aus. **Jede Art gibt es nur einmal pro Spieler** (also maximal 3 im Besitz): Besessene Arten sind in der Auswahl ausgegraut, und auch der Spielleiter kann sie nicht doppelt vergeben. Wer alle drei hat, behält die offene Wahl, bis er einen einsetzt. Joker werden gesetzt, solange die Frage vorgelesen wird, und wirken auf genau diese Frage:

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
Der Gratis-Server schläft nach etwa 15 Minuten ohne Aufrufe ein; verbundene Spieler halten ihn über einen kleinen Ping alle 5 Minuten wach. Der Spielstand liegt nur im Arbeitsspeicher – vor dem Spielabend einmal die Seite aufrufen und zwischendurch „Spielstand sichern“ drücken.
Nach jedem Update die Versionsnummer in `public/index.html` und `public/editor.html` (`?v=12`) hochzählen, dann holen alle Browser garantiert die neuen Dateien.
