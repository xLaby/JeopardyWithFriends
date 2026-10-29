'use strict';
// Mini-Games: Zuordnen, Geoguessr und das rundenbasierte Sortieren
const crypto = require('crypto');
const { MINI_TIME, SORT_HEARTS, RANK_FACTOR } = require('./config');
const hub = require('./hub');
// Funktionen aus anderen Modulen (spaete Bindung ueber hub)
const V = (...a) => hub.V(...a);
const award = (...a) => hub.award(...a);
const clearTimers = (...a) => hub.clearTimers(...a);
const coord = (...a) => hub.coord(...a);
const curQ = (...a) => hub.curQ(...a);
const emitState = (...a) => hub.emitState(...a);
const grantReward = (...a) => hub.grantReward(...a);
const player = (...a) => hub.player(...a);
const snapshot = (...a) => hub.snapshot(...a);
const toReveal = (...a) => hub.toReveal(...a);
const winMult = (...a) => hub.winMult(...a);

// ---------- Mini-Games (Sortieren, Zuordnen, Geoguessr) ----------
// Alle spielen gleichzeitig auf dem eigenen Geraet. Wertung: Qualitaet des Ergebnisses, bei Gleichstand gewinnt wer schneller fertig ist.
// Punkte nach Rang: Platz 1 bekommt den vollen Feldwert, Platz 2 75 %, Platz 3 50 %, Platz 4 25 %.
const rid = () => crypto.randomBytes(4).toString('hex');
function shuffle(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }
function startMini(room, cur) {
  const q = curQ(room, cur);
  const m = { answers: {}, result: null, items: null, left: null, right: null, truth: null };
  if (cur.typ === 'sortieren') {
    return startSort(room, cur, q);
  } else if (cur.typ === 'zuordnen') {
    const L = q.paare.map(p => ({ id: rid(), text: p.links.text, bild: p.links.bild }));
    const R = q.paare.map(p => ({ id: rid(), text: p.rechts.text, bild: p.rechts.bild }));
    m.truth = Object.fromEntries(L.map((l, i) => [l.id, R[i].id]));
    let disp; do { disp = shuffle(R); } while (disp.length > 1 && disp.every((r, i) => m.truth[L[i].id] === r.id));
    m.left = L; m.right = disp;
  }
  cur.mini = m;
  const ms = (q.zeit || MINI_TIME[cur.typ]) * 1000;
  cur.deadline = Date.now() + ms;
  cur.t.mini = setTimeout(() => { if (room.current === cur && cur.state === 'open') { finishMini(room, cur); emitState(room); } }, ms);
}
function cleanMini(cur, ans) {
  const m = cur.mini;
  if (cur.typ === 'sortieren') {
    if (!Array.isArray(ans) || ans.length !== m.truth.length) return null;
    const ids = new Set(m.truth);
    return ans.every(x => ids.has(x)) && new Set(ans).size === ans.length ? ans.slice() : null;
  }
  if (cur.typ === 'zuordnen') {
    if (!ans || typeof ans !== 'object') return null;
    const L = new Set(m.left.map(x => x.id)), R = new Set(m.right.map(x => x.id)), out = {}, used = new Set();
    for (const [k, v] of Object.entries(ans)) { if (L.has(k) && R.has(v) && !used.has(v)) { used.add(v); out[k] = v; } }
    return out;
  }
  const x = coord(ans && ans.x), y = coord(ans && ans.y);   // Pin auf dem Kartenbild: Anteil von Breite und Hoehe
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
function finishMini(room, cur) {
  if (cur.typ === 'sortieren') return finishSort(room, cur);
  if (cur.state !== 'open' || !cur.mini) return;
  room.undo = snapshot(room, 'Auswertung des Mini-Games');
  clearTimers(cur);
  const q = curQ(room, cur), m = cur.mini, value = V(room)[cur.row], total = (q.zeit || MINI_TIME[cur.typ]) * 1000;
  const rows = [];
  Object.entries(m.answers).forEach(([pid, a]) => {
    if (!player(room, pid) || cur.locked.has(pid)) return;
    const t = a.done ? a.at : total;
    let r;
    if (cur.typ === 'zuordnen') {
      const ok = Object.entries(a.ans).filter(([l, rr]) => m.truth[l] === rr).length;
      r = { key: [-ok, t], valid: ok > 0, detail: ok + ' von ' + m.left.length + ' richtig zugeordnet' };
    } else {
      // Abstand auf dem Kartenbild als Anteil der Bilddiagonale (0 = genau getroffen)
      const asp = q.aspekt || 1, d = Math.hypot((a.ans.x - q.ziel.x) * asp, a.ans.y - q.ziel.y) / Math.hypot(asp, 1);
      r = { key: [d, t], valid: true, dist: d, pin: a.ans, detail: 'Abstand ' + (d * 100).toFixed(1).replace('.', ',') + ' % der Kartendiagonale' };
    }
    rows.push({ pid, ms: t, ...r });
  });
  const cmp = (x, y) => { for (let i = 0; i < x.key.length; i++) if (x.key[i] !== y.key[i]) return x.key[i] - y.key[i]; return 0; };
  rows.sort((x, y) => (y.valid - x.valid) || cmp(x, y));
  let rank = 0;
  rows.forEach((r, i) => { if (!r.valid) { r.rank = null; return; } if (i === 0 || cmp(rows[i - 1], r) !== 0) rank = i + 1; r.rank = rank; });
  const jk = cur.joker;
  rows.forEach(r => {
    r.factor = r.rank ? (cur.typ === 'geo' ? [1] : RANK_FACTOR)[r.rank - 1] || 0 : 0;   // Geoguessr: nur der Naechste bekommt Punkte
    if (!r.factor) return;
    if (jk && jk.type === 'risk' && jk.by === r.pid && r.rank !== 1) return;   // Risiko zaehlt nur mit Platz 1, sonst gibt resolveRisk den Abzug
    award(room, cur, r.pid, Math.round(value * r.factor * winMult(cur, r.pid)), 'rank');
  });
  cur.winners = rows.filter(r => r.rank === 1).map(r => r.pid);
  cur.winners.forEach(id => { const p = player(room, id); if (p) p.stats.miniWins = (p.stats.miniWins || 0) + 1; });
  const pubItem = it => ({ id: it.id, text: it.text, bild: it.bild });
  const byId = (list, id) => list.find(x => x.id === id);
  m.result = {
    ranking: rows.map(r => ({ pid: r.pid, rank: r.rank, factor: r.factor, detail: r.detail, ms: r.ms, dist: r.dist == null ? null : r.dist, pin: r.pin || null })),
    truth: cur.typ === 'zuordnen' ? m.left.map(l => ({ lid: l.id, rid: m.truth[l.id], links: pubItem(l), rechts: pubItem(byId(m.right, m.truth[l.id])) }))
      : { x: q.ziel.x, y: q.ziel.y }
  };
  toReveal(room, cur, cur.winners.length ? 'correct' : 'none');
  grantReward(room, cur);
}
// Was Spieler und Host vom Mini-Game sehen (Loesung erst nach der Wertung, der Host sieht sie vorab)
function miniView(room, cur, forHost, pid) {
  const m = cur.mini, q = curQ(room, cur);
  const v = { kind: cur.typ, answered: m ? Object.keys(m.answers) : [], submitted: m ? Object.keys(m.answers).filter(id => m.answers[id].done) : [] };
  if (cur.typ === 'sortieren') { v.anfang = q.anfang; v.ende = q.ende; v.abwaerts = !!q.abwaerts; }
  if (cur.typ === 'geo' && (forHost || (m && cur.state !== 'reading'))) v.karte = q.karte;
  if (m && cur.state !== 'reading') {
    if (m.sort) {
      const so = m.sort, byId = id => so.items.find(i => i.id === id);
      const pub = (it, info) => ({ id: it.id, text: it.text, bild: it.bild, info: info ? it.info : '' });
      // line: nur die schon liegenden Gegenstaende, in ihrer richtigen Reihenfolge (ohne Platznummern, die gibt es erst bei der Aufloesung)
      v.sort = { n: so.truth.length, line: so.placed.filter(Boolean).map(id => pub(byId(id), true)),
        pool: so.display.filter(id => !so.placed.includes(id)).map(id => pub(byId(id), false)),
        order: so.order, hearts: so.hearts, correct: so.correct, maxHearts: so.maxHearts, turn: so.turn, last: so.last,
        startItem: so.truth[so.start], streng: !!so.streng };
    }
    if (cur.typ === 'zuordnen') { v.left = m.left.map(({ id, text, bild }) => ({ id, text, bild })); v.right = m.right.map(({ id, text, bild }) => ({ id, text, bild })); }
  }
  if (m && pid && m.answers[pid]) v.mine = { ans: m.answers[pid].ans, done: !!m.answers[pid].done };
  if (m && cur.state === 'reveal' && m.result) v.result = m.result;
  if (forHost && cur.state !== 'reveal') {
    if (cur.typ === 'sortieren') v.hostTruth = q.items.map(it => ({ text: it.text, bild: it.bild, info: it.info }));
    if (cur.typ === 'zuordnen') v.hostTruth = q.paare.map(p => ({ links: p.links, rechts: p.rechts }));
    if (cur.typ === 'geo') v.hostTruth = { x: q.ziel.x, y: q.ziel.y };
  }
  return v;
}
// ---------- Sortieren (rundenbasiert) ----------
// Eine wachsende Reihe: die Spieler sind reihum dran und legen einen Gegenstand aus dem Pool links oder rechts von einem schon liegenden an.
// Richtig = bleibt liegen. Falsch (oder Zeit ab) = ein Herz weg, der Gegenstand bleibt im Pool. Wer am Ende die meisten Herzen hat, gewinnt.
// Ein Gegenstand liegt von Anfang an richtig auf dem Brett (sein Zusatzwert ist sichtbar). Der Wert wird erst nach dem richtigen Platzieren gezeigt.
function startSort(room, cur, q) {
  const items = q.items.map(it => ({ id: rid(), text: it.text, bild: it.bild, info: it.info, start: it.start }));
  const truth = items.map(i => i.id);
  let si = items.findIndex(i => i.start);
  if (si < 0) si = items.length > 2 ? 1 + crypto.randomInt(items.length - 2) : crypto.randomInt(items.length);
  const placed = items.map((it, i) => i === si ? it.id : null);
  const display = shuffle(truth);
  const ps = room.players.filter(p => p.connected && !cur.locked.has(p.id));
  const at = Math.max(0, ps.findIndex(p => p.id === room.picker));
  const order = ps.map((_, i) => ps[(at + i) % ps.length].id);   // wer das Feld gewaehlt hat, faengt an
  const hearts = {}, correct = {}, maxHearts = q.herzen || SORT_HEARTS;
  order.forEach(id => { hearts[id] = maxHearts; correct[id] = 0; });
  cur.mini = { answers: {}, result: null, items: null, left: null, right: null, truth: null,
    sort: { items, truth, placed, display, order, hearts, correct, maxHearts, turn: null, last: null, n: 0, start: si, streng: !!q.streng } };
  sortAdvance(room, cur);
}
function sortStartTurn(room, cur) {
  clearTimeout(cur.t.turn);
  const ms = (curQ(room, cur).zeit || MINI_TIME.sortieren) * 1000;
  cur.deadline = Date.now() + ms;
  cur.t.turn = setTimeout(() => {
    if (room.current !== cur || cur.state !== 'open' || !cur.mini || !cur.mini.sort) return;
    sortTimeout(room, cur); emitState(room);
  }, ms);
}
// Naechster Spieler (mit Herzen und verbunden) oder Ende: Brett voll, niemand mehr uebrig oder nur noch einer mit Herzen
function sortAdvance(room, cur) {
  const s = cur.mini.sort;
  clearTimeout(cur.t.turn); cur.deadline = 0;
  const alive = s.order.filter(id => s.hearts[id] > 0);
  if (s.placed.every(Boolean) || !alive.length || (s.order.length > 1 && alive.length <= 1)) return finishSort(room, cur);
  const i = s.order.indexOf(s.turn), n = s.order.length;
  for (let k = 1; k <= n; k++) {
    const id = s.order[(i + k + n) % n], p = player(room, id);
    if (s.hearts[id] > 0 && p && p.connected) { s.turn = id; return sortStartTurn(room, cur); }
  }
  s.turn = null;   // niemand verbunden: der Spielleiter beendet das Spiel oder wartet
}
// Zug: Gegenstand + ein schon liegender Bezugsgegenstand + Seite. Richtig, wenn der Gegenstand wirklich links bzw. rechts davon gehoert.
// Mit "streng" muss er zusaetzlich direkt daneben liegen (kein anderer liegender Gegenstand dazwischen). Bei Treffer rutscht er an seinen richtigen Platz in der Reihe.
function sortCheck(s, itemId, refId, side) {
  const ti = s.truth.indexOf(itemId), tr = s.truth.indexOf(refId);
  if (ti < 0 || tr < 0 || ti === tr) return false;
  if (side === 'left' ? ti > tr : ti < tr) return false;
  if (!s.streng) return true;
  const lo = Math.min(ti, tr), hi = Math.max(ti, tr);
  for (let k = lo + 1; k < hi; k++) if (s.placed[k]) return false;
  return true;
}
function sortMove(room, cur, pid, itemId, refId, side) {
  const s = cur.mini.sort;
  clearTimeout(cur.t.turn);
  const ok = sortCheck(s, itemId, refId, side);
  if (ok) { s.placed[s.truth.indexOf(itemId)] = itemId; s.correct[pid]++; } else s.hearts[pid]--;
  s.last = { n: ++s.n, pid, item: itemId, ref: refId, side, ok };
  sortAdvance(room, cur);
}
function sortTimeout(room, cur) {
  const s = cur.mini.sort;
  if (s.turn) { s.hearts[s.turn]--; s.last = { n: ++s.n, pid: s.turn, item: null, ref: null, side: null, ok: false, timeout: true }; }
  sortAdvance(room, cur);
}
function finishSort(room, cur) {
  if (cur.state !== 'open' || !cur.mini || !cur.mini.sort) return;
  room.undo = snapshot(room, 'Auswertung des Mini-Games');
  clearTimers(cur);
  const s = cur.mini.sort, value = V(room)[cur.row];
  const rows = s.order.filter(id => player(room, id)).map(pid => ({ pid, hearts: s.hearts[pid], ok: s.correct[pid] }));
  rows.sort((x, y) => (y.hearts - x.hearts) || (y.ok - x.ok));   // meiste Herzen, bei Gleichstand mehr richtig gesetzte
  rows.forEach((r, i) => { r.rank = i === 0 || r.hearts !== rows[i - 1].hearts || r.ok !== rows[i - 1].ok ? i + 1 : rows[i - 1].rank; });
  rows.forEach(r => { r.win = r.rank === 1 && r.hearts > 0; });   // nur der Beste bekommt den vollen Feldwert (bei exaktem Gleichstand alle)
  rows.forEach(r => { if (r.win) award(room, cur, r.pid, Math.round(value * winMult(cur, r.pid)), 'rank'); });
  cur.winners = rows.filter(r => r.win).map(r => r.pid);
  cur.winners.forEach(id => { const p = player(room, id); if (p) p.stats.miniWins = (p.stats.miniWins || 0) + 1; });
  const pub = it => ({ id: it.id, text: it.text, bild: it.bild, info: it.info });
  cur.mini.result = {
    ranking: rows.map(r => ({ pid: r.pid, rank: r.rank, factor: r.win ? 1 : 0, ms: null, dist: null, pin: null,
      detail: r.hearts + (r.hearts === 1 ? ' Herz' : ' Herzen') + ' übrig, ' + r.ok + ' richtig gesetzt' })),
    truth: s.truth.map(id => pub(s.items.find(i => i.id === id)))
  };
  toReveal(room, cur, cur.winners.length ? 'correct' : 'none');
  grantReward(room, cur);
}

hub.register({ rid, shuffle, startMini, cleanMini, finishMini, miniView, startSort, sortStartTurn, sortAdvance, sortCheck, sortMove, sortTimeout, finishSort });
