'use strict';
// "Noch 5 Sekunden" (Nachfrist) und Mini-Games ohne Standard-Zeitlimit
const { wait, newGame } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300, 400, 500], kategorien: [{ name: 'A', fragen: [
  { frage: 'Buzzer-Frage', antwort: 'a1' },
  { typ: 'schaetzen', frage: 'Wie viel?', antwort: '100', einheit: '€' },
  { typ: 'geo', frage: 'Wo?', antwort: 'Burg', karte: 'beispiel-karte.png', aspekt: 1.5, ziel: { x: 0.5, y: 0.5 } },
  { typ: 'sortieren', frage: 'Sortiere', items: [{ text: 'a', info: '1' }, { text: 'b', info: '2' }, { text: 'c', info: '3' }] },
  { frage: 'Buzzer 2', antwort: 'a5' }] }],
  finale: { name: 'Finale', fragen: [{ frage: 'F1', antwort: 'x' }] } };

module.exports = async ({ url, t }) => {
  const g = await newGame(url, PKG);
  const [A, B, C] = g.players;

  console.log('Nachfrist: Buzzer');
  await g.pick(0, 0);
  g.host.emit('host:grace', { secs: 1 }); await wait(150);
  t.ok(!g.cur().grace && g.cur().state === 'reading', 'Beim Vorlesen gibt es keine Nachfrist');
  await g.open();
  t.ok(g.cur().left === null && !g.cur().grace, 'Offener Buzzer: ohne Nachfrist kein Zeitlimit');
  g.host.emit('host:grace', { secs: 1 }); await wait(150);
  t.ok(g.cur().grace === true && g.cur().left > 0 && g.cur().left <= 1000, 'Nachfrist läuft, Restzeit ist für alle sichtbar');
  t.ok(A.S.current.grace === true && A.S.current.left > 0, 'Auch die Spieler sehen den Countdown');
  g.host.emit('host:grace', { secs: 30 }); await wait(100);
  t.ok(g.cur().left <= 1000, 'Ein zweiter Druck verlängert die Nachfrist nicht');
  await wait(1300);
  t.ok(g.cur().state === 'reveal' && g.cur().result === 'none', 'Nach Ablauf endet die Frage ohne Gewinner');
  g.host.emit('host:close'); await wait(150);

  console.log('Nachfrist: jemand antwortet noch');
  await g.pick(0, 4); await g.open();
  g.host.emit('host:grace', { secs: 1 }); await wait(150);
  A.sock.emit('player:buzz', { elapsed: 100 }); await wait(500);
  t.ok(g.cur().state === 'buzzed' && g.cur().grace === false, 'Wer vor Ablauf buzzert, stoppt die Nachfrist');
  await wait(1500);
  t.ok(g.cur().state === 'buzzed', 'Die Frage endet nicht, solange jemand antwortet');
  g.host.emit('host:judge', { correct: true }); await wait(150); g.host.emit('host:close'); await wait(150);

  console.log('Nachfrist: Schätzfrage');
  await g.pick(0, 1); await g.open();
  A.sock.emit('player:guess', { text: '90' }); await wait(100);
  g.host.emit('host:grace', { secs: 1 }); await wait(1400);
  t.ok(g.cur().state === 'review', 'Schätzfrage: nach der Nachfrist werden die Schätzungen aufgedeckt');
  g.host.emit('host:revealNext'); await wait(100); g.host.emit('host:mark', { id: A.pid, correct: true }); g.host.emit('host:resolve'); await wait(150); g.host.emit('host:close'); await wait(150);

  console.log('Mini-Games ohne Zeitlimit');
  await g.pick(0, 2); await g.open();
  t.ok(g.cur().left === null, 'Geoguessr ohne "zeit": kein Zeitlimit');
  await wait(1200);
  t.ok(g.cur().state === 'open', 'Es läuft weiter, bis alle fertig sind oder der Spielleiter beendet');
  A.sock.emit('player:mini', { ans: { x: 0.5, y: 0.5 }, done: true }); await wait(150);
  g.host.emit('host:grace', { secs: 1 }); await wait(1500);
  t.ok(g.cur().state === 'reveal' && g.cur().mini.result.ranking.some(r => r.pid === A.pid && r.rank === 1), 'Mini-Game: nach der Nachfrist wird mit den abgegebenen Pins gewertet');
  g.host.emit('host:close'); await wait(150);
  await g.pick(0, 3); await g.open();
  t.ok(g.cur().left === null && !!g.cur().mini.sort.turn, 'Sortieren ohne "zeit": kein Zeitlimit pro Zug');
  const who = g.cur().mini.sort.turn, hb = g.cur().mini.sort.hearts[who];
  await wait(1500);
  t.ok(g.cur().mini.sort.turn === who && g.cur().mini.sort.hearts[who] === hb, 'Der Zug läuft nicht von selbst ab');
  g.host.emit('host:sortSkip'); await wait(150);
  t.ok(g.cur().mini.sort.turn !== who, 'Der Spielleiter kann den Zug überspringen');
  g.host.emit('host:grace', { secs: 1 }); await wait(1500);
  t.ok(g.cur().state === 'reveal', 'Sortieren: Nachfrist beendet das Spiel');
  g.host.emit('host:close'); await wait(150);

  console.log('Nachfrist: Finale');
  g.host.emit('host:finale'); await wait(150); g.host.emit('host:finaleNext'); await wait(150); g.host.emit('host:open'); await wait(150);
  A.sock.emit('player:decide', { play: true }); B.sock.emit('player:decide', { play: false }); C.sock.emit('player:decide', { play: false }); await wait(250);   // nur wer Punkte hat, kann einsetzen
  t.ok(g.cur().state === 'play', 'Finale: Antwortphase');
  g.host.emit('host:grace', { secs: 1 }); await wait(1500);
  t.ok(g.cur().state === 'review' || g.cur().state === 'judge', 'Finale: nach der Nachfrist geht es zur Aufdeckung');
  g.close();
};
