'use strict';
// Mini-Games: Sortieren (rundenbasiert), Zuordnen, Geoguessr (Kartenbild)
const { wait, newGame } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300, 400], kategorien: [{ name: 'Mini', fragen: [
  { typ: 'sortieren', frage: 'Sortiere', herzen: 2, zeit: 3, items: [{ text: 'a', info: '1' }, { text: 'b', info: '2' }, { text: 'c', info: '3' }, { text: 'd', info: '4' }] },
  { typ: 'geo', frage: 'Wo?', antwort: 'Burg', karte: 'beispiel-karte.png', aspekt: 1.5, ziel: { x: 0.5, y: 0.5 } },
  { typ: 'zuordnen', frage: 'Paare', paare: [{ links: 'DE', rechts: 'Berlin' }, { links: 'FR', rechts: 'Paris' }, { links: 'IT', rechts: 'Rom' }] },
  { typ: 'sortieren', frage: 'Sortiere 2', zeit: 20, items: ['x', 'y', 'z'] }] }] };

module.exports = async ({ url, t }) => {
  const g = await newGame(url, PKG);
  const [A, B, C] = g.players;
  const sort = () => g.HS.current.mini.sort;   // Zustand des Spielleiters (bleibt auch dann aktuell, wenn ein Spieler-Socket getrennt wird)

  console.log('Sortieren');
  await g.pick(0, 0); await g.open();
  t.ok(!!sort() && sort().n === 4, 'Brett mit 4 Plätzen');
  t.ok(sort().placed.filter(Boolean).length === 1, 'Genau ein Start-Gegenstand liegt');
  t.ok(sort().pool.length === 3 && sort().pool.every(i => i.info === ''), 'Pool zeigt noch keine Werte');
  t.ok(!JSON.stringify(A.S.current).includes('truth'), 'Lösung steckt nicht im Spieler-Zustand');
  const first = sort().turn;
  t.ok(!!first, 'Jemand ist dran');
  const other = g.players.find(p => p.pid !== first);
  other.sock.emit('player:sortPlace', { item: sort().pool[0].id, slot: 0 }); await wait(120);
  t.ok(sort().placed.filter(Boolean).length === 1 && sort().turn === first, 'Zug des Falschen wird ignoriert');
  const truth = g.HS.current.mini.hostTruth.map(x => x.text);
  const idByText = {}; [...sort().pool, ...sort().placed.filter(Boolean)].forEach(i => { idByText[i.text] = i.id; });
  const free = () => sort().placed.map((p, i) => p ? -1 : i).filter(i => i >= 0);
  const slotF = free()[0], wrongItem = sort().pool.find(i => i.text !== truth[slotF]);
  g.byPid(first).sock.emit('player:sortPlace', { item: wrongItem.id, slot: slotF }); await wait(150);
  t.ok(sort().hearts[first] === 1 && sort().last && !sort().last.ok, 'Falsch gesetzt: ein Herz weg');
  t.ok(sort().pool.some(i => i.id === wrongItem.id), 'Falscher Gegenstand bleibt im Pool');
  t.ok(sort().turn !== first, 'Der Zug wechselt');
  for (let i = 0; i < 10 && g.cur().state === 'open'; i++) {
    const who = sort().turn, slot = free()[0]; if (!who || slot == null) break;
    g.byPid(who).sock.emit('player:sortPlace', { item: idByText[truth[slot]], slot }); await wait(120);
  }
  await wait(200);
  t.ok(g.cur().state === 'reveal', 'Brett voll: Auflösung');
  const w = g.cur().winners;
  t.ok(w.length >= 1 && !w.includes(first), 'Wer ein Herz verloren hat, gewinnt nicht');
  t.ok(w.every(id => g.score(id) === 100), 'Gewinner bekommt den vollen Feldwert');
  t.ok(g.cur().mini.result.truth.map(x => x.text).join() === truth.join(), 'Auflösung zeigt die richtige Reihenfolge');
  g.host.emit('host:undo'); await wait(150);
  t.ok(g.cur().state === 'open' && w.every(id => g.score(id) === 0) && !!sort().turn, 'Rückgängig: Spiel läuft weiter, Punkte zurück');
  const t0 = sort().turn, h0 = sort().hearts[t0];
  await wait(3500);
  t.ok(sort().hearts[t0] === h0 - 1 && sort().last.timeout, 'Zeit abgelaufen kostet ein Herz');
  g.host.emit('host:skip'); await wait(150);
  t.ok(g.cur().state === 'reveal', 'Spielleiter kann beenden und werten');
  g.host.emit('host:close'); await wait(120);

  console.log('Geoguessr mit Kartenbild');
  await g.pick(0, 1);
  t.ok(g.HS.current.mini.karte === 'media/beispiel-karte.png' && g.HS.current.mini.hostTruth.x === 0.5, 'Spielleiter sieht Karte und Ziel');
  t.ok(A.S.current.mini.karte === undefined, 'Spieler sehen die Karte erst nach der Freigabe');
  const before = Object.fromEntries(g.players.map(p => [p.pid, g.score(p.pid)]));
  await g.open();
  t.ok(A.S.current.mini.karte === 'media/beispiel-karte.png', 'Nach der Freigabe sehen alle die Karte');
  t.ok(!JSON.stringify(A.S.current).includes('hostTruth'), 'Ziel steckt nicht im Spieler-Zustand');
  A.sock.emit('player:mini', { ans: { x: 0.52, y: 0.5 }, done: true });
  B.sock.emit('player:mini', { ans: { x: 0.9, y: 0.1 }, done: true });
  C.sock.emit('player:mini', { ans: { x: 7, y: 0.1 }, done: true }); await wait(250);
  t.ok(g.HS.current.mini.submitted.length === 2, 'Pin außerhalb des Bildes wird abgelehnt');
  g.host.emit('host:skip'); await wait(200);
  const rk = g.cur().mini.result.ranking;
  t.ok(rk[0].pid === A.pid && rk[0].rank === 1, 'Der nächste Pin gewinnt');
  t.ok(g.score(A.pid) - before[A.pid] === 200, 'Nächster Pin bekommt den vollen Feldwert (200)');
  t.ok(g.score(B.pid) - before[B.pid] === 0, 'Nur der Nächste bekommt Punkte, der Zweite geht leer aus');
  t.ok(/%/.test(rk[0].detail), 'Abstand wird in Prozent gezeigt');
  g.host.emit('host:close'); await wait(120);

  console.log('Zuordnen');
  await g.pick(0, 2); await g.open();
  const hostPairs = g.HS.current.mini.hostTruth;
  const L = A.S.current.mini.left, R = A.S.current.mini.right;
  const idOf = (list, txt) => list.find(x => x.text === txt).id;
  const right = {}; hostPairs.forEach(p => { right[idOf(L, p.links.text)] = idOf(R, p.rechts.text); });
  const wrong = { ...right }; const ks = Object.keys(right); [wrong[ks[0]], wrong[ks[1]]] = [wrong[ks[1]], wrong[ks[0]]];
  A.sock.emit('player:mini', { ans: right, done: true }); B.sock.emit('player:mini', { ans: wrong, done: true }); C.sock.emit('player:mini', { ans: {}, done: true }); await wait(300);
  t.ok(g.cur().state === 'reveal', 'Alle fertig: sofort ausgewertet');
  const zr = g.cur().mini.result.ranking;
  t.ok(zr[0].pid === A.pid && zr[0].factor === 1 && zr[1].pid === B.pid && zr[1].factor === 0.75, 'Zuordnen: Rangpunkte 100 % und 75 %');
  g.host.emit('host:close'); await wait(120);

  console.log('Sortieren: Spieler fällt aus');
  await g.pick(0, 3); await g.open();
  const turn1 = sort().turn;
  g.byPid(turn1).sock.close(); await wait(250);
  t.ok(sort().turn && sort().turn !== turn1, 'Getrennter Spieler wird ohne Strafe übersprungen');
  t.ok(sort().hearts[turn1] === sort().maxHearts, 'Er verliert kein Herz');
  const turn2 = sort().turn;
  g.host.emit('host:kick', { id: turn2 }); await wait(250);
  t.ok(!sort() || (!sort().order.includes(turn2) && g.cur().state !== undefined), 'Entfernter Spieler ist aus der Zugfolge');
  g.host.emit('host:sortSkip'); await wait(150);
  g.host.close(); g.players.forEach(p => p.sock.close());
};
