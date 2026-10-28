'use strict';
// Spielstand sichern und laden
const crypto = require('crypto');
const { JOKERS, MAX_JOKERS, DELAYS } = require('./config');
const hub = require('./hub');
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const newStats = (...a) => hub.newStats(...a);
const normalize = (...a) => hub.normalize(...a);
const photoFromData = (...a) => hub.photoFromData(...a);
const safeName = (...a) => hub.safeName(...a);
const str = (...a) => hub.str(...a);
const themeOk = (...a) => hub.themeOk(...a);
const token = (...a) => hub.token(...a);

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


hub.register({ serCur, exportRoom, importRoom });
