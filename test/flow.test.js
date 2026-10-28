'use strict';
// Spielablauf: Buzzer, Joker, Rueckgaengig, Schaetzfrage, Spielstand sichern/laden, Finale
const { wait, ack, connect, newGame } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300], kategorien: [
  { name: 'A', fragen: [{ frage: 'f1', antwort: 'a1' }, { frage: 'f2', antwort: 'a2' }, { frage: 'f3', antwort: 'a3' }] },
  { name: 'B', fragen: [{ typ: 'schaetzen', frage: 'Wie viel?', antwort: '100', einheit: '€', zeit: 10 }, { frage: 'f5', antwort: 'a5' }, { frage: 'f6', antwort: 'a6' }] }],
  finale: { name: 'Finale', fragen: [{ frage: 'F1', antwort: 'x' }, { frage: 'F2', antwort: 'y' }] } };

module.exports = async ({ url, t }) => {
  const g = await newGame(url, PKG);
  const [A, B, C] = g.players;
  const buzz = async (p, ms) => { p.sock.emit('player:buzz', { elapsed: ms }); };

  console.log('Buzzer');
  await g.pick(0, 0);
  t.ok(g.cur().state === 'reading', 'Feld gewählt, Frage wird vorgelesen');
  await g.open();
  await buzz(A, 300); await buzz(B, 200); await wait(500);
  t.ok(g.cur().state === 'buzzed' && g.cur().buzzer === B.pid, 'Kürzeste Reaktionszeit gewinnt den Buzzer');
  g.host.emit('host:judge', { correct: false }); await wait(150);
  t.ok(g.score(B.pid) === -50, 'Falsch: halber Wert wird abgezogen');
  t.ok(g.cur().state === 'open' && g.cur().locked.includes(B.pid), 'Wer falsch lag, ist gesperrt, die Frage geht weiter');
  await buzz(B, 100); await buzz(A, 250); await wait(500);
  t.ok(g.cur().buzzer === A.pid, 'Gesperrter Spieler kann nicht buzzern');
  g.host.emit('host:judge', { correct: true }); await wait(150);
  t.ok(g.score(A.pid) === 100 && g.cur().state === 'reveal', 'Richtig: voller Wert, Auflösung');
  g.host.emit('host:undo'); await wait(150);
  t.ok(g.score(A.pid) === 0 && g.cur().state === 'buzzed', 'Rückgängig stellt Punkte und Zustand wieder her');
  g.host.emit('host:judge', { correct: true }); await wait(150);
  g.host.emit('host:close'); await wait(150);
  t.ok(g.cur() === null && g.HS.done === 1, 'Frage geschlossen, Feld ist verbraucht');

  console.log('Joker');
  g.host.emit('host:giveJoker', { id: A.pid, type: 'double' }); g.host.emit('host:giveJoker', { id: B.pid, type: 'coffee' }); g.host.emit('host:giveJoker', { id: C.pid, type: 'risk' }); await wait(150);
  await g.pick(0, 1);
  A.sock.emit('player:joker', { type: 'double' }); await wait(150);
  await g.open(); await buzz(A, 100); await wait(450);
  g.host.emit('host:judge', { correct: true }); await wait(150);
  t.ok(g.score(A.pid) === 500, 'Doppelt: 100 + 2 × 200');
  g.host.emit('host:close'); await wait(150);
  await g.pick(0, 2);
  B.sock.emit('player:joker', { type: 'coffee', target: A.pid }); await wait(150);
  t.ok(g.cur().locked.includes(A.pid), 'Kaffeepause sperrt den Zielspieler');
  await g.open(); await buzz(A, 50); await wait(450);
  t.ok(g.cur().buzzer === null, 'Gesperrter Spieler kommt nicht durch');
  await buzz(B, 80); await wait(450);
  g.host.emit('host:judge', { correct: true }); await wait(150);
  t.ok(g.score(B.pid) === 250, 'Richtig nach Kaffeepause: -50 + 300');
  g.host.emit('host:close'); await wait(150);

  console.log('Schätzfrage');
  await g.pick(1, 0); await g.open();
  A.sock.emit('player:guess', { text: '95' }); C.sock.emit('player:guess', { text: '100' }); await wait(200);
  g.host.emit('host:skip'); await wait(150);
  t.ok(g.cur().state === 'review', 'Zeit beendet, Schätzungen werden aufgedeckt');
  g.host.emit('host:revealNext'); g.host.emit('host:revealNext'); await wait(200);
  t.ok(g.cur().state === 'judge', 'Alle Schätzungen sind aufgedeckt');
  const first = g.cur();
  g.host.emit('host:mark', { id: C.pid, correct: true }); g.host.emit('host:mark', { id: A.pid, correct: false }); await wait(150);
  g.host.emit('host:resolve'); await wait(200);
  t.ok(g.score(C.pid) === 100 && g.cur().state === 'reveal' && first, 'Host bewertet: richtige Schätzung bekommt den Feldwert');
  g.host.emit('host:close'); await wait(150);

  console.log('Risiko');
  await g.pick(1, 1);
  C.sock.emit('player:joker', { type: 'risk' }); await wait(150);
  await g.open(); await buzz(C, 90); await wait(450);
  g.host.emit('host:judge', { correct: false }); await wait(150);
  t.ok(g.score(C.pid) === 100 - 400, 'Risiko falsch: doppelter Wert als Abzug');
  g.host.emit('host:skip'); await wait(150);
  g.host.emit('host:close'); await wait(150);

  console.log('Spielstand sichern und laden');
  const exp = await (await fetch(url + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: g.code, token: g.token }) })).json();
  t.ok(exp.ok && exp.save.players.length === 3, 'Export enthält alle Spieler');
  const host2 = await connect(url); let HS2 = null; host2.on('state', s => { HS2 = s; });
  const room2 = await ack(host2, 'host:create');
  const rest = await (await fetch(url + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: room2.code, token: room2.token, save: exp.save }) })).json();
  t.ok(rest.ok && rest.players === 3, 'Laden in neuem Raum klappt: ' + (rest.error || ''));
  const rj = await ack(host2, 'host:rejoin', { code: rest.code, token: rest.token }); await wait(200);
  t.ok(rj.ok && HS2.players.length === 3 && HS2.players.find(p => p.name === 'Anna').score === 500 && HS2.done === g.HS.done, 'Punkte und Fortschritt sind wieder da');
  host2.close();

  console.log('Finale');
  g.host.emit('host:finale'); await wait(150);
  t.ok(g.HS.phase === 'finale', 'Finale startet');
  g.host.emit('host:finaleNext'); await wait(150);
  t.ok(g.cur().typ === 'finale' && g.cur().state === 'intro', 'Erste Finalfrage');
  g.host.emit('host:open'); await wait(150);
  A.sock.emit('player:decide', { play: true }); B.sock.emit('player:decide', { play: true }); C.sock.emit('player:decide', { play: false }); await wait(250);
  t.ok(g.cur().state === 'play', 'Alle haben entschieden, Einsatz und Antwort');
  A.sock.emit('player:wager', { n: 50 }); B.sock.emit('player:wager', { n: 10000 });   // zu hoher Einsatz wird gekappt
  A.sock.emit('player:guess', { text: 'x' }); B.sock.emit('player:guess', { text: 'falsch' }); await wait(200);
  g.host.emit('host:skip'); await wait(150);
  g.host.emit('host:revealNext'); g.host.emit('host:revealNext'); await wait(200);
  t.ok(g.cur().state === 'judge', 'Antworten sind aufgedeckt');
  g.host.emit('host:mark', { id: A.pid, correct: true }); g.host.emit('host:mark', { id: B.pid, correct: false }); await wait(150);
  g.host.emit('host:resolve'); await wait(200);
  t.ok(g.score(A.pid) === 550, 'Finale richtig: Einsatz wird gutgeschrieben');
  t.ok(g.score(B.pid) === 0, 'Finale falsch: Einsatz (auf Punktestand begrenzt) wird abgezogen');
  g.host.emit('host:close'); await wait(150);
  g.host.emit('host:open'); await wait(150);
  [A, B, C].forEach(p => p.sock.emit('player:decide', { play: false })); await wait(250);
  t.ok(g.cur().state === 'reveal', 'Niemand spielt mit: direkt zur Auflösung');
  g.host.emit('host:close'); await wait(200);
  t.ok(g.HS.phase === 'end' && !!g.HS.awards, 'Spielende mit Siegerehrung');
  g.close();
};
