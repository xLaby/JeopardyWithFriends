'use strict';
// Beamer-Ansicht: reiner Zuschauer fuer Fernseher/Stream. Sieht live mit, aber keine Loesungen, und steuert nichts.
const { wait, ack, connect, newGame } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300], kategorien: [{ name: 'A', fragen: [
  { frage: 'Streng geheime Frage', antwort: 'geheime-antwort' },
  { typ: 'sortieren', frage: 'Sortiere', zeit: 20, items: [{ text: 'sa', info: '1' }, { text: 'sb', info: '2' }, { text: 'sc', info: '3' }] },
  { typ: 'geo', frage: 'Wo?', antwort: 'Burg-Antwort', karte: 'beispiel-karte.png', aspekt: 1.5, ziel: { x: 0.5, y: 0.5 } }] }] };

module.exports = async ({ url, t }) => {
  const g = await newGame(url, PKG);
  const beam = await connect(url); let BS = null; beam.on('state', s => { BS = s; });

  console.log('Beamer');
  const bad = await ack(beam, 'beamer:join', { code: 'ZZZZ' });
  t.ok(!bad.ok, 'Unbekannter Raum wird abgelehnt');
  const r = await ack(beam, 'beamer:join', { code: g.code.toLowerCase() }); await wait(150);
  t.ok(r.ok && BS && BS.phase === 'game' && BS.players.length === 3, 'Beitritt per Code (auch klein geschrieben), Spielzustand kommt an');
  t.ok(BS.settings.theme === 'classic', 'Design wird mitgeschickt');

  beam.emit('host:pick', { cat: 0, row: 0 }); beam.emit('host:open'); beam.emit('player:buzz', { elapsed: 100 }); beam.emit('host:judge', { correct: true }); await wait(250);
  t.ok(g.cur() === null && BS.current === null, 'Der Beamer kann nichts steuern');

  await g.pick(0, 0); await wait(150);
  t.ok(BS.current && BS.current.state === 'reading', 'Er sieht Änderungen live mit');
  t.ok(!JSON.stringify(BS).includes('Streng geheime Frage') && !JSON.stringify(BS).includes('geheime-antwort'), 'Frage und Antwort sind verborgen, solange der Spielleiter nichts freigibt');
  await g.open(); g.host.emit('host:show'); await wait(200);
  t.ok(BS.current.question === 'Streng geheime Frage', 'Nach der Freigabe sieht er die Frage (wie die Spieler)');
  t.ok(!JSON.stringify(BS).includes('geheime-antwort'), 'Die Antwort bleibt bis zur Auflösung verborgen');
  g.players[0].sock.emit('player:buzz', { elapsed: 100 }); await wait(450);
  t.ok(BS.current.state === 'buzzed' && BS.current.buzzer === g.players[0].pid, 'Er sieht, wer gebuzzert hat');
  g.host.emit('host:judge', { correct: true }); await wait(200);
  t.ok(BS.current.state === 'reveal' && BS.current.answer === 'geheime-antwort', 'Bei der Auflösung sieht er die Antwort');
  g.host.emit('host:close'); await wait(150);
  t.ok(BS.current === null && BS.players.find(p => p.id === g.players[0].pid).score === 100, 'Punktestand ist aktuell');

  console.log('Beamer: Mini-Games');
  await g.pick(0, 1); await g.open(); await wait(150);
  t.ok(!!BS.current.mini.sort && BS.current.mini.sort.line.length === 1, 'Beim Sortieren sieht er das Brett live');
  t.ok(!JSON.stringify(BS).includes('hostTruth'), 'Aber keine Lösung');
  g.host.emit('host:skip'); await wait(150); g.host.emit('host:close'); await wait(150);
  await g.pick(0, 2); await g.open(); await wait(150);
  t.ok(BS.current.mini.karte === 'media/beispiel-karte.png', 'Beim Geoguessr sieht er die Karte');
  t.ok(!JSON.stringify(BS).includes('Burg-Antwort') && BS.current.mini.hostTruth === undefined, 'Ziel und Antwort bleiben verborgen');
  g.players[0].sock.emit('player:mini', { ans: { x: 0.5, y: 0.5 }, done: true }); await wait(150);
  g.host.emit('host:skip'); await wait(200);
  t.ok(BS.current.mini.result.truth.x === 0.5 && BS.current.mini.result.ranking[0].pin, 'Nach der Wertung sieht er Ziel und Pins');

  console.log('Design');
  g.host.emit('host:close'); await wait(120);
  t.ok(BS.settings.theme === 'classic', 'Design bleibt unverändert, solange das Spiel läuft');

  beam.close(); await wait(100);
  g.host.emit('host:pick', { cat: 0, row: 0 }); await wait(100);   // Server laeuft nach dem Weggang des Beamers normal weiter
  t.ok(!!g.HS, 'Spiel läuft nach dem Weggang des Beamers normal weiter');
  g.close();
};
