'use strict';
// Finale mit verdecktem Einsatz
const { DECIDE_TIME } = require('./config');
const hub = require('./hub');
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const award = (...a) => hub.award(...a);
const clearTimers = (...a) => hub.clearTimers(...a);
const curQ = (...a) => hub.curQ(...a);
const emitState = (...a) => hub.emitState(...a);
const player = (...a) => hub.player(...a);

// ---------- Finale ----------
// Ablauf pro Frage: intro (Host liest vor) -> decide (20 s: Spielen oder Aussetzen) -> play (Einsatz + Antwort, Schaetzzeit)
//                   -> review (Aufdecken vom Letzten zum Ersten) -> reveal (Zusammenfassung)
const maxWager = p => p.score > 0 ? p.score : 100;   // wer im Minus ist, darf trotzdem 100 setzen
function startFinale(room) {
  if (!room.data.finale || room.current) return;
  room.phase = 'finale';
  room.fin = { idx: -1 };
  emitState(room);
}
function finaleNext(room) {
  const fin = room.data.finale;
  if (room.current && room.current.state !== 'reveal') return;
  clearTimers(room.current);
  room.undo = null;
  room.fin.idx++;
  if (room.fin.idx >= fin.fragen.length) { room.current = null; room.phase = 'end'; return emitState(room); }
  room.current = {
    typ: 'finale', idx: room.fin.idx, state: 'intro',
    decision: {}, participants: [], wagers: {}, answers: {}, review: null, awards: [], result: null,
    deadline: 0, audio: { n: 0, on: false }, t: {}
  };
  emitState(room);
}
// Frage zeigen: alle sehen sie, 20 s Entscheidung
function finToDecide(room, cur) {
  clearTimers(cur);
  const q = curQ(room, cur);
  cur.state = 'decide';
  if (q.sound) cur.audio = { n: cur.audio.n + 1, on: true };
  cur.deadline = Date.now() + DECIDE_TIME * 1000;
  cur.t.decide = setTimeout(() => { if (room.current === cur && cur.state === 'decide') { finToPlay(room, cur); emitState(room); } }, DECIDE_TIME * 1000);
}
// Wer spielt, setzt Einsatz und Antwort in einem Fenster
function finToPlay(room, cur) {
  clearTimers(cur);
  cur.participants = room.players.filter(p => cur.decision[p.id] === true).map(p => p.id);
  if (!cur.participants.length) {
    cur.state = 'reveal'; cur.result = 'none'; cur.deadline = 0; cur.audio.on = false;
    cur.review = { order: [], i: 0, stage: 0, judged: {} };
    return;
  }
  const q = curQ(room, cur);
  cur.state = 'play';
  const ms = (q.zeit || room.settings.guessTime) * 1000;
  cur.deadline = Date.now() + ms;
  cur.t.play = setTimeout(() => { if (room.current === cur && cur.state === 'play') { finToReview(room, cur); emitState(room); } }, ms);
}
function finToReview(room, cur) {
  clearTimers(cur);
  cur.state = 'review'; cur.deadline = 0; cur.audio.on = false;
  const order = room.players.filter(p => cur.participants.includes(p.id)).sort((a, b) => a.score - b.score).map(p => p.id);   // vom Letzten zum Ersten
  cur.review = { order, revealed: 0, marks: {}, judged: {} };
  if (!order.length) { cur.state = 'reveal'; cur.result = 'done'; }
}
// Alle Antworten offen -> Spielleiter bewertet jede Zeile selbst. Einzige Vorgabe: keine Antwort = falsch (umschaltbar)
function finToJudge(room, cur) {
  cur.state = 'judge';
  cur.review.order.forEach(pid => { if (!(cur.answers[pid] || '').trim()) cur.review.marks[pid] = false; });
}
// Auswerten: Einsaetze aufdecken und auf einmal verrechnen
function finResolve(room, cur) {
  const r = cur.review;
  r.order.forEach(pid => {
    const p = player(room, pid), correct = r.marks[pid] === true, w = cur.wagers[pid] || 0;
    if (p) {
      award(room, cur, pid, correct ? w : -w, correct ? 'correct' : 'wrong');
      if (correct) p.stats.correct++; else p.stats.wrong++;
    }
    r.judged[pid] = { correct, wager: w, answer: cur.answers[pid] || '' };
  });
  cur.state = 'reveal'; cur.result = 'done';
}


hub.register({ maxWager, startFinale, finaleNext, finToDecide, finToPlay, finToReview, finToJudge, finResolve });
