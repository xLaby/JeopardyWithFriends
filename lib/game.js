'use strict';
// Spielablauf: Punkte, Joker-Wirkung, Buzzer, Felder oeffnen und aufloesen
const { REVEAL_MULT, STREAK_EVERY } = require('./config');
const hub = require('./hub');
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const V = (...a) => hub.V(...a);
const curQ = (...a) => hub.curQ(...a);
const emitState = (...a) => hub.emitState(...a);
const key = (...a) => hub.key(...a);
const notice = (...a) => hub.notice(...a);
const parseNum = (...a) => hub.parseNum(...a);
const player = (...a) => hub.player(...a);
const qOf = (...a) => hub.qOf(...a);
const tileState = (...a) => hub.tileState(...a);

// ---------- Spiellogik ----------
function clearTimers(cur) {
  if (!cur) return;
  Object.values(cur.t).forEach(clearTimeout);
  cur.t = {};
}
function award(room, cur, pid, delta, why) {
  const p = player(room, pid);
  if (!p) return;
  p.score += delta;
  if (delta > p.stats.bestGain) p.stats.bestGain = delta;
  cur.awards.push({ pid, delta, why });
}
// Faktor bei Gewinn: Doppelt x2, Risiko x3
function winMult(cur, pid) {
  const j = cur.joker;
  if (j && j.by === pid) return j.type === 'double' ? 2 : j.type === 'risk' ? 3 : 1;
  return 1;
}
// Gewinn einer Buzzer-/Reveal-/Schaetzfrage inkl. Joker und Reveal-Stufe
function gainFor(room, cur, pid) {
  let m = winMult(cur, pid);
  if (cur.typ === 'reveal') m *= REVEAL_MULT[cur.stage];
  return Math.round(V(room)[cur.row] * m);
}
// Abzug bei falscher Antwort: normal halber Wert, Doppelt voller Wert, Risiko doppelter Wert
function penaltyFor(cur, pid, value) {
  const j = cur.joker;
  if (j && j.by === pid) {
    if (j.type === 'risk') return value * 2;
    if (j.type === 'double') return value;
  }
  return value / 2;
}
function resolveRisk(room, cur) {
  const j = cur.joker;
  if (!j || j.type !== 'risk' || cur.riskDone) return;
  cur.riskDone = true;
  if (!cur.winners.includes(j.by)) award(room, cur, j.by, -V(room)[cur.row] * 2, 'risk');
}
// Richtige Antwort: Serie zaehlen, alle STREAK_EVERY gibt es einen Bonus
function onCorrect(room, cur, pid) {
  const p = player(room, pid);
  if (!p) return;
  p.streak++;
  if (p.streak > p.stats.bestStreak) p.stats.bestStreak = p.streak;
  if (p.streak % STREAK_EVERY === 0) {
    const bonus = V(room)[0];
    award(room, cur, pid, bonus, 'streak');
    notice(room, 'streak', `🔥 ${p.name}: ${p.streak} richtige in Folge, +${bonus} Bonus!`);
  }
}
function grantReward(room, cur) {
  if (!cur.winners.length || !room.jokers.has(key(cur.cat, cur.row))) return;
  cur.reward = true;
  cur.winners.forEach(id => { const p = player(room, id); if (p) p.pendingPick++; });
}
function toReveal(room, cur, result) {
  clearTimers(cur);
  cur.state = 'reveal'; cur.result = result; cur.buzzer = null; cur.window = null; cur.shown = true;
  cur.audio.on = false; cur.deadline = 0; cur.timeUp = false;
  if (cur.typ === 'reveal') cur.stage = 3;
  resolveRisk(room, cur);
}
function startTile(room, cat, row) {
  if (room.phase !== 'game' || room.current) return;
  if (tileState(room, cat, row) !== 'free') return;
  const q = qOf(room, cat, row);
  room.undo = null;
  clearTimeout(room.timer); room.interlude = null;
  room.current = {
    cat, row, typ: q.typ, state: 'reading',
    buzzer: null, locked: new Set(), window: null, deadline: 0, timeUp: false,
    joker: null, riskDone: false, awards: [], winners: [], result: null, reward: false,
    audio: { n: 0, on: false },
    guesses: {}, order: [], revealed: 0, marks: {},
    openedAt: 0, buzzOpen: 0, stage: 0, buzzes: [], shown: false, mini: null,
    t: {}
  };
  emitState(room);
}
// Reveal-Bild: Stufe ergibt sich aus der Zeit seit der Freigabe (4 Stufen ueber "dauer" Sekunden)
function revealStage(room, cur, t) {
  const q = curQ(room, cur);
  return Math.max(0, Math.min(3, Math.floor((t - cur.openedAt) / (q.dauer * 1000 / 4))));
}
// Buzzer-Fenster auswerten: kuerzeste gemessene Reaktionszeit gewinnt
function resolveBuzz(room) {
  const cur = room.current;
  if (!cur || !cur.window || cur.state !== 'open') return;
  const best = cur.window.candidates.sort((a, b) => a.elapsed - b.elapsed)[0];
  cur.buzzes = cur.window.candidates.map(c => ({ pid: c.pid, elapsed: c.elapsed }));
  if (cur.typ === 'reveal' && !curQ(room, cur).sound) cur.stage = revealStage(room, cur, cur.window.at);
  cur.window = null;
  if (!best) return emitState(room);
  const p = player(room, best.pid);
  if (p && (p.stats.fastest == null || best.elapsed < p.stats.fastest)) p.stats.fastest = best.elapsed;
  cur.buzzer = best.pid; cur.state = 'buzzed'; cur.timeUp = false;
  const ms = room.settings.answerTime * 1000;
  cur.deadline = Date.now() + ms;
  cur.t.answer = setTimeout(() => {
    if (room.current === cur && cur.state === 'buzzed') { cur.timeUp = true; emitState(room); }
  }, ms);
  emitState(room);
}
// Schaetzfrage: Zeit vorbei, Antworten werden aufgedeckt (weit weg zuerst, am naechsten dran zuletzt)
function toReview(room, cur) {
  clearTimers(cur);
  const A = parseNum(curQ(room, cur).antwort);
  const ids = Object.keys(cur.guesses);
  if (Number.isFinite(A)) {
    const d = id => Number.isFinite(cur.guesses[id].num) ? Math.abs(cur.guesses[id].num - A) : 1e18;
    ids.sort((a, b) => d(b) - d(a));
  }
  cur.order = ids; cur.revealed = 0; cur.marks = {}; cur.state = ids.length ? 'review' : 'judge';
  cur.audio.on = false; cur.deadline = 0;
}
function applyWinners(room, cur, winners) {
  cur.winners = winners;
  winners.forEach(id => {
    award(room, cur, id, gainFor(room, cur, id), 'correct');
    const p = player(room, id); if (p) { p.stats.correct++; p.stats.guessWins++; }
    onCorrect(room, cur, id);
  });
  toReveal(room, cur, winners.length ? 'correct' : 'none');
  grantReward(room, cur);
}

hub.register({ clearTimers, award, winMult, gainFor, penaltyFor, resolveRisk, onCorrect, grantReward, toReveal, startTile, revealStage, resolveBuzz, toReview, applyWinners });
