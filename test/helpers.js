'use strict';
// Hilfen fuer die Tests: Server starten, Raum mit Bot-Spielern aufbauen, Pruefungen zaehlen
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const wait = ms => new Promise(r => setTimeout(r, ms));
const ack = (sock, ev, ...a) => new Promise(r => sock.emit(ev, ...a, r));
const connect = url => new Promise(res => { const s = io(url, { transports: ['websocket'] }); s.on('connect', () => res(s)); });

async function startServer() {
  const port = 4100 + Math.floor(Math.random() * 800);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Server startet nicht')), 10000);
    p.stdout.on('data', d => { if (String(d).includes('Quiz laeuft')) { clearTimeout(t); res(); } });
    p.stderr.on('data', d => process.stderr.write(d));
    p.on('exit', c => rej(new Error('Server beendet, Code ' + c)));
  });
  return { url: 'http://localhost:' + port, stop: () => p.kill() };
}

// Ein Raum mit Spielleiter und Bot-Spielern, Spiel ist schon gestartet
async function newGame(url, pkg, names = ['Anna', 'Basti', 'Cleo'], settings = { joker: 0, comeback: 0 }) {
  const g = { url, HS: null, players: [], host: await connect(url) };
  g.host.on('state', s => { g.HS = s; });
  const h = await ack(g.host, 'host:create');
  g.code = h.code; g.token = h.token;
  for (const name of names) {
    const sock = await connect(url), pl = { name, sock, S: null };
    sock.on('state', s => { pl.S = s; });
    const r = await ack(sock, 'player:join', { code: g.code, name });
    if (!r || !r.ok) throw new Error('Beitritt fehlgeschlagen: ' + JSON.stringify(r));
    pl.pid = r.pid || (r.player && r.player.id) || r.id;
    g.players.push(pl);
  }
  const q = await ack(g.host, 'host:setQuestions', pkg);
  if (!q.ok) throw new Error('Fragenpaket abgelehnt: ' + q.error);
  g.host.emit('host:setSettings', settings);
  g.host.emit('host:start');
  await wait(200);
  g.byPid = id => g.players.find(p => p.pid === id);
  g.score = pid => g.HS.players.find(p => p.id === pid).score;
  g.cur = () => g.HS.current;
  g.close = () => { g.host.close(); g.players.forEach(p => p.sock.close()); };
  g.pick = async (cat, row) => { g.host.emit('host:pick', { cat, row }); await wait(120); };
  g.open = async () => { g.host.emit('host:open'); await wait(150); };
  return g;
}

// Einfaches Pruefungs-Protokoll
function reporter() {
  const r = { fails: 0, total: 0 };
  r.ok = (cond, msg) => { r.total++; console.log((cond ? '  OK   ' : '  FAIL ') + msg); if (!cond) r.fails++; };
  return r;
}
module.exports = { wait, ack, connect, startServer, newGame, reporter };
