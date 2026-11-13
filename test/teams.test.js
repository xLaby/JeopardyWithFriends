'use strict';
// Team-Modus: Teams gruenden und beitreten, "alle duerfen buzzern" und "reihum antworten", Wiederverbinden, Entfernen, Spielstand
const { wait, ack, connect } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300], kategorien: [{ name: 'A', fragen: [
  { frage: 'f1', antwort: 'a1' }, { frage: 'f2', antwort: 'a2' }, { frage: 'f3', antwort: 'a3' }] }] };

const PKG2 = { titel: 'T', werte: [100, 200], kategorien: [{ name: 'A', fragen: [
  { typ: 'schaetzen', frage: 'Wie viel?', antwort: '100', einheit: '€' },
  { typ: 'zuordnen', frage: 'Paare', paare: [{ links: 'DE', rechts: 'Berlin' }, { links: 'FR', rechts: 'Paris' }] }] }] };

async function makeRoom(url, settings, pkg = PKG) {
  const host = await connect(url), g = { host, HS: null, url };
  host.on('state', s => { g.HS = s; });
  const h = await ack(host, 'host:create'); g.code = h.code; g.token = h.token;
  await ack(host, 'host:setQuestions', pkg);
  host.emit('host:setSettings', { joker: 0, comeback: 0, ...settings }); await wait(150);
  g.join = async (name, team, extra = {}) => {
    const sock = await connect(url), pl = { name, sock, S: null };
    sock.on('state', s => { pl.S = s; });
    pl.r = await ack(sock, 'player:join', { code: g.code, name, team, ...extra });
    pl.pid = pl.r.pid; pl.mid = pl.r.mid; pl.token = pl.r.token;
    return pl;
  };
  g.team = name => g.HS.players.find(p => p.name === name);
  g.pick = async (row) => { host.emit('host:pick', { cat: 0, row }); await wait(120); };
  g.open = async () => { host.emit('host:open'); await wait(150); };
  g.cur = () => g.HS.current;
  return g;
}

module.exports = async ({ url, t }) => {
  console.log('Team-Modus: Beitritt');
  const g = await makeRoom(url, { teamMode: true, teamAnswer: 'alle' });
  const info0 = await ack(await connect(url), 'room:info', { code: g.code });
  t.ok(info0.ok && info0.teamMode === true && info0.teams.length === 0, 'Raum-Info: Team-Modus aktiv, noch keine Teams');
  const nr = await ack(await connect(url), 'player:join', { code: g.code, name: 'Anna' });
  t.ok(!nr.ok, 'Ohne Teamnamen kein Beitritt');
  const anna = await g.join('Anna', 'Rot', { color: 0, avatar: 1 });
  const basti = await g.join('Basti', 'rot');
  const cleo = await g.join('Cleo', 'Blau', { color: 3, avatar: 2 });
  await wait(200);
  t.ok(anna.r.ok && basti.r.ok && anna.pid === basti.pid && anna.mid !== basti.mid, 'Gleicher Teamname (auch klein geschrieben): beide im selben Team');
  t.ok(g.HS.players.length === 2 && g.team('Rot').members.length === 2 && g.team('Blau').members.length === 1, 'Zwei Teams, eines mit zwei Mitgliedern');
  t.ok(g.team('Rot').members.map(m => m.name).join() === 'Anna,Basti', 'Mitglieder stehen im Zustand');
  const dup = await ack(await connect(url), 'player:join', { code: g.code, name: 'anna', team: 'Rot' });
  t.ok(!dup.ok, 'Derselbe Name im Team ist nicht erlaubt, solange das Mitglied verbunden ist');
  const info1 = await ack(await connect(url), 'room:info', { code: g.code });
  t.ok(info1.teams.length === 2 && info1.teams.find(x => x.name === 'Rot').size === 2, 'Raum-Info zeigt die Teams mit Größe');
  t.ok(anna.S.players.length === 2 && basti.S.players.length === 2 && anna.S.players[0].id === basti.S.players[0].id, 'Beide Mitglieder bekommen den Zustand');

  console.log('Team-Modus: alle dürfen buzzern');
  g.host.emit('host:start'); await wait(200);
  await g.pick(0); await g.open();
  anna.sock.emit('player:buzz', { elapsed: 300 }); basti.sock.emit('player:buzz', { elapsed: 200 }); cleo.sock.emit('player:buzz', { elapsed: 250 }); await wait(500);
  t.ok(g.cur().state === 'buzzed' && g.cur().buzzer === anna.pid, 'Schnellster Buzz zählt für das Team (hier Basti für Team Rot)');
  t.ok(g.cur().buzzMember === 'Basti' && anna.S.current.buzzMember === 'Basti', 'Der Zustand nennt, welches Mitglied gebuzzert hat (für Spieler und Spielleiter)');
  g.host.emit('host:judge', { correct: false }); await wait(150);
  t.ok(g.team('Rot').score === -50 && g.cur().locked.includes(anna.pid), 'Falsch: das ganze Team verliert Punkte und ist gesperrt');
  basti.sock.emit('player:buzz', { elapsed: 50 }); anna.sock.emit('player:buzz', { elapsed: 60 }); cleo.sock.emit('player:buzz', { elapsed: 400 }); await wait(500);
  t.ok(g.cur().buzzer === cleo.pid && g.cur().buzzMember === '', 'Auch das zweite Teammitglied kann nicht buzzern, wenn das Team gesperrt ist (Einzelteam: kein Mitgliedsname)');
  g.host.emit('host:judge', { correct: true }); await wait(150);
  t.ok(g.team('Blau').score === 100, 'Richtig: Punkte gehen aufs Team');
  g.host.emit('host:close'); await wait(150);

  console.log('Team-Modus: Wiederverbinden und Spielstand');
  basti.sock.close(); await wait(200);
  t.ok(g.team('Rot').connected === true && g.team('Rot').members.find(m => m.name === 'Basti').on === false, 'Ein Mitglied weg: Team bleibt verbunden, Mitglied ist offline');
  const b2sock = await connect(url); let b2S = null; b2sock.on('state', s => { b2S = s; });
  const b2 = await ack(b2sock, 'player:join', { code: g.code, token: basti.token }); await wait(150);
  t.ok(b2.ok && b2.pid === anna.pid && b2.mid === basti.mid && !!b2S, 'Wiederverbinden per Token bringt dasselbe Mitglied zurück');
  const exp = await (await fetch(url + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: g.code, token: g.token }) })).json();
  t.ok(exp.ok && exp.save.players.find(p => p.name === 'Rot').members.length === 2, 'Spielstand enthält die Teammitglieder');
  const host2 = await connect(url); let HS2 = null; host2.on('state', s => { HS2 = s; });
  const room2 = await ack(host2, 'host:create');
  const rest = await (await fetch(url + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: room2.code, token: room2.token, save: exp.save }) })).json();
  await ack(host2, 'host:rejoin', { code: rest.code, token: rest.token }); await wait(200);
  t.ok(rest.ok && HS2.players.length === 2 && HS2.players.find(p => p.name === 'Rot').members.length === 2 && HS2.settings.teamMode === true, 'Laden: Teams, Mitglieder und Einstellung sind wieder da');
  const again = await ack(await connect(url), 'player:join', { code: rest.code, name: 'Anna', team: 'Rot' });
  t.ok(again.ok && again.member === 'Anna', 'Nach dem Laden holt sich ein Mitglied seinen Platz mit Teamname und Namen zurück');
  host2.close();

  console.log('Team-Modus: Mitglieder entfernen');
  g.host.emit('host:kickMember', { id: anna.pid, mid: basti.mid }); await wait(200);
  t.ok(g.team('Rot').members.length === 1, 'Einzelnes Mitglied wird entfernt');
  g.host.emit('host:kickMember', { id: anna.pid, mid: anna.mid }); await wait(200);
  t.ok(!g.team('Rot') && g.HS.players.length === 1, 'Das letzte Mitglied entfernt das ganze Team');
  g.host.close();

  console.log('Team-Modus: reihum antworten');
  const r = await makeRoom(url, { teamMode: true, teamAnswer: 'reihum' });
  const a = await r.join('Anna', 'Rot', { color: 0, avatar: 1 }), b = await r.join('Basti', 'Rot'), c = await r.join('Cleo', 'Blau', { color: 3, avatar: 2 });
  await wait(200);
  r.host.emit('host:start'); await wait(200);
  t.ok(r.team('Rot').ans === a.mid && r.team('Blau').ans === null, 'Erste Frage: erstes Mitglied ist Antwortgeber, ein Einzelteam hat keinen');
  await r.pick(0); await r.open();
  b.sock.emit('player:buzz', { elapsed: 10 }); await wait(500);
  t.ok(r.cur().state === 'open' && r.cur().buzzer === null, 'Wer nicht dran ist, kann nicht buzzern');
  a.sock.emit('player:buzz', { elapsed: 100 }); await wait(500);
  t.ok(r.cur().buzzer === a.pid, 'Der Antwortgeber kann buzzern');
  r.host.emit('host:judge', { correct: true }); await wait(150); r.host.emit('host:close'); await wait(150);
  t.ok(r.team('Rot').ans === b.mid, 'Nach der Frage ist das nächste Mitglied dran');
  await r.pick(1); await r.open();
  a.sock.emit('player:buzz', { elapsed: 10 }); await wait(500);
  t.ok(r.cur().buzzer === null, 'Das vorherige Mitglied ist jetzt nicht mehr dran');
  b.sock.emit('player:buzz', { elapsed: 100 }); await wait(500);
  t.ok(r.cur().buzzer === a.pid, 'Das neue Mitglied kann buzzern');
  r.host.emit('host:judge', { correct: true }); await wait(150); r.host.emit('host:close'); await wait(150);
  a.sock.close(); await wait(250);
  t.ok(r.team('Rot').ans === b.mid, 'Ist der Antwortgeber nicht verbunden, springt das nächste verbundene Mitglied ein');
  await r.pick(2); await r.open();
  b.sock.emit('player:buzz', { elapsed: 100 }); await wait(500);
  t.ok(r.cur().buzzer === a.pid, 'Das einspringende Mitglied kann buzzern');
  r.host.close(); b.sock.close(); c.sock.close();

  console.log('Team-Modus: wer im Team hat abgegeben');
  const q = await makeRoom(url, { teamMode: true, teamAnswer: 'alle' }, PKG2);
  const qa = await q.join('Anna', 'Rot', { color: 0, avatar: 1 }), qb = await q.join('Basti', 'Rot'), qc = await q.join('Cleo', 'Blau', { color: 3, avatar: 2 });
  await wait(200); q.host.emit('host:start'); await wait(200);
  await q.pick(0); await q.open();
  t.ok(qa.S.current.guess.mine === null, 'Vor der ersten Abgabe gibt es nichts');
  qa.sock.emit('player:guess', { text: '90' }); await wait(200);
  t.ok(qb.S.current.guess.mine && qb.S.current.guess.mine.text === '90' && qb.S.current.guess.mine.by === 'Anna', 'Das andere Teammitglied sieht, was das Team abgegeben hat und von wem');
  qb.sock.emit('player:guess', { text: '95' }); await wait(200);
  t.ok(qa.S.current.guess.mine.text === '95' && qa.S.current.guess.mine.by === 'Basti', 'Überschreibt jemand, sehen es alle im Team');
  qc.sock.emit('player:guess', { text: '100' }); await wait(200);
  t.ok(qc.S.current.guess.mine.by === '' && !qa.S.current.guess.mine.text.includes('100'), 'Ein Einzelteam hat keinen Mitgliedsnamen, fremde Abgaben bleiben verborgen');
  q.host.emit('host:skip'); await wait(150); q.host.emit('host:revealNext'); q.host.emit('host:revealNext'); await wait(150);
  q.host.emit('host:mark', { id: qa.pid, correct: false }); q.host.emit('host:mark', { id: qc.pid, correct: true }); q.host.emit('host:resolve'); await wait(150); q.host.emit('host:close'); await wait(150);
  await q.pick(1); await q.open();
  const L = qa.S.current.mini.left, Rr = qa.S.current.mini.right, id = (list, txt) => list.find(x => x.text === txt).id;
  qb.sock.emit('player:mini', { ans: { [id(L, 'DE')]: id(Rr, 'Berlin'), [id(L, 'FR')]: id(Rr, 'Paris') }, done: true }); await wait(250);
  t.ok(qa.S.current.mini.mine && qa.S.current.mini.mine.done === true && qa.S.current.mini.mine.by === 'Basti', 'Mini-Games: das Team sieht, wer abgegeben hat');
  q.host.close(); qa.sock.close(); qb.sock.close(); qc.sock.close();
};