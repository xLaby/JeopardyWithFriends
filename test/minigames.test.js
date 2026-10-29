'use strict';
// Mini-Games: Sortieren (rundenbasiert), Zuordnen, Geoguessr (Kartenbild)
const { wait, newGame } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300, 400, 500], kategorien: [{ name: 'Mini', fragen: [
  { typ: 'sortieren', frage: 'Sortiere', herzen: 2, zeit: 3, items: [{ text: 'a', info: '1' }, { text: 'b', info: '2' }, { text: 'c', info: '3' }, { text: 'd', info: '4' }] },
  { typ: 'geo', frage: 'Wo?', antwort: 'Burg', karte: 'beispiel-karte.png', aspekt: 1.5, ziel: { x: 0.5, y: 0.5 } },
  { typ: 'zuordnen', frage: 'Paare', paare: [{ links: 'DE', rechts: 'Berlin' }, { links: 'FR', rechts: 'Paris' }, { links: 'IT', rechts: 'Rom' }] },
  { typ: 'sortieren', frage: 'Sortiere 2', zeit: 20, items: ['x', 'y', 'z'] },
  { typ: 'sortieren', frage: 'Streng', streng: true, herzen: 3, zeit: 20, items: ['p', 'q', 'r', 's', 't'] }] }] };

module.exports = async ({ url, t }) => {
  const g = await newGame(url, PKG);
  const [A, B, C] = g.players;
  const sort = () => g.HS.current.mini.sort;   // Zustand des Spielleiters (bleibt auch dann aktuell, wenn ein Spieler-Socket getrennt wird)

  // Hilfen fuer die links/rechts-Regel: die Wahrheit kennt nur der Spielleiter (hostTruth), die Spieler sehen nur Reihe und Pool
  const truthTexts = () => g.HS.current.mini.hostTruth.map(x => x.text);
  const textOf = id => { const it = [...sort().pool, ...sort().line].find(i => i.id === id); return it && it.text; };
  const tIdx = id => truthTexts().indexOf(textOf(id));
  const move = (pid, item, ref, side) => { g.byPid(pid).sock.emit('player:sortPlace', { item, ref, side }); return wait(130); };
  const sideOf = (item, ref) => tIdx(item) < tIdx(ref) ? 'left' : 'right';                    // die richtige Seite
  const other = s => s === 'left' ? 'right' : 'left';
  // ein richtiger Zug mit dem naechsten Nachbarn als Bezug
  const goodMove = async () => {
    const who = sort().turn, X = sort().pool[0], R = sort().line.reduce((b, it) => Math.abs(tIdx(it) - tIdx(X.id)) < Math.abs(tIdx(b) - tIdx(X.id)) ? it.id : b, sort().line[0].id);
    await move(who, X.id, R, sideOf(X.id, R));
  };
  // eine wahre, aber nicht direkt angrenzende Behauptung suchen (zwischen Gegenstand und Bezug liegt noch ein anderer)
  const farClaim = () => {
    for (const X of sort().pool) for (const R of sort().line) {
      const lo = Math.min(tIdx(X.id), tIdx(R.id)), hi = Math.max(tIdx(X.id), tIdx(R.id));
      if (sort().line.some(L => tIdx(L.id) > lo && tIdx(L.id) < hi)) return { X: X.id, R: R.id, side: sideOf(X.id, R.id) };
    }
    return null;
  };

  console.log('Sortieren (links/rechts)');
  await g.pick(0, 0); await g.open();
  const truthAtStart = truthTexts();   // nach der Auflösung gibt es hostTruth nicht mehr
  t.ok(!!sort() && sort().n === 4, 'Reihe mit 4 Gegenständen im Spiel');
  t.ok(sort().line.length === 1 && sort().line[0].info !== '', 'Nur der Start-Gegenstand liegt, sein Wert ist sichtbar');
  t.ok(sort().pool.length === 3 && sort().pool.every(i => i.info === ''), 'Pool zeigt noch keine Werte');
  t.ok(!JSON.stringify(A.S.current).includes('truth') && !JSON.stringify(A.S.current).includes('hostTruth'), 'Lösung steckt nicht im Spieler-Zustand');
  const first = sort().turn;
  t.ok(!!first, 'Jemand ist dran');
  const outsider = g.players.find(p => p.pid !== first);
  await move(outsider.pid, sort().pool[0].id, sort().line[0].id, 'left');
  t.ok(sort().line.length === 1 && sort().turn === first && sort().last === null, 'Zug des Falschen wird ignoriert');
  await move(first, sort().pool[0].id, sort().pool[1].id, 'left');
  t.ok(sort().line.length === 1 && sort().turn === first, 'Bezug muss schon liegen (Pool-Gegenstand als Bezug wird ignoriert)');
  await move(first, sort().line[0].id, sort().line[0].id, 'left');
  t.ok(sort().turn === first && sort().last === null, 'Ein liegender Gegenstand kann nicht noch einmal gesetzt werden');
  const X0 = sort().pool[0], S0 = sort().line[0];
  await move(first, X0.id, S0.id, other(sideOf(X0.id, S0.id)));
  t.ok(sort().hearts[first] === 1 && sort().last && !sort().last.ok, 'Falsche Seite: ein Herz weg');
  t.ok(sort().pool.some(i => i.id === X0.id) && sort().line.length === 1, 'Falscher Gegenstand bleibt im Pool');
  t.ok(sort().turn !== first, 'Der Zug wechselt');
  for (let i = 0; i < 6 && sort().line.length < 3; i++) await goodMove();
  t.ok(sort().line.length === 3, 'Richtige Züge legen den Gegenstand an seinen Platz in der Reihe');
  const lineIdx = sort().line.map(it => tIdx(it.id));
  t.ok(lineIdx.every((v, i) => i === 0 || v > lineIdx[i - 1]), 'Die Reihe ist immer richtig sortiert');
  const far = farClaim();
  if (far) { await move(sort().turn, far.X, far.R, far.side); t.ok(sort().last.ok, 'Normal: richtige Seite reicht, auch ohne direkt daneben'); }
  for (let i = 0; i < 10 && g.cur().state === 'open'; i++) await goodMove();
  await wait(200);
  t.ok(g.cur().state === 'reveal', 'Reihe voll: Auflösung');
  const w = g.cur().winners;
  t.ok(w.length >= 1 && !w.includes(first), 'Wer ein Herz verloren hat, gewinnt nicht');
  t.ok(w.every(id => g.score(id) === 100), 'Gewinner bekommt den vollen Feldwert');
  t.ok(g.cur().mini.result.truth.map(x => x.text).join() === truthAtStart.join(), 'Auflösung zeigt die richtige Reihenfolge (mit Nummern)');
  g.host.emit('host:undo'); await wait(150);
  t.ok(g.cur().state === 'open' && w.every(id => g.score(id) === 0) && !!sort().turn, 'Rückgängig: Spiel läuft weiter, Punkte zurück');
  const t0 = sort().turn, h0 = sort().hearts[t0];
  await wait(3500);
  t.ok(sort().hearts[t0] === h0 - 1 && sort().last.timeout, 'Zeit abgelaufen kostet ein Herz');
  g.host.emit('host:skip'); await wait(150);
  t.ok(g.cur().state === 'reveal', 'Spielleiter kann beenden und werten');
  g.host.emit('host:close'); await wait(120);

  console.log('Sortieren: streng (direkt daneben)');
  await g.pick(0, 4); await g.open();
  t.ok(sort().streng === true, 'Strenger Modus ist aktiv');
  for (let i = 0; i < 6 && sort().line.length < 3; i++) await goodMove();
  const hard = farClaim();
  t.ok(!!hard, 'Es gibt eine Behauptung, die richtig, aber nicht direkt daneben ist');
  if (hard) {
    const who = sort().turn, hb = sort().hearts[who], poolBefore = sort().pool.length;
    await move(who, hard.X, hard.R, hard.side);
    t.ok(sort().hearts[who] === hb - 1 && sort().pool.length === poolBefore && !sort().last.ok, 'Streng: nicht direkt daneben gilt als falsch');
    const X = sort().pool[0], R = sort().line.reduce((b, it) => Math.abs(tIdx(it.id) - tIdx(X.id)) < Math.abs(tIdx(b) - tIdx(X.id)) ? it.id : b, sort().line[0].id);
    await move(sort().turn, X.id, R, sideOf(X.id, R));
    t.ok(sort().last.ok, 'Streng: direkt neben dem Nachbarn ist richtig');
  }
  g.host.emit('host:skip'); await wait(150); g.host.emit('host:close'); await wait(120);

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
