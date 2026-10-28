'use strict';
// Zustand pro Rolle an alle senden, alte Raeume aufraeumen
const { isMini, THEMES, REVEAL_MULT, SOUND_STAGES, COLORS, AVATARS, rooms } = require('./config');
const hub = require('./hub');
const io = hub.io;
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const V = (...a) => hub.V(...a);
const clearTimers = (...a) => hub.clearTimers(...a);
const computeAwards = (...a) => hub.computeAwards(...a);
const curQ = (...a) => hub.curQ(...a);
const key = (...a) => hub.key(...a);
const miniView = (...a) => hub.miniView(...a);
const tileState = (...a) => hub.tileState(...a);

// ---------- State ----------
function stateFor(room, forHost, pid) {
  const cur = room.current;
  let current = null;
  if (cur && cur.typ === 'finale') {
    const q = curQ(room, cur);
    const hidden = !forHost && cur.state === 'intro';
    const r = cur.review;
    let shown = null;
    if (r) {
      shown = {};
      r.order.forEach((pid, i) => {
        if (r.judged[pid]) shown[pid] = r.judged[pid];
        else if (i < r.revealed) shown[pid] = { answer: cur.answers[pid] || '' };
      });
    }
    current = {
      typ: 'finale', idx: cur.idx, total: room.data.finale.fragen.length, catName: room.data.finale.name,
      state: cur.state,
      question: hidden ? '' : q.frage, bild: hidden ? '' : q.bild, sound: hidden ? '' : q.sound, hasSound: !!q.sound,
      audio: cur.audio, left: cur.deadline ? Math.max(0, cur.deadline - Date.now()) : null,
      wagered: Object.keys(cur.wagers), answered: Object.keys(cur.answers),
      wagers: forHost ? cur.wagers : {}, answers: forHost ? cur.answers : {},
      // Entscheidung: Host sieht Namen live, Spieler waehrend der 20 s nur Zahlen, danach alle
      decided: Object.keys(cur.decision).length,
      decision: forHost || cur.state !== 'decide' ? cur.decision : {},
      participants: cur.state === 'decide' ? [] : cur.participants,
      review: r ? { order: r.order, revealed: r.revealed, marks: r.marks, shown } : null,
      awards: cur.awards, result: cur.result
    };
    if (forHost || cur.state === 'reveal') { current.answer = q.antwort; current.ansBild = q.antwortBild; }
  } else if (cur) {
    const q = curQ(room, cur);
    const hidden = !forHost && !cur.shown;   // Spieler sehen die Frage erst, wenn der Host sie einblendet
    const reveal = cur.state === 'reveal';
    current = {
      cat: cur.cat, row: cur.row, value: V(room)[cur.row], typ: cur.typ,
      catName: room.data.kategorien[cur.cat].name,
      question: hidden ? '' : q.frage, bild: hidden ? '' : q.bild, sound: hidden ? '' : q.sound,
      hasSound: !!q.sound, einheit: q.einheit,
      joker: room.jokers.has(key(cur.cat, cur.row)),
      state: cur.state, shown: cur.shown, buzzer: cur.buzzer, pending: !!cur.window, locked: [...cur.locked],
      used: cur.joker, audio: cur.audio, timeUp: cur.timeUp,
      left: cur.deadline && (cur.state === 'buzzed' || cur.state === 'open') ? Math.max(0, cur.deadline - Date.now()) : null,
      result: cur.result, winners: cur.winners, reward: cur.reward, awards: cur.awards,
      buzzes: cur.buzzes, hold: {}
    };
    // Handicap: Restzeit der Buzzer-Verzoegerung je Spieler (nur Buzzer-/Reveal-Fragen, nur solange der Buzzer offen ist)
    if (cur.state === 'open' && (cur.typ === 'buzzer' || cur.typ === 'reveal')) room.players.forEach(p => {
      const left = (cur.buzzOpen || 0) + (p.delay || 0) * 1000 - Date.now();
      if (p.delay && left > 0) current.hold[p.id] = left;
    });
    if (isMini(cur.typ)) current.mini = miniView(room, cur, forHost, pid);
    if (cur.typ === 'reveal') current.reveal = {
      mode: q.sound ? 'sound' : 'bild', stage: cur.stage, dauer: q.dauer,
      elapsed: cur.openedAt ? Date.now() - cur.openedAt : 0, mult: REVEAL_MULT, soundStages: SOUND_STAGES
    };
    if (forHost || reveal) { current.answer = q.antwort; current.ansBild = q.antwortBild; }
    if (cur.typ === 'schaetzen') {
      const order = cur.order.length ? cur.order : Object.keys(cur.guesses);
      const entries = order.map(pid => ({ pid, text: cur.guesses[pid].text }));
      current.guess = {
        count: order.length, guessed: Object.keys(cur.guesses),
        total: cur.order.length, revealed: cur.revealed, marks: cur.marks,
        list: forHost || reveal || cur.state === 'judge' ? entries : cur.state === 'review' ? entries.slice(0, cur.revealed) : []
      };
    }
  }
  let jokerTiles = [];
  if (forHost) jokerTiles = room.phase === 'lobby' ? [...room.fixed] : [...room.jokers].filter(k => !room.used.has(k));
  return {
    code: room.code, phase: room.phase, picker: room.picker, titel: room.data.titel,
    hostOnline: !!room.hostSocket, settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, jokers: p.jokers, delay: p.delay || 0, photo: p.photo ? p.photoV : 0, pending: p.pendingPick,
      color: COLORS[p.color], avatar: AVATARS[p.avatar], streak: p.streak })),
    looks: { colors: COLORS, avatars: AVATARS }, themes: THEMES,
    done: room.done, total: room.data.kategorien.reduce((a, c) => a + c.fragen.length, 0),
    interlude: room.interlude ? { ...room.interlude, left: Math.max(0, room.interlude.until - Date.now()) } : null,
    notices: room.notices.filter(n => Date.now() - n.at < 12000).map(n => ({ id: n.id, kind: n.kind, text: n.text, age: Date.now() - n.at })),
    canUndo: forHost && room.undo ? room.undo.label : null,
    cats: room.data.kategorien.map(c => c.name),
    values: V(room),
    tiles: room.data.kategorien.map((c, ci) => V(room).map((_, ri) => tileState(room, ci, ri))),
    jokerTiles,
    finale: room.data.finale ? { name: room.data.finale.name, count: room.data.finale.fragen.length } : null,
    fin: room.phase === 'finale' ? { idx: room.fin.idx, total: room.data.finale.fragen.length } : null,
    awards: room.phase === 'end' ? computeAwards(room) : [],
    current
  };
}
function emitState(room) {
  room.touched = Date.now();
  if (room.hostSocket) io.to(room.hostSocket).emit('state', stateFor(room, true));
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, false, p.id)); });
}

setInterval(() => {
  const limit = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, r] of rooms) if (r.touched < limit) { clearTimers(r.current); clearTimeout(r.timer); rooms.delete(code); }
}, 10 * 60 * 1000);


hub.register({ stateFor, emitState });
