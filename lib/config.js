'use strict';
// Konstanten und der Raum-Speicher

const MAX_CATS = 15, MAX_ROWS = 10;
const JOKERS = ['double', 'coffee', 'risk'];
const MAX_JOKERS = 3;          // je Joker-Art nur einer pro Spieler, damit maximal 3
const MINI = ['sortieren', 'zuordnen', 'geo'];        // Mini-Games: alle spielen gleichzeitig, Punkte nach Rang
const isMini = t => MINI.includes(t);
const MINI_TIME = { sortieren: 25, zuordnen: 60, geo: 45 };   // Standardzeit in Sekunden (Sortieren: pro Zug)
const SORT_HEARTS = 3;         // Herzen pro Spieler beim Sortieren (pro Frage mit "herzen" aenderbar)
const RANK_FACTOR = [1, 0.75, 0.5, 0.25];                // Anteil des Feldwerts fuer Platz 1, 2, 3, 4 (danach 0)
const MAX_ITEMS = 10;
const DELAYS = [1, 2, 3, 5];   // Handicap: Buzzer-Verzoegerung in Sekunden (0 = aus)
const THEMES = [               // komplette Designs (Schrift, Formen, Hintergrund, Board- und Buzzer-Layout); c = Vorschaufarben
  { id: 'classic', name: 'Showbühne', d: 'Vorhang, Scheinwerfer, Lichterrahmen, runder Buzzer', c: ['#12081a', '#6b0f24', '#f5b92e'] },
  { id: 'arcade', name: 'Retro-Arcade', d: '8-Bit mit Pixel-Schrift, Scanlines, eckiges Board, Pixel-Buzzer', c: ['#0a0a1e', '#00e5a0', '#ff2e88'] },
  { id: 'scifi', name: 'Sci-Fi Hologramm', d: 'Neon-Linien, Sternenhimmel, Hologramm-Board, Hexagon-Buzzer', c: ['#030b1a', '#0a3a6b', '#19e3ff'] },
  { id: 'comic', name: 'Comic Pop-Art', d: 'Dicke Umrandungen, Rasterpunkte, Comic-Panels, Starburst-Buzzer', c: ['#ffd60a', '#e63946', '#1d4ed8'] },
  { id: 'anime', name: 'Anime', d: 'Pastell, Sterne, Visual-Novel-Textbox, Bubble-Board, Herz-Buzzer', c: ['#ffd9ec', '#b28dff', '#ff5fa8'] }
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

module.exports = { MAX_CATS, MAX_ROWS, JOKERS, MAX_JOKERS, MINI, isMini, MINI_TIME, SORT_HEARTS, RANK_FACTOR, MAX_ITEMS, DELAYS, THEMES, MAX_PHOTO, BUZZ_WINDOW, REVEAL_MULT, SOUND_STAGES, DECIDE_TIME, MAX_UPLOAD, STREAK_EVERY, INTERLUDE_MS, COLORS, AVATARS, rooms };
