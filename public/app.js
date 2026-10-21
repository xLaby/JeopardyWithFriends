const socket = io();
const $app = document.getElementById('app');
const LS = 'quiz-session';
let me = JSON.parse(localStorage.getItem(LS) || 'null'); // {role, code, token, pid, name}
let S = null, startError = '', coffeePick = false, draft = '', lastCardKey = '', cardFresh = false;
let muted = localStorage.getItem('quiz-mute') === '1';
let audioBlocked = false, lastAudioKey = '', previewing = false;
let openAt = 0, buzzSent = false, lockUntil = 0, lockTimer = null;   // Buzzer-Fairness
let myGuess = '', jokerMode = false, deadline = 0;

const JOKER = {
  double: { name: 'Doppelte Punkte', icon: '×2', desc: 'Dein Ergebnis bei dieser Frage zählt doppelt – Gewinn wie Verlust.' },
  coffee: { name: 'Kaffeepause', icon: '☕', desc: 'Ein Mitspieler deiner Wahl setzt bei dieser Frage aus.' },
  risk:   { name: 'Risiko', icon: '⚡', desc: 'Richtig: dreifache Punkte. Falsch oder keine Antwort: doppelter Fragenwert Abzug.' }
};
const WHY = { correct: 'richtig', wrong: 'falsch', risk: 'Risiko verloren' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const save = () => me ? localStorage.setItem(LS, JSON.stringify(me)) : localStorage.removeItem(LS);
const pname = id => { const p = S && S.players.find(x => x.id === id); return p ? p.name : '?'; };
const toUrl = u => /^https?:/i.test(u) ? u : '/' + encodeURI(u);
const fmtTime = s => s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : String(s);
const winMult = (c, pid) => { const j = c.used; return j && j.by === pid ? (j.type === 'double' ? 2 : j.type === 'risk' ? 3 : 1) : 1; };
const penalty = (c, pid, v) => { const j = c.used; if (j && j.by === pid) { if (j.type === 'risk') return v * 2; if (j.type === 'double') return v; } return v / 2; };

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
  joker: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * .07, .4, 'sine', .14)),
  use: () => { tone(1175, 0, .15, 'sine', .14); tone(1568, .12, .3, 'sine', .14); },
  timeup: () => [0, .18, .36].forEach(t => tone(440, t, .14, 'square', .12)),
  ding: () => { tone(1047, 0, .4, 'sine', .14); }
};
function playMedia(src) {
  if (muted) return;
  media.src = toUrl(src); media.currentTime = 0;
  media.play().then(() => { audioBlocked = false; }).catch(() => { audioBlocked = true; render(); });
}
function stopMedia() { try { media.pause(); } catch (e) {} }

function confetti() {
  const cv = document.getElementById('confetti'), g = cv.getContext('2d');
  if (!g) return;
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

/* Countdown-Anzeigen laufen lokal weiter, der Server schickt nur die Restzeit */
setInterval(() => {
  const els = document.querySelectorAll('.cd');
  if (!els.length) return;
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  els.forEach(el => { el.textContent = fmtTime(left); el.classList.toggle('warn', left <= 3 && left > 0); });
}, 200);

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
    const fresh = !p || p.cat !== c.cat || p.row !== c.row;
    if (fresh) {
      coffeePick = false; audioBlocked = false; buzzSent = false; myGuess = ''; previewing = false;
      SFX.pick(); if (c.joker) setTimeout(SFX.joker, 350);
    } else {
      if (c.state === 'buzzed' && p.state !== 'buzzed') SFX.buzz();
      if (c.state === 'reveal' && p.state !== 'reveal') { if (c.result === 'correct') SFX.right(); else if (c.result === 'none') SFX.wrong(); }
      else if (p.state === 'buzzed' && c.state === 'open') SFX.wrong();
      if (c.state === 'review' && p.state !== 'review') SFX.ding();
      if (c.timeUp && !p.timeUp) SFX.timeup();
      if (c.used && !p.used) SFX.use();
    }
    // Reaktionszeit-Messung startet, sobald der Buzzer bei uns sichtbar offen ist
    if (c.state === 'open' && !c.pending && (fresh || p.state !== 'open' || p.pending)) { openAt = performance.now(); buzzSent = false; }
    if (c.state !== 'reading') { coffeePick = false; previewing = false; }
    if (c.left != null) deadline = Date.now() + c.left;
    if (c.sound && c.audio.on) {
      const k = c.cat + '-' + c.row + '-' + c.audio.n;
      if (k !== lastAudioKey) { lastAudioKey = k; previewing = false; playMedia(c.sound); }
    } else if (!previewing) stopMedia();
  } else { stopMedia(); lastAudioKey = ''; previewing = false; }
  if (s.phase === 'end' && (!prev || prev.phase !== 'end')) { SFX.right(); setTimeout(confetti, 200); }
}

/* ---------- Rendering ---------- */
function render() {
  const keep = { sel: null, scroll: 0 };
  const g = document.getElementById('guess');
  if (g) { draft = g.value; keep.sel = document.activeElement === g ? [g.selectionStart, g.selectionEnd] : null; }
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
  const g2 = document.getElementById('guess');
  if (g2) { g2.value = draft; if (keep.sel) { g2.focus(); g2.setSelectionRange(...keep.sel); } }
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
      <p class="muted" style="margin:0">Du erstellst einen Raum, liest die Fragen vor und entscheidest über richtig oder falsch.</p>
      <button class="ghost" data-act="host">Neuen Raum erstellen</button>
    </div>
  </div>`;
  startError = '';
}

function playerList() {
  if (!S.players.length) return '<p class="muted">Noch niemand im Raum.</p>';
  return '<ul class="plist">' + S.players.map((p, i) => `
    <li><span><span class="dot ${p.connected ? '' : 'off'}"></span>${i + 1}. ${esc(p.name)}</span></li>`).join('') + '</ul>';
}
function hostPlayerList() {
  if (!S.players.length) return '<p class="muted">Noch niemand im Raum.</p>';
  const n = S.players.length;
  return '<ul class="plist">' + S.players.map((p, i) => `
    <li><span><span class="dot ${p.connected ? '' : 'off'}"></span>${i + 1}. ${esc(p.name)}</span>
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
          <div>${S.cats.length} Kategorien, ${nq} Fragen geladen.</div>
          <div class="muted">Eigene Fragen? Lade deine <code>fragen.json</code> hoch (<a href="/fragen-vorlage.json">Vorlage</a>).</div>
          <input type="file" id="qfile" accept=".json,application/json">
          <div class="err" id="err"></div>
        </div>
        <div class="panel stack">
          <h2>Einstellungen</h2>
          <div class="settings">
            <label>Joker-Felder gesamt<input type="number" id="setj" min="0" max="104" value="${S.settings.joker}"></label>
            <label>Antwortzeit nach Buzz (s)<input type="number" id="seta" min="3" max="60" value="${S.settings.answerTime}"></label>
            <label>Schätzzeit (s)<input type="number" id="setg" min="10" max="600" value="${S.settings.guessTime}"></label>
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
    f.text().then(t => {
      let data; try { data = JSON.parse(t); } catch { return document.getElementById('err').textContent = 'Das ist keine gültige JSON-Datei.'; }
      socket.emit('host:setQuestions', data, r => { if (!r.ok) document.getElementById('err').textContent = r.error; });
    });
  };
  document.getElementById('setj').onchange = e => socket.emit('host:setSettings', { joker: e.target.value });
  document.getElementById('seta').onchange = e => socket.emit('host:setSettings', { answerTime: e.target.value });
  document.getElementById('setg').onchange = e => socket.emit('host:setSettings', { guessTime: e.target.value });
}

function viewPlayerLobby() {
  $app.innerHTML = `
  <div class="wrap stack center">
    <div class="logo">${esc(S.titel)}</div>
    <h2>Du bist drin, ${esc(me.name)}</h2>
    <p class="muted">Raum ${S.code}. Warte, bis der Spielleiter das Spiel startet.<br>Schalte den Ton an, es gibt Sounds.</p>
    <div class="panel" style="text-align:left"><h2>Spieler (${S.players.length})</h2>${playerList()}</div>
    <button class="ghost" data-act="leave">Raum verlassen</button>
  </div>`;
}

function jokerBadges(p) {
  const n = {}; p.jokers.forEach(t => n[t] = (n[t] || 0) + 1);
  return Object.keys(n).map(t => `<span class="badge" title="${esc(JOKER[t].name)}">${JOKER[t].icon}${n[t] > 1 ? ' ' + n[t] : ''}</span>`).join('') +
    (p.pending ? '<span class="badge new">Joker wählen</span>' : '');
}
function chips() {
  const host = me.role === 'host';
  return '<div class="chips">' + S.players.map(p => {
    const cls = `chip ${S.picker === p.id ? 'turn' : ''} ${p.connected ? '' : 'off'} ${p.id === me.pid ? 'me' : ''}`;
    const inner = `${esc(p.name)}${jokerBadges(p)}<b>${p.score}</b>`;
    return host ? `<button class="${cls}" data-act="adjust" data-id="${p.id}" title="Klicken: Punkte ändern oder dransetzen">${inner}</button>`
                : `<div class="${cls}">${inner}</div>`;
  }).join('') + '</div>';
}

function board(o) {
  const host = me.role === 'host', jk = new Set(S.jokerTiles || []);
  let h = `<div class="frame ${o.mini ? 'mini' : ''}"><div class="boardwrap"><div class="board" style="--cols:${S.cats.length}">`;
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

function viewGame() {
  const host = me.role === 'host';
  const edit = host && jokerMode && !S.current;
  const canPick = !S.current && !edit && (host || S.picker === me.pid);
  let turn = '';
  if (edit) turn = 'Joker-Modus: Klick auf ein Feld setzt oder entfernt den Joker (★).';
  else if (!S.current) {
    if (host) turn = S.picker ? `${esc(pname(S.picker))} ist am Zug. Du kannst auch selbst wählen oder per Klick auf einen Namen jemanden dransetzen.` : 'Wähle ein Feld.';
    else turn = S.picker === me.pid ? 'Du bist am Zug, wähle ein Feld!' : `${esc(pname(S.picker))} wählt das nächste Feld.`;
  }
  $app.innerHTML = `
  <div class="hud"><div class="t">${esc(S.titel)}</div>
    <div class="r"><span class="muted">Raum ${S.code}</span>
      ${host && !S.current ? `<button class="ghost ${jokerMode ? 'on' : ''}" data-act="jokermode">${jokerMode ? 'Joker-Modus beenden' : 'Joker-Felder bearbeiten'}</button>` : ''}
      <button class="ghost" data-act="mute">${muted ? 'Ton aus' : 'Ton an'}</button>
      ${host ? '<button class="ghost" data-act="end">Beenden</button>' : ''}</div></div>
  ${S.hostOnline ? '' : '<div class="banner">Der Spielleiter ist gerade nicht verbunden.</div>'}
  ${chips()}
  <div class="turnmsg">${turn}</div>
  ${board({ canPick, toggle: edit })}
  ${S.current ? card() : ''}
  ${host ? '' : pickPanel()}`;
}

function resultText(c, guess) {
  if (c.result === 'skipped') return 'Frage übersprungen.';
  if (c.result === 'none') return guess ? 'Kein Gewinner – niemand hat eine gültige Schätzung abgegeben.' : 'Niemand hat die Frage gelöst.';
  const names = c.winners.map(pname).join(' und ');
  let t = guess ? `${esc(names)} ${c.winners.length > 1 ? 'lagen' : 'lag'} am nächsten dran!` : `${esc(names)} hatte recht!`;
  if (c.reward) t += ` Joker-Feld! ${esc(names)} darf sich einen Joker aussuchen.`;
  return t;
}

function card() {
  const c = S.current, host = me.role === 'host', v = c.value;
  const mine = S.players.find(p => p.id === me.pid);
  const hidden = !host && c.state === 'reading';
  const guess = c.typ === 'schaetzen';
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
    : (c.pending ? 'Buzz! Wer war schneller …' : 'Buzzer ist offen!');
  else if (c.state === 'buzzed') status = c.timeUp ? `Zeit abgelaufen für ${esc(buzzName)}!` : (c.buzzer === me.pid ? 'Du bist dran, antworte jetzt!' : `${esc(buzzName)} antwortet.`);
  else if (c.state === 'review') status = `Antworten werden aufgedeckt (${c.guess.revealed}/${c.guess.total}).`;
  else status = resultText(c, guess);

  // Countdown (Antwortzeit oder Schätzzeit)
  if ((c.state === 'buzzed' || (guess && c.state === 'open')) && c.left != null)
    cd = `<div class="cdwrap ${c.timeUp ? 'over' : ''}"><span class="cd">${fmtTime(Math.ceil(c.left / 1000))}</span></div>`;

  // Eingesetzter Joker
  if (c.used) {
    const j = JOKER[c.used.type];
    extra += `<div class="usedj"><span class="ic">${j.icon}</span><b>${j.name}</b> von ${esc(pname(c.used.by))}${c.used.target ? ` – ${esc(pname(c.used.target))} setzt bei dieser Frage aus.` : ''}</div>`;
  }
  // Punkte-Protokoll
  if (c.awards.length) extra += '<ul class="log">' + c.awards.map(a =>
    `<li class="${a.delta >= 0 ? 'plus' : 'minus'}">${esc(pname(a.pid))}: ${a.delta >= 0 ? '+' : '−'}${Math.abs(a.delta)}<small>${WHY[a.why] || ''}</small></li>`).join('') + '</ul>';

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
    buzzer = `<button class="buzz ${cls}" data-buzz aria-disabled="${can ? 'false' : 'true'}">${label}</button>`;
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

  // Schaetz-Liste (Host sieht sie live, Spieler erst beim Aufdecken)
  if (guess && (c.state === 'review' || c.state === 'reveal' || (host && c.state === 'open'))) {
    const list = c.guess.list;
    const noGuess = S.players.filter(p => !c.guess.guessed.includes(p.id) && !c.locked.includes(p.id));
    const click = host && c.state === 'reveal';
    glist = `<ul class="glist">${list.map((g, i) => {
      const hid = host && c.state === 'review' && i >= c.guess.revealed;
      return `<li class="${c.winners.includes(g.pid) ? 'win' : ''} ${hid ? 'hid' : ''} ${click ? 'click' : ''}" ${click ? `data-act="setWinner" data-id="${g.pid}" title="Zum Gewinner machen"` : ''}>
        <span>${esc(pname(g.pid))}${hid ? ' <small class="muted">(noch verdeckt)</small>' : ''}</span><b>${esc(g.text)}${unit}</b></li>`;
    }).join('')}
    ${c.state !== 'open' && noGuess.length ? `<li class="muted"><span>Keine Abgabe</span><span>${esc(noGuess.map(p => p.name).join(', '))}</span></li>` : ''}
    ${!host && c.state === 'review' && c.guess.revealed < c.guess.total ? '<li class="muted"><span>…</span><span>noch ' + (c.guess.total - c.guess.revealed) + ' verdeckt</span></li>' : ''}</ul>`;
    if (click && list.length > 1) glist += '<div class="status soft">Klick auf eine Schätzung, um den Gewinner zu ändern.</div>';
  }

  // Host-Knoepfe
  if (host) {
    const snd = c.hasSound && c.state !== 'reveal' && c.state !== 'reading'
      ? `<button class="ghost" data-act="snd" data-on="1">${c.audio.n ? 'Sound neu starten' : 'Sound abspielen'}</button>${c.audio.on ? '<button class="ghost" data-act="snd" data-on="0">Sound stoppen</button>' : ''}` : '';
    if (c.state === 'reading') btns = `<button data-act="open">${guess ? 'Schätzen freigeben' : 'Buzzer freigeben'}</button>${c.hasSound ? '<button class="ghost" data-act="preview">Sound vorhören (nur bei dir)</button>' : ''}<button class="ghost" data-act="skip">Frage überspringen</button>`;
    else if (c.state === 'open') btns = guess ? `<button data-act="skip">Zeit beenden</button>${snd}` : `${snd}<button class="ghost" data-act="skip">Niemand weiß es</button>`;
    else if (c.state === 'buzzed') btns = `<button class="ok" data-act="judge" data-v="1">Richtig, +${v * winMult(c, c.buzzer)}</button><button class="bad ${c.timeUp ? 'hl' : ''}" data-act="judge" data-v="0">Falsch, −${penalty(c, c.buzzer, v)}</button>${snd}`;
    else if (c.state === 'review') btns = `<button data-act="revealNext" ${c.guess.revealed >= c.guess.total ? 'disabled' : ''}>Nächste Antwort aufdecken (${c.guess.revealed}/${c.guess.total})</button><button class="${c.guess.revealed >= c.guess.total ? '' : 'ghost'}" data-act="resolve">Auflösung</button>`;
    else btns = '<button data-act="close">Zurück zum Board</button>';
  }

  const blocked = c.sound && c.audio.on && audioBlocked ? '<div class="btns"><button data-act="tapsound">Sound starten</button></div>' : '';
  const showAns = host || c.state === 'reveal';
  const hostAns = showAns ? `<div class="a">Antwort: <b>${esc(c.answer)}${guess ? unit : ''}</b></div>` : '';
  const hint = host && c.state === 'reading' ? `<div class="status soft">Die Spieler sehen die Frage${c.hasSound ? ' und hören den Sound' : ''} erst nach der Freigabe.</div>` : '';

  return `<div class="ov"><div class="card ${cardFresh ? 'enter' : ''}">
    <div class="meta"><span>${esc(c.catName)}, ${v} Punkte</span>${guess ? '<span class="typtag">Schätzfrage</span>' : ''}</div>
    ${c.joker ? '<div class="joker">Joker-Feld! Richtig beantwortet gibt einen Joker</div>' : ''}
    ${hidden ? '<div class="q waiting">Die Frage wird vorgelesen …</div>' : ''}
    ${img && !hidden ? `<img class="qimg" src="${esc(toUrl(img))}" alt="">` : ''}
    ${c.sound && c.audio.on ? '<div class="status soft">Sound läuft …</div>' : ''}
    ${c.question && !hidden ? `<div class="q">${esc(c.question)}</div>` : ''}
    ${blocked}${hostAns}${hint}
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
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'guess') sendGuess(); });
function sendGuess() {
  const g = document.getElementById('guess');
  if (!g || !g.value.trim()) return;
  myGuess = g.value.trim();
  socket.emit('player:guess', { text: myGuess });
}

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
    case 'move': socket.emit('host:move', { id: d.id, dir: +d.dir }); break;
    case 'toggleJoker': socket.emit('host:toggleJoker', { cat: +d.c, row: +d.r }); break;
    case 'jokermode': jokerMode = !jokerMode; render(); break;
    case 'pick': socket.emit(host ? 'host:pick' : 'player:pick', { cat: +d.c, row: +d.r }); break;
    case 'open': socket.emit('host:open'); break;
    case 'preview': previewing = true; playMedia(S.current.sound); render(); break;
    case 'judge': socket.emit('host:judge', { correct: d.v === '1' }); break;
    case 'skip': socket.emit('host:skip'); break;
    case 'revealNext': socket.emit('host:revealNext'); break;
    case 'resolve': socket.emit('host:resolve'); break;
    case 'setWinner': socket.emit('host:setWinner', { id: d.id }); break;
    case 'close': socket.emit('host:close'); break;
    case 'kick': socket.emit('host:kick', { id: d.id }); break;
    case 'snd': previewing = false; socket.emit('host:sound', { on: d.on === '1' }); break;
    case 'tapsound': playMedia(S.current.sound); break;
    case 'coffeemenu': coffeePick = !coffeePick; render(); break;
    case 'joker': socket.emit('player:joker', { type: d.t, target: d.id }); coffeePick = false; break;
    case 'pickJoker': socket.emit('player:pickJoker', { type: d.t }); break;
    case 'guess': sendGuess(); break;
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
