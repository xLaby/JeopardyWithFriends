# Quiz Show (Jeopardy-Stil) mit Lobby, Buzzer, Medien und Power-ups

Ein Host leitet das Spiel, Spieler treten im Browser mit Raumcode bei. Es muss nichts heruntergeladen werden.

## Spielregeln
- Am Zug ist der Gewinner der letzten Frage und wählt das nächste Feld auf seinem eigenen Board. Der Host kann jederzeit selbst wählen oder per Klick auf einen Spielernamen festlegen, wer am Zug ist (Eingabe leer lassen).
- Richtig beantwortet gibt den vollen Fragenwert, falsch zieht die Hälfte ab. Wer falsch liegt, ist für diese Frage gesperrt.
- Joker-Felder sehen aus wie normale Felder. Wer dort richtig antwortet, bekommt zufällig ein Power-up.
- Power-ups (werden eingesetzt, solange die Frage vorgelesen wird, vor Buzzer-Freigabe):
  - Doppelte Punkte: gilt für den Spieler bei dieser Frage, auch bei falscher Antwort (Abzug dann ebenfalls doppelt).
  - Aussetzen: ein gewählter Mitspieler darf bei dieser Frage nicht buzzern.
- Optional in der Lobby: Anzahl der Joker-Felder und "Antworten eintippen" (der gebuzzerte Spieler tippt, alle sehen die Antwort).

## Fragen, Bilder und Sounds
Die Datei `fragen.json` (oder Upload in der Lobby) hat bis zu 12 Kategorien mit je bis zu 9 Fragen für 200 bis 1000 Punkte:

    {
      "titel": "Mein Quiz",
      "kategorien": [
        { "name": "Orte", "fragen": [
          { "frage": "Woher kommt dieser Ort?", "antwort": "Island",
            "bild": "ort1.jpg", "antwortBild": "ort1-karte.jpg" },
          { "frage": "Welcher Film?", "antwort": "Star Wars", "sound": "intro1.mp3", "joker": true }
        ] }
      ]
    }

- `bild`, `sound` und `antwortBild` sind optional. Eintragen kannst du entweder einen Dateinamen aus dem Ordner `media/` oder einen vollständigen https-Link.
- `antwortBild` erscheint erst bei der Auflösung. `joker: true` macht das Feld fest zum Joker-Feld (sonst werden Joker-Felder zufällig verteilt).
- Den Sound startet der Host mit einem Knopf, er läuft dann bei allen Spielern. Spieler müssen einmal auf die Seite getippt haben, sonst blockieren Handys das Abspielen. Dafür gibt es bei Bedarf einen Knopf "Sound starten".
- Dateien im Ordner `media/` gehören mit ins GitHub-Repository, sonst fehlen sie auf dem Server.

## Lokal testen
Node.js ab Version 18, dann im Projektordner `npm install` und `npm start`, danach http://localhost:3000 öffnen.

## Online stellen (Render)
Wie bisher: Projekt in GitHub aktualisieren, Render deployt automatisch neu. Build Command `npm install`, Start Command `npm start`. Der Gratis-Server schläft nach etwa 15 Minuten ohne Aufrufe ein, und der Spielstand liegt nur im Arbeitsspeicher.
