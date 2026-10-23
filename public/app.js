const socket = io();
const $app = document.getElementById('app');
const LS = 'quiz-session';
let me = JSON.parse(localStorage.getItem(LS) || 'null'); // {role, code, token, pid, name}
let S = null, startError = '', coffeePick = false, draft = '', lastCardKey = '', cardFresh = false;
let muted = localStorage.getItem('quiz-mute') === '1';
let audioBlocked = false, lastAudioKey = '', previewing = false, mediaStop = null;
let openAt = 0, buzzSent = false, lockUntil = 0, lockTimer = null;   // Buzzer-Fairness
let myGuess = '', myWager = null, myDecision = null, jokerMode = false, deadline = 0, menuFor = null;
let revealT0 = 0, pixStage = -1;                                      // Reveal-Bild
let lastTick = 0, shakeCard = false, cardFx = '', scoreAnim = {}, floats = [];   // Effekte
const pixImgs = {}, pixErr = {};

const JOKER = {
  double: { name: 'Doppelte Punkte', icon: '×2', desc: 'Dein Ergebnis bei dieser Frage zählt doppelt – Gewinn wie Verlust.' },
  coffee: { name: 'Kaffeepause', icon: '☕', desc: 'Ein Mitspieler deiner Wahl setzt bei dieser Frage aus.' },
  risk:   { name: 'Risiko', icon: '⚡', desc: 'Richtig: dreifache Punkte. Falsch oder keine Antwort: doppelter Fragenwert Abzug.' }
};
const WHY = { correct: 'richtig', wrong: 'falsch', risk: 'Risiko verloren', streak: 'Serien-Bonus' };
// Muss zur Liste im Server passen (wird dort geprueft)
const COLORS = ['#e0443a', '#f5b92e', '#41c27a', '#3b9ddd', '#a86be0', '#ff9ad5', '#ff8a3c', '#2ec4b6', '#c9b8a0', '#8ff0b8', '#ffe08a', '#6b8cff'];
const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐧', '🐯', '🐨', '🦉', '🐵', '🐺', '🦖', '🐢', '🦋', '🐝', '🍕', '🎸', '🚀', '🎲', '🧙', '🤖', '👽', '🍩'];
let look = JSON.parse(localStorage.getItem('quiz-look') || 'null') || { color: Math.floor(Math.random() * COLORS.length), avatar: Math.floor(Math.random() * AVATARS.length) };
let lookOpen = false;
const seenNotices = new Set();

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const save = () => me ? localStorage.setItem(LS, JSON.stringify(me)) : localStorage.removeItem(LS);
const pname = id => { const p = S && S.players.find(x => x.id === id); return p ? p.name : '?'; };
const pOf = id => S && S.players.find(x => x.id === id);
// Name mit Avatar (fuer Listen und Chips)
const plabel = id => { const p = pOf(id); return p ? `<span class="av">${p.avatar}</span>${esc(p.name)}` : '?'; };
const fmtSec = ms => (ms / 1000).toFixed(2).replace('.', ',') + ' s';
const toUrl = u => /^https?:/i.test(u) || u.startsWith('/') ? u : '/' + encodeURI(u);
const fmtTime = s => s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : String(s);
const fmtMult = m => ('×' + m).replace('.', ',');
const winMult = (c, pid) => { const j = c.used; return j && j.by === pid ? (j.type === 'double' ? 2 : j.type === 'risk' ? 3 : 1) : 1; };
const penalty = (c, pid, v) => { const j = c.used; if (j && j.by === pid) { if (j.type === 'risk') return v * 2; if (j.type === 'double') return v; } return v / 2; };
const gain = (c, pid) => Math.round(c.value * winMult(c, pid) * (c.reveal ? c.reveal.mult[c.reveal.stage] : 1));

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
  updateLobbyMusic();
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
/* Eigene Sounddateien: liegen sie unter media/sfx/<name>.mp3, werden sie statt der Synth-Toene benutzt */
const SFX_FILES = { pick: 'feld', buzz: 'buzz', right: 'richtig', wrong: 'falsch', joker: 'joker', use: 'jokereinsatz', timeup: 'zeit', ding: 'ding', stage: 'stufe', finale: 'finale', streak: 'serie', tick: 'tick' };
const sfxAudio = {};
Object.entries(SFX_FILES).forEach(([key, file]) => {
  const a = new Audio('/media/sfx/' + file + '.mp3');
  a.preload = 'auto';
  a.addEventListener('canplaythrough', () => { sfxAudio[key] = a; }, { once: true });
  a.addEventListener('error', () => { delete sfxAudio[key]; });
});
function playFile(key) {
  const a = sfxAudio[key];
  if (!a || muted) return false;
  try { const c = a.cloneNode(); c.volume = .7; c.play().catch(() => {}); } catch (e) {}
  return true;
}
const SYNTH = {
  pick: () => { tone(392, 0, .12, 'triangle'); tone(523, .1, .2, 'triangle'); },
  buzz: () => { tone(880, 0, .25, 'square', .1); tone(660, .08, .3, 'square', .07); },
  right: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .1, .35, 'triangle', .18)),
  wrong: () => { tone(150, 0, .5, 'sawtooth', .18); tone(110, .05, .5, 'sawtooth', .13); },
  joker: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * .07, .4, 'sine', .14)),
  use: () => { tone(1175, 0, .15, 'sine', .14); tone(1568, .12, .3, 'sine', .14); },
  timeup: () => [0, .18, .36].forEach(t => tone(440, t, .14, 'square', .12)),
  ding: () => { tone(1047, 0, .4, 'sine', .14); },
  stage: () => { tone(660, 0, .1, 'triangle', .12); tone(880, .1, .15, 'triangle', .12); },
  finale: () => [392, 392, 392, 311, 466, 392, 311, 466, 392].forEach((f, i) => tone(f, i * .22, i === 8 ? .6 : .2, 'sawtooth', .1)),
  streak: () => [659, 784, 988, 1319, 1568].forEach((f, i) => tone(f, i * .08, .3, 'triangle', .16)),
  tick: () => tone(1200, 0, .06, 'square', .08)
};
const SFX = {};
Object.keys(SYNTH).forEach(k => { SFX[k] = () => { if (!playFile(k)) SYNTH[k](); }; });
// Lobby-Musik (media/sfx/lobby.mp3), laeuft in der Lobby und endet mit dem Spielstart
const lobbyMusic = new Audio('/media/sfx/lobby.mp3');
lobbyMusic.loop = true; lobbyMusic.volume = .35;
let lobbyOk = false;
lobbyMusic.addEventListener('canplaythrough', () => { lobbyOk = true; updateLobbyMusic(); }, { once: true });
lobbyMusic.addEventListener('error', () => { lobbyOk = false; });
function updateLobbyMusic() {
  const want = lobbyOk && !muted && unlocked && S && S.phase === 'lobby';
  if (want && lobbyMusic.paused) lobbyMusic.play().catch(() => {});
  if (!want && !lobbyMusic.paused) lobbyMusic.pause();
}
// limit > 0: nur die ersten Sekunden abspielen (Sound-Reveal)
let mediaError = '';
media.onerror = () => { mediaError = 'Sound konnte nicht geladen werden – kein direkter Dateilink (YouTube & Co. gehen nicht) oder die Seite blockt das Einbetten.'; render(); };
function playMedia(src, limit) {
  if (muted) return;
  mediaError = '';
  clearTimeout(mediaStop);
  media.src = toUrl(src); media.currentTime = 0;
  media.play().then(() => {
    audioBlocked = false;
    if (limit > 0) mediaStop = setTimeout(() => media.pause(), limit * 1000);
  }).catch(() => { audioBlocked = true; render(); });
}
function stopMedia() { clearTimeout(mediaStop); try { media.pause(); } catch (e) {} }

function confetti(count = 160, ms = 5500) {
  const cv = document.getElementById('confetti'), g = cv.getContext('2d');
  if (!g) return;
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#f5b92e', '#ffe08a', '#ff9ad5', '#41c27a', '#fff1d0', '#e0443a'];
  const ps = Array.from({ length: count }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .6, w: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
    vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -.2 + Math.random() * .4,
    c: cols[Math.floor(Math.random() * cols.length)]
  }));
  const t0 = performance.now();
  (function frame(t) {
    g.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); });
    if (t - t0 < ms) requestAnimationFrame(frame); else g.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

/* ---------- Reveal-Bild: verpixelt zeichnen ---------- */
const PIX = [1 / 28, 1 / 14, 1 / 7, 1];   // Anteil der Originalaufloesung je Stufe
function drawPix() {
  const cv = document.querySelector('canvas.pix');
  if (!cv) return;
  const src = cv.dataset.src, stage = +cv.dataset.stage;
  let img = pixImgs[src];
  if (!img) {
    img = pixImgs[src] = new Image();
    img.onload = drawPix;
    img.onerror = () => { pixErr[src] = true; render(); };
    img.src = src;
    return;
  }
  if (!img.complete || !img.naturalWidth) return;
  const g = cv.getContext('2d');
  if (!g) return;
  const W = Math.min(img.naturalWidth, 1280), H = Math.round(img.naturalHeight * W / img.naturalWidth);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const f = PIX[Math.max(0, Math.min(3, stage))];
  if (f >= 1) { g.imageSmoothingEnabled = true; g.drawImage(img, 0, 0, W, H); return; }
  const sw = Math.max(2, Math.round(W * f)), sh = Math.max(2, Math.round(H * f));
  const off = document.createElement('canvas'); off.width = sw; off.height = sh;
  const og = off.getContext('2d');
  og.imageSmoothingEnabled = true; og.drawImage(img, 0, 0, sw, sh);
  g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, sw, sh, 0, 0, W, H);
}
// Aktuelle Reveal-Stufe (Bild: aus der Zeit, Sound: vom Server)
function stageNow(c) {
  if (!c.reveal) return 0;
  if (c.state === 'reveal') return 3;
  if (c.reveal.mode === 'sound' || c.state !== 'open') return c.reveal.stage;
  return Math.max(0, Math.min(3, Math.floor((Date.now() - revealT0) / (c.reveal.dauer * 1000 / 4))));
}

/* Countdown und Reveal-Stufen laufen lokal weiter, der Server schickt nur Restzeit bzw. Startzeitpunkt */
setInterval(() => {
  const els = document.querySelectorAll('.cd');
  if (els.length) {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    els.forEach(el => { el.textContent = fmtTime(left); el.classList.toggle('warn', left <= 3 && left > 0); });
    const cur = S && S.current;
    if (cur && cur.state === 'buzzed' && left <= 3 && left > 0 && left !== lastTick) { lastTick = left; SFX.tick(); }
  }
  document.querySelectorAll('.notice[data-exp]').forEach(el => { if (+el.dataset.exp < Date.now()) el.remove(); });
  const c = S && S.current;
  if (c && c.reveal && c.reveal.mode === 'bild' && c.state === 'open') {
    const st = stageNow(c);
    if (st !== pixStage) { pixStage = st; if (st > 0) SFX.stage(); render(); }
  }
}, 200);

// Keep-alive: ein kleiner HTTP-Aufruf alle 5 Minuten, damit der Gratis-Server nicht einschlaeft
setInterval(() => { if (me) fetch('/ping').catch(() => {}); }, 5 * 60 * 1000);

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

// Grosser Name in Spielerfarbe, wenn jemand buzzert
function buzzFlash(pid) {
  const pl = pOf(pid); if (!pl) return;
  document.querySelectorAll('.buzzflash').forEach(e => e.remove());
  const el = document.createElement('div');
  el.className = 'buzzflash'; el.style.setProperty('--pc', pl.color);
  el.innerHTML = `<div class="bf"><span class="av">${pl.avatar}</span>${esc(pl.name)}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
// Punkteaenderungen: Zahl zaehlt hoch/runter, Delta fliegt vom Chip weg
function scoreEffects(prev, s) {
  if (!prev) return;
  s.players.forEach(p => {
    const o = prev.players.find(x => x.id === p.id);
    if (!o || o.score === p.score) return;
    scoreAnim[p.id] = { from: o.score, to: p.score, t0: performance.now() };
    floats.push({ pid: p.id, delta: p.score - o.score, id: Math.random().toString(36).slice(2) });
  });
  if (Object.keys(scoreAnim).length) requestAnimationFrame(tickScores);
}
function tickScores() {
  let active = false;
  Object.entries(scoreAnim).forEach(([pid, a]) => {
    const k = Math.min(1, (performance.now() - a.t0) / 600);
    const v = Math.round(a.from + (a.to - a.from) * (1 - Math.pow(1 - k, 3)));
    document.querySelectorAll(`.chip[data-pid="${pid}"] b`).forEach(b => { b.textContent = v; });
    if (k >= 1) delete scoreAnim[pid]; else active = true;
  });
  if (active) requestAnimationFrame(tickScores);
}
const shownScore = p => { const a = scoreAnim[p.id]; if (!a) return p.score; const k = Math.min(1, (performance.now() - a.t0) / 600); return Math.round(a.from + (a.to - a.from) * (1 - Math.pow(1 - k, 3))); };

function effects(prev, s) {
  const c = s.current, p = prev && prev.current;
  scoreEffects(prev, s);
  updateLobbyMusic();
  if (c && c.typ === 'finale') {
    const fresh = !p || p.typ !== 'finale' || p.idx !== c.idx;
    if (fresh) { myGuess = ''; myWager = null; myDecision = null; SFX.pick(); }
    else {
      if (c.state === 'decide' && p.state !== 'decide') SFX.ding();
      if (c.state === 'play' && p.state !== 'play') SFX.pick();
      if (c.review && p.review && c.review.revealed > p.review.revealed) SFX.pick();
      if (c.state === 'judge' && p.state !== 'judge') SFX.ding();
      if (c.state === 'reveal' && p.state !== 'reveal') { const good = c.awards.some(a => a.delta > 0); (good ? SFX.right : SFX.wrong)(); cardFx = good ? 'good' : 'badfx'; }
    }
    if (c.left != null) deadline = Date.now() + c.left;
    if (c.sound && c.audio.on) {
      const k = 'f' + c.idx + '-' + c.audio.n;
      if (k !== lastAudioKey) { lastAudioKey = k; playMedia(c.sound, 0); }
    } else stopMedia();
  } else if (c) {
    const fresh = !p || p.typ === 'finale' || p.cat !== c.cat || p.row !== c.row;
    if (fresh) {
      coffeePick = false; audioBlocked = false; buzzSent = false; myGuess = ''; previewing = false; pixStage = -1;
      SFX.pick(); if (c.joker) setTimeout(SFX.joker, 350);
    } else {
      if (c.state === 'buzzed' && p.state !== 'buzzed') { SFX.buzz(); shakeCard = true; buzzFlash(c.buzzer); lastTick = 0; }
      if (c.state === 'reveal' && p.state !== 'reveal') {
        if (c.result === 'correct') { SFX.right(); cardFx = 'good'; if (c.reward) setTimeout(() => confetti(70, 2500), 150); }
        else if (c.result === 'none') { SFX.wrong(); cardFx = 'badfx'; }
      }
      else if (p.state === 'buzzed' && c.state === 'open') { SFX.wrong(); cardFx = 'badfx'; }
      if (c.state === 'review' && p.state !== 'review') SFX.ding();
      if (c.timeUp && !p.timeUp) SFX.timeup();
      if (c.used && !p.used) SFX.use();
      if (c.reveal && p.reveal && c.reveal.mode === 'sound' && c.reveal.stage > p.reveal.stage) SFX.stage();
    }
    // Reaktionszeit-Messung startet, sobald der Buzzer bei uns sichtbar offen ist
    if (c.state === 'open' && !c.pending && (fresh || p.state !== 'open' || p.pending)) { openAt = performance.now(); buzzSent = false; }
    if (c.state !== 'reading') { coffeePick = false; previewing = false; }
    if (c.left != null) deadline = Date.now() + c.left;
    if (c.reveal) revealT0 = Date.now() - c.reveal.elapsed;
    if (c.sound && c.audio.on) {
      const k = c.cat + '-' + c.row + '-' + c.audio.n;
      if (k !== lastAudioKey) {
        lastAudioKey = k; previewing = false;
        playMedia(c.sound, c.reveal && c.reveal.mode === 'sound' ? c.reveal.soundStages[c.reveal.stage] : 0);
      }
    } else if (!previewing) stopMedia();
  } else { stopMedia(); lastAudioKey = ''; previewing = false; }
  (s.notices || []).forEach(n => { if (!seenNotices.has(n.id)) { seenNotices.add(n.id); if (n.age < 3000) (n.kind === 'streak' ? SFX.streak : SFX.joker)(); } });
  if (s.interlude && !(prev && prev.interlude)) SFX.ding();
  if (s.phase === 'finale' && (!prev || prev.phase !== 'finale')) { menuFor = null; SFX.finale(); }
  if (s.phase === 'end' && (!prev || prev.phase !== 'end')) { menuFor = null; SFX.right(); setTimeout(confetti, 200); }
}

/* ---------- Rendering ---------- */
function render() {
  const keep = { sel: null, scroll: 0, wager: null, adj: null };
  const g = document.getElementById('guess');
  if (g) { draft = g.value; keep.sel = document.activeElement === g ? [g.selectionStart, g.selectionEnd] : null; }
  const w = document.getElementById('wager'); if (w) keep.wager = w.value;
  const av = document.getElementById('adjv'); if (av) keep.adj = av.value;
  const bw = document.querySelector('.boardwrap'); if (bw) keep.scroll = bw.scrollLeft;

  const key = S && S.current ? (S.current.typ === 'finale' ? 'f' + S.current.idx : S.current.cat + '-' + S.current.row) : '';
  cardFresh = !!key && key !== lastCardKey; lastCardKey = key;
  if (!key) draft = '';

  if (!me) viewStart();
  else if (!S) $app.innerHTML = '<div class="wrap center muted">Verbinde …</div>';
  else if (S.phase === 'lobby') me.role === 'host' ? viewHostLobby() : viewPlayerLobby();
  else if (S.phase === 'game') viewGame();
  else if (S.phase === 'finale') viewFinale();
  else viewEnd();

  const bw2 = document.querySelector('.boardwrap'); if (bw2) bw2.scrollLeft = keep.scroll;
  const g2 = document.getElementById('guess');
  if (g2) { g2.value = draft; if (keep.sel) { g2.focus(); g2.setSelectionRange(...keep.sel); } }
  const w2 = document.getElementById('wager'); if (w2 && keep.wager !== null) { w2.value = keep.wager; const r = document.getElementById('wrange'); if (r) r.value = keep.wager; }
  const av2 = document.getElementById('adjv'); if (av2 && keep.adj !== null) av2.value = keep.adj;
  const card = document.querySelector('.card');
  if (card) {
    if (shakeCard) { card.classList.add('shake'); shakeCard = false; }
    if (cardFx) { card.classList.add(cardFx); cardFx = ''; }
  }
  if (floats.length) { const ids = floats.map(f => f.id); setTimeout(() => { floats = floats.filter(f => !ids.includes(f.id)); document.querySelectorAll('.float').forEach(e => { if (ids.includes(e.dataset.fid)) e.remove(); }); }, 1400); }
  drawPix();
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
      ${lookPicker()}
      <div class="err" id="err">${esc(startError)}</div>
      <button data-act="join">Beitreten</button>
    </div>
    <div class="panel stack">
      <h2>Spiel leiten</h2>
      <p class="muted" style="margin:0">Du erstellst einen Raum, liest die Fragen vor und entscheidest über richtig oder falsch.</p>
      <button class="ghost" data-act="host">Neuen Raum erstellen</button>
    </div>
    <p class="center"><a href="/editor.html">Fragen-Editor öffnen</a></p>
  </div>`;
  startError = '';
}

function lookPicker() {
  return `<div class="lookpick">
    <div class="muted">Deine Farbe</div>
    <div class="swatches">${COLORS.map((c, i) => `<button class="sw ${look.color === i ? 'on' : ''}" style="--pc:${c}" data-act="color" data-i="${i}" aria-label="Farbe ${i + 1}"></button>`).join('')}</div>
    <div class="muted" style="margin-top:8px">Dein Avatar</div>
    <div class="avgrid">${AVATARS.map((a, i) => `<button class="avb ${look.avatar === i ? 'on' : ''}" data-act="avatar" data-i="${i}">${a}</button>`).join('')}</div>
  </div>`;
}
function playerList() {
  if (!S.players.length) return '<p class="muted">Noch niemand im Raum.</p>';
  return '<ul class="plist">' + S.players.map((p, i) => `
    <li><span><span class="dot ${p.connected ? '' : 'off'}"></span>${i + 1}. ${plabel(p.id)}</span></li>`).join('') + '</ul>';
}
function hostPlayerList() {
  if (!S.players.length) return '<p class="muted">Noch niemand im Raum.</p>';
  const n = S.players.length;
  return '<ul class="plist">' + S.players.map((p, i) => `
    <li><span><span class="dot ${p.connected ? '' : 'off'}"></span>${i + 1}. ${plabel(p.id)}</span>
    <span class="row">
      <button class="ghost sm" data-act="move" data-id="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Nach oben">▲</button>
      <button class="ghost sm" data-act="move" data-id="${p.id}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} title="Nach unten">▼</button>
      <button class="ghost sm" data-act="kick" data-id="${p.id}">Entfernen</button></span></li>`).join('') + '</ul>';
}

function viewHostLobby() {
  const link = location.origin + '/?code=' + S.code;
  const nq = S.tiles.reduce((a, c) => a + c.filter(t => t !== 'none').length, 0);
  const fixed = S.jokerTiles.length, rest = Math.max(0, S.settings.joker - fixed);
  $app.innerHTML = `
  <div class="wrap wide stack">
    <div class="logo">${esc(S.titel)}</div>
    <div class="cols">
      <div class="stack">
        <div class="panel center">
          <div class="muted">Raumcode</div>
          <div class="roomcode">${S.code}</div>
          <div class="muted" style="margin-bottom:10px">Spieler öffnen diese Adresse:</div>
          <div class="row" style="justify-content:center"><code style="word-break:break-all">${esc(link)}</code>
          <button class="ghost" data-act="copy" data-text="${esc(link)}">Link kopieren</button></div>
        </div>
        <div class="panel"><h2>Spieler (${S.players.length})</h2>
          <p class="muted" style="margin:0 0 8px">Die Reihenfolge hier ist die Zugreihenfolge im Spiel.</p>${hostPlayerList()}</div>
      </div>
      <div class="stack">
        <div class="panel stack">
          <h2>Fragen</h2>
          <div>${S.cats.length} Kategorien × ${S.values.length} Stufen (${S.values[0]}–${S.values[S.values.length - 1]}), ${nq} Fragen.
            ${S.finale ? `Finale „${esc(S.finale.name)}" mit ${S.finale.count} Frage${S.finale.count === 1 ? '' : 'n'}.` : '<span class="muted">Kein Finale in diesem Paket.</span>'}</div>
          <div class="muted">Eigene Fragen? Lade deine <code>fragen.json</code> oder ein Sofort-Paket aus dem <a href="/editor.html" target="_blank">Fragen-Editor</a> hoch (<a href="/fragen-vorlage.json">Vorlage</a>).</div>
          <input type="file" id="qfile" accept=".json,application/json">
          <div class="err" id="err"></div>
        </div>
        <div class="panel stack">
          <h2>Einstellungen</h2>
          <div class="settings">
            <label>Joker-Felder gesamt<input type="number" id="setj" min="0" max="150" value="${S.settings.joker}"></label>
            <label>Antwortzeit nach Buzz (s)<input type="number" id="seta" min="3" max="60" value="${S.settings.answerTime}"></label>
            <label>Schätz-/Finalzeit (s)<input type="number" id="setg" min="10" max="600" value="${S.settings.guessTime}"></label>
            <label>Comeback alle … Fragen (0 = aus)<input type="number" id="setc" min="0" max="200" value="${S.settings.comeback}"></label>
          </div>
        </div>
      </div>
    </div>
    <div class="panel stack">
      <h2>Joker-Felder</h2>
      <div class="muted">Klick auf ein Feld setzt es fest als Joker (★). ${fixed} fest gesetzt${rest ? `, ${rest} weitere werden beim Start zufällig verteilt` : ''}. Spieler sehen die Joker nicht.</div>
      ${board({ mini: true, toggle: true })}
    </div>
    <button data-act="start" ${S.players.length ? '' : 'disabled'}>Spiel starten</button>
  </div>`;
  document.getElementById('qfile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const err = m => { const el = document.getElementById('err'); if (el) el.textContent = m; };
    f.text().then(t => {
      let data; try { data = JSON.parse(t); } catch { return err('Das ist keine gültige JSON-Datei.'); }
      const n = data && data.medien && typeof data.medien === 'object' ? Object.keys(data.medien).length : 0;
      if (n && !confirm(`Dieses Sofort-Paket enthält ${n} eingebettete Bilder/Sounds.\n\nSie liegen danach NUR im Arbeitsspeicher des Servers: Nach einem Neustart oder wenn der Gratis-Server einschläft, sind sie weg und müssen vor dem nächsten Spiel neu hochgeladen werden.\n\nDauerhaft bleiben Medien nur, wenn sie als Repo-Paket in GitHub liegen.\n\nTrotzdem jetzt hochladen?`)) return;
      err('Lade hoch …');
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: me.code, token: me.token, paket: data }) })
        .then(r => r.json()).then(r => err(r.ok ? '' : r.error))
        .catch(() => err('Upload fehlgeschlagen (Datei zu groß oder keine Verbindung).'));
    });
  };
  document.getElementById('setj').onchange = e => socket.emit('host:setSettings', { joker: e.target.value });
  document.getElementById('seta').onchange = e => socket.emit('host:setSettings', { answerTime: e.target.value });
  document.getElementById('setg').onchange = e => socket.emit('host:setSettings', { guessTime: e.target.value });
  document.getElementById('setc').onchange = e => socket.emit('host:setSettings', { comeback: e.target.value });
}

function viewPlayerLobby() {
  $app.innerHTML = `
  <div class="wrap stack center">
    <div class="logo">${esc(S.titel)}</div>
    <h2>Du bist drin, ${esc(me.name)}</h2>
    <p class="muted">Raum ${S.code}. Warte, bis der Spielleiter das Spiel startet.<br>Schalte den Ton an, es gibt Sounds.</p>
    <div class="panel" style="text-align:left"><h2>Spieler (${S.players.length})</h2>${playerList()}</div>
    <div class="panel" style="text-align:left"><button class="ghost" data-act="looktoggle">${lookOpen ? 'Fertig' : 'Farbe und Avatar ändern'}</button>${lookOpen ? lookPicker() : ''}</div>
    <button class="ghost" data-act="leave">Raum verlassen</button>
  </div>`;
}

function jokerBadges(p) {
  const n = {}; p.jokers.forEach(t => n[t] = (n[t] || 0) + 1);
  return (p.streak >= 3 ? `<span class="badge fire" title="${p.streak} richtige in Folge">🔥 ${p.streak}</span>` : '') +
    Object.keys(n).map(t => `<span class="badge" title="${esc(JOKER[t].name)}">${JOKER[t].icon}${n[t] > 1 ? ' ' + n[t] : ''}</span>`).join('') +
    (p.pending ? '<span class="badge new">Joker wählen</span>' : '');
}
function chips() {
  const host = me.role === 'host';
  return '<div class="chips">' + S.players.map(p => {
    const cls = `chip ${S.picker === p.id ? 'turn' : ''} ${p.connected ? '' : 'off'} ${p.id === me.pid ? 'me' : ''} ${menuFor === p.id ? 'turn' : ''}`;
    const fl = floats.filter(f => f.pid === p.id).map(f => `<span class="float ${f.delta > 0 ? 'plus' : 'minus'}" data-fid="${f.id}">${f.delta > 0 ? '+' : '−'}${Math.abs(f.delta)}</span>`).join('');
    const inner = `${plabel(p.id)}${jokerBadges(p)}<b>${shownScore(p)}</b>${fl}`;
    return host ? `<button class="${cls}" style="--pc:${p.color}" data-pid="${p.id}" data-act="menu" data-id="${p.id}" title="Punkte, Zug, Joker">${inner}</button>`
                : `<div class="${cls}" style="--pc:${p.color}" data-pid="${p.id}">${inner}</div>`;
  }).join('') + '</div>' + (host ? playerMenu() : '');
}
// Host-Menue fuer einen Spieler (ersetzt das prompt-Fenster)
function playerMenu() {
  const p = menuFor && S.players.find(x => x.id === menuFor);
  if (!p) return '';
  const owned = {}; p.jokers.forEach(t => owned[t] = (owned[t] || 0) + 1);
  const step = S.values[0] || 100, full = p.jokers.length >= 3;
  return `<div class="pmenu">
    <h3>${esc(p.name)} – ${p.score} Punkte</h3>
    <div class="row"><span>Punkte</span>
      <button class="ghost" data-act="adj" data-id="${p.id}" data-d="${-step}">−${step}</button>
      <button class="ghost" data-act="adj" data-id="${p.id}" data-d="${step}">+${step}</button>
      <input type="number" id="adjv" placeholder="±Betrag" step="${step}">
      <button class="ghost" data-act="adjcustom" data-id="${p.id}">Ändern</button></div>
    ${S.phase === 'game' ? `<div class="row"><span>Zug</span><button class="ghost" data-act="setpicker" data-id="${p.id}" ${S.picker === p.id ? 'disabled' : ''}>Ist als Nächstes dran</button></div>` : ''}
    <div class="row"><span>Joker geben</span>
      ${Object.keys(JOKER).map(t => `<button class="ghost" data-act="give" data-id="${p.id}" data-t="${t}" ${full ? 'disabled' : ''} title="${esc(JOKER[t].name)}">${JOKER[t].icon} ${JOKER[t].name}</button>`).join('')}
      ${full ? '<span class="muted">(hat schon 3)</span>' : ''}</div>
    ${p.jokers.length ? `<div class="row"><span>Joker nehmen</span>
      ${Object.keys(owned).map(t => `<button class="ghost" data-act="take" data-id="${p.id}" data-t="${t}">${JOKER[t].icon} ${JOKER[t].name} (${owned[t]})</button>`).join('')}</div>` : ''}
    <div class="row"><span></span><button class="bad sm" data-act="kick" data-id="${p.id}">Spieler entfernen</button><button class="ghost" data-act="menu" data-id="${p.id}">Schließen</button></div>
  </div>`;
}

function board(o) {
  const host = me.role === 'host', jk = new Set(S.jokerTiles || []);
  let h = `<div class="frame ${o.mini ? 'mini' : ''}"><div class="boardwrap"><div class="board" style="--cols:${S.cats.length};--rows:${S.values.length}">`;
  S.cats.forEach(c => h += `<div class="cat">${esc(c)}</div>`);
  S.values.forEach((v, ri) => S.tiles.forEach((col, ci) => {
    const t = col[ri], isJ = host && jk.has(ci + '-' + ri) && t === 'free';
    if (t === 'none') { h += '<div class="tile gap"></div>'; return; }
    const on = o.toggle ? t === 'free' : (t === 'free' && o.canPick);
    h += `<button class="tile ${t === 'used' ? 'used' : ''} ${on ? 'go' : ''} ${isJ ? 'jk' : ''} ${o.toggle ? 'edit' : ''}"
      data-act="${o.toggle ? 'toggleJoker' : 'pick'}" data-c="${ci}" data-r="${ri}" ${on ? '' : 'disabled'}
      aria-label="${esc(S.cats[ci])} ${v}">${t === 'free' ? v : ''}${isJ ? '<span class="jkmark">★</span>' : ''}</button>`;
  }));
  return h + '</div></div></div>';
}

function hud() {
  const host = me.role === 'host';
  return `<div class="hud"><div class="t">${esc(S.titel)}</div>
    <div class="r"><span class="muted">Raum ${S.code}</span>
      ${host && S.phase === 'game' && !S.current ? `<button class="ghost ${jokerMode ? 'on' : ''}" data-act="jokermode">${jokerMode ? 'Joker-Modus beenden' : 'Joker-Felder bearbeiten'}</button>` : ''}
      ${host && S.phase === 'game' && !S.current && S.finale ? '<button class="ghost" data-act="finale">Finale starten</button>' : ''}
      ${host && S.canUndo ? `<button class="ghost undo" data-act="undo" title="${esc(S.canUndo)}">↶ Rückgängig</button>` : ''}
      <button class="ghost" data-act="mute">${muted ? 'Ton aus' : 'Ton an'}</button>
      ${host ? '<button class="ghost" data-act="end">Beenden</button>' : ''}</div></div>
  ${S.hostOnline ? '' : '<div class="banner">Der Spielleiter ist gerade nicht verbunden.</div>'}`;
}

function viewGame() {
  const host = me.role === 'host';
  const edit = host && jokerMode && !S.current;
  const canPick = !S.current && !edit && (host || S.picker === me.pid);
  let turn = '';
  if (edit) turn = 'Joker-Modus: Klick auf ein Feld setzt oder entfernt den Joker (★).';
  else if (!S.current) {
    if (host) turn = S.picker ? `${esc(pname(S.picker))} ist am Zug. Du kannst auch selbst wählen oder per Klick auf einen Namen das Menü öffnen.` : 'Wähle ein Feld.';
    else turn = S.picker === me.pid ? 'Du bist am Zug, wähle ein Feld!' : `${esc(pname(S.picker))} wählt das nächste Feld.`;
  }
  $app.innerHTML = `${hud()}${chips()}
  <div class="turnmsg">${turn}</div>
  ${board({ canPick, toggle: edit })}
  ${S.current ? card() : ''}
  ${host ? '' : pickPanel()}
  ${interlude()}${notices()}`;
}
// Zwischenstand nach einer abgeraeumten Kategorie
function interlude() {
  const it = S.interlude;
  if (!it) return '';
  const r = [...S.players].sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...r.map(p => Math.abs(p.score)));
  return `<div class="inter"><div class="intercard">
    <div class="meta">Zwischenstand</div>
    <h2>„${esc(it.cat)}" ist abgeräumt</h2>
    <div class="muted">${S.done} von ${S.total} Fragen gespielt</div>
    <ol class="ranks">${r.map((p, i) => `<li style="--pc:${p.color}"><span class="pos">${i + 1}.</span><span class="nm">${plabel(p.id)}</span>
      <span class="barwrap"><span class="bar" style="width:${Math.max(4, Math.round(Math.abs(p.score) / max * 100))}%;${p.score < 0 ? 'opacity:.45' : ''}"></span></span><b>${p.score}</b></li>`).join('')}</ol>
    ${me.role === 'host' ? '<div class="btns" style="justify-content:center"><button data-act="dismiss">Weiter</button></div>' : '<div class="status soft center">Weiter geht es gleich …</div>'}
  </div></div>`;
}
function notices() {
  const list = (S.notices || []).filter(n => n.age < 9000);
  if (!list.length) return '';
  return `<div class="notices">${list.map(n => `<div class="notice ${n.kind}" data-exp="${Date.now() + 9000 - n.age}">${esc(n.text)}</div>`).join('')}</div>`;
}

function resultText(c, guess) {
  if (c.result === 'skipped') return 'Frage übersprungen.';
  if (c.result === 'none') return guess ? 'Kein Gewinner bei dieser Schätzfrage.' : 'Niemand hat die Frage gelöst.';
  const names = c.winners.map(pname).join(' und ');
  let t = guess ? `${esc(names)} ${c.winners.length > 1 ? 'lagen' : 'lag'} am nächsten dran!` : `${esc(names)} hatte recht!`;
  if (c.reward) t += ` Joker-Feld! ${esc(names)} darf sich einen Joker aussuchen.`;
  return t;
}
function awardLog(c) {
  if (!c.awards.length) return '';
  return '<ul class="log">' + c.awards.map(a =>
    `<li class="${a.delta >= 0 ? 'plus' : 'minus'}">${esc(pname(a.pid))}: ${a.delta >= 0 ? '+' : '−'}${Math.abs(a.delta)}<small>${WHY[a.why] || ''}</small></li>`).join('') + '</ul>';
}
function stages(c) {
  const r = c.reveal, st = stageNow(c);
  return `<div class="stages">${r.mult.map((m, i) =>
    `<span class="st ${i === st ? 'on' : i < st ? 'past' : ''}">${r.mode === 'sound' ? (r.soundStages[i] ? r.soundStages[i] + ' s' : 'ganz') : 'Stufe ' + (i + 1)} · ${fmtMult(m)}</span>`).join('')}</div>`;
}

function card() {
  const c = S.current, host = me.role === 'host', v = c.value;
  const mine = S.players.find(p => p.id === me.pid);
  const hidden = !host && !c.shown;
  const guess = c.typ === 'schaetzen', rev = c.typ === 'reveal';
  const img = c.state === 'reveal' && c.ansBild ? c.ansBild : c.bild;
  const buzzName = c.buzzer ? pname(c.buzzer) : '';
  const unit = c.einheit ? ' ' + esc(c.einheit) : '';
  let status = '', btns = '', extra = '', play = '', cd = '', buzzer = '', guessBox = '', glist = '';

  // Status
  if (c.state === 'reading') status = host
    ? 'Lies die Frage vor. Solange kann ein Spieler einen Joker setzen. Dann freigeben.'
    : 'Der Spielleiter liest die Frage vor. Bis zur Freigabe kann ein Spieler einen Joker setzen.';
  else if (c.state === 'open') status = guess
    ? (host ? `${c.guess.count} ${c.guess.count === 1 ? 'Schätzung' : 'Schätzungen'} abgegeben.` : 'Gib deine Schätzung ab!')
    : (c.pending ? 'Buzz! Wer war schneller …' : rev ? `Buzzer ist offen – je früher, desto mehr Punkte (jetzt ${fmtMult(c.reveal.mult[stageNow(c)])}).`
      : !c.shown ? (host ? 'Buzzer offen – die Spieler sehen die Frage noch nicht.' : 'Buzzer ist offen – du darfst schon während des Vorlesens drücken!') : 'Buzzer ist offen!');
  else if (c.state === 'buzzed') status = c.timeUp ? `Zeit abgelaufen für ${esc(buzzName)}!` : (c.buzzer === me.pid ? 'Du bist dran, antworte jetzt!' : `${esc(buzzName)} antwortet.`);
  else if (c.state === 'review') status = `Antworten werden aufgedeckt (${c.guess.revealed}/${c.guess.total}).`;
  else if (c.state === 'judge') status = host ? (c.guess.total ? 'Markiere pro Schätzung: Gewinner (✓) oder nicht (✗). Mehrere Gewinner sind möglich.' : 'Niemand hat geschätzt – einfach auswerten.') : 'Der Spielleiter bewertet die Schätzungen …';
  else status = resultText(c, guess);

  if ((c.state === 'buzzed' || (guess && c.state === 'open')) && c.left != null)
    cd = `<div class="cdwrap ${c.timeUp ? 'over' : ''}"><span class="cd">${fmtTime(Math.ceil(c.left / 1000))}</span></div>`;

  if (c.buzzes && c.buzzes.length && c.state !== 'reading') {
    const b = [...c.buzzes].sort((x, y) => x.elapsed - y.elapsed);
    extra += `<div class="rt">Reaktion: ${b.map((x, i) => `<span class="${i === 0 ? 'first' : ''}">${plabel(x.pid)} ${fmtSec(x.elapsed)}</span>`).join('<span class="sep">·</span>')}</div>`;
  }
  if (c.used) {
    const j = JOKER[c.used.type];
    extra += `<div class="usedj"><span class="ic">${j.icon}</span><b>${j.name}</b> von ${esc(pname(c.used.by))}${c.used.target ? ` – ${esc(pname(c.used.target))} setzt bei dieser Frage aus.` : ''}</div>`;
  }
  extra += awardLog(c);

  // Spieler: Joker einsetzen (nur beim Vorlesen, einer pro Frage)
  if (!host && mine && c.state === 'reading' && !c.used && mine.jokers.length) {
    const n = {}; mine.jokers.forEach(t => n[t] = (n[t] || 0) + 1);
    const others = S.players.filter(p => p.id !== me.pid);
    play = `<div class="pu"><b>Joker einsetzen</b> <span class="muted">(einer pro Frage – wer zuerst kommt)</span><div class="row">` +
      Object.keys(n).map(t => `<button data-act="${t === 'coffee' ? 'coffeemenu' : 'joker'}" data-t="${t}" title="${esc(JOKER[t].desc)}" ${t === 'coffee' && !others.length ? 'disabled' : ''}>${JOKER[t].icon} ${JOKER[t].name} (${n[t]})</button>`).join('') +
      `</div>${coffeePick ? `<div class="row"><span>Wer soll aussetzen?</span>${others.map(p => `<button class="ghost" data-act="joker" data-t="coffee" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}</div>`;
  }

  // Spieler: Buzzer (auch beim Vorlesen sichtbar, damit zu fruehes Druecken erkannt wird)
  if (!host && mine && !guess && c.state !== 'reveal') {
    const locked = c.locked.includes(me.pid), early = Date.now() < lockUntil;
    const can = c.state === 'open' && !c.pending && !locked && !buzzSent && !early;
    let label = 'BUZZ', cls = 'off';
    if (c.state === 'buzzed') { label = c.buzzer === me.pid ? 'DU!' : esc(buzzName); if (c.buzzer === me.pid) cls = 'won off'; }
    else if (locked) label = 'RAUS';
    else if (early) { label = 'ZU FRÜH'; cls = 'early off'; }
    else if (c.state === 'reading') label = 'WARTEN';
    else if (c.pending || buzzSent) label = '…';
    else if (can) cls = 'live';
    buzzer = `<button class="buzz ${cls}" style="--pc:${mine.color}" data-buzz aria-disabled="${can ? 'false' : 'true'}">${label}</button>`;
    if (locked && c.state !== 'reading') extra += `<div class="status">${c.used && c.used.target === me.pid ? 'Kaffeepause – du setzt bei dieser Frage aus.' : 'Du bist für diese Frage raus.'}</div>`;
  }

  // Spieler: Schaetzung eingeben
  if (!host && mine && guess && c.state === 'open') {
    if (c.locked.includes(me.pid)) extra += '<div class="status">Kaffeepause – du setzt bei dieser Frage aus.</div>';
    else {
      const done = c.guess.guessed.includes(me.pid);
      guessBox = `<div class="guessbox"><div class="row">
        <input type="text" id="guess" inputmode="decimal" maxlength="40" placeholder="Deine Schätzung${c.einheit ? ' in ' + esc(c.einheit) : ''}" autocomplete="off">
        <button data-act="guess">${done ? 'Ändern' : 'Abschicken'}</button></div>
        ${done ? `<div class="status soft">Abgegeben${myGuess ? ': <b>' + esc(myGuess) + unit + '</b>' : ''}. Bis die Zeit abläuft, kannst du noch ändern.</div>` : ''}</div>`;
    }
  }
  if (!host && mine && guess && c.state === 'reading' && c.locked.includes(me.pid)) extra += '<div class="status">Kaffeepause – du setzt bei dieser Frage aus.</div>';

  // Schaetz-Liste (Host sieht sie live, Spieler erst beim Aufdecken; Bewertung durch den Host)
  if (guess && (c.state === 'review' || c.state === 'judge' || c.state === 'reveal' || (host && c.state === 'open'))) {
    const list = c.guess.list, marks = c.guess.marks || {};
    const noGuess = S.players.filter(p => !c.guess.guessed.includes(p.id) && !c.locked.includes(p.id));
    const judging = c.state === 'judge';
    glist = `<ul class="glist">${list.map((g, i) => {
      const hid = host && c.state === 'review' && i >= c.guess.revealed;
      const m = marks[g.pid], won = c.state === 'reveal' ? c.winners.includes(g.pid) : m === true;
      const lost = c.state !== 'reveal' && m === false;
      const right = judging && host
        ? `<span class="marks"><button class="ok sm ${m === true ? 'on' : ''}" data-act="mark" data-id="${g.pid}" data-v="1" title="Gewinner">✓</button><button class="bad sm ${m === false ? 'on' : ''}" data-act="mark" data-id="${g.pid}" data-v="0" title="kein Gewinner">✗</button></span>`
        : (judging || c.state === 'reveal') ? `<span class="mk">${won ? '✓' : lost || (c.state === 'reveal' && c.winners.length) ? '✗' : ''}</span>` : '';
      return `<li class="${won ? 'win' : ''} ${lost ? 'lose' : ''} ${hid ? 'hid' : ''}">
        <span>${plabel(g.pid)}${hid ? ' <small class="muted">(noch verdeckt)</small>' : ''}</span><span class="val"><b>${esc(g.text)}${unit}</b>${right}</span></li>`;
    }).join('')}
    ${c.state !== 'open' && noGuess.length ? `<li class="muted"><span>Keine Abgabe</span><span>${esc(noGuess.map(p => p.name).join(', '))}</span></li>` : ''}
    ${!host && c.state === 'review' && c.guess.revealed < c.guess.total ? '<li class="muted"><span>…</span><span>noch ' + (c.guess.total - c.guess.revealed) + ' verdeckt</span></li>' : ''}</ul>`;
    if (judging && host && !list.every(g => typeof marks[g.pid] === 'boolean')) glist += '<div class="status soft">Noch nicht alle Schätzungen bewertet.</div>';
  }

  // Host-Knoepfe
  if (host) {
    const snd = c.hasSound && c.state !== 'reveal' && c.state !== 'reading'
      ? `<button class="ghost" data-act="snd" data-on="1">${c.audio.n ? 'Sound neu starten' : 'Sound abspielen'}</button>${c.audio.on ? '<button class="ghost" data-act="snd" data-on="0">Sound stoppen</button>' : ''}` : '';
    const more = rev && c.reveal.mode === 'sound' && c.state === 'open' && c.reveal.stage < 3
      ? `<button data-act="stage">Länger abspielen (${c.reveal.soundStages[c.reveal.stage + 1] ? c.reveal.soundStages[c.reveal.stage + 1] + ' s' : 'komplett'})</button>` : '';
    const showBtn = !c.shown && c.state !== 'reveal' && c.typ === 'buzzer' && c.state !== 'reading' ? '<button data-act="show">Frage einblenden</button>' : '';
    if (c.state === 'reading') btns = guess || rev
      ? `<button data-act="open">${guess ? 'Schätzen freigeben' : 'Buzzer freigeben'}</button>${c.hasSound ? '<button class="ghost" data-act="preview">Sound vorhören (nur bei dir)</button>' : ''}<button class="ghost" data-act="skip">Frage überspringen</button>`
      : `<button data-act="open">Buzzer freigeben</button><button class="ghost" data-act="openshow">Buzzer + Frage freigeben</button>${c.hasSound ? '<button class="ghost" data-act="preview">Sound vorhören (nur bei dir)</button>' : ''}<button class="ghost" data-act="skip">Frage überspringen</button>`;
    else if (c.state === 'open') btns = guess ? `<button data-act="skip">Zeit beenden</button>${snd}` : `${showBtn}${more}${snd}<button class="ghost" data-act="skip">Niemand weiß es</button>`;
    else if (c.state === 'buzzed') btns = `${showBtn}<button class="ok" data-act="judge" data-v="1">Richtig, +${gain(c, c.buzzer)}</button><button class="bad ${c.timeUp ? 'hl' : ''}" data-act="judge" data-v="0">Falsch, −${penalty(c, c.buzzer, v)}</button>${snd}`;
    else if (c.state === 'review') btns = `<button data-act="revealNext">Nächste Antwort aufdecken (${c.guess.revealed + 1}/${c.guess.total})</button>`;
    else if (c.state === 'judge') { const ok = c.guess.list.every(g => typeof (c.guess.marks || {})[g.pid] === 'boolean'); btns = `<button data-act="resolve" ${ok ? '' : 'disabled'}>Auswerten</button>`; }
    else btns = '<button data-act="close">Zurück zum Board</button>';
  }

  const blocked = c.sound && c.audio.on && audioBlocked ? '<div class="btns"><button data-act="tapsound">Sound starten</button></div>' : '';
  const merr = c.sound && mediaError && host ? `<div class="status soft" style="color:#ff9a90">${esc(mediaError)}</div>` : '';
  const showAns = host || c.state === 'reveal';
  const hostAns = showAns ? `<div class="a">Antwort: <b>${esc(c.answer)}${guess ? unit : ''}</b></div>` : '';
  const hint = host && c.state === 'reading' ? `<div class="status soft">${c.typ === 'buzzer' ? 'Die Spieler sehen die Frage erst, wenn du sie einblendest – der Buzzer kann vorher schon offen sein.' : `Die Spieler sehen die Frage${c.hasSound ? ' und hören den Sound' : ''} erst nach der Freigabe.`}${rev ? ' Reveal-Frage: je früher gebuzzert wird, desto höher der Faktor.' : ''}${rev && c.reveal.mode === 'sound' && c.bild ? ' <b>Achtung:</b> Bild und Sound gesetzt – Reveal läuft über den Sound, das Bild wird nicht verpixelt.' : ''}</div>` : '';

  // Bild: bei Reveal-Fragen verpixelt (Stufe steigt mit der Zeit), sonst normal
  let pic = '';
  if (img && !hidden) {
    const pixel = rev && c.reveal.mode === 'bild' && c.state !== 'reveal' && !(host && c.state === 'reading');
    const imgErr = host ? ` onerror="this.outerHTML='<div class=&quot;status soft&quot; style=&quot;color:#ff9a90&quot;>Bild konnte nicht geladen werden – kein direkter Dateilink oder die Seite blockt das Einbetten.</div>'"` : ' onerror="this.remove()"';
    const u = toUrl(img);
    if (pixel && pixErr[u]) pic = host ? '<div class="status soft" style="color:#ff9a90">Reveal-Bild konnte nicht geladen werden – kein direkter Dateilink oder die Seite blockt das Einbetten.</div>' : '';
    else pic = pixel ? `<canvas class="pix" data-src="${esc(u)}" data-stage="${stageNow(c)}" width="16" height="9"></canvas>`
                     : `<img class="qimg" src="${esc(u)}" alt=""${imgErr}>`;
  }

  return `<div class="ov"><div class="card ${cardFresh ? 'enter' : ''}">
    <div class="meta"><span>${esc(c.catName)}, ${v} Punkte</span>${guess ? '<span class="typtag">Schätzfrage</span>' : ''}${rev ? '<span class="typtag">Reveal</span>' : ''}</div>
    ${c.joker ? '<div class="joker">Joker-Feld! Richtig beantwortet gibt einen Joker</div>' : ''}
    ${hidden ? `<div class="q waiting">${c.state === 'reading' ? 'Die Frage wird vorgelesen …' : 'Die Frage wird vorgelesen – Buzzer ist offen!'}</div>` : ''}
    ${pic}
    ${c.sound && c.audio.on ? '<div class="status soft">Sound läuft …</div>' : ''}
    ${c.question && !hidden ? `<div class="q">${esc(c.question)}</div>` : ''}
    ${rev && !hidden ? stages(c) : ''}
    ${blocked}${merr}${hostAns}${hint}
    <div class="status">${status}</div>${cd}${extra}${glist}${play}${buzzer}${guessBox}
    <div class="btns">${btns}</div>
  </div></div>`;
}

function pickPanel() {
  const mine = S.players.find(p => p.id === me.pid);
  if (!mine || !mine.pending) return '';
  const full = mine.jokers.length >= 3;
  return `<div class="pickpanel"><b>Du hast ${mine.pending > 1 ? mine.pending + ' Joker' : 'einen Joker'} gewonnen!</b>
    ${full ? '<div class="muted" style="margin-top:6px">Du hast schon 3 Joker. Setz erst einen ein, dann kannst du wählen.</div>' :
      `<div class="jcards">${Object.keys(JOKER).map(t => `<button class="jcard" data-act="pickJoker" data-t="${t}"><span class="ic">${JOKER[t].icon}</span><b>${JOKER[t].name}</b><small>${JOKER[t].desc}</small></button>`).join('')}</div>`}</div>`;
}

/* ---------- Finale ---------- */
function viewFinale() {
  const host = me.role === 'host';
  const c = S.current;
  let body;
  if (!c) {
    body = `<div class="finwrap center">
      <div class="finlogo">Finale</div>
      <h2>${esc(S.fin ? S.finale.name : '')}</h2>
      <p class="muted">${S.fin.total} Frage${S.fin.total === 1 ? '' : 'n'}. Vor jeder Frage setzt jeder verdeckt einen Teil seiner Punkte – richtig gibt den Einsatz dazu, falsch zieht ihn ab.
      Wer im Minus steht, darf trotzdem bis 100 setzen.</p>
      ${host ? `<div class="btns" style="justify-content:center"><button data-act="finaleNext">Erste Finalfrage</button><button class="ghost" data-act="end">Finale überspringen</button></div>`
             : '<div class="status">Gleich geht es los …</div>'}
    </div>`;
  } else body = finaleCard();
  $app.innerHTML = `${hud()}${chips()}${body}${notices()}`;
}

function finaleCard() {
  const c = S.current, host = me.role === 'host';
  const mine = S.players.find(p => p.id === me.pid);
  const hidden = !host && c.state === 'intro';
  const n = S.players.length;
  const inPlay = c.participants.includes(me.pid);
  let status = '', btns = '', extra = '', cd = '', box = '', list = '';
  const nameList = ids => ids.length ? ids.map(id => plabel(id)).join(', ') : '<span class="muted">niemand</span>';

  if (c.state === 'intro') {
    status = host ? 'Lies die Frage vor. Mit „Frage zeigen" sehen sie alle und haben 20 Sekunden, um sich für Spielen oder Aussetzen zu entscheiden.'
                  : 'Der Spielleiter liest die Finalfrage vor …';
  } else if (c.state === 'decide') {
    status = host ? `${c.decided} von ${n} haben sich entschieden.` : 'Spielen oder aussetzen? Du hast 20 Sekunden.';
    if (host) extra += `<ul class="glist">${S.players.map(p => { const d = c.decision[p.id]; return `<li class="${d === true ? 'win' : ''} ${d === false ? 'hid' : ''}"><span>${plabel(p.id)}</span><b>${d === true ? 'spielt' : d === false ? 'setzt aus' : '…'}</b></li>`; }).join('')}</ul>`;
    else if (mine) {
      const d = c.decision[me.pid];
      extra += `<div class="status soft">${c.decided} von ${n} haben sich schon entschieden.</div>`;
      box = `<div class="decide">
        <button class="ok big ${myDecision === true ? 'on' : ''}" data-act="decide" data-p="1">▶ Spielen</button>
        <button class="ghost big ${myDecision === false ? 'on' : ''}" data-act="decide" data-p="0">Aussetzen</button>
        <div class="status soft">${myDecision === true ? 'Du spielst mit – gleich setzt du Einsatz und Antwort.' : myDecision === false ? 'Du setzt diese Frage aus. Bis die Zeit abläuft, kannst du noch umentscheiden.' : 'Wer sich nicht entscheidet, setzt aus.'}</div></div>`;
    }
  } else if (c.state === 'play') {
    const k = c.participants.length;
    status = host ? `${k} ${k === 1 ? 'spielt' : 'spielen'} mit – ${c.answered.length} von ${k} haben geantwortet.`
                  : inPlay ? 'Setze deinen Einsatz und tippe deine Antwort!' : 'Du setzt diese Frage aus.';
    if (host) extra += `<ul class="glist">${c.participants.map(pid => `<li class="${c.answered.includes(pid) ? 'win' : ''}"><span>${plabel(pid)} <small class="muted">Einsatz ${c.wagers[pid] === undefined ? '–' : c.wagers[pid]}</small></span><b>${esc(c.answers[pid] || '–')}</b></li>`).join('')}</ul>`;
    extra += `<div class="status soft">Setzen aus: ${nameList(S.players.filter(p => !c.participants.includes(p.id)).map(p => p.id))}</div>`;
    if (!host && mine && inPlay) {
      const max = mine.score > 0 ? mine.score : 100;
      const doneW = c.wagered.includes(me.pid), doneA = c.answered.includes(me.pid);
      const val = myWager != null ? myWager : Math.min(max, Math.round(max / 2));
      box = `<div class="wagerbox">
        <div class="muted">Du hast ${mine.score} Punkte, Einsatz maximal ${max}.</div>
        <div class="row" style="margin-top:8px"><span class="muted" style="min-width:70px">Einsatz</span><input type="number" id="wager" min="0" max="${max}" step="1" value="${val}"></div>
        <input type="range" class="range" id="wrange" min="0" max="${max}" step="1" value="${val}">
        <div class="row" style="margin-top:10px"><span class="muted" style="min-width:70px">Antwort</span><input type="text" id="guess" maxlength="100" placeholder="Deine Antwort" autocomplete="off"></div>
        <div class="row" style="margin-top:10px"><button data-act="play">${doneA ? 'Ändern' : 'Abschicken'}</button></div>
        ${doneW || doneA ? `<div class="status soft">Gesetzt: Einsatz <b>${doneW ? myWager : 0}</b>${doneA && myGuess ? ', Antwort <b>' + esc(myGuess) + '</b>' : ''}. Bis die Zeit abläuft, kannst du noch ändern.</div>` : ''}</div>`;
    }
  } else {
    const r = c.review, k = r.order.length;
    const allMarked = r.order.every(pid => typeof r.marks[pid] === 'boolean');
    if (c.state === 'review') status = `Antworten werden aufgedeckt (${r.revealed}/${k}).`;
    else if (c.state === 'judge') status = host ? 'Entscheide pro Spieler: richtig oder falsch. Dann auswerten.' : 'Der Spielleiter bewertet die Antworten …';
    else status = c.result === 'none' ? 'Niemand hat gespielt – keine Punkteänderung.' : 'Ausgewertet – die Einsätze sind verrechnet.';
    list = `<ul class="finlist ${c.state === 'judge' && host ? 'judging' : ''}">${r.order.map((pid, i) => {
      const sh = r.shown[pid], m = r.marks[pid];
      const judged = sh && sh.correct !== undefined;
      const cls = judged ? (sh.correct ? 'ok' : 'bad') : m === true ? 'ok' : m === false ? 'bad' : '';
      const answer = sh ? (sh.answer ? esc(sh.answer) : '<span class="hid">keine Antwort</span>') : (host ? `<span class="hid">${esc(c.answers[pid] || 'keine Antwort')}</span>` : '<span class="hid">verdeckt</span>');
      const right = judged ? `<span class="wg">${(sh.correct ? '+' : '−') + sh.wager}</span><span class="rs">${sh.correct ? '✓' : '✗'}</span>`
        : c.state === 'judge' && host ? `<span class="wg"><span class="hid">Einsatz ${c.wagers[pid] || 0}</span></span><span class="rs marks"><button class="ok sm ${m === true ? 'on' : ''}" data-act="mark" data-id="${pid}" data-v="1" title="richtig">✓</button><button class="bad sm ${m === false ? 'on' : ''}" data-act="mark" data-id="${pid}" data-v="0" title="falsch">✗</button></span>`
        : `<span class="wg">${host ? `<span class="hid">Einsatz ${c.wagers[pid] || 0}</span>` : ''}</span><span class="rs">${m === true ? '✓' : m === false ? '✗' : ''}</span>`;
      return `<li class="${cls} ${c.state === 'review' && i === r.revealed ? 'cur' : ''}"><span class="nm">${plabel(pid)}</span><span class="an">${answer}</span>${right}</li>`;
    }).join('')}</ul>`;
    const out = S.players.filter(p => !c.participants.includes(p.id)).map(p => p.id);
    if (out.length) list += `<div class="status soft">Ausgesetzt: ${nameList(out)}</div>`;
    if (c.state === 'judge' && host && !allMarked) list += '<div class="status soft">Noch nicht alle Zeilen bewertet.</div>';
  }

  if ((c.state === 'decide' || c.state === 'play') && c.left != null) cd = `<div class="cdwrap"><span class="cd">${fmtTime(Math.ceil(c.left / 1000))}</span></div>`;

  if (host) {
    const snd = c.hasSound && (c.state === 'decide' || c.state === 'play')
      ? `<button class="ghost" data-act="snd" data-on="1">${c.audio.n ? 'Sound neu starten' : 'Sound abspielen'}</button>${c.audio.on ? '<button class="ghost" data-act="snd" data-on="0">Sound stoppen</button>' : ''}` : '';
    if (c.state === 'intro') btns = `<button data-act="open">Frage zeigen</button>${c.hasSound ? '<button class="ghost" data-act="preview">Sound vorhören (nur bei dir)</button>' : ''}`;
    else if (c.state === 'decide') btns = `<button data-act="skip">Weiter (Entscheidung beenden)</button>${snd}`;
    else if (c.state === 'play') btns = `<button data-act="skip">Zeit beenden</button>${snd}`;
    else if (c.state === 'review') { const r = c.review; btns = `<button data-act="revealNext">Antwort von ${esc(pname(r.order[r.revealed]))} aufdecken (${r.revealed + 1}/${r.order.length})</button>`; }
    else if (c.state === 'judge') { const r = c.review; const ok = r.order.every(pid => typeof r.marks[pid] === 'boolean'); btns = `<button data-act="resolve" ${ok ? '' : 'disabled'}>Auswerten – Einsätze aufdecken</button>`; }
    else btns = `<button data-act="close">${c.idx + 1 >= c.total ? 'Zur Siegerehrung' : 'Nächste Finalfrage'}</button>`;
  }

  const blocked = c.sound && c.audio.on && audioBlocked ? '<div class="btns"><button data-act="tapsound">Sound starten</button></div>' : '';
  const showAns = host || c.state === 'reveal';
  const ans = showAns ? `<div class="a">Antwort: <b>${esc(c.answer)}</b></div>` : '';
  const hint = host && c.state === 'intro' ? '<div class="status soft">Die Spieler sehen die Frage erst, wenn du sie zeigst.</div>' : '';
  const img = c.state === 'reveal' && c.ansBild ? c.ansBild : c.bild;

  return `<div class="ov"><div class="card ${cardFresh ? 'enter' : ''}">
    <div class="meta"><span>${esc(c.catName)} – Frage ${c.idx + 1} von ${c.total}</span><span class="typtag">Finale</span></div>
    ${hidden ? '<div class="q waiting">Die Finalfrage wird vorgelesen …</div>' : ''}
    ${img && !hidden ? `<img class="qimg" src="${esc(toUrl(img))}" alt="">` : ''}
    ${c.sound && c.audio.on ? '<div class="status soft">Sound läuft …</div>' : ''}
    ${c.question && !hidden ? `<div class="q">${esc(c.question)}</div>` : ''}
    ${blocked}${ans}${hint}
    <div class="status">${status}</div>${cd}${extra}${list}${box}
    <div class="btns">${btns}</div>
  </div></div>`;
}

function viewEnd() {
  const r = [...S.players].sort((a, b) => b.score - a.score);
  const order = [r[1], r[0], r[2]].filter(Boolean);
  const h = { 0: 200, 1: 150, 2: 110 };
  const rankOf = p => r.indexOf(p);
  $app.innerHTML = `<div class="wrap wide stack center">
    <div class="logo">Siegerehrung</div>
    <div class="podium">${order.map(p => `<div class="pod" style="--pc:${p.color}"><div class="pav">${p.avatar}</div><div class="n">${esc(p.name)}</div><div class="s">${p.score}</div>
      <div class="bar" style="height:${h[rankOf(p)]}px">${rankOf(p) + 1}</div></div>`).join('')}</div>
    ${r.length > 3 ? `<div class="panel" style="text-align:left;max-width:520px;margin:0 auto"><ul class="plist">${r.slice(3).map((p, i) => `<li><span>${i + 4}. ${plabel(p.id)}</span><b>${p.score}</b></li>`).join('')}</ul></div>` : ''}
    ${S.awards.length ? `<h2 style="margin-top:24px">Awards</h2><div class="awards">${S.awards.map(a => `<div class="award"><div class="t">${esc(a.title)}</div><div class="n">${esc(a.names.join(' & '))}</div><div class="v">${esc(a.value)}</div></div>`).join('')}</div>` : ''}
    <button class="ghost" data-act="leave">Zur Startseite</button>
  </div>`;
}

/* ---------- Aktionen ---------- */
// Buzzer: pointerdown statt click, damit es keine Verzoegerung gibt. Zu fruehes Druecken sperrt 1 Sekunde.
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-buzz]');
  if (!el || !S || !S.current || !me || me.role !== 'player') return;
  const c = S.current;
  if (el.getAttribute('aria-disabled') === 'false') {
    buzzSent = true;
    socket.emit('player:buzz', { elapsed: Math.round(performance.now() - openAt) });
    if (navigator.vibrate) navigator.vibrate(30);
    render();
  } else if (c.state === 'reading' || (c.state === 'open' && Date.now() < lockUntil)) {
    lockUntil = Date.now() + 1000;
    clearTimeout(lockTimer); lockTimer = setTimeout(render, 1050);
    render();
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const fin = S && S.current && S.current.typ === 'finale';
  if (e.target.id === 'guess') { if (fin) sendWager(); sendGuess(); }
  if (e.target.id === 'wager') { sendWager(); if (fin) sendGuess(); }
  if (e.target.id === 'adjv') { const b = document.querySelector('[data-act="adjcustom"]'); if (b) b.click(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'wrange') { const w = document.getElementById('wager'); if (w) w.value = e.target.value; }
  if (e.target.id === 'wager') { const r = document.getElementById('wrange'); if (r) r.value = e.target.value; }
});
function sendGuess() {
  const g = document.getElementById('guess');
  if (!g || !g.value.trim()) return;
  myGuess = g.value.trim();
  socket.emit('player:guess', { text: myGuess });
}
function sendWager() {
  const w = document.getElementById('wager');
  if (!w) return;
  const n = Math.max(0, Math.min(+w.max, Math.round(Number(w.value) || 0)));
  myWager = n;
  socket.emit('player:wager', { n });
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const d = el.dataset, host = me && me.role === 'host';
  switch (d.act) {
    case 'host': socket.emit('host:create', r => { me = { role: 'host', code: r.code, token: r.token }; save(); }); break;
    case 'join': {
      const code = document.getElementById('jcode').value.trim().toUpperCase();
      const name = document.getElementById('jname').value.trim();
      localStorage.setItem('quiz-look', JSON.stringify(look));
      socket.emit('player:join', { code, name, color: look.color, avatar: look.avatar }, r => {
        if (!r.ok) return document.getElementById('err').textContent = r.error;
        me = { role: 'player', code: r.code, token: r.token, pid: r.pid, name: r.name }; save();
      });
      break;
    }
    case 'copy': navigator.clipboard && navigator.clipboard.writeText(d.text); el.textContent = 'Kopiert'; break;
    case 'start': socket.emit('host:start'); break;
    case 'move': socket.emit('host:move', { id: d.id, dir: +d.dir }); break;
    case 'toggleJoker': socket.emit('host:toggleJoker', { cat: +d.c, row: +d.r }); break;
    case 'jokermode': jokerMode = !jokerMode; render(); break;
    case 'pick': socket.emit(host ? 'host:pick' : 'player:pick', { cat: +d.c, row: +d.r }); break;
    case 'open': socket.emit('host:open'); break;
    case 'openshow': socket.emit('host:open', { show: true }); break;
    case 'show': socket.emit('host:show'); break;
    case 'preview': previewing = true; playMedia(S.current.sound, 0); render(); break;
    case 'stage': socket.emit('host:stage'); break;
    case 'judge': socket.emit('host:judge', { correct: d.v === '1' }); break;
    case 'skip': socket.emit('host:skip'); break;
    case 'revealNext': socket.emit('host:revealNext'); break;
    case 'resolve': socket.emit('host:resolve'); break;
    case 'close': socket.emit('host:close'); break;
    case 'finale': if (confirm('Finale jetzt starten? Das Board wird dann nicht weitergespielt.')) socket.emit('host:finale'); break;
    case 'finaleNext': socket.emit('host:finaleNext'); break;
    case 'undo': if (confirm('Rückgängig: ' + S.canUndo + '?')) socket.emit('host:undo'); break;
    case 'dismiss': socket.emit('host:dismiss'); break;
    case 'color': look.color = +d.i; localStorage.setItem('quiz-look', JSON.stringify(look)); if (me && me.role === 'player') socket.emit('player:look', look); render(); break;
    case 'avatar': look.avatar = +d.i; localStorage.setItem('quiz-look', JSON.stringify(look)); if (me && me.role === 'player') socket.emit('player:look', look); render(); break;
    case 'looktoggle': lookOpen = !lookOpen; render(); break;
    case 'kick': if (confirm(pname(d.id) + ' wirklich entfernen?')) { socket.emit('host:kick', { id: d.id }); menuFor = null; } break;
    case 'snd': previewing = false; socket.emit('host:sound', { on: d.on === '1' }); break;
    case 'tapsound': { const c = S.current; playMedia(c.sound, c.reveal && c.reveal.mode === 'sound' ? c.reveal.soundStages[c.reveal.stage] : 0); break; }
    case 'coffeemenu': coffeePick = !coffeePick; render(); break;
    case 'joker': socket.emit('player:joker', { type: d.t, target: d.id }); coffeePick = false; break;
    case 'pickJoker': socket.emit('player:pickJoker', { type: d.t }); break;
    case 'guess': sendGuess(); break;
    case 'wager': sendWager(); break;
    case 'play': sendWager(); sendGuess(); break;
    case 'decide': myDecision = d.p === '1'; socket.emit('player:decide', { play: myDecision }); render(); break;
    case 'mark': socket.emit('host:mark', { id: d.id, correct: d.v === '1' }); break;
    case 'menu': menuFor = menuFor === d.id ? null : d.id; render(); break;
    case 'adj': socket.emit('host:adjust', { id: d.id, delta: +d.d }); break;
    case 'adjcustom': { const v = document.getElementById('adjv'); const n = Number(v && v.value); if (Number.isFinite(n) && n !== 0) socket.emit('host:adjust', { id: d.id, delta: n }); break; }
    case 'setpicker': socket.emit('host:setPicker', { id: d.id }); break;
    case 'give': socket.emit('host:giveJoker', { id: d.id, type: d.t }); break;
    case 'take': socket.emit('host:takeJoker', { id: d.id, type: d.t }); break;
    case 'mute': muted = !muted; localStorage.setItem('quiz-mute', muted ? '1' : '0'); if (muted) stopMedia(); updateLobbyMusic(); render(); break;
    case 'end': if (confirm('Spiel beenden und zur Siegerehrung?')) socket.emit('host:end'); break;
    case 'leave': me = null; S = null; save(); history.replaceState(null, '', '/'); render(); break;
  }
});
render();
