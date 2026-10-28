'use strict';
// HTTP-Routen: Medien, Upload, Export, Wiederherstellen
const path = require('path');
const express = require('express');
const ROOT = path.join(__dirname, '..');   // Projektordner
const { MAX_UPLOAD, rooms } = require('./config');
const hub = require('./hub');
const app = hub.app;
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const emitState = (...a) => hub.emitState(...a);
const exportRoom = (...a) => hub.exportRoom(...a);
const fixedJokers = (...a) => hub.fixedJokers(...a);
const importRoom = (...a) => hub.importRoom(...a);
const normalize = (...a) => hub.normalize(...a);
const safeName = (...a) => hub.safeName(...a);
const str = (...a) => hub.str(...a);

app.use(express.static(path.join(ROOT, 'public')));
app.use('/media', express.static(path.join(ROOT, 'media')));
app.get('/avatar/:code/:pid', (req, res) => {
  const r = rooms.get(String(req.params.code).toUpperCase());
  const p = r && r.players.find(x => x.id === req.params.pid);
  if (!p || !p.photo) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.send(p.photo);
});
app.get('/ping', (req, res) => res.type('text').send('ok'));   // Keep-alive gegen Einschlafen
app.get('/fragen-vorlage.json', (req, res) =>
  res.download(path.join(ROOT, 'fragen.json'), 'fragen.json'));
app.get('/beispiel-minigames.json', (req, res) =>
  res.download(path.join(ROOT, 'beispiel-minigames.json'), 'beispiel-minigames.json'));

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
    const walk = f => {
      if (!f || typeof f !== 'object') return;
      ['bild', 'sound', 'antwortBild', 'karte'].forEach(k => { if (f[k]) f[k] = fix(f[k]); });
      const fixItem = it => { if (it && typeof it === 'object' && it.bild) it.bild = fix(it.bild); };
      if (Array.isArray(f.items)) f.items.forEach(fixItem);
      if (Array.isArray(f.paare)) f.paare.forEach(p => { if (p) { fixItem(p.links); fixItem(p.rechts); } });
    };
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
      const walk = f => ['bild', 'sound', 'antwortBild', 'karte'].forEach(k => { if (f[k]) f[k] = fix(f[k]); });
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
