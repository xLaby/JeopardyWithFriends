const socket = io();
const $app = document.getElementById('app');
const LS = 'quiz-session';
let me = JSON.parse(localStorage.getItem(LS) || 'null'); // {role, code, token, pid, name}
let S = null, startError = '', skipPick = false, draft = '', lastCardKey = '', cardFresh = false;
let muted = localStorage.getItem('quiz-mute') === '1';
let audioBlocked = false, lastAudioKey = '';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const save = () => me ? localStorage.setItem(LS, JSON.stringify(me)) : localStorage.removeItem(LS);
const pname = id => { const p = S && S.players.find(x => x.id === id); return p ? p.name : '?'; };
const toUrl = u => /^https?:/i.test(u) ? u : '/' + encodeURI(u);

/* ---------- Ton ---------- */
const media = new Audio();
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let AC, unlocked = false;
function ctx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function unlock() {
  if (unlocked) return; unlocked = true;
  try { media.src = SILENT; media.play().catch(() => {}); ctx(); } catch (e) {}
}
document.addEventListener('pointerdown', unlock);
function tone(freq, t0, dur, type = 'sine', vol = .15) {
  if (muted) return;
  try {
    const c = ctx(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .02);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + .05);
  } catch (e) {}
}
const SFX = {
  pick: () => { tone(392, 0, .12, 'triangle'); tone(523, .1, .2, 'triangle'); },
  buzz: () => { tone(880, 0, .25, 'square', .1); tone(660, .08, .3, 'square', .07); },
  right: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .1, .35, 'triangle', .18)),
  wrong: () => { tone(150, 0, .5, 'sawtooth', .18); tone(110, .05, .5, 'sawtooth', .13); },
  joker: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * .07, .4, 'sine', .14))
};
function playMedia(src) {
  if (muted) return;
  media.src = toUrl(src); media.currentTime = 0;
  media.play().then(() => { audioBlocked = false; }).catch(() => { audioBlocked = true; render(); });
}
function stopMedia() { try { media.pause(); } catch (e) {} }

function confetti() {
  const cv = document.getElementById('confetti'), g = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#f5b92e', '#ffe08a', '#ff9ad5', '#41c27a', '#fff1d0', '#e0443a'];
  const ps = Array.from({ length: 160 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .6, w: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
    vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -.2 + Math.random() * .4,
    c: cols[Math.floor(Math.random() * cols.length)]
  }));
  const t0 = performance.now();
  (function frame(t) {
    g.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); });
    if (t - t0 < 5500) requestAnimationFrame(frame); else g.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

/* ---------- Verbindung ---------- */
function tryRejoin() {
  if (!me) return;
  const done = r => { if (!r.ok) { me = null; S = null; save(); render(); } };
  if (me.role === 'host') socket.emit('host:rejoin', { code: me.code, token: me.token }, done);
  else socket.emit('player:join', { code: me.code, token: me.token }, done);
}
socket.on('connect', () => { document.getElementById('banner').innerHTML = ''; tryRejoin(); });
socket.on('disconnect', () => { document.getElementById('banner').innerHTML = '<div class="banner">Verbindung verloren, verbinde neu …</div>'; });
socket.on('kicked', () => { me = null; S = null; save(); startError = 'Du wurdest aus dem Raum entfernt.'; render(); });
socket.on('state', s => { const prev = S; S = s; effects(prev, s); render(); });

function effects(prev, s) {
  const c = s.current, p = prev && prev.current;
  if (c) {
    if (!p || p.cat !== c.cat || p.row !== c.row) {
      skipPick = false; audioBlocked = false;
      SFX.pick(); if (c.joker) setTimeout(SFX.joker, 350);
    } else {
      if (c.state === 'buzzed' && p.state !== 'buzzed') SFX.buzz();
      if (c.state === 'reveal' && p.state !== 'reveal') (c.result === 'correct' ? SFX.right : SFX.wrong)();
      else if (p.state === 'buzzed' && c.state === 'open') SFX.wrong();
      if (c.state !== 'reading') skipPick = false;
    }
    if (c.sound && prev) {
      const k = c.cat + '-' + c.row + '-' + c.audio.n;
      if (c.audio.on) { if (k !== lastAudioKey) { lastAudioKey = k; playMedia(c.sound); } }
      else stopMedia();
    } else if (!c.sound) stopMedia();
  } else { stopMedia(); lastAudioKey = ''; }
  if (s.phase === 'end' && (!prev || prev.phase !== 'end')) { SFX.right(); setTimeout(confetti, 200); }
}

/* ---------- Rendering ---------- */
function render() {
  const keep = { ans: null, scroll: 0 };
  const a = document.getElementById('ans');
  if (a) { draft = a.value; keep.ans = document.activeElement === a ? [a.selectionStart, a.selectionEnd] : null; }
  const bw = document.querySelector('.boardwrap'); if (bw) keep.scroll = bw.scrollLeft;

  const key = S && S.current ? S.current.cat + '-' + S.current.row : '';
  cardFresh = !!key && key !== lastCardKey; lastCardKey = key;
  if (!key) draft = '';

  if (!me) viewStart();
  else if (!S) $app.innerHTML = '<div class="wrap center muted">Verbinde …</div>';
  else if (S.phase === 'lobby') me.role === 'host' ? viewHostLobby() : viewPlayerLobby();
  else if (S.phase === 'game') viewGame();
  else viewEnd();

  const bw2 = document.querySelector('.boardwrap'); if (bw2) bw2.scrollLeft = keep.scroll;
  const a2 = document.getElementById('ans');
  if (a2) { a2.value = draft; if (keep.ans) { a2.focus(); a2.setSelectionRange(...keep.ans); } }
}

function viewStart() {
  const code = new URLSearchParams(location.search).get('code') || '';
  $app.innerHTML = `
  <div class="wrap stack">
    <div class="logo">Quiz Show</div>
    <div class="panel stack">
      <h2>Mitspielen</h2>
      <input type="text" id="jcode" placeholder="Raumcode" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(code.toUpperCase())}">
      <input type="text" id="jname" placeholder="Dein Name" maxlength="20" autocomplete="nickname">
      <div class="err" id="err">${esc(startError)}</div>
      <button data-act="join">Beitreten</button>
    </div>
    <div class="panel stack">
      <h2>Spiel leiten</h2>
      <p class="muted" style="margin:0">Du erstellst einen Raum, steuerst die Fragen und entscheidest über richtig oder falsch.</p>
      <button class="ghost" data-act="host">Neuen Raum erstellen</button>
    </div>
  </div>`;
  startError = '';
}

function playerList(withKick) {
  if (!S.players.length) return '<p class="muted">Noch niemand im Raum.</p>';
  return '<ul class="plist">' + S.players.map(p => `
    <li><span><span class="dot ${p.connected ? '' : 'off'}"></span>${esc(p.name)}</span>
    ${withKick ? `<button class="ghost" data-act="kick" data-id="${p.id}">Entfernen</button>` : ''}</li>`).join('') + '</ul>';
}

function viewHostLobby() {
  const link = location.origin + '/?code=' + S.code;
  const nq = S.tiles.reduce((a, c) => a + c.filter(t => t !== 'none').length, 0);
  $app.innerHTML = `
  <div class="wrap stack">
    <div class="logo">${esc(S.titel)}</div>
    <div class="panel center">
      <div class="muted">Raumcode</div>
      <div class="roomcode">${S.code}</div>
      <div class="muted" style="margin-bottom:10px">Spieler öffnen diese Adresse:</div>
      <div class="row" style="justify-content:center"><code style="word-break:break-all">${esc(link)}</code>
      <button class="ghost" data-act="copy" data-text="${esc(link)}">Link kopieren</button></div>
    </div>
    <div class="panel"><h2>Spieler (${S.players.length})</h2>${playerList(true)}</div>
    <div class="panel stack">
      <h2>Fragen</h2>
      <div>${S.cats.length} Kategorien, ${nq} Fragen geladen.</div>
      <div class="muted">Eigene Fragen? Lade deine <code>fragen.json</code> hoch (<a href="/fragen-vorlage.json">Vorlage</a>).</div>
      <input type="file" id="qfile" accept=".json,application/json">
      <div class="err" id="err"></div>
    </div>
    <div class="panel stack">
      <h2>Einstellungen</h2>
      <label>Joker-Felder (verstecktes Power-up auf dem Board)
        <input type="number" id="setj" min="0" max="20" value="${S.settings.joker}"></label>
      <label class="chk"><input type="checkbox" id="sett" ${S.settings.typed ? 'checked' : ''}>
        Antworten eintippen lassen (du siehst die Antwort auf dem Bildschirm)</label>
    </div>
    <button data-act="start" ${S.players.length ? '' : 'disabled'}>Spiel starten</button>
  </div>`;
  document.getElementById('qfile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      let data; try { data = JSON.parse(t); } catch { return document.getElementById('err').textContent = 'Das ist keine gültige JSON-Datei.'; }
      socket.emit('host:setQuestions', data, r => { if (!r.ok) document.getElementById('err').textContent = r.error; });
    });
  };
  document.getElementById('setj').onchange = e => socket.emit('host:setSettings', { joker: e.target.value });
  document.getElementById('sett').onchange = e => socket.emit('host:setSettings', { typed: e.target.checked });
}

function viewPlayerLobby() {
  $app.innerHTML = `
  <div class="wrap stack center">
    <div class="logo">${esc(S.titel)}</div>
    <h2>Du bist drin, ${esc(me.name)}</h2>
    <p class="muted">Raum ${S.code}. Warte, bis der Host das Spiel startet.<br>Schalte den Ton an, es gibt Sounds.</p>
    <div class="panel" style="text-align:left"><h2>Spieler (${S.players.length})</h2>${playerList(false)}</div>
    <button class="ghost" data-act="leave">Raum verlassen</button>
  </div>`;
}

function puBadges(p) {
  return (p.pu.double ? `<span class="badge">×2 ${p.pu.double}</span>` : '') +
         (p.pu.skip ? `<span class="badge">Aus ${p.pu.skip}</span>` : '');
}
function chips() {
  const host = me.role === 'host';
  return '<div class="chips">' + S.players.map(p => {
    const cls = `chip ${S.picker === p.id ? 'turn' : ''} ${p.connected ? '' : 'off'} ${p.id === me.pid ? 'me' : ''}`;
    const inner = `${esc(p.name)}${puBadges(p)}<b>${p.score}</b>`;
    return host ? `<button class="${cls}" data-act="adjust" data-id="${p.id}" title="Klicken: Punkte ändern">${inner}</button>`
                : `<div class="${cls}">${inner}</div>`;
  }).join('') + '</div>';
}

function board(canPick) {
  let h = `<div class="frame"><div class="boardwrap"><div class="board" style="--cols:${S.cats.length}">`;
  S.cats.forEach(c => h += `<div class="cat">${esc(c)}</div>`);
  S.values.forEach((v, ri) => S.tiles.forEach((col, ci) => {
    const t = col[ri], go = t === 'free' && canPick;
    h += t === 'none' ? '<div class="tile gap"></div>'
      : `<button class="tile ${t === 'used' ? 'used' : ''} ${go ? 'go' : ''}" data-act="pick" data-c="${ci}" data-r="${ri}" ${go ? '' : 'disabled'} aria-label="${esc(S.cats[ci])} ${v}">${t === 'free' ? v : ''}</button>`;
  }));
  return h + '</div></div></div>';
}

function viewGame() {
  const host = me.role === 'host';
  const canPick = !S.current && (host || S.picker === me.pid);
  let turn = '';
  if (!S.current) {
    if (host) turn = S.picker ? `${esc(pname(S.picker))} ist am Zug. Du kannst trotzdem selbst ein Feld wählen.` : 'Wähle ein Feld.';
    else turn = S.picker === me.pid ? 'Du bist am Zug, wähle ein Feld!' : `${esc(pname(S.picker))} wählt das nächste Feld.`;
  }
  $app.innerHTML = `
  <div class="hud"><div class="t">${esc(S.titel)}</div>
    <div class="r"><span class="muted">Raum ${S.code}</span>
      <button class="ghost" data-act="mute">${muted ? 'Ton aus' : 'Ton an'}</button>
      ${host ? '<button class="ghost" data-act="end">Beenden</button>' : ''}</div></div>
  ${S.hostOnline ? '' : '<div class="banner">Der Host ist gerade nicht verbunden.</div>'}
  ${chips()}
  <div class="turnmsg">${turn}</div>
  ${board(canPick)}
  ${S.current ? card() : ''}`;
}

function card() {
  const c = S.current, host = me.role === 'host';
  const mine = S.players.find(p => p.id === me.pid);
  const mult = c.buzzer && c.doubled.includes(c.buzzer) ? 2 : 1;
  const img = c.state === 'reveal' && c.ansBild ? c.ansBild : c.bild;
  let status = '', btns = '', extra = '';

  if (c.state === 'reading') status = host ? 'Lies die Frage vor. Dann schaltest du den Buzzer frei.' : 'Die Frage wird vorgelesen. Power-ups kannst du jetzt noch einsetzen.';
  else if (c.state === 'open') status = 'Buzzer ist offen!';
  else if (c.state === 'buzzed') status = c.buzzer === me.pid ? 'Du bist dran, antworte jetzt!' : `${esc(pname(c.buzzer))} antwortet.`;
  else status = c.result === 'correct' ? `${esc(c.winner)} hatte recht und bekommt ${c.value * (c.doubled.includes(S.players.find(p => p.name === c.winner)?.id) ? 2 : 1)} Punkte.` : 'Niemand hat die Frage gelöst.';

  if (c.reward) status += ` Joker! ${esc(c.winner)} bekommt ein Power-up: ${c.reward === 'double' ? 'Doppelte Punkte' : 'Aussetzen'}.`;

  if (host) {
    const snd = c.sound && c.state !== 'reveal'
      ? `<button class="ghost" data-act="snd" data-on="1">${c.audio.n ? 'Sound neu starten' : 'Sound abspielen'}</button>${c.audio.on ? '<button class="ghost" data-act="snd" data-on="0">Sound stoppen</button>' : ''}` : '';
    if (c.state === 'reading') btns = `<button data-act="openBuzzer">Buzzer freigeben</button>${snd}<button class="ghost" data-act="skip">Überspringen</button>`;
    else if (c.state === 'open') btns = `${snd}<button class="ghost" data-act="skip">Niemand weiß es</button>`;
    else if (c.state === 'buzzed') btns = `<button class="ok" data-act="judge" data-v="1">Richtig, +${c.value * mult}</button><button class="bad" data-act="judge" data-v="0">Falsch, −${c.value / 2 * mult}</button>${snd}`;
    else btns = '<button data-act="close">Zurück zum Board</button>';
  }

  const names = ids => ids.map(pname).join(', ');
  if (c.doubled.length) extra += `<div class="status">Doppelte Punkte: ${esc(names(c.doubled))}</div>`;
  if (c.skipped.length) extra += `<div class="status">Ausgesetzt: ${esc(names(c.skipped))}</div>`;
  if (c.typed) extra += `<div class="typed">${esc(c.buzzer ? pname(c.buzzer) : c.winner)}: <b>${esc(c.typed)}</b></div>`;

  let play = '';
  if (!host && c.state === 'reading' && mine) {
    const others = S.players.filter(p => p.id !== me.pid && !c.locked.includes(p.id));
    play = `<div class="pu"><b>Power-ups</b><div class="row">
      <button data-act="pu" data-t="double" ${mine.pu.double && !c.doubled.includes(me.pid) ? '' : 'disabled'}>Doppelte Punkte (${mine.pu.double})</button>
      <button data-act="skipmenu" ${mine.pu.skip && others.length ? '' : 'disabled'}>Aussetzen (${mine.pu.skip})</button></div>
      ${skipPick ? `<div class="row">${others.map(p => `<button class="ghost" data-act="pu" data-t="skip" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}</div>`;
  }
  if (!host && c.state !== 'reading' && c.state !== 'reveal' && c.skipped.includes(me.pid)) extra += '<div class="status">Du wurdest ausgesetzt.</div>';

  let buzzer = '';
  if (!host && mine && c.state !== 'reveal') {
    const locked = c.locked.includes(me.pid), can = c.state === 'open' && !locked;
    buzzer = `<button class="buzz ${can ? 'live' : ''}" data-act="buzz" ${can ? '' : 'disabled'}>BUZZ</button>`;
    if (c.state === 'open' && locked && !c.skipped.includes(me.pid)) extra += '<div class="status">Du bist für diese Frage raus.</div>';
  }
  let answerBox = '';
  if (!host && S.settings.typed && c.state === 'buzzed' && c.buzzer === me.pid)
    answerBox = `<div class="row" style="margin-top:12px"><input type="text" id="ans" maxlength="200" placeholder="Deine Antwort" autocomplete="off"><button data-act="send">Senden</button></div>`;

  const blocked = c.sound && c.audio.on && audioBlocked ? '<div class="btns"><button data-act="tapsound">Sound starten</button></div>' : '';
  const hostAns = host ? `<div class="a">Antwort: <b>${esc(c.answer)}</b></div>` : (c.state === 'reveal' ? `<div class="a">Antwort: <b>${esc(c.answer)}</b></div>` : '');

  return `<div class="ov"><div class="card ${cardFresh ? 'enter' : ''}">
    <div class="meta">${esc(c.catName)}, ${c.value} Punkte</div>
    ${c.joker ? '<div class="joker">Joker-Feld! Richtig beantwortet gibt ein Power-up</div>' : ''}
    ${img ? `<img class="qimg" src="${esc(toUrl(img))}" alt="">` : ''}
    ${c.sound && c.audio.on ? '<div class="status">Sound läuft …</div>' : ''}
    ${c.question ? `<div class="q">${esc(c.question)}</div>` : ''}
    ${blocked}${hostAns}
    <div class="status">${status}</div>${extra}${play}${buzzer}${answerBox}
    <div class="btns">${btns}</div>
  </div></div>`;
}

function viewEnd() {
  const r = [...S.players].sort((a, b) => b.score - a.score);
  const order = [r[1], r[0], r[2]].filter(Boolean);
  const h = { 0: 200, 1: 150, 2: 110 };
  const rankOf = p => r.indexOf(p);
  $app.innerHTML = `<div class="wrap stack center">
    <div class="logo">Siegerehrung</div>
    <div class="podium">${order.map(p => `<div class="pod"><div class="n">${esc(p.name)}</div><div class="s">${p.score}</div>
      <div class="bar" style="height:${h[rankOf(p)]}px">${rankOf(p) + 1}</div></div>`).join('')}</div>
    ${r.length > 3 ? `<div class="panel" style="text-align:left"><ul class="plist">${r.slice(3).map((p, i) => `<li><span>${i + 4}. ${esc(p.name)}</span><b>${p.score}</b></li>`).join('')}</ul></div>` : ''}
    <button class="ghost" data-act="leave">Zur Startseite</button>
  </div>`;
}

/* ---------- Aktionen ---------- */
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-act="buzz"]');
  if (el && !el.disabled) { socket.emit('player:buzz'); if (navigator.vibrate) navigator.vibrate(30); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'ans') sendAnswer(); });
function sendAnswer() { const a = document.getElementById('ans'); if (a && a.value.trim()) socket.emit('player:answer', { text: a.value }); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const d = el.dataset, host = me && me.role === 'host';
  switch (d.act) {
    case 'host': socket.emit('host:create', r => { me = { role: 'host', code: r.code, token: r.token }; save(); }); break;
    case 'join': {
      const code = document.getElementById('jcode').value.trim().toUpperCase();
      const name = document.getElementById('jname').value.trim();
      socket.emit('player:join', { code, name }, r => {
        if (!r.ok) return document.getElementById('err').textContent = r.error;
        me = { role: 'player', code: r.code, token: r.token, pid: r.pid, name: r.name }; save();
      });
      break;
    }
    case 'copy': navigator.clipboard && navigator.clipboard.writeText(d.text); el.textContent = 'Kopiert'; break;
    case 'start': socket.emit('host:start'); break;
    case 'pick': socket.emit(host ? 'host:pick' : 'player:pick', { cat: +d.c, row: +d.r }); break;
    case 'openBuzzer': socket.emit('host:openBuzzer'); break;
    case 'judge': socket.emit('host:judge', { correct: d.v === '1' }); break;
    case 'skip': socket.emit('host:skip'); break;
    case 'close': socket.emit('host:close'); break;
    case 'kick': socket.emit('host:kick', { id: d.id }); break;
    case 'snd': socket.emit('host:sound', { on: d.on === '1' }); break;
    case 'tapsound': playMedia(S.current.sound); break;
    case 'skipmenu': skipPick = !skipPick; render(); break;
    case 'pu': socket.emit('player:powerup', { type: d.t, target: d.id }); skipPick = false; break;
    case 'send': sendAnswer(); break;
    case 'mute': muted = !muted; localStorage.setItem('quiz-mute', muted ? '1' : '0'); if (muted) stopMedia(); render(); break;
    case 'end': if (confirm('Spiel wirklich beenden?')) socket.emit('host:end'); break;
    case 'adjust': {
      const v = prompt('Punkte für ' + pname(d.id) + ' ändern (z. B. 200 oder -200).\nLeer lassen und OK: Spieler ist als Nächstes am Zug.');
      if (v === null) break;
      if (v.trim() === '') socket.emit('host:setPicker', { id: d.id });
      else if (!isNaN(Number(v))) socket.emit('host:adjust', { id: d.id, delta: Number(v) });
      break;
    }
    case 'leave': me = null; S = null; save(); history.replaceState(null, '', '/'); render(); break;
  }
});
render();
