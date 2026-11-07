'use strict';
// Team-Modus: Teams gruenden und beitreten, "alle duerfen buzzern" und "reihum antworten", Wiederverbinden, Entfernen, Spielstand
const { wait, ack, connect } = require('./helpers');

const PKG = { titel: 'T', werte: [100, 200, 300], kategorien: [{ name: 'A', fragen: [
  { frage: 'f1', antwort: 'a1' }, { frage: 'f2', antwort: 'a2' }, { frage: 'f3', antwort: 'a3' }] }] };

async function makeRoom(url, settings) {
  const host = await connect(url), g = { host, HS: null, url };
  host.on('state', s => { g.HS = s; });
  const h = await ack(host, 'host:create'); g.code = h.code; g.token = h.token;
  await ack(host, 'host:setQuestions', PKG);
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
  g.host.emit('host:judge', { correct: false }); await wait(150);
  t.ok(g.team('Rot').score === -50 && g.cur().locked.includes(anna.pid), 'Falsch: das ganze Team verliert Punkte und ist gesperrt');
  basti.sock.emit('player:buzz', { elapsed: 50 }); anna.sock.emit('player:buzz', { elapsed: 60 }); cleo.sock.emit('player:buzz', { elapsed: 400 }); await wait(500);
  t.ok(g.cur().buzzer === cleo.pid, 'Auch das zweite Teammitglied kann nicht buzzern, wenn das Team gesperrt ist');
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
};
