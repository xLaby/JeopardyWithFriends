// Bot-Test: spielt Sortieren (rundenbasiert) und Geo (Kartenbild) ueber echte Socket-Verbindungen durch
const { io } = require('socket.io-client');
const URL = 'http://localhost:' + (process.env.PORT || 3111);
const wait = ms => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise(res => { const s = io(URL, { transports: ['websocket'] }); s.on('connect', () => res(s)); });
const emitCb = (s, ev, ...a) => new Promise(r => s.emit(ev, ...a, r));
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const host = await connect(); let HS = null; host.on('state', s => HS = s);
  const h = await emitCb(host, 'host:create');
  const mk = async name => { const s = await connect(); const st = { S: null }; s.on('state', x => st.S = x); const r = await emitCb(s, 'player:join', { code: h.code, name }); st.pid = r.pid; st.sock = s; return st; };
  const A = await mk('Anna'), B = await mk('Basti'), C = await mk('Cleo');
  // Paket: 1 Sortier-Frage, 1 Geo-Frage
  const pkg = { titel: 'T', werte: [100, 200], kategorien: [{ name: 'Mini', fragen: [
    { typ: 'sortieren', frage: 'Sortiere', herzen: 2, zeit: 3, items: [{ text: 'a', info: '1' }, { text: 'b', info: '2' }, { text: 'c', info: '3' }, { text: 'd', info: '4' }] },
    { typ: 'geo', frage: 'Wo?', antwort: 'Burg', karte: 'beispiel-karte.png', aspekt: 1.5, ziel: { x: 0.5, y: 0.5 } } ] }] };
  const r = await emitCb(host, 'host:setQuestions', pkg); ok(r.ok, 'Paket akzeptiert');
  host.emit('host:setSettings', { joker: 0 });
  host.emit('host:start'); await wait(150);
  ok(HS.phase === 'game', 'Spiel gestartet');
  // --- Sortieren
  host.emit('host:pick', { cat: 0, row: 0 }); await wait(100);
  host.emit('host:open'); await wait(150);
  const sort = () => A.S.current.mini.sort;
  ok(!!sort(), 'Sort-State vorhanden'); ok(sort().n === 4, '4 Plaetze');
  ok(sort().placed.filter(Boolean).length === 1, 'genau ein Start-Gegenstand liegt');
  ok(sort().pool.length === 3 && sort().pool.every(i => i.info === ''), 'Pool ohne Infos');
  ok(!JSON.stringify(A.S.current).includes('truth'), 'Loesung nicht im Spieler-State');
  const st = [A, B, C], byPid = id => st.find(x => x.pid === id);
  const first = sort().turn; ok(!!first, 'jemand ist dran: ' + byPid(first).S.players.find(p => p.id === first).name);
  // falscher Spieler darf nicht
  const other = st.find(x => x.pid !== first);
  const it0 = sort().pool[0];
  other.sock.emit('player:sortPlace', { item: it0.id, slot: 0 }); await wait(100);
  ok(sort().placed.filter(Boolean).length === 1 && sort().turn === first, 'Zug des Falschen wird ignoriert');
  // Loesung ermitteln: Host sieht hostTruth in Reihenfolge (Text)
  const truthText = HS.current.mini.hostTruth.map(x => x.text);
  const idByText = {}; const all = [...sort().pool, ...sort().placed.filter(Boolean)]; all.forEach(i => idByText[i.text] = i.id);
  const free = () => sort().placed.map((p, i) => p ? -1 : i).filter(i => i >= 0);
  // erster Spieler setzt falsch (ersten freien Platz, aber einen Gegenstand der dort nicht hingehoert)
  const slotF = free()[0]; const wrongItem = sort().pool.find(i => i.text !== truthText[slotF]);
  byPid(first).sock.emit('player:sortPlace', { item: wrongItem.id, slot: slotF }); await wait(150);
  ok(sort().hearts[first] === 1 && sort().last && !sort().last.ok, 'falsch: Herz weg');
  ok(sort().pool.some(i => i.id === wrongItem.id), 'falscher Gegenstand bleibt im Pool');
  ok(sort().turn !== first, 'Zug wechselt');
  // doppelter Slot / bereits gesetzter Gegenstand
  // alle setzen jetzt richtig, bis das Brett voll ist
  for (let guard = 0; guard < 10 && HS.current && HS.current.state === 'open'; guard++) {
    const t = sort().turn; if (!t) break;
    const slot = free()[0]; if (slot == null) break;
    byPid(t).sock.emit('player:sortPlace', { item: idByText[truthText[slot]], slot }); await wait(120);
  }
  await wait(200);
  ok(HS.current.state === 'reveal', 'Brett voll -> Aufloesung');
  const rk = HS.current.mini.result.ranking;
  ok(rk[0].rank === 1 && rk[0].factor === 1, 'Gewinner steht fest');
  const w = HS.current.winners; ok(w.length >= 1 && !w.includes(first), 'Spieler mit Herzverlust gewinnt nicht');
  const sc = pid => HS.players.find(p => p.id === pid).score;
  ok(w.every(id => sc(id) === 100), 'Gewinner bekommt vollen Feldwert (100)');
  ok(HS.current.mini.result.truth.map(x => x.text).join() === truthText.join(), 'Aufloesung zeigt richtige Reihenfolge');
  // Rueckgaengig
  host.emit('host:undo'); await wait(150);
  ok(HS.current.state === 'open' && w.every(id => sc(id) === 0), 'Rueckgaengig stellt Punkte und Spiel wieder her');
  ok(!!HS.current.mini.sort.turn, 'Zug laeuft nach Undo weiter');
  // Zeitablauf: Zug laeuft ab -> Herz weg (zeit=3 s)
  const t0 = sort().turn, h0 = sort().hearts[t0];
  await wait(3500);
  ok(sort().hearts[t0] === h0 - 1 && sort().last.timeout, 'Zeitablauf kostet ein Herz');
  // Host beendet
  host.emit('host:skip'); await wait(150);
  ok(HS.current.state === 'reveal', 'Host kann beenden und werten');
  host.emit('host:close'); await wait(100);
  // --- Geo mit Kartenbild
  host.emit('host:pick', { cat: 0, row: 1 }); await wait(100);
  ok(HS.current.typ === 'geo', 'Geo-Frage');
  ok(HS.current.mini.karte === 'media/beispiel-karte.png', 'Host sieht Kartenpfad');
  ok(HS.current.mini.hostTruth.x === 0.5, 'Host sieht Ziel');
  ok(A.S.current.mini.karte === undefined, 'Spieler sehen Karte erst nach Freigabe');
  host.emit('host:open'); await wait(150);
  ok(A.S.current.mini.karte === 'media/beispiel-karte.png', 'Spieler sehen Karte nach Freigabe');
  ok(!JSON.stringify(A.S.current).includes('"ziel"') && A.S.current.mini.hostTruth === undefined, 'Ziel nicht im Spieler-State');
  A.sock.emit('player:mini', { ans: { x: 0.52, y: 0.5 }, done: true });   // nah
  B.sock.emit('player:mini', { ans: { x: 0.9, y: 0.1 }, done: true });    // weit
  C.sock.emit('player:mini', { ans: { x: 7, y: 0.1 }, done: true });      // ungueltig -> ignoriert
  await wait(200);
  ok(HS.current.mini.submitted.length === 2, 'ungueltiger Pin wird abgelehnt');
  host.emit('host:skip'); await wait(200);
  const gr = HS.current.mini.result.ranking;
  ok(gr[0].pid === A.pid && gr[0].rank === 1, 'Naechster Pin gewinnt');
  ok(HS.current.mini.result.truth.x === 0.5 && gr[0].pin.x === 0.52, 'Aufloesung mit Ziel und Pins');
  ok(/%/.test(gr[0].detail), 'Abstand in Prozent: ' + gr[0].detail);
  console.log(fails ? '\n' + fails + ' FEHLER' : '\nALLE TESTS OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
