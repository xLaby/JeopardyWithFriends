'use strict';
// Raeume, Spieler, Rueckgaengig-Snapshots, Joker-Verteilung, Spielerreihenfolge
const crypto = require('crypto');
const { THEMES, MAX_PHOTO, COLORS, AVATARS, rooms } = require('./config');
const hub = require('./hub');
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const clearTimers = (...a) => hub.clearTimers(...a);
const sortStartTurn = (...a) => hub.sortStartTurn(...a);

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
const newStats = () => ({ buzz: 0, fastest: null, correct: 0, wrong: 0, jokers: 0, bestGain: 0, guessWins: 0, miniWins: 0, bestStreak: 0 });
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
  if (c && c.typ === 'sortieren' && c.state === 'open' && c.mini && c.mini.sort && c.mini.sort.turn) sortStartTurn(room, c);   // Rueckgaengig: Zugzeit neu starten
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


hub.register({ photoFromData, setPhoto, themeOk, newCode, token, key, V, qOf, curQ, player, newStats, pickLook, notice, snapshot, restore, tileState, freeTiles, fixedJokers, assignJokers, nextPicker });
