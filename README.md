# Jeopardy-Quiz mit Lobby und Buzzer

Ein Host leitet das Spiel und sieht das Board. Spieler treten im Browser mit Raumcode und Namen bei und buzzern auf dem Handy oder PC. Es muss nichts heruntergeladen werden.

## Ablauf eines Spiels
1. Host öffnet die Seite und wählt "Neuen Raum erstellen". Es erscheint ein Raumcode (z. B. KXQ7) und ein Link.
2. Spieler öffnen den Link oder geben den Code ein und tragen ihren Namen ein.
3. Host startet das Spiel und klickt ein Feld an. Die Frage erscheint bei allen.
4. Host liest die Frage vor und gibt den Buzzer frei. Wer zuerst drückt, antwortet.
5. Host wählt "Richtig" (Punkte dazu) oder "Falsch" (Punkte weg, Spieler ist für diese Frage gesperrt, Buzzer geht wieder auf).
6. Host klickt auf einen Spielernamen, um Punkte von Hand zu ändern oder festzulegen, wer am Zug ist (Feld leer lassen).

Verbindungsabbrüche sind kein Problem: Wer die Seite neu lädt, ist automatisch wieder im Raum.

## Fragen eintragen
Die Datei `fragen.json` enthält bis zu 12 Kategorien mit je bis zu 9 Fragen (für 200 bis 1000 Punkte, in dieser Reihenfolge):

    { "kategorien": [ { "name": "Geografie", "fragen": [ { "frage": "...", "antwort": "..." } ] } ] }

Du kannst die Datei in der Lobby direkt hochladen, ohne den Server neu zu deployen.

## Lokal testen
Node.js (ab Version 18) installieren, dann im Projektordner:

    npm install
    npm start

Dann http://localhost:3000 öffnen.

## Online stellen (kostenlos mit Render)
1. Den Projektordner in ein neues GitHub-Repository hochladen (ohne `node_modules`).
2. Auf render.com mit GitHub anmelden, "New", "Web Service", das Repository wählen.
3. Build Command: `npm install`, Start Command: `npm start`, Instance Type: Free.
4. Nach dem Deploy bekommst du eine Adresse wie https://dein-quiz.onrender.com. Die gibst du an alle weiter.

Hinweise zum Gratis-Tarif:
- Der Server schläft nach etwa 15 Minuten ohne Aufrufe ein. Öffne die Seite etwa 5 Minuten vor dem Spiel, damit er wach ist.
- Der Spielstand liegt nur im Arbeitsspeicher. Bei einem Neustart des Servers ist der Raum weg.
