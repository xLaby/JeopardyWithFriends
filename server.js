const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const VALUES = [200, 300, 400, 500, 600, 700, 800, 900, 1000];
const MAX_CATS = 12;
const POWERUPS = ['double', 'skip'];
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
function normalize(data) {
  if (!data || !Array.isArray(data.kategorien) || !data.kategorien.length)
    throw new Error('Die Datei braucht eine Liste "kategorien".');
  if (data.kategorien.length > MAX_CATS)
    throw new Error('Maximal ' + MAX_CATS + ' Kategorien erlaubt.');
  return {
    titel: str(data.titel, 40) || 'Quiz Show',
    kategorien: data.kategorien.map((c, i) => {
      const fragen = (Array.isArray(c.fragen) ? c.fragen : []).slice(0, VALUES.length).map(f => ({
        frage: str(f && f.frage),
        antwort: str(f && f.antwort),
        bild: mediaPath(f && f.bild),
        sound: mediaPath(f && f.sound),
        antwortBild: mediaPath(f && f.antwortBild),
        joker: !!(f && f.joker)
      }));
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

function tileState(room, ci, ri) {
  if (!room.data.kategorien[ci].fragen[ri]) return 'none';
  return room.used.has(ci + '-' + ri) ? 'used' : 'free';
}
function freeTiles(room) {
  let n = 0;
  room.data.kategorien.forEach((c, ci) =>
    VALUES.forEach((_, ri) => { if (tileState(room, ci, ri) === 'free') n++; }));
  return n;
}
function assignJokers(room) {
  room.jokers = new Set();
  const all = [];
  room.data.kategorien.forEach((c, ci) => c.fragen.forEach((f, ri) => {
    if (f.joker) room.jokers.add(ci + '-' + ri); else all.push(ci + '-' + ri);
  }));
  while (room.jokers.size < room.settings.joker && all.length) {
    room.jokers.add(all.splice(crypto.randomInt(all.length), 1)[0]);
  }
}
function stateFor(room, forHost) {
  const cur = room.current;
  let current = null;
  if (cur) {
    const q = room.data.kategorien[cur.cat].fragen[cur.row];
    const reveal = cur.state === 'reveal';
    current = {
      cat: cur.cat, row: cur.row, value: VALUES[cur.row],
      catName: room.data.kategorien[cur.cat].name,
      question: q.frage, bild: q.bild, sound: q.sound,
      joker: room.jokers.has(cur.cat + '-' + cur.row),
      state: cur.state, buzzer: cur.buzzer, locked: [...cur.locked],
      doubled: [...cur.doubled], skipped: [...cur.skipped],
      audio: cur.audio, typed: cur.typed,
      result: cur.result, winner: cur.winner, reward: cur.reward
    };
    if (forHost || reveal) { current.answer = q.antwort; current.ansBild = q.antwortBild; }
  }
  return {
    code: room.code, phase: room.phase, picker: room.picker, titel: room.data.titel,
    hostOnline: !!room.hostSocket, settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, pu: p.pu })),
    cats: room.data.kategorien.map(c => c.name),
    values: VALUES,
    tiles: room.data.kategorien.map((c, ci) => VALUES.map((_, ri) => tileState(room, ci, ri))),
    current
  };
}
function emitState(room) {
  room.touched = Date.now();
  if (room.hostSocket) io.to(room.hostSocket).emit('state', stateFor(room, true));
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, false)); });
}
function startTile(room, cat, row) {
  if (room.phase !== 'game' || room.current) return;
  if (!room.data.kategorien[cat] || tileState(room, cat, row) !== 'free') return;
  room.current = {
    cat, row, state: 'reading', buzzer: null, locked: new Set(), doubled: new Set(), skipped: new Set(),
    audio: { n: 0, on: false }, typed: null, result: null, winner: null, reward: null
  };
  emitState(room);
}
function toReveal(cur, result) {
  cur.state = 'reveal'; cur.result = result; cur.buzzer = null; cur.audio.on = false;
}

setInterval(() => {
  const limit = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, r] of rooms) if (r.touched < limit) rooms.delete(code);
}, 10 * 60 * 1000);

// ---------- Sockets ----------
io.on('connection', sock => {
  const hostRoom = () => {
    const r = rooms.get(sock.data.code);
    return r && sock.data.role === 'host' && r.hostSocket === sock.id ? r : null;
  };
  const wrap = cb => (typeof cb === 'function' ? cb : () => {});

  sock.on('host:create', cb => {
    cb = wrap(cb);
    const code = newCode();
    const room = {
      code, hostToken: token(), hostSocket: sock.id, phase: 'lobby',
      data: defaultData(), players: [], used: new Set(), jokers: new Set(), current: null,
      picker: null, settings: { joker: 5, typed: false }, touched: Date.now()
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
    try { room.data = normalize(data); cb({ ok: true }); emitState(room); }
    catch (e) { cb({ ok: false, error: e.message }); }
  });

  sock.on('host:setSettings', (s = {}) => {
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return;
    const j = Math.round(Number(s.joker));
    if (Number.isFinite(j)) room.settings.joker = Math.max(0, Math.min(20, j));
    if (typeof s.typed === 'boolean') room.settings.typed = s.typed;
    emitState(room);
  });

  sock.on('host:start', () => {
    const room = hostRoom();
    if (!room || room.phase !== 'lobby') return;
    room.phase = 'game';
    assignJokers(room);
    room.picker = room.players.length ? room.players[0].id : null;
    emitState(room);
  });

  sock.on('host:pick', ({ cat, row } = {}) => { const r = hostRoom(); if (r) startTile(r, cat, row); });
  sock.on('player:pick', ({ cat, row } = {}) => {
    const r = rooms.get(sock.data.code);
    if (r && sock.data.role === 'player' && r.picker === sock.data.pid) startTile(r, cat, row);
  });

  sock.on('host:openBuzzer', () => {
    const room = hostRoom();
    if (!room || !room.current || room.current.state !== 'reading') return;
    room.current.state = 'open';
    emitState(room);
  });

  sock.on('host:sound', ({ on } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state === 'reveal') return;
    cur.audio = { n: cur.audio.n + (on ? 1 : 0), on: !!on };
    emitState(room);
  });

  sock.on('player:powerup', ({ type, target } = {}) => {
    const room = rooms.get(sock.data.code);
    const cur = room && room.current;
    if (!cur || cur.state !== 'reading' || sock.data.role !== 'player') return;
    const me = room.players.find(p => p.id === sock.data.pid);
    if (!me || !POWERUPS.includes(type) || me.pu[type] < 1) return;
    if (type === 'double') {
      if (cur.doubled.has(me.id)) return;
      cur.doubled.add(me.id);
    } else {
      const t = room.players.find(p => p.id === target);
      if (!t || t.id === me.id || cur.locked.has(t.id)) return;
      cur.skipped.add(t.id);
      cur.locked.add(t.id);
    }
    me.pu[type]--;
    emitState(room);
  });

  sock.on('player:answer', ({ text } = {}) => {
    const room = rooms.get(sock.data.code);
    const cur = room && room.current;
    if (!cur || !room.settings.typed || cur.state !== 'buzzed' || cur.buzzer !== sock.data.pid) return;
    cur.typed = str(text, 200) || null;
    emitState(room);
  });

  sock.on('host:judge', ({ correct } = {}) => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'buzzed') return;
    const p = room.players.find(x => x.id === cur.buzzer);
    const value = VALUES[cur.row];
    if (!p) { cur.buzzer = null; cur.state = 'open'; return emitState(room); }
    const mult = cur.doubled.has(p.id) ? 2 : 1;
    if (correct) {
      p.score += value * mult;
      room.picker = p.id;
      toReveal(cur, 'correct');
      cur.winner = p.name;
      if (room.jokers.has(cur.cat + '-' + cur.row)) {
        cur.reward = POWERUPS[crypto.randomInt(POWERUPS.length)];
        p.pu[cur.reward]++;
      }
    } else {
      p.score -= (value / 2) * mult;
      cur.locked.add(p.id);
      cur.buzzer = null;
      cur.typed = null;
      if (room.players.some(x => x.connected && !cur.locked.has(x.id))) cur.state = 'open';
      else toReveal(cur, 'none');
    }
    emitState(room);
  });

  sock.on('host:skip', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state === 'reveal') return;
    toReveal(cur, 'none');
    emitState(room);
  });

  sock.on('host:close', () => {
    const room = hostRoom();
    const cur = room && room.current;
    if (!cur || cur.state !== 'reveal') return;
    room.used.add(cur.cat + '-' + cur.row);
    room.current = null;
    if (freeTiles(room) === 0) room.phase = 'end';
    emitState(room);
  });

  sock.on('host:adjust', ({ id, delta } = {}) => {
    const room = hostRoom();
    const p = room && room.players.find(x => x.id === id);
    const d = Number(delta);
    if (!p || !Number.isFinite(d)) return;
    p.score += Math.round(d);
    emitState(room);
  });

  sock.on('host:setPicker', ({ id } = {}) => {
    const room = hostRoom();
    if (!room || !room.players.some(p => p.id === id)) return;
    room.picker = id;
    emitState(room);
  });

  sock.on('host:kick', ({ id } = {}) => {
    const room = hostRoom();
    if (!room) return;
    const p = room.players.find(x => x.id === id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
    room.players = room.players.filter(x => x.id !== id);
    if (room.picker === id) room.picker = room.players.length ? room.players[0].id : null;
    const cur = room.current;
    if (cur) {
      cur.locked.delete(id); cur.doubled.delete(id); cur.skipped.delete(id);
      if (cur.buzzer === id) { cur.buzzer = null; cur.state = 'open'; }
    }
    emitState(room);
  });

  sock.on('host:end', () => {
    const room = hostRoom();
    if (!room) return;
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
            pu: { double: 0, skip: 0 }, socketId: null, connected: false };
      room.players.push(p);
    }
    p.socketId = sock.id;
    p.connected = true;
    sock.data = { code: room.code, role: 'player', pid: p.id };
    cb({ ok: true, code: room.code, pid: p.id, token: p.token, name: p.name });
    emitState(room);
  });

  sock.on('player:buzz', () => {
    const room = rooms.get(sock.data.code);
    const cur = room && room.current;
    if (!cur || sock.data.role !== 'player' || cur.state !== 'open') return;
    const pid = sock.data.pid;
    if (cur.locked.has(pid) || !room.players.some(p => p.id === pid)) return;
    cur.buzzer = pid;
    cur.state = 'buzzed';
    emitState(room);
  });

  sock.on('disconnect', () => {
    const room = rooms.get(sock.data && sock.data.code);
    if (!room) return;
    if (sock.data.role === 'host' && room.hostSocket === sock.id) {
      room.hostSocket = null;
      emitState(room);
    } else if (sock.data.role === 'player') {
      const p = room.players.find(x => x.id === sock.data.pid);
      if (p && p.socketId === sock.id) { p.connected = false; p.socketId = null; emitState(room); }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Quiz laeuft auf Port ' + PORT));
