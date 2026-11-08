'use strict';
// Socket-Ereignisse von Spielleiter und Spielern
const crypto = require('crypto');
const { MAX_TEAM, MAX_CATS, MAX_ROWS, JOKERS, isMini, DELAYS, BUZZ_WINDOW, INTERLUDE_MS, rooms } = require('./config');
const hub = require('./hub');
const io = hub.io;
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const V = (...a) => hub.V(...a);
const applyWinners = (...a) => hub.applyWinners(...a);
const assignJokers = (...a) => hub.assignJokers(...a);
const award = (...a) => hub.award(...a);
const cleanMini = (...a) => hub.cleanMini(...a);
const clearTimers = (...a) => hub.clearTimers(...a);
const curQ = (...a) => hub.curQ(...a);
const defaultData = (...a) => hub.defaultData(...a);
const emitState = (...a) => hub.emitState(...a);
const memberFind = (...a) => hub.memberFind(...a);
const syncConn = (...a) => hub.syncConn(...a);
const teamSockets = (...a) => hub.teamSockets(...a);
const mayAnswer = (...a) => hub.mayAnswer(...a);
const advanceAnswerers = (...a) => hub.advanceAnswerers(...a);
const stateFor = (...a) => hub.stateFor(...a);
const finResolve = (...a) => hub.finResolve(...a);
const finToDecide = (...a) => hub.finToDecide(...a);
const finToJudge = (...a) => hub.finToJudge(...a);
const finToPlay = (...a) => hub.finToPlay(...a);
const finToReview = (...a) => hub.finToReview(...a);
const finaleNext = (...a) => hub.finaleNext(...a);
const finishMini = (...a) => hub.finishMini(...a);
const fixedJokers = (...a) => hub.fixedJokers(...a);
const freeTiles = (...a) => hub.freeTiles(...a);
const gainFor = (...a) => hub.gainFor(...a);
const grantReward = (...a) => hub.grantReward(...a);
const key = (...a) => hub.key(...a);
const maxWager = (...a) => hub.maxWager(...a);
const newCode = (...a) => hub.newCode(...a);
const newStats = (...a) => hub.newStats(...a);
const nextPicker = (...a) => hub.nextPicker(...a);
const normalize = (...a) => hub.normalize(...a);
const notice = (...a) => hub.notice(...a);
const onCorrect = (...a) => hub.onCorrect(...a);
const parseNum = (...a) => hub.parseNum(...a);
const penaltyFor = (...a) => hub.penaltyFor(...a);
const photoFromData = (...a) => hub.photoFromData(...a);
const pickLook = (...a) => hub.pickLook(...a);
const player = (...a) => hub.player(...a);
const qOf = (...a) => hub.qOf(...a);
const resolveBuzz = (...a) => hub.resolveBuzz(...a);
const restore = (...a) => hub.restore(...a);
const setPhoto = (...a) => hub.setPhoto(...a);
const snapshot = (...a) => hub.snapshot(...a);
const sortAdvance = (...a) => hub.sortAdvance(...a);
const sortMove = (...a) => hub.sortMove(...a);
const startFinale = (...a) => hub.startFinale(...a);
const startMini = (...a) => hub.startMini(...a);
const startTile = (...a) => hub.startTile(...a);
const str = (...a) => hub.str(...a);
const themeOk = (...a) => hub.themeOk(...a);
const tileState = (...a) => hub.tileState(...a);
const toReveal = (...a) => hub.toReveal(...a);
const toReview = (...a) => hub.toReview(...a);
const token = (...a) => hub.token(...a);

// ---------- Sockets ----------
io.on('connection', sock => {
  const hostRoom = () => {
    const r = rooms.get(sock.data.code);
    return r && sock.data.role === 'host' && r.hostSocket === sock.id ? r : null;
  };
  const playerRoom = () => {
    const r = rooms.get(sock.data.code);
    return r && sock.data.role === 'player' ? r : null;
  };
  const wrap = cb => (typeof cb === 'function' ? cb : () => {});

  sock.on('host:create', cb => {
    cb = wrap(cb);
    const code = newCode();
    const data = defaultData();
    const room = {
      code, hostToken: token(), hostSocket: sock.id, phase: 'lobby',
      data, players: [], used: new Set(), fixed: fixedJokers(data), jokers: new Set(), current: null,
      picker: null, fin: null, blobs: new Map(), settings: { joker: 5, answerTime: 10, guessTime: 90, comeback: 20, theme: 'classic', teamMode: false, teamAnswer: 'alle' }, touched: Date.now(),
      done: 0, interlude: null, timer: null, notices: [], undo: null
    };
    rooms.set(code, room);
    sock.data = { code, role: 'host' };
    cb({ ok: true, code, token: room.hostToken });
    emitState(room);
  });

  sock.on('host:rejoin', (msg, cb) => {
    cb = wrap(cb);
    const room = rooms.get(str(msg && msg.code).toUpperCase());
    if (!room || room.hostToken !== (msg && msg.token)) return cb({ ok: false });
    room.hostSocket = sock.id;
    sock.data = { code: room.code, role: 'host' };
    cb({ ok: true, code: room.code });
    emitState(room);
  });

  sock.on('host:setQuestions', (data, cb) => {
    cb = wrap(cb);
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return cb({ ok: false, error: 'Nur in der Lobby moeglich.' });
    try {
      room.data = normalize(data);
      room.fixed = fixedJokers(room.data);
      room.blobs = new Map();
      cb({ ok: true }); emitState(room);
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  sock.on('host:setSettings', (s = {}) => {
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return;
    const num = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null; };
    const j = num(s.joker, 0, MAX_CATS * MAX_ROWS), a = num(s.answerTime, 3, 60), g = num(s.guessTime, 10, 600), cb = num(s.comeback, 0, 200);
    if (j !== null) room.settings.joker = j;
    if (cb !== null) room.settings.comeback = cb;
    if (a !== null) room.settings.answerTime = a;
    if (g !== null) room.settings.guessTime = g;
    if (themeOk(s.theme)) room.settings.theme = s.theme;
    if (typeof s.teamMode === 'boolean') room.settings.teamMode = s.teamMode;
    if (s.teamAnswer === 'alle' || s.teamAnswer === 'reihum') room.settings.teamAnswer = s.teamAnswer;
    emitState(room);
  });

  // Joker-Feld per Klick setzen/entfernen (Lobby: fest; im Spiel: direkt, nur freie Felder)
  sock.on('host:toggleJoker', ({ cat, row } = {}) => {
    const room = hostRoom();
    if (!room) return;
    cat = Number(cat); row = Number(row);
    if (!qOf(room, cat, row)) return;
    const k = key(cat, row);
    if (room.phase === 'lobby') {
      room.fixed.has(k) ? room.fixed.delete(k) : room.fixed.add(k);
    } else if (room.phase === 'game' && tileState(room, cat, row) === 'free' && !room.current) {
      room.jokers.has(k) ? room.jokers.delete(k) : room.jokers.add(k);
    } else return;
    emitState(room);
  });

  sock.on('host:move', ({ id, dir } = {}) => {
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return;
    const i = room.players.findIndex(p => p.id === id), j = i + (Number(dir) < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= room.players.length) return;
    [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    emitState(room);
  });

  sock.on('host:start', () => {
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return;
    room.phase = 'game';
    room.done = 0; room.undo = null; room.notices = [];
    assignJokers(room);
    const first = room.players.find(p => p.connected) || room.players[0];
    room.picker = first ? first.id : null;
    emitState(room);
  });

  sock.on('host:pick', ({ cat, row } = {}) => { const r = hostRoom(); if (r) startTile(r, Number(cat), Number(row)); });
  sock.on('player:pick', ({ cat, row } = {}) => {
    const r = playerRoom();
    if (r && r.picker === sock.data.pid) startTile(r, Number(cat), Number(row));
  });

  // Freigabe: Frage wird fuer alle sichtbar, Buzzer bzw. Eingabe geht auf, Sound startet automatisch
  sock.on('player:mini', ({ ans, done } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || !isMini(cur.typ) || cur.typ === 'sortieren' || cur.state !== 'open' || !cur.mini) return;
    const pid = sock.data.pid;
    if (!player(room, pid) || cur.locked.has(pid) || !mayAnswer(room, player(room, pid), sock.data.mid)) return;
    const prev = cur.mini.answers[pid];
    if (prev && prev.done) return;
    const a = ans === undefined ? (prev && prev.ans) : cleanMini(cur, ans);
    if (a == null) return;
    cur.mini.answers[pid] = { ans: a, done: !!done, at: Date.now() - cur.openedAt };
    if (done) {
      const active = room.players.filter(x => x.connected && !cur.locked.has(x.id));
      if (active.length && active.every(x => cur.mini.answers[x.id] && cur.mini.answers[x.id].done)) finishMini(room, cur);   // alle fertig: sofort auswerten
    }
    emitState(room);
  });
  // Sortieren: ein Gegenstand aus dem Pool auf einen freien Platz, nur wer dran ist
  sock.on('player:sortPlace', ({ item, ref, side } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'sortieren' || cur.state !== 'open' || !cur.mini || !cur.mini.sort) return;
    const s = cur.mini.sort, pid = sock.data.pid;
    if (s.turn !== pid || !mayAnswer(room, player(room, pid), sock.data.mid)) return;
    if (side !== 'left' && side !== 'right') return;
    if (!s.truth.includes(item) || s.placed.includes(item)) return;   // Gegenstand muss noch im Pool liegen
    if (!s.placed.includes(ref)) return;                             // Bezug muss schon auf dem Brett liegen
    sortMove(room, cur, pid, item, ref, side);
    emitState(room);
  });
  // Spielleiter: Zug ueberspringen (ohne Herzverlust), z. B. wenn jemand nicht reagiert
  sock.on('host:sortSkip', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'sortieren' || cur.state !== 'open' || !cur.mini || !cur.mini.sort) return;
    sortAdvance(room, cur);
    emitState(room);
  });
  sock.on('host:open', (opts) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur) return;
    if (cur.typ === 'finale') {
      if (cur.state !== 'intro') return;
      finToDecide(room, cur);
      return emitState(room);
    }
    if (cur.state !== 'reading') return;
    const q = curQ(room, cur);
    cur.state = 'open';
    cur.openedAt = Date.now(); cur.buzzOpen = cur.openedAt;
    // Normale Buzzer-Frage: Frage erst auf Wunsch einblenden (der Host liest vor). Reveal und Schaetzen: sofort sichtbar.
    cur.shown = cur.typ !== 'buzzer' || !!(opts && opts.show);
    if (q.sound && cur.shown) cur.audio = { n: cur.audio.n + 1, on: true };
    if (isMini(cur.typ)) startMini(room, cur);
    if (cur.typ === 'schaetzen') {
      const ms = (q.zeit || room.settings.guessTime) * 1000;
      cur.deadline = Date.now() + ms;
      cur.t.guess = setTimeout(() => {
        if (room.current === cur && cur.state === 'open') { toReview(room, cur); emitState(room); }
      }, ms);
    }
    emitState(room);
  });

  // Frage (Text, Bild, Sound) fuer die Spieler einblenden, unabhaengig vom Buzzer
  sock.on('host:show', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.typ === 'finale' || cur.shown || cur.state === 'reveal') return;
    cur.shown = true;
    const q = curQ(room, cur);
    if (q.sound && cur.state !== 'reading') cur.audio = { n: cur.audio.n + 1, on: true };
    emitState(room);
  });

  sock.on('host:sound', ({ on } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state === 'reading' || cur.state === 'reveal' || cur.state === 'intro') return;
    cur.audio = { n: cur.audio.n + (on ? 1 : 0), on: !!on };
    emitState(room);
  });

  // Reveal mit Sound: naechste Stufe (laenger abspielen), nur solange der Buzzer offen ist
  sock.on('host:stage', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'reveal' || cur.state !== 'open' || !curQ(room, cur).sound || cur.stage >= 3) return;
    cur.stage++;
    cur.audio = { n: cur.audio.n + 1, on: true };
    emitState(room);
  });

  // Ein Joker pro Frage, nur solange die Frage vorgelesen wird
  sock.on('player:joker', ({ type, target } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'reading' || cur.joker) return;
    const me = player(room, sock.data.pid);
    if (!me || !JOKERS.includes(type) || !me.jokers.includes(type)) return;
    let t = null;
    if (type === 'coffee') {
      t = player(room, target);
      if (!t || t.id === me.id) return;
      cur.locked.add(t.id);
    }
    me.jokers.splice(me.jokers.indexOf(type), 1);
    me.stats.jokers++;
    cur.joker = { by: me.id, type, target: t ? t.id : null };
    emitState(room);
  });

  // Gewonnenen Joker aussuchen
  sock.on('player:pickJoker', ({ type } = {}) => {
    const room = playerRoom();
    if (!room) return;
    const me = player(room, sock.data.pid);
    if (!me || me.pendingPick < 1 || !JOKERS.includes(type) || me.jokers.includes(type)) return;
    me.jokers.push(type);
    me.pendingPick--;
    emitState(room);
  });

  // Host vergibt oder entfernt Joker manuell
  sock.on('host:giveJoker', ({ id, type } = {}) => {
    const room = hostRoom();
    const p = room && player(room, id);
    if (!p || !JOKERS.includes(type) || p.jokers.includes(type)) return;
    p.jokers.push(type);
    emitState(room);
  });
  // Handicap: Buzzer-Verzoegerung fuer einen Spieler setzen (0 = aus), bleibt bis der Host es abschaltet
  sock.on('host:setHandicap', ({ id, delay } = {}) => {
    const room = hostRoom();
    const p = room && player(room, id);
    const d = Number(delay);
    if (!p || !(d === 0 || DELAYS.includes(d))) return;
    p.delay = d;
    emitState(room);
  });
  sock.on('host:takeJoker', ({ id, type } = {}) => {
    const room = hostRoom();
    const p = room && player(room, id);
    if (!p || !p.jokers.includes(type)) return;
    p.jokers.splice(p.jokers.indexOf(type), 1);
    emitState(room);
  });

  sock.on('player:buzz', ({ elapsed } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || (cur.typ !== 'buzzer' && cur.typ !== 'reveal') || cur.state !== 'open') return;
    const pid = sock.data.pid;
    const me = player(room, pid);
    if (!me || cur.locked.has(pid) || !mayAnswer(room, me, sock.data.mid)) return;
    if (me.delay && Date.now() < (cur.buzzOpen || 0) + me.delay * 1000 - 100) return;   // Handicap: Buzzer fuer diesen Spieler noch gesperrt
    let e = Number(elapsed);
    if (!Number.isFinite(e) || e < 0 || e > 99999) e = 99999;
    if (!cur.window) {
      cur.window = { candidates: [], at: Date.now() };
      cur.t.window = setTimeout(() => resolveBuzz(room), BUZZ_WINDOW);
      emitState(room);   // "pending": Buzzer bei allen kurz gesperrt
    }
    const prior = cur.window.candidates.find(c => c.pid === pid);
    if (!prior) { cur.window.candidates.push({ pid, elapsed: e }); me.stats.buzz++; }
    else if (e < prior.elapsed) prior.elapsed = e;   // mehrere Teammitglieder: die schnellste Zeit zaehlt fuers Team
  });

  // Schaetzung bzw. Finale-Antwort abgeben
  sock.on('player:guess', ({ text } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur) return;
    const pid = sock.data.pid;
    if (!player(room, pid) || !mayAnswer(room, player(room, pid), sock.data.mid)) return;
    if (cur.typ === 'finale') {
      if (cur.state !== 'play' || !cur.participants.includes(pid)) return;
      const t = str(text, 100);
      if (!t) return;
      cur.answers[pid] = t;
    } else {
      if (cur.typ !== 'schaetzen' || cur.state !== 'open' || cur.locked.has(pid)) return;
      const t = str(text, 100);
      if (!t) return;
      cur.guesses[pid] = { text: t, num: parseNum(t) };   // Text ist erlaubt; Zahlen werden fuer die Sortierung nach Naehe ausgewertet
    }
    emitState(room);
  });

  sock.on('player:wager', ({ n } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'finale' || cur.state !== 'play' || !cur.participants.includes(sock.data.pid)) return;
    const p = player(room, sock.data.pid);
    const w = Math.round(Number(n));
    if (!p || !Number.isFinite(w)) return;
    cur.wagers[p.id] = Math.max(0, Math.min(maxWager(p), w));
    emitState(room);
  });

  // Finale: Spielen oder Aussetzen (bis alle entschieden haben oder die Zeit um ist)
  sock.on('player:decide', ({ play } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'finale' || cur.state !== 'decide') return;
    const p = player(room, sock.data.pid);
    if (!p) return;
    cur.decision[p.id] = !!play;
    if (room.players.every(x => !x.connected || cur.decision[x.id] !== undefined)) finToPlay(room, cur);
    emitState(room);
  });

  sock.on('host:judge', ({ correct } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur) return;
    if (cur.typ === 'finale') return;   // im Finale bewertet der Host pro Zeile ueber host:mark
    if ((cur.typ !== 'buzzer' && cur.typ !== 'reveal') || cur.state !== 'buzzed') return;
    const p = player(room, cur.buzzer);
    const value = V(room)[cur.row];
    if (!p) { clearTimeout(cur.t.answer); cur.timeUp = false; cur.deadline = 0; cur.buzzer = null; cur.state = 'open'; cur.buzzOpen = Date.now(); return emitState(room); }
    room.undo = snapshot(room, (correct ? 'Richtig' : 'Falsch') + ' für ' + p.name);
    clearTimeout(cur.t.answer); cur.timeUp = false; cur.deadline = 0;
    if (correct) {
      award(room, cur, p.id, gainFor(room, cur, p.id), 'correct');
      p.stats.correct++;
      cur.winners = [p.id];
      onCorrect(room, cur, p.id);
      toReveal(room, cur, 'correct');
      grantReward(room, cur);
    } else {
      award(room, cur, p.id, -penaltyFor(cur, p.id, value), 'wrong');
      p.stats.wrong++;
      p.streak = 0;
      if (cur.joker && cur.joker.by === p.id && cur.joker.type === 'risk') cur.riskDone = true;
      cur.locked.add(p.id);
      cur.buzzer = null;
      if (room.players.some(x => x.connected && !cur.locked.has(x.id))) { cur.state = 'open'; cur.buzzOpen = Date.now(); }
      else toReveal(room, cur, 'none');
    }
    emitState(room);
  });

  // Ueberspringen: beim Vorlesen = Frage abbrechen (Joker geht zurueck), sonst "niemand weiss es" / "Zeit beenden"
  // Frage jetzt beenden (Zeit beenden / niemand weiss es), auch fuer "noch X Sekunden"
  const skipNow = room => {
    const cur = room.current;
    if (!cur) return;
    if (cur.typ === 'finale') {
      if (cur.state === 'decide') finToPlay(room, cur);
      else if (cur.state === 'play') finToReview(room, cur);
      else return;
      return emitState(room);
    }
    if (cur.state === 'reveal' || cur.state === 'review' || cur.state === 'judge') return;
    room.undo = snapshot(room, cur.state === 'reading' ? 'Frage übersprungen' : cur.typ === 'schaetzen' ? 'Zeit beendet' : 'Niemand weiß es');
    if (cur.state === 'reading') {
      if (cur.joker) {
        const p = player(room, cur.joker.by);
        if (p) { if (p.jokers.includes(cur.joker.type)) p.pendingPick++; else p.jokers.push(cur.joker.type); p.stats.jokers--; }   // schon wieder im Besitz (z. B. vom Host vergeben): freie Wahl statt Doppel
        cur.joker = null; cur.locked.clear();
      }
      toReveal(room, cur, 'skipped');
    } else if (cur.typ === 'schaetzen') toReview(room, cur);
    else if (isMini(cur.typ)) finishMini(room, cur);
    else toReveal(room, cur, 'none');
    emitState(room);
  };
  sock.on('host:skip', () => { const room = hostRoom(); if (room) skipNow(room); });
  // "Noch 5 Sekunden": Countdown fuer alle sichtbar, danach endet die Frage, wenn niemand mehr antwortet (Buzzer offen, Schaetzen, Mini-Games, Finale)
  sock.on('host:grace', ({ secs } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.graceAt) return;
    if (!(cur.typ === 'finale' ? cur.state === 'play' : cur.state === 'open')) return;
    const ms = Math.max(1, Math.min(30, Math.round(Number(secs)) || 5)) * 1000, at = Date.now();
    cur.graceAt = at;
    cur.deadline = cur.deadline ? Math.min(cur.deadline, at + ms) : at + ms;
    cur.timeUp = false;
    cur.t.grace = setTimeout(() => {
      if (room.current !== cur || cur.graceAt !== at || !(cur.typ === 'finale' ? cur.state === 'play' : cur.state === 'open')) return;
      cur.graceAt = 0;
      skipNow(room);
    }, ms);
    emitState(room);
  });

  sock.on('host:revealNext', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur) return;
    if (cur.typ === 'finale') {
      if (cur.state !== 'review') return;
      const r = cur.review;
      if (r.revealed < r.order.length) r.revealed++;
      if (r.revealed >= r.order.length) finToJudge(room, cur);
      return emitState(room);
    }
    if (cur.state !== 'review') return;
    if (cur.revealed < cur.order.length) cur.revealed++;
    if (cur.revealed >= cur.order.length) cur.state = 'judge';
    emitState(room);
  });

  sock.on('host:resolve', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur) return;
    if (cur.typ === 'finale') {
      if (cur.state !== 'judge') return;
      const r = cur.review;
      if (!r.order.every(pid => typeof r.marks[pid] === 'boolean')) return;   // erst wenn alles bewertet ist
      room.undo = snapshot(room, 'Finale: Auswertung von Frage ' + (cur.idx + 1));
      finResolve(room, cur);
      return emitState(room);
    }
    if (cur.typ !== 'schaetzen' || cur.state !== 'judge') return;
    if (!cur.order.every(pid => typeof cur.marks[pid] === 'boolean')) return;   // erst wenn alles bewertet ist
    room.undo = snapshot(room, 'Auswertung der Schätzfrage');
    applyWinners(room, cur, cur.order.filter(pid => cur.marks[pid] === true));
    emitState(room);
  });

  // Finale: Host markiert eine Zeile als richtig/falsch (vor der Auswertung beliebig aenderbar)
  sock.on('host:mark', ({ id, correct } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'judge') return;
    if (cur.typ === 'finale') { if (!cur.review.order.includes(id)) return; cur.review.marks[id] = !!correct; }
    else if (cur.typ === 'schaetzen') { if (!cur.order.includes(id)) return; cur.marks[id] = !!correct; }
    else return;
    emitState(room);
  });

  sock.on('host:close', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'reveal') return;
    advanceAnswerers(room);   // naechste Frage: naechstes Teammitglied ist Antwortgeber (nur Modus "reihum")
    if (cur.typ === 'finale') return finaleNext(room);
    room.used.add(key(cur.cat, cur.row));
    room.current = null;
    room.picker = nextPicker(room);
    room.done++;
    const left = freeTiles(room);
    // Comeback: alle N Fragen bekommt der Letzte eine Jokerwahl
    const every = room.settings.comeback;
    if (every > 0 && room.done % every === 0 && room.players.length > 1 && left > 0) {
      const min = Math.min(...room.players.map(p => p.score));
      const last = room.players.filter(p => p.score === min);
      last.forEach(p => p.pendingPick++);
      notice(room, 'comeback', `Comeback! ${last.map(p => p.name).join(' und ')} ${last.length > 1 ? 'liegen' : 'liegt'} hinten und ${last.length > 1 ? 'dürfen' : 'darf'} sich einen Joker aussuchen.`);
    }
    // Kategorie abgeraeumt -> Zwischenstand einblenden
    const catDone = room.data.kategorien[cur.cat].fragen.every((_, ri) => room.used.has(key(cur.cat, ri)));
    if (catDone && left > 0) {
      room.interlude = { cat: room.data.kategorien[cur.cat].name, until: Date.now() + INTERLUDE_MS };
      clearTimeout(room.timer);
      room.timer = setTimeout(() => { room.interlude = null; emitState(room); }, INTERLUDE_MS);
    }
    if (left === 0) { if (room.data.finale) return startFinale(room); room.phase = 'end'; }
    emitState(room);
  });

  sock.on('host:finale', () => { const room = hostRoom(); if (room && room.phase === 'game') startFinale(room); });

  // Letzte Wertung zurueeknehmen (gilt bis zur naechsten Frage)
  sock.on('host:undo', () => {
    const room = hostRoom();
    if (!room || !room.undo) return;
    restore(room, room.undo);
    emitState(room);
  });
  sock.on('host:dismiss', () => {
    const room = hostRoom();
    if (!room || !room.interlude) return;
    clearTimeout(room.timer); room.interlude = null;
    emitState(room);
  });
  sock.on('player:photo', ({ data } = {}) => {
    const room = playerRoom();
    const p = room && player(room, sock.data.pid);
    if (!p) return;
    if (data === null) setPhoto(p, null);
    else { const b = photoFromData(data); if (!b) return; setPhoto(p, b); }
    emitState(room);
  });
  // Moderation: der Spielleiter kann ein Profilbild entfernen
  sock.on('host:removePhoto', ({ id } = {}) => {
    const room = hostRoom();
    const p = room && player(room, id);
    if (!p || !p.photo) return;
    setPhoto(p, null);
    emitState(room);
  });
  sock.on('player:look', ({ color, avatar } = {}) => {
    const room = playerRoom();
    const p = room && player(room, sock.data.pid);
    if (!p) return;
    Object.assign(p, pickLook(room, color, avatar));
    emitState(room);
  });
  sock.on('host:finaleNext', () => { const room = hostRoom(); if (room && room.phase === 'finale') finaleNext(room); });

  sock.on('host:adjust', ({ id, delta } = {}) => {
    const room = hostRoom();
    const p = room && player(room, id);
    const d = Number(delta);
    if (!p || !Number.isFinite(d)) return;
    p.score += Math.round(d);
    emitState(room);
  });

  sock.on('host:setPicker', ({ id } = {}) => {
    const room = hostRoom();
    if (!room || !player(room, id)) return;
    room.picker = id;
    emitState(room);
  });

  // Ein einzelnes Mitglied aus einem Team entfernen (das letzte Mitglied: ganzes Team)
  sock.on('host:kickMember', ({ id, mid } = {}) => {
    const room = hostRoom();
    const p = room && player(room, id);
    const m = p && p.members.find(x => x.id === mid);
    if (!m) return;
    if (p.members.length === 1) return kickTeam({ id });
    if (m.socketId) io.to(m.socketId).emit('kicked');
    p.members = p.members.filter(x => x.id !== mid);
    p.turn = (p.turn || 0) % p.members.length;
    syncConn(p);
    emitState(room);
  });
  const kickTeam = ({ id } = {}) => {
    const room = hostRoom();
    if (!room) return;
    const p = player(room, id);
    if (!p) return;
    teamSockets(p).forEach(sid => io.to(sid).emit('kicked'));
    room.players = room.players.filter(x => x.id !== id);
    if (room.picker === id) room.picker = nextPicker(room);
    const cur = room.current;
    if (cur && cur.typ === 'finale') {
      delete cur.wagers[id]; delete cur.answers[id]; delete cur.decision[id];
      cur.participants = cur.participants.filter(x => x !== id);
      if (cur.review) {
        const r = cur.review, idx = r.order.indexOf(id);
        r.order = r.order.filter(x => x !== id); delete r.judged[id]; delete r.marks[id];
        if (idx >= 0 && idx < r.revealed) r.revealed--;
        if (cur.state === 'review' && r.revealed >= r.order.length && r.order.length) finToJudge(room, cur);
        if (!r.order.length && cur.state !== 'reveal') { cur.state = 'reveal'; cur.result = 'done'; }
      }
    } else if (cur) {
      if (cur.mini && cur.mini.sort && cur.state === 'open') {   // Sortieren: Spieler aus der Zugfolge nehmen
        const s = cur.mini.sort, i = s.order.indexOf(id), wasTurn = s.turn === id;
        if (i >= 0) {
          s.order.splice(i, 1); delete s.hearts[id]; delete s.correct[id];
          if (wasTurn) { s.turn = s.order.length ? s.order[(i - 1 + s.order.length) % s.order.length] : null; sortAdvance(room, cur); }
        }
      }
      cur.locked.delete(id);
      delete cur.guesses[id];
      if (cur.mini) delete cur.mini.answers[id];
      cur.order = cur.order.filter(x => x !== id); delete cur.marks[id];
      cur.revealed = Math.min(cur.revealed, cur.order.length);
      if (cur.state === 'review' && cur.revealed >= cur.order.length) cur.state = 'judge';
      cur.winners = cur.winners.filter(x => x !== id);
      if (cur.window) cur.window.candidates = cur.window.candidates.filter(c => c.pid !== id);
      if (cur.buzzer === id) { clearTimeout(cur.t.answer); cur.buzzer = null; cur.timeUp = false; cur.deadline = 0; cur.state = 'open'; cur.buzzOpen = Date.now(); }
    }
    emitState(room);
  };
  sock.on('host:kick', kickTeam);

  sock.on('host:end', () => {
    const room = hostRoom();
    if (!room) return;
    clearTimers(room.current);
    clearTimeout(room.timer); room.interlude = null; room.undo = null;
    room.phase = 'end';
    room.current = null;
    emitState(room);
  });

  // Beamer-Ansicht: reiner Zuschauer fuer Fernseher oder Stream. Bekommt wie ein Spieler nur den oeffentlichen Zustand und darf nichts steuern.
  sock.on('beamer:join', (msg, cb) => {
    cb = wrap(cb);
    const room = rooms.get(str(msg && msg.code).toUpperCase());
    if (!room) return cb({ ok: false, error: 'Diesen Raum gibt es nicht.' });
    sock.data = { code: room.code, role: 'beamer' };
    (room.beamers = room.beamers || new Set()).add(sock.id);
    cb({ ok: true, code: room.code });
    sock.emit('state', stateFor(room, false, null));
  });
  // Beitrittsmaske: welche Teams gibt es schon? (nur oeffentliche Angaben)
  sock.on('room:info', (msg, cb) => {
    cb = wrap(cb);
    const room = rooms.get(str(msg && msg.code).toUpperCase());
    if (!room) return cb({ ok: false });
    cb({ ok: true, teamMode: !!room.settings.teamMode, phase: room.phase,
      teams: room.players.map(p => ({ name: p.name, size: p.members.length, full: p.members.length >= MAX_TEAM })) });
  });
  // Beitritt: ohne Team-Modus ist jeder Spieler ein Team mit einem Mitglied. Mit Team-Modus gruendet man ein Team oder tritt einem bei (gleicher Teamname).
  sock.on('player:join', (msg, cb) => {
    cb = wrap(cb);
    const room = rooms.get(str(msg && msg.code).toUpperCase());
    if (!room) return cb({ ok: false, error: 'Diesen Raum gibt es nicht.' });
    const teamMode = !!room.settings.teamMode;
    const found = memberFind(room, msg.token);
    let p = found && found.p, m = found && found.m;
    if (!p) {
      const name = str(msg.name, 20);
      if (!name) return cb({ ok: false, error: 'Bitte einen Namen eingeben.' });
      const teamName = teamMode ? str(msg.team, 20) : name;
      if (!teamName) return cb({ ok: false, error: 'Bitte einen Teamnamen eingeben oder ein Team wählen.' });
      p = room.players.find(x => x.name.toLowerCase() === teamName.toLowerCase());
      if (p) {
        m = p.members.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (m) {
          // Platz zurueckholen: gleicher Name, Mitglied gerade nicht verbunden (z. B. nach Neustart oder geladenem Spielstand)
          if (m.connected) return cb({ ok: false, error: teamMode ? 'Dieser Name ist im Team schon vergeben.' : 'Dieser Name ist schon vergeben.' });
          m.token = token();
        } else if (teamMode) {
          if (p.members.length >= MAX_TEAM) return cb({ ok: false, error: 'Dieses Team ist voll.' });
          m = { id: crypto.randomBytes(4).toString('hex'), name, token: token(), socketId: null, connected: false };
          p.members.push(m);
        } else return cb({ ok: false, error: 'Dieser Name ist schon vergeben.' });
      } else {
        if (room.phase !== 'lobby') return cb({ ok: false, error: 'Das Spiel laeuft bereits.' });
        if (room.players.length >= 30) return cb({ ok: false, error: teamMode ? 'Es gibt schon die maximale Zahl an Teams.' : 'Der Raum ist voll.' });
        m = { id: crypto.randomBytes(4).toString('hex'), name, token: token(), socketId: null, connected: false };
        p = { id: crypto.randomBytes(4).toString('hex'), name: teamName, members: [m], turn: 0, score: 0, streak: 0,
              jokers: [], delay: 0, photo: null, photoV: 0, pendingPick: 0, stats: newStats(), connected: false, ...pickLook(room, msg.color, msg.avatar) };
        room.players.push(p);
      }
    }
    if (!p.photo && msg.photo && p.members.length === 1) { const b = photoFromData(msg.photo); if (b) setPhoto(p, b); }
    m.socketId = sock.id;
    m.connected = true;
    syncConn(p);
    sock.data = { code: room.code, role: 'player', pid: p.id, mid: m.id };
    { const cur = room.current; if (cur && cur.typ === 'sortieren' && cur.state === 'open' && cur.mini && cur.mini.sort && cur.mini.sort.turn == null) sortAdvance(room, cur); }   // Zug war ins Leere gelaufen
    cb({ ok: true, code: room.code, pid: p.id, mid: m.id, token: m.token, name: p.name, member: m.name });
    emitState(room);
  });
  sock.on('disconnect', () => {
    const room = rooms.get(sock.data && sock.data.code);
    if (!room) return;
    if (sock.data.role === 'host' && room.hostSocket === sock.id) {
      room.hostSocket = null;
      emitState(room);
    } else if (sock.data.role === 'beamer') {
      if (room.beamers) room.beamers.delete(sock.id);
    } else if (sock.data.role === 'player') {
      const p = player(room, sock.data.pid), m = p && p.members.find(x => x.id === sock.data.mid);
      if (m && m.socketId === sock.id) {
        m.connected = false; m.socketId = null; syncConn(p);
        const cur = room.current;
        if (!p.connected && cur && cur.typ === 'sortieren' && cur.state === 'open' && cur.mini && cur.mini.sort && cur.mini.sort.turn === p.id) sortAdvance(room, cur);   // Zug geht ohne Strafe weiter (erst wenn das ganze Team weg ist)
        emitState(room);
      }
    }
  });
});

