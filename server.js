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

const MAX_CATS = 15, MAX_ROWS = 10;
const JOKERS = ['double', 'coffee', 'risk'];
const MAX_JOKERS = 3;          // je Joker-Art nur einer pro Spieler, damit maximal 3
const DELAYS = [1, 2, 3, 5];   // Handicap: Buzzer-Verzoegerung in Sekunden (0 = aus)
const THEMES = [               // komplette Designs (Schrift, Formen, Hintergrund, Board- und Buzzer-Layout); c = Vorschaufarben
  { id: 'classic', name: 'Showbühne', d: 'Vorhang, Scheinwerfer, Lichterrahmen, runder Buzzer', c: ['#12081a', '#6b0f24', '#f5b92e'] },
  { id: 'arcade', name: 'Retro-Arcade', d: '8-Bit mit Pixel-Schrift, Scanlines, eckiges Board, Pixel-Buzzer', c: ['#0a0a1e', '#00e5a0', '#ff2e88'] },
  { id: 'scifi', name: 'Sci-Fi Hologramm', d: 'Neon-Linien, Sternenhimmel, Hologramm-Board, Hexagon-Buzzer', c: ['#030b1a', '#0a3a6b', '#19e3ff'] },
  { id: 'comic', name: 'Comic Pop-Art', d: 'Dicke Umrandungen, Rasterpunkte, Comic-Panels, Starburst-Buzzer', c: ['#ffd60a', '#e63946', '#1d4ed8'] },
  { id: 'anime', name: 'Anime', d: 'Pastell, Sterne, Visual-Novel-Textbox, Bubble-Board, Herz-Buzzer', c: ['#ffd9ec', '#b28dff', '#ff5fa8'] }
];
const MAX_PHOTO = 90 * 1024;
// Profilbild: nur JPEG (vom Client verkleinert), Magic-Bytes werden geprueft
function photoFromData(d) {
  if (typeof d !== 'string' || d.length > 130000) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(d);
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  return b.length > 100 && b.length <= MAX_PHOTO && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? b : null;
}
function setPhoto(p, buf) { p.photo = buf || null; p.photoV = Date.now(); }
const themeOk = id => THEMES.some(t => t.id === id);
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

app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'media')));
app.get('/avatar/:code/:pid', (req, res) => {
  const r = rooms.get(String(req.params.code).toUpperCase());
  const p = r && r.players.find(x => x.id === req.params.pid);
  if (!p || !p.photo) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.send(p.photo);
});
app.get('/ping', (req, res) => res.type('text').send('ok'));   // Keep-alive gegen Einschlafen
app.get('/fragen-vorlage.json', (req, res) =>
  res.download(path.join(__dirname, 'fragen.json'), 'fragen.json'));

// Fragenpaket per HTTP hochladen (auch "Sofort-Pakete" mit eingebetteten Medien aus dem Editor).
// Medien liegen danach nur im Arbeitsspeicher dieses Raums und sind nach einem Neustart weg.
app.post('/upload', express.json({ limit: '56mb' }), (req, res) => {
  const { code, token: tok, paket } = req.body || {};
  const room = rooms.get(str(code).toUpperCase());
  if (!room || room.hostToken !== tok) return res.status(403).json({ ok: false, error: 'Kein Zugriff auf diesen Raum.' });
  if (room.phase !== 'lobby') return res.json({ ok: false, error: 'Nur in der Lobby moeglich.' });
  try {
    if (!paket || typeof paket !== 'object') throw new Error('Kein Fragenpaket gefunden.');
    const blobs = new Map();
    let total = 0;
    const medien = paket.medien && typeof paket.medien === 'object' ? paket.medien : {};
    for (const [name, dataUrl] of Object.entries(medien)) {
      const safe = safeName(name);
      const m = /^data:(image\/[\w+.-]+|audio\/[\w+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
      if (!safe || !m) throw new Error('Medium "' + str(name, 60) + '" hat ein ungueltiges Format.');
      const buf = Buffer.from(m[2], 'base64');
      total += buf.length;
      if (total > MAX_UPLOAD) throw new Error('Eingebettete Medien zu gross (maximal 40 MB).');
      blobs.set(safe, { buf, mime: m[1] });
    }
    const fix = v => {
      const safe = safeName(str(v, 2000).replace(/^\/?media\//, ''));
      return blobs.has(safe) ? '/blob/' + room.code + '/' + encodeURIComponent(safe) : v;
    };
    const walk = f => { if (f && typeof f === 'object') ['bild', 'sound', 'antwortBild'].forEach(k => { if (f[k]) f[k] = fix(f[k]); }); };
    (Array.isArray(paket.kategorien) ? paket.kategorien : []).forEach(c => (c && Array.isArray(c.fragen) ? c.fragen : []).forEach(walk));
    if (paket.finale && Array.isArray(paket.finale.fragen)) paket.finale.fragen.forEach(walk);
    room.data = normalize(paket);
    room.fixed = fixedJokers(room.data);
    room.blobs = blobs;
    emitState(room);
    res.json({ ok: true, medien: blobs.size, bytes: total });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
// Spielstand sichern: alles, was der Raum weiss, als JSON zum Herunterladen (inkl. hochgeladener Medien)
app.post('/export', express.json({ limit: '1mb' }), (req, res) => {
  const { code, token: tok } = req.body || {};
  const room = rooms.get(str(code).toUpperCase());
  if (!room || room.hostToken !== tok) return res.status(403).json({ ok: false, error: 'Kein Zugriff auf diesen Raum.' });
  res.json({ ok: true, save: exportRoom(room) });
});
// Spielstand laden: in der Lobby eines neuen Raums. Der alte Raumcode wird uebernommen, wenn er frei ist,
// damit sich die Spieler ueber ihre gespeicherte Sitzung automatisch wieder verbinden koennen.
app.post('/restore', express.json({ limit: '56mb' }), (req, res) => {
  const { code, token: tok, save } = req.body || {};
  const room = rooms.get(str(code).toUpperCase());
  if (!room || room.hostToken !== tok) return res.status(403).json({ ok: false, error: 'Kein Zugriff auf diesen Raum.' });
  if (room.phase !== 'lobby') return res.json({ ok: false, error: 'Nur in der Lobby moeglich.' });
  try {
    if (!save || save.version !== 1 || !save.data) throw new Error('Das ist keine Spielstand-Datei.');
    const restored = importRoom(save);
    const oldCode = str(save.code).toUpperCase();
    const useOld = /^[A-Z0-9]{4}$/.test(oldCode) && (!rooms.has(oldCode) || oldCode === room.code);
    restored.code = useOld ? oldCode : room.code;
    restored.hostToken = useOld ? (str(save.hostToken, 40) || room.hostToken) : room.hostToken;
    restored.hostSocket = null;
    if (restored.code !== oldCode) {
      const fix = v => typeof v === 'string' ? v.replace('/blob/' + oldCode + '/', '/blob/' + restored.code + '/') : v;
      const walk = f => ['bild', 'sound', 'antwortBild'].forEach(k => { if (f[k]) f[k] = fix(f[k]); });
      restored.data.kategorien.forEach(c => c.fragen.forEach(walk));
      if (restored.data.finale) restored.data.finale.fragen.forEach(walk);
    }
    rooms.delete(room.code);
    rooms.set(restored.code, restored);
    res.json({ ok: true, code: restored.code, token: restored.hostToken, players: restored.players.length, sameCode: useOld });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.get('/blob/:code/:name', (req, res) => {
  const room = rooms.get(req.params.code);
  const b = room && room.blobs && room.blobs.get(req.params.name);
  if (!b) return res.status(404).type('text').send('Nicht gefunden. Hochgeladene Medien gehen beim Neustart des Servers verloren.');
  res.set('Content-Type', b.mime);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(b.buf);
});

// ---------- Fragen ----------
const str = (v, max = 1000) => String(v == null ? '' : v).trim().slice(0, max);

const safeName = n => str(n, 80).toLowerCase().replace(/[^\w\-.]/g, '_');

// Medien: https-Link, hochgeladenes Medium (/blob/...) oder Dateiname im Ordner "media"
function mediaPath(v) {
  v = str(v, 2000);
  if (!v) return '';
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^\/blob\/[A-Z0-9]{4}\/[\w\-.%]+$/.test(v)) return v;
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

function normQuestion(f, finale) {
  f = f || {};
  const t = str(f.typ, 20).toLowerCase().replace('ä', 'ae');
  const zeit = Math.round(Number(f.zeit)), dauer = Math.round(Number(f.dauer));
  const q = {
    frage: str(f.frage), antwort: str(f.antwort),
    bild: mediaPath(f.bild), sound: mediaPath(f.sound), antwortBild: mediaPath(f.antwortBild),
    joker: !!f.joker,
    typ: finale ? 'finale' : t === 'schaetzen' ? 'schaetzen' : t === 'reveal' ? 'reveal' : 'buzzer',
    zeit: Number.isFinite(zeit) && zeit > 0 ? Math.min(zeit, 600) : 0,
    dauer: Number.isFinite(dauer) && dauer >= 4 ? Math.min(dauer, 120) : 20,
    einheit: str(f.einheit, 10)
  };
  if (q.typ === 'reveal' && !q.bild && !q.sound) q.typ = 'buzzer';   // ohne Bild oder Sound gibt es nichts zu enthuellen
  return q;
}

function normalize(data) {
  if (!data || !Array.isArray(data.kategorien) || !data.kategorien.length)
    throw new Error('Die Datei braucht eine Liste "kategorien".');
  if (data.kategorien.length > MAX_CATS)
    throw new Error('Maximal ' + MAX_CATS + ' Kategorien erlaubt.');
  // Punktwerte: "werte" (Liste) oder "schritt" (100, 200, ...), Anzahl Stufen = laengste Kategorie
  const werte = Array.isArray(data.werte) ? data.werte.map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round).slice(0, MAX_ROWS) : [];
  const longest = Math.max(1, ...data.kategorien.map(c => Array.isArray(c.fragen) ? c.fragen.length : 0));
  const rows = werte.length || Math.min(MAX_ROWS, longest);
  const schritt = Math.round(Number(data.schritt));
  const values = werte.length ? werte : Array.from({ length: rows }, (_, i) => (schritt > 0 ? schritt : 100) * (i + 1));
  const out = {
    titel: str(data.titel, 40) || 'Quiz Show',
    values,
    kategorien: data.kategorien.map((c, i) => {
      const fragen = (Array.isArray(c.fragen) ? c.fragen : []).slice(0, rows).map(f => normQuestion(f, false));
      if (!fragen.length) throw new Error('Kategorie ' + (i + 1) + ' hat keine Fragen.');
      return { name: str(c.name, 60) || 'Kategorie ' + (i + 1), fragen };
    }),
    finale: null
  };
  const fin = data.finale;
  if (fin && Array.isArray(fin.fragen) && fin.fragen.length) {
    out.finale = { name: str(fin.name, 40) || 'Finale', fragen: fin.fragen.slice(0, 20).map(f => normQuestion(f, true)) };
  }
  return out;
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
const V = room => room.data.values;
const qOf = (room, ci, ri) =>
  Number.isInteger(ci) && Number.isInteger(ri) && room.data.kategorien[ci] ? room.data.kategorien[ci].fragen[ri] : undefined;
const curQ = (room, cur) => cur.typ === 'finale' ? room.data.finale.fragen[cur.idx] : qOf(room, cur.cat, cur.row);
const player = (room, id) => room.players.find(p => p.id === id);
const newStats = () => ({ buzz: 0, fastest: null, correct: 0, wrong: 0, jokers: 0, bestGain: 0, guessWins: 0, bestStreak: 0 });
// Farbe/Avatar pruefen; ungueltig -> erste freie Farbe bzw. zufaelliger Avatar
function pickLook(room, color, avatar) {
  let c = Number(color), a = Number(avatar);
  if (!Number.isInteger(c) || c < 0 || c >= COLORS.length) {
    const used = new Set(room.players.map(p => p.color));
    c = COLORS.findIndex((_, i) => !used.has(i));
    if (c < 0) c = crypto.randomInt(COLORS.length);
  }
  if (!Number.isInteger(a) || a < 0 || a >= AVATARS.length) a = crypto.randomInt(AVATARS.length);
  return { color: c, avatar: a };
}
// Kurze Einblendungen fuer alle (Serie, Comeback)
function notice(room, kind, text) {
  room.notices.push({ id: crypto.randomBytes(3).toString('hex'), kind, text, at: Date.now() });
  room.notices = room.notices.slice(-5);
}
// Rueckgaengig: Zustand vor einer Wertung sichern (Punkte, Joker, Board, aktuelle Frage)
function snapshot(room, label) {
  const cur = room.current;
  return {
    label,
    players: room.players.map(p => ({ id: p.id, score: p.score, jokers: [...p.jokers], pendingPick: p.pendingPick, stats: { ...p.stats }, streak: p.streak })),
    used: new Set(room.used), picker: room.picker, phase: room.phase, done: room.done,
    fin: room.fin ? { ...room.fin } : null,
    current: cur ? structuredClone({ ...cur, t: {}, window: null }) : null
  };
}
function restore(room, snap) {
  clearTimers(room.current);
  clearTimeout(room.timer); room.interlude = null;
  snap.players.forEach(sp => {
    const p = player(room, sp.id);
    if (p) { p.score = sp.score; p.jokers = [...sp.jokers]; p.pendingPick = sp.pendingPick; p.stats = { ...sp.stats }; p.streak = sp.streak; }
  });
  room.used = new Set(snap.used); room.picker = snap.picker; room.phase = snap.phase; room.done = snap.done;
  room.fin = snap.fin ? { ...snap.fin } : null;
  const c = snap.current ? structuredClone(snap.current) : null;
  if (c) { c.t = {}; c.window = null; c.deadline = 0; c.timeUp = false; c.audio = { ...c.audio, on: false }; }
  room.current = c;
  room.undo = null;
}

function tileState(room, ci, ri) {
  if (!qOf(room, ci, ri)) return 'none';
  return room.used.has(key(ci, ri)) ? 'used' : 'free';
}
function freeTiles(room) {
  let n = 0;
  room.data.kategorien.forEach((c, ci) =>
    V(room).forEach((_, ri) => { if (tileState(room, ci, ri) === 'free') n++; }));
  return n;
}
function fixedJokers(data) {
  const s = new Set();
  data.kategorien.forEach((c, ci) => c.fragen.forEach((f, ri) => { if (f.joker) s.add(key(ci, ri)); }));
  return s;
}
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
    openedAt: 0, buzzOpen: 0, stage: 0, buzzes: [], shown: false,
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

// ---------- Spielstand sichern / laden ----------
const serCur = cur => cur ? { ...cur, t: undefined, window: null, locked: cur.locked ? [...cur.locked] : undefined } : null;
function exportRoom(room) {
  const blobs = {};
  room.blobs.forEach((b, name) => { blobs[name] = { mime: b.mime, b64: b.buf.toString('base64') }; });
  return {
    version: 1, savedAt: new Date().toISOString(), code: room.code, hostToken: room.hostToken,
    phase: room.phase, data: { ...room.data, werte: room.data.values }, settings: room.settings, picker: room.picker, done: room.done, fin: room.fin,
    used: [...room.used], fixed: [...room.fixed], jokers: [...room.jokers],
    players: room.players.map(p => ({ id: p.id, token: p.token, name: p.name, score: p.score, streak: p.streak, jokers: p.jokers, delay: p.delay || 0, photo: p.photo ? p.photo.toString('base64') : null, pendingPick: p.pendingPick, stats: p.stats, color: p.color, avatar: p.avatar })),
    current: serCur(room.current), blobs
  };
}
function importRoom(save) {
  const data = normalize(save.data);
  const blobs = new Map();
  Object.entries(save.blobs || {}).forEach(([name, b]) => {
    if (b && typeof b.b64 === 'string' && /^(image|audio)\//.test(b.mime || '')) blobs.set(safeName(name), { buf: Buffer.from(b.b64, 'base64'), mime: b.mime });
  });
  const players = (Array.isArray(save.players) ? save.players : []).slice(0, 30).map(p => ({
    id: str(p.id, 16) || crypto.randomBytes(4).toString('hex'), token: str(p.token, 40) || token(), name: str(p.name, 20) || 'Spieler',
    score: Number.isFinite(Number(p.score)) ? Math.round(Number(p.score)) : 0, streak: Number(p.streak) || 0,
    jokers: [...new Set(Array.isArray(p.jokers) ? p.jokers : [])].filter(j => JOKERS.includes(j)).slice(0, MAX_JOKERS),
    delay: DELAYS.includes(Number(p.delay)) ? Number(p.delay) : 0,
    photo: photoFromData(typeof p.photo === 'string' ? 'data:image/jpeg;base64,' + p.photo : null), photoV: Date.now(),
    pendingPick: Math.max(0, Number(p.pendingPick) || 0), stats: { ...newStats(), ...(p.stats || {}) },
    color: Number.isInteger(p.color) ? p.color : 0, avatar: Number.isInteger(p.avatar) ? p.avatar : 0,
    socketId: null, connected: false
  }));
  let cur = save.current && typeof save.current === 'object' ? { ...save.current } : null;
  if (cur) {
    cur.t = {}; cur.window = null; cur.deadline = 0; cur.timeUp = false;
    if (cur.locked) cur.locked = new Set(cur.locked);
    if (cur.audio) cur.audio = { ...cur.audio, on: false }; else cur.audio = { n: 0, on: false };
  }
  const phase = ['lobby', 'game', 'finale', 'end'].includes(save.phase) ? save.phase : 'lobby';
  const s = save.settings || {};
  return {
    code: null, hostToken: null, hostSocket: null, phase, data, players,
    used: new Set(save.used || []), fixed: new Set(save.fixed || []), jokers: new Set(save.jokers || []),
    current: cur, picker: save.picker || null, fin: save.fin || null, blobs,
    settings: { joker: Number(s.joker) >= 0 ? Number(s.joker) : 5, answerTime: Number(s.answerTime) || 10, guessTime: Number(s.guessTime) || 90, comeback: Number.isFinite(Number(s.comeback)) ? Number(s.comeback) : 20, theme: themeOk(s.theme) ? s.theme : 'classic' },
    touched: Date.now(), done: Number(save.done) || 0, interlude: null, timer: null, notices: [], undo: null
  };
}

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
  best(s => s.jokers, 'Jokerfreund', v => v + ' Joker eingesetzt');
  best(s => s.bestStreak >= STREAK_EVERY ? s.bestStreak : 0, 'Serientäter', v => v + ' richtige in Folge');
  best(s => s.wrong, 'Mut zur Lücke', v => v + ' Fehlversuche');
  return out;
}

// ---------- State ----------
function stateFor(room, forHost) {
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
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('state', stateFor(room, false)); });
}

setInterval(() => {
  const limit = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, r] of rooms) if (r.touched < limit) { clearTimers(r.current); clearTimeout(r.timer); rooms.delete(code); }
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
      picker: null, fin: null, blobs: new Map(), settings: { joker: 5, answerTime: 10, guessTime: 90, comeback: 20, theme: 'classic' }, touched: Date.now(),
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
    if (!me || cur.locked.has(pid)) return;
    if (me.delay && Date.now() < (cur.buzzOpen || 0) + me.delay * 1000 - 100) return;   // Handicap: Buzzer fuer diesen Spieler noch gesperrt
    let e = Number(elapsed);
    if (!Number.isFinite(e) || e < 0 || e > 99999) e = 99999;
    if (!cur.window) {
      cur.window = { candidates: [], at: Date.now() };
      cur.t.window = setTimeout(() => resolveBuzz(room), BUZZ_WINDOW);
      emitState(room);   // "pending": Buzzer bei allen kurz gesperrt
    }
    if (!cur.window.candidates.some(c => c.pid === pid)) { cur.window.candidates.push({ pid, elapsed: e }); me.stats.buzz++; }
  });

  // Schaetzung bzw. Finale-Antwort abgeben
  sock.on('player:guess', ({ text } = {}) => {
    const room = playerRoom();
    const cur = room && room.current;
    if (!cur) return;
    const pid = sock.data.pid;
    if (!player(room, pid)) return;
    if (cur.typ === 'finale') {
      if (cur.state !== 'play' || !cur.participants.includes(pid)) return;
      const t = str(text, 100);
      if (!t) return;
      cur.answers[pid] = t;
    } else {
      if (cur.typ !== 'schaetzen' || cur.state !== 'open' || cur.locked.has(pid)) return;
      const t = str(text, 40);
      if (!t) return;
      cur.guesses[pid] = { text: t, num: parseNum(t) };
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
  sock.on('host:skip', () => {
    const room = hostRoom();
    const cur = room && room.current;
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
    else toReveal(room, cur, 'none');
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

  sock.on('host:kick', ({ id } = {}) => {
    const room = hostRoom();
    if (!room) return;
    const p = player(room, id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
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
      cur.locked.delete(id);
      delete cur.guesses[id];
      cur.order = cur.order.filter(x => x !== id); delete cur.marks[id];
      cur.revealed = Math.min(cur.revealed, cur.order.length);
      if (cur.state === 'review' && cur.revealed >= cur.order.length) cur.state = 'judge';
      cur.winners = cur.winners.filter(x => x !== id);
      if (cur.window) cur.window.candidates = cur.window.candidates.filter(c => c.pid !== id);
      if (cur.buzzer === id) { clearTimeout(cur.t.answer); cur.buzzer = null; cur.timeUp = false; cur.deadline = 0; cur.state = 'open'; cur.buzzOpen = Date.now(); }
    }
    emitState(room);
  });

  sock.on('host:end', () => {
    const room = hostRoom();
    if (!room) return;
    clearTimers(room.current);
    clearTimeout(room.timer); room.interlude = null; room.undo = null;
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
      // Platz zurueckholen: gleicher Name, Spieler gerade nicht verbunden (z. B. nach Neustart oder geladenem Spielstand)
      const seat = room.players.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (seat && !seat.connected) { p = seat; p.token = token(); }
      else if (room.phase !== 'lobby') return cb({ ok: false, error: 'Das Spiel laeuft bereits.' });
      else if (seat) return cb({ ok: false, error: 'Dieser Name ist schon vergeben.' });
    }
    if (!p) {
      const name = str(msg.name, 20);
      if (room.players.length >= 30) return cb({ ok: false, error: 'Der Raum ist voll.' });
      p = { id: crypto.randomBytes(4).toString('hex'), token: token(), name, score: 0, streak: 0,
            jokers: [], delay: 0, photo: null, photoV: 0, pendingPick: 0, stats: newStats(), socketId: null, connected: false, ...pickLook(room, msg.color, msg.avatar) };
      room.players.push(p);
    }
    if (!p.photo && msg.photo) { const b = photoFromData(msg.photo); if (b) setPhoto(p, b); }
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
