'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const VALUES = [100, 200, 300, 400, 500, 600, 700, 800];
const MAX_CATS = 13;
const JOKERS = ['double', 'coffee', 'risk'];
const MAX_JOKERS = 3;      // so viele Joker kann ein Spieler gleichzeitig besitzen
const BUZZ_WINDOW = 250;   // ms: nach dem ersten Buzz werden weitere gesammelt, kuerzeste Reaktionszeit gewinnt
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'media')));
app.get('/fragen-vorlage.json', (req, res) =>
  res.download(path.join(__dirname, 'fragen.json'), 'fragen.json'));

// ---------- Fragen ----------
const str = (v, max = 1000) => String(v == null ? '' : v).trim().slice(0, max);

// Medien: entweder https-Link oder Dateiname im Ordner "media"
function mediaPath(v) {
  v = str(v, 300);
  if (!v) return '';
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^[\w\-. ()\/]+$/.test(v) && !v.includes('..')) return 'media/' + v.replace(/^\/?media\//, '');
  return '';
}

// Zahl aus Text: "1.200" -> 1200, "12,50" -> 12.5, "ca. 300 EUR" -> 300
function parseNum(v) {
  let s = str(v, 60).replace(/[^\d,.\-]/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const hasC = s.includes(','), hasP = s.includes('.');
  if (hasC && hasP) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(',', '.');
  } else if (hasP) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  } else if (hasC) {
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

function normalize(data) {
  if (!data || !Array.isArray(data.kategorien) || !data.kategorien.length)
    throw new Error('Die Datei braucht eine Liste "kategorien".');
  if (data.kategorien.length > MAX_CATS)
    throw new Error('Maximal ' + MAX_CATS + ' Kategorien erlaubt.');
  return {
    titel: str(data.titel, 40) || 'Quiz Show',
    kategorien: data.kategorien.map((c, i) => {
      const fragen = (Array.isArray(c.fragen) ? c.fragen : []).slice(0, VALUES.length).map(f => {
        f = f || {};
        const typ = str(f.typ, 20).toLowerCase().replace('ä', 'ae');
        const zeit = Math.round(Number(f.zeit));
        return {
          frage: str(f.frage), antwort: str(f.antwort),
          bild: mediaPath(f.bild), sound: mediaPath(f.sound), antwortBild: mediaPath(f.antwortBild),
          joker: !!f.joker,
          typ: typ === 'schaetzen' ? 'schaetzen' : 'buzzer',
          zeit: Number.isFinite(zeit) && zeit > 0 ? Math.min(zeit, 600) : 0,
          einheit: str(f.einheit, 10)
        };
      });
      if (!fragen.length) throw new Error('Kategorie ' + (i + 1) + ' hat keine Fragen.');
      return { name: str(c.name, 60) || 'Kategorie ' + (i + 1), fragen };
    })
  };
}
const defaultData = () =>
  normalize(JSON.parse(fs.readFileSync(path.join(__dirname, 'fragen.json'), 'utf8')));

// ---------- Raeume ----------
function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
const token = () => crypto.randomBytes(12).toString('hex');
const key = (ci, ri) => ci + '-' + ri;
const qOf = (room, ci, ri) =>
  Number.isInteger(ci) && Number.isInteger(ri) && room.data.kategorien[ci] ? room.data.kategorien[ci].fragen[ri] : undefined;
const player = (room, id) => room.players.find(p => p.id === id);

function tileState(room, ci, ri) {
  if (!qOf(room, ci, ri)) return 'none';
  return room.used.has(key(ci, ri)) ? 'used' : 'free';
}
function freeTiles(room) {
  let n = 0;
  room.data.kategorien.forEach((c, ci) =>
    VALUES.forEach((_, ri) => { if (tileState(room, ci, ri) === 'free') n++; }));
  return n;
}
// Joker, die in der JSON fest gesetzt sind
function fixedJokers(data) {
  const s = new Set();
  data.kategorien.forEach((c, ci) => c.fragen.forEach((f, ri) => { if (f.joker) s.add(key(ci, ri)); }));
  return s;
}
// Beim Start: feste Joker uebernehmen, Rest bis zur eingestellten Anzahl zufaellig verteilen
function assignJokers(room) {
  room.jokers = new Set([...room.fixed].filter(k => {
    const [ci, ri] = k.split('-').map(Number);
    return !!qOf(room, ci, ri);
  }));
  const rest = [];
  room.data.kategorien.forEach((c, ci) => c.fragen.forEach((f, ri) => {
    if (!room.jokers.has(key(ci, ri))) rest.push(key(ci, ri));
  }));
  while (room.jokers.size < room.settings.joker && rest.length)
    room.jokers.add(rest.splice(crypto.randomInt(rest.length), 1)[0]);
}
// Feste Reihenfolge: naechster verbundener Spieler nach dem aktuellen
function nextPicker(room) {
  const ps = room.players;
  if (!ps.length) return null;
  const i = ps.findIndex(p => p.id === room.picker);
  for (let k = 1; k <= ps.length; k++) {
    const p = ps[(i + k + ps.length) % ps.length];
    if (p.connected) return p.id;
  }
  return ps[(i + 1 + ps.length) % ps.length].id;
}

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
  cur.awards.push({ pid, delta, why });
}
// Faktor bei Gewinn: Doppelt x2, Risiko x3
function winMult(cur, pid) {
  const j = cur.joker;
  if (j && j.by === pid) return j.type === 'double' ? 2 : j.type === 'risk' ? 3 : 1;
  return 1;
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
// Risiko ohne Gewinn: doppelter Wert weg (einmal pro Frage)
function resolveRisk(room, cur) {
  const j = cur.joker;
  if (!j || j.type !== 'risk' || cur.riskDone) return;
  cur.riskDone = true;
  if (!cur.winners.includes(j.by)) award(room, cur, j.by, -VALUES[cur.row] * 2, 'risk');
}
function grantReward(room, cur) {
  if (!cur.winners.length || !room.jokers.has(key(cur.cat, cur.row))) return;
  cur.reward = true;
  cur.winners.forEach(id => { const p = player(room, id); if (p) p.pendingPick++; });
}
function toReveal(room, cur, result) {
  clearTimers(cur);
  cur.state = 'reveal'; cur.result = result; cur.buzzer = null; cur.window = null;
  cur.audio.on = false; cur.deadline = 0; cur.timeUp = false;
  resolveRisk(room, cur);
}
function startTile(room, cat, row) {
  if (room.phase !== 'game' || room.current) return;
  if (tileState(room, cat, row) !== 'free') return;
  const q = qOf(room, cat, row);
  room.current = {
    cat, row, typ: q.typ, state: 'reading',
    buzzer: null, locked: new Set(), window: null, deadline: 0, timeUp: false,
    joker: null, riskDone: false, awards: [], winners: [], result: null, reward: false,
    audio: { n: 0, on: false },
    guesses: {}, order: [], revealed: 0,
    t: {}
  };
  emitState(room);
}
// Buzzer-Fenster auswerten: kuerzeste gemessene Reaktionszeit gewinnt
function resolveBuzz(room) {
  const cur = room.current;
  if (!cur || !cur.window || cur.state !== 'open') return;
  const best = cur.window.candidates.sort((a, b) => a.elapsed - b.elapsed)[0];
  cur.window = null;
  if (!best) return emitState(room);
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
  const A = parseNum(qOf(room, cur.cat, cur.row).antwort);
  const ids = Object.keys(cur.guesses);
  if (Number.isFinite(A)) {
    const d = id => Number.isFinite(cur.guesses[id].num) ? Math.abs(cur.guesses[id].num - A) : 1e18;
    ids.sort((a, b) => d(b) - d(a));
  }
  cur.order = ids; cur.revealed = 0; cur.state = 'review';
  cur.audio.on = false; cur.deadline = 0;
}
function applyWinners(room, cur, winners) {
  const value = VALUES[cur.row];
  cur.winners = winners;
  winners.forEach(id => award(room, cur, id, value * winMult(cur, id), 'correct'));
  toReveal(room, cur, winners.length ? 'correct' : 'none');
  grantReward(room, cur);
}
function resolveGuess(room, cur) {
  const A = parseNum(qOf(room, cur.cat, cur.row).antwort);
  let winners = [], best = Infinity;
  if (Number.isFinite(A)) {
    for (const id of cur.order) {
      const n = cur.guesses[id].num;
      if (!Number.isFinite(n)) continue;
      const d = Math.abs(n - A);
      if (d < best - 1e-9) { best = d; winners = [id]; }
      else if (Math.abs(d - best) < 1e-9) winners.push(id);
    }
  }
  applyWinners(room, cur, winners);
}

function stateFor(room, forHost) {
  const cur = room.current;
  let current = null;
  if (cur) {
    const q = qOf(room, cur.cat, cur.row);
    const hidden = !forHost && cur.state === 'reading';   // Spieler sehen die Frage erst nach der Freigabe
    const reveal = cur.state === 'reveal';
    current = {
      cat: cur.cat, row: cur.row, value: VALUES[cur.row], typ: cur.typ,
      catName: room.data.kategorien[cur.cat].name,
      question: hidden ? '' : q.frage, bild: hidden ? '' : q.bild, sound: hidden ? '' : q.sound,
      hasSound: !!q.sound, einheit: q.einheit,
      joker: room.jokers.has(key(cur.cat, cur.row)),
      state: cur.state, buzzer: cur.buzzer, pending: !!cur.window, locked: [...cur.locked],
      used: cur.joker, audio: cur.audio, timeUp: cur.timeUp,
      left: cur.deadline && (cur.state === 'buzzed' || cur.state === 'open') ? Math.max(0, cur.deadline - Date.now()) : null,
      result: cur.result, winners: cur.winners, reward: cur.reward, awards: cur.awards
    };
    if (forHost || reveal) { current.answer = q.antwort; current.ansBild = q.antwortBild; }
    if (cur.typ === 'schaetzen') {
      const order = cur.order.length ? cur.order : Object.keys(cur.guesses);
      const entries = order.map(pid => ({ pid, text: cur.guesses[pid].text }));
      current.guess = {
        count: order.length, guessed: Object.keys(cur.guesses),
        total: cur.order.length, revealed: cur.revealed,
        list: forHost || reveal ? entries : cur.state === 'review' ? entries.slice(0, cur.revealed) : []
      };
    }
  }
  let jokerTiles = [];
  if (forHost) jokerTiles = room.phase === 'lobby' ? [...room.fixed] : [...room.jokers].filter(k => !room.used.has(k));
  return {
    code: room.code, phase: room.phase, picker: room.picker, titel: room.data.titel,
    hostOnline: !!room.hostSocket, settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, jokers: p.jokers, pending: p.pendingPick })),
    cats: room.data.kategorien.map(c => c.name),
    values: VALUES,
    tiles: room.data.kategorien.map((c, ci) => VALUES.map((_, ri) => tileState(room, ci, ri))),
    jokerTiles, current
  };
}
function emitState(room) {
  room.touched = Date.now();
  if (room.hostSocket) io.to(room.hostSocket).emit('state', stateFor(room, true));
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, false)); });
}

setInterval(() => {
  const limit = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, r] of rooms) if (r.touched < limit) { clearTimers(r.current); rooms.delete(code); }
}, 10 * 60 * 1000);

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
      picker: null, settings: { joker: 5, answerTime: 10, guessTime: 90 }, touched: Date.now()
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
      cb({ ok: true }); emitState(room);
    } catch (e) { cb({ ok: false, error: e.message }); }
  });

  sock.on('host:setSettings', (s = {}) => {
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return;
    const num = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null; };
    const j = num(s.joker, 0, MAX_CATS * VALUES.length), a = num(s.answerTime, 3, 60), g = num(s.guessTime, 10, 600);
    if (j !== null) room.settings.joker = j;
    if (a !== null) room.settings.answerTime = a;
    if (g !== null) room.settings.guessTime = g;
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

  // Freigabe: Frage wird fuer alle sichtbar, Buzzer bzw. Schaetz-Eingabe geht auf, Sound startet automatisch
  sock.on('host:open', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'reading') return;
    const q = qOf(room, cur.cat, cur.row);
    cur.state = 'open';
    if (q.sound) cur.audio = { n: cur.audio.n + 1, on: true };
    if (cur.typ === 'schaetzen') {
      const ms = (q.zeit || room.settings.guessTime) * 1000;
      cur.deadline = Date.now() + ms;
      cur.t.guess = setTimeout(() => {
        if (room.current === cur && cur.state === 'open') { toReview(room, cur); emitState(room); }
      }, ms);
    }
    emitState(room);
  });

  sock.on('host:sound', ({ on } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state === 'reading' || cur.state === 'reveal') return;
    cur.audio = { n: cur.audio.n + (on ? 1 : 0), on: !!on };
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
    cur.joker = { by: me.id, type, target: t ? t.id : null };
    emitState(room);
  });

  // Gewonnenen Joker aussuchen
  sock.on('player:pickJoker', ({ type } = {}) => {
    const room = playerRoom();
    if (!room) return;
    const me = player(room, sock.data.pid);
    if (!me || me.pendingPick < 1 || !JOKERS.includes(type) || me.jokers.length >= MAX_JOKERS) return;
    me.jokers.push(type);
    me.pendingPick--;
    emitState(room);
  });

  sock.on('player:buzz', ({ elapsed } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'buzzer' || cur.state !== 'open') return;
    const pid = sock.data.pid;
    const me = player(room, pid);
    if (!me || cur.locked.has(pid)) return;
    let e = Number(elapsed);
    if (!Number.isFinite(e) || e < 0 || e > 99999) e = 99999;
    if (!cur.window) {
      cur.window = { candidates: [] };
      cur.t.window = setTimeout(() => resolveBuzz(room), BUZZ_WINDOW);
      emitState(room);   // "pending": Buzzer bei allen kurz gesperrt
    }
    if (!cur.window.candidates.some(c => c.pid === pid)) cur.window.candidates.push({ pid, elapsed: e });
  });

  sock.on('player:guess', ({ text } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'schaetzen' || cur.state !== 'open') return;
    const pid = sock.data.pid;
    if (!player(room, pid) || cur.locked.has(pid)) return;
    const t = str(text, 40);
    if (!t) return;
    cur.guesses[pid] = { text: t, num: parseNum(t) };
    emitState(room);
  });

  sock.on('host:judge', ({ correct } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'buzzer' || cur.state !== 'buzzed') return;
    const p = player(room, cur.buzzer);
    const value = VALUES[cur.row];
    clearTimeout(cur.t.answer); cur.timeUp = false; cur.deadline = 0;
    if (!p) { cur.buzzer = null; cur.state = 'open'; return emitState(room); }
    if (correct) {
      award(room, cur, p.id, value * winMult(cur, p.id), 'correct');
      cur.winners = [p.id];
      toReveal(room, cur, 'correct');
      grantReward(room, cur);
    } else {
      award(room, cur, p.id, -penaltyFor(cur, p.id, value), 'wrong');
      if (cur.joker && cur.joker.by === p.id && cur.joker.type === 'risk') cur.riskDone = true;
      cur.locked.add(p.id);
      cur.buzzer = null;
      if (room.players.some(x => x.connected && !cur.locked.has(x.id))) cur.state = 'open';
      else toReveal(room, cur, 'none');
    }
    emitState(room);
  });

  // Ueberspringen: beim Vorlesen = Frage abbrechen (Joker geht zurueck), sonst "niemand weiss es" / "Zeit beenden"
  sock.on('host:skip', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state === 'reveal' || cur.state === 'review') return;
    if (cur.state === 'reading') {
      if (cur.joker) {
        const p = player(room, cur.joker.by);
        if (p) p.jokers.push(cur.joker.type);
        cur.joker = null; cur.locked.clear();
      }
      toReveal(room, cur, 'skipped');
    } else if (cur.typ === 'schaetzen') toReview(room, cur);
    else toReveal(room, cur, 'none');
    emitState(room);
  });

  sock.on('host:revealNext', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'review') return;
    if (cur.revealed < cur.order.length) cur.revealed++;
    emitState(room);
  });

  sock.on('host:resolve', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'review') return;
    cur.revealed = cur.order.length;
    resolveGuess(room, cur);
    emitState(room);
  });

  // Gewinner einer Schaetzfrage nachtraeglich aendern: alles zuruecknehmen und neu vergeben
  sock.on('host:setWinner', ({ id } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.typ !== 'schaetzen' || cur.state !== 'reveal' || !cur.guesses[id]) return;
    cur.awards.forEach(a => { const p = player(room, a.pid); if (p) p.score -= a.delta; });
    if (cur.reward) cur.winners.forEach(w => { const p = player(room, w); if (p && p.pendingPick > 0) p.pendingPick--; });
    cur.awards = []; cur.reward = false; cur.riskDone = false;
    applyWinners(room, cur, [id]);
    emitState(room);
  });

  sock.on('host:close', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'reveal') return;
    room.used.add(key(cur.cat, cur.row));
    room.current = null;
    room.picker = nextPicker(room);
    if (freeTiles(room) === 0) room.phase = 'end';
    emitState(room);
  });

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

  sock.on('host:kick', ({ id } = {}) => {
    const room = hostRoom();
    if (!room) return;
    const p = player(room, id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
    room.players = room.players.filter(x => x.id !== id);
    if (room.picker === id) room.picker = nextPicker(room);
    const cur = room.current;
    if (cur) {
      cur.locked.delete(id);
      delete cur.guesses[id];
      cur.order = cur.order.filter(x => x !== id);
      cur.revealed = Math.min(cur.revealed, cur.order.length);
      cur.winners = cur.winners.filter(x => x !== id);
      if (cur.window) cur.window.candidates = cur.window.candidates.filter(c => c.pid !== id);
      if (cur.buzzer === id) { clearTimeout(cur.t.answer); cur.buzzer = null; cur.timeUp = false; cur.deadline = 0; cur.state = 'open'; }
    }
    emitState(room);
  });

  sock.on('host:end', () => {
    const room = hostRoom();
    if (!room) return;
    clearTimers(room.current);
    room.phase = 'end';
    room.current = null;
    emitState(room);
  });

  sock.on('player:join', (msg, cb) => {
    cb = wrap(cb);
    const room = rooms.get(str(msg && msg.code).toUpperCase());
    if (!room) return cb({ ok: false, error: 'Diesen Raum gibt es nicht.' });
    let p = msg.token && room.players.find(x => x.token === msg.token);
    if (!p) {
      const name = str(msg.name, 20);
      if (!name) return cb({ ok: false, error: 'Bitte einen Namen eingeben.' });
      if (room.phase !== 'lobby') return cb({ ok: false, error: 'Das Spiel laeuft bereits.' });
      if (room.players.some(x => x.name.toLowerCase() === name.toLowerCase()))
        return cb({ ok: false, error: 'Dieser Name ist schon vergeben.' });
      if (room.players.length >= 30) return cb({ ok: false, error: 'Der Raum ist voll.' });
      p = { id: crypto.randomBytes(4).toString('hex'), token: token(), name, score: 0,
            jokers: [], pendingPick: 0, socketId: null, connected: false };
      room.players.push(p);
    }
    p.socketId = sock.id;
    p.connected = true;
    sock.data = { code: room.code, role: 'player', pid: p.id };
    cb({ ok: true, code: room.code, pid: p.id, token: p.token, name: p.name });
    emitState(room);
  });

  sock.on('disconnect', () => {
    const room = rooms.get(sock.data && sock.data.code);
    if (!room) return;
    if (sock.data.role === 'host' && room.hostSocket === sock.id) {
      room.hostSocket = null;
      emitState(room);
    } else if (sock.data.role === 'player') {
      const p = player(room, sock.data.pid);
      if (p && p.socketId === sock.id) { p.connected = false; p.socketId = null; emitState(room); }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Quiz laeuft auf Port ' + PORT));
