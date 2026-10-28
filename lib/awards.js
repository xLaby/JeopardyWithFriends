'use strict';
// Auszeichnungen fuer die Siegerehrung
const { STREAK_EVERY } = require('./config');
const hub = require('./hub');

// ---------- Awards ----------
function computeAwards(room) {
  const ps = room.players;
  if (!ps.length) return [];
  const out = [];
  const best = (get, title, fmt, dir = 1) => {
    const vals = ps.map(p => get(p.stats)).filter(v => v != null);
    if (!vals.length) return;
    const b = dir > 0 ? Math.max(...vals) : Math.min(...vals);
    if (dir > 0 && b <= 0) return;
    out.push({ title, names: ps.filter(p => get(p.stats) === b).map(p => p.name), value: fmt(b) });
  };
  best(s => s.fastest, 'Schnellster Buzzer', v => (v / 1000).toFixed(2).replace('.', ',') + ' s Reaktionszeit', -1);
  best(s => s.correct, 'Treffsicher', v => v + ' richtige Antworten');
  best(s => s.bestGain, 'Jackpot', v => '+' + v + ' auf einen Schlag');
  best(s => s.buzz, 'Dauerdrücker', v => v + ' Mal gebuzzert');
  best(s => s.guessWins, 'Schätzkönig', v => v + ' Schätzfragen gewonnen');
  best(s => s.miniWins, 'Mini-Game-Profi', v => v + ' Mini-Games gewonnen');
  best(s => s.jokers, 'Jokerfreund', v => v + ' Joker eingesetzt');
  best(s => s.bestStreak >= STREAK_EVERY ? s.bestStreak : 0, 'Serientäter', v => v + ' richtige in Folge');
  best(s => s.wrong, 'Mut zur Lücke', v => v + ' Fehlversuche');
  return out;
}


hub.register({ computeAwards });
