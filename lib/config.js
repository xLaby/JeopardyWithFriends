'use strict';
// Konstanten und der Raum-Speicher

const MAX_CATS = 15, MAX_ROWS = 10;
const MAX_TEAM = 12;   // Mitglieder pro Team (Teams: bis zu 30, wie vorher bei Spielern)
const JOKERS = ['double', 'coffee', 'risk'];
const MAX_JOKERS = 3;          // je Joker-Art nur einer pro Spieler, damit maximal 3
const MINI = ['sortieren', 'zuordnen', 'geo'];        // Mini-Games: alle spielen gleichzeitig, Punkte nach Rang
const isMini = t => MINI.includes(t);
const MINI_TIME = { sortieren: 0, zuordnen: 0, geo: 0 };   // Standardzeit in Sekunden: 0 = kein Limit (Sortieren: pro Zug). Ein Limit gilt nur, wenn die Frage "zeit" hat.
const SORT_HEARTS = 3;         // Herzen pro Spieler beim Sortieren (pro Frage mit "herzen" aenderbar)
const RANK_FACTOR = [1, 0.75, 0.5, 0.25];                // Anteil des Feldwerts fuer Platz 1, 2, 3, 4 (danach 0)
const MAX_ITEMS = 10;
const DELAYS = [1, 2, 3, 5];   // Handicap: Buzzer-Verzoegerung in Sekunden (0 = aus)
const THEMES = [               // komplette Designs (Schrift, Formen, Hintergrund, Board- und Buzzer-Layout); c = Vorschaufarben
  { id: 'classic', name: 'Showbühne', d: 'Vorhang, Scheinwerfer, Lichterrahmen, runder Buzzer', c: ['#12081a', '#6b0f24', '#f5b92e'] },
  { id: 'neon', name: 'Neon', d: 'Leuchtröhren auf dunkler Backsteinwand: Neon-Rahmen in Cyan und Pink', c: ['#0d0618', '#ff3ad2', '#35e6ff'] },
  { id: 'future', name: 'Rot / Future', d: 'Dunkles Rot mit orangem Text, kantige Rahmen, Chevron-Knöpfe', c: ['#240814', '#ff4d6d', '#ffae5f'] },
  { id: 'primetime', name: 'Prime-Time', d: 'Dunkelblau mit Punktraster, Sechseck-Frage und runden Pillen wie in großen TV-Quizshows', c: ['#080b2e', '#3a2f9b', '#ff8fd8'] }
];
const MAX_PHOTO = 90 * 1024;
const BUZZ_WINDOW = 250;       // ms: nach dem ersten Buzz werden weitere gesammelt, kuerzeste Reaktionszeit gewinnt
const REVEAL_MULT = [2, 1.5, 1.25, 1];   // Punktfaktor je Reveal-Stufe (frueh buzzern lohnt sich)
const SOUND_STAGES = [2, 5, 10, 0];      // Sekunden pro Sound-Stufe, 0 = komplett
const DECIDE_TIME = 20;        // Sekunden, um sich bei einer Finalfrage fuer Spielen oder Aussetzen zu entscheiden
const MAX_UPLOAD = 40 * 1024 * 1024;   // Sofort-Paket: eingebettete Medien insgesamt
const STREAK_EVERY = 3;        // alle drei richtigen Antworten in Folge gibt es einen Bonus (kleinster Feldwert)
const INTERLUDE_MS = 9000;     // Zwischenstand nach einer abgeraeumten Kategorie
const COLORS = ['#e0443a', '#f5b92e', '#41c27a', '#3b9ddd', '#a86be0', '#ff9ad5', '#ff8a3c', '#2ec4b6', '#c9b8a0', '#8ff0b8', '#ffe08a', '#6b8cff'];
const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐧', '🐯', '🐨', '🦉', '🐵', '🐺', '🦖', '🐢', '🦋', '🐝', '🍕', '🎸', '🚀', '🎲', '🧙', '🤖', '👽', '🍩'];
const rooms = new Map();

module.exports = { MAX_TEAM, MAX_CATS, MAX_ROWS, JOKERS, MAX_JOKERS, MINI, isMini, MINI_TIME, SORT_HEARTS, RANK_FACTOR, MAX_ITEMS, DELAYS, THEMES, MAX_PHOTO, BUZZ_WINDOW, REVEAL_MULT, SOUND_STAGES, DECIDE_TIME, MAX_UPLOAD, STREAK_EVERY, INTERLUDE_MS, COLORS, AVATARS, rooms };
