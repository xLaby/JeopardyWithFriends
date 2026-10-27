/* Fragen-Editor fuer die Quiz Show. Laeuft komplett im Browser:
   Text liegt im localStorage, Bilder/Sounds in der IndexedDB. Nichts davon geht an den Server,
   bis du ein Paket exportierst und in der Lobby hochlaedst (oder ins Repo legst). */
const $app = document.getElementById('app');
const LS = 'quiz-editor-pkg';
const MAX_CATS = 15, MAX_ROWS = 10, MAX_SOFORT = 40 * 1024 * 1024;
let pkg = null, sel = 0, saveStat = '', saveTimer = null, toastTimer = null;
const media = new Map();        // Dateiname -> Blob
const urls = new Map();         // Dateiname -> Object-URL fuer Vorschau
window.__exports = [];          // zuletzt erzeugte Downloads (fuer Tests)

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const s = (v, max = 1000) => String(v == null ? '' : v).trim().slice(0, max);
const num = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const isUrl = v => /^https?:\/\//i.test(v || '');
const slug = t => s(t).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
const safeName = n => {
  const i = n.lastIndexOf('.');
  const base = slug(i > 0 ? n.slice(0, i) : n), ext = i > 0 ? n.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? base + '.' + ext : base;
};
const MINI_T = ['sortieren', 'zuordnen', 'geo'], MAX_ITEMS = 8;
const emptyItem = () => ({ text: '', bild: '' });
const emptyQ = () => ({ frage: '', antwort: '', typ: 'buzzer', einheit: '', zeit: 0, dauer: 20, joker: false, bild: '', sound: '', antwortBild: '',
  items: [], paare: [], anfang: '', ende: '', ziel: { lat: '', lng: '' } });
const itemFilled = it => !!(it && ((it.text || '').trim() || it.bild));
const miniFilled = q => MINI_T.includes(q.typ) && ((q.items || []).some(itemFilled) || (q.paare || []).some(p => itemFilled(p.links) || itemFilled(p.rechts)) || !!(q.ziel && q.ziel.lat !== '' && q.ziel.lng !== '' && q.ziel.lat != null));
const isEmpty = q => !q.frage && !q.antwort && !q.bild && !q.sound && !miniFilled(q);
// Medien-Pfade einer Frage: bild, sound, antwortBild plus die Bilder der Elemente (items.0.bild, paare.1.links.bild)
function refPaths(q) {
  const out = ['bild', 'sound', 'antwortBild'];
  (q.items || []).forEach((_, i) => out.push('items.' + i + '.bild'));
  (q.paare || []).forEach((_, i) => out.push('paare.' + i + '.links.bild', 'paare.' + i + '.rechts.bild'));
  return out;
}
const getRef = (q, path) => path.split('.').reduce((o, k) => o == null ? o : o[k], q);
const setRef = (q, path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], q)[last] = v; };
const refLabel = path => { const m = /^items\.(\d+)/.exec(path) || /^paare\.(\d+)\.(links|rechts)/.exec(path); return !m ? '' : path.startsWith('items') ? 'Element ' + (+m[1] + 1) : 'Paar ' + (+m[1] + 1) + (m[2] === 'links' ? ' links' : ' rechts'); };
const rows = () => pkg.werte.length;
const qAt = (ci, ri) => ci === 'f' ? pkg.finale.fragen[ri] : pkg.kategorien[ci].fragen[ri];

/* ---------- IndexedDB fuer Medien ---------- */
const IDB = {
  open() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('kein IndexedDB'));
      const r = indexedDB.open('quiz-editor', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('media', mode), st = t.objectStore('media');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  put(name, blob) { return this.tx('readwrite', st => st.put(blob, name)); },
  del(name) { return this.tx('readwrite', st => st.delete(name)); },
  clear() { return this.tx('readwrite', st => st.clear()); },
  async all() {
    const db = await this.open();
    return new Promise((res, rej) => {
      const out = new Map(), st = db.transaction('media').objectStore('media');
      const keys = st.getAllKeys(), vals = st.getAll();
      vals.onsuccess = () => { keys.result.forEach((k, i) => out.set(k, vals.result[i])); res(out); };
      vals.onerror = () => rej(vals.error);
    });
  }
};
const idb = (fn) => fn().catch(() => {});   // IndexedDB ist Komfort, kein Muss

/* ---------- Modell ---------- */
const mediaRef = v => { v = s(v, 2000); if (!v) return ''; if (isUrl(v)) return v; return v.replace(/^\/?media\//, ''); };
// Links, die auf eine Webseite statt auf eine Datei zeigen (YouTube, Spotify, Wikipedia-Artikel, Google-Bildersuche ...)
const PAGE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|soundcloud\.com|instagram\.com|pinterest\.\w+|tiktok\.com|google\.\w+|bing\.com|imgur\.com\/gallery)/i;
function linkProblem(v, kind) {
  if (!isUrl(v)) return '';
  let u; try { u = new URL(v); } catch (e) { return 'ist kein gültiger Link.'; }
  if (u.protocol !== 'https:') return 'muss mit https:// beginnen (http wird vom Browser blockiert).';
  const host = u.hostname.replace(/^www\./, '');
  if (PAGE_HOSTS.test(host) || /youtube|youtu\.be/.test(host)) return 'zeigt auf eine Webseite (' + host + '), nicht auf eine Datei. YouTube & Co. gehen nicht – Datei herunterladen und als Datei einfügen.';
  if (/wikipedia\.org$/.test(host) && /\/wiki\//.test(u.pathname)) return 'ist die Wikipedia-Seite, nicht das Bild. Bild anklicken → „Originaldatei" → den upload.wikimedia.org-Link kopieren.';
  const last = u.pathname.split('/').pop() || '';
  const ext = last.includes('.') ? last.split('.').pop().toLowerCase() : '';
  const ok = kind === 'sound' ? /^(mp3|ogg|oga|m4a|aac|wav|flac|opus|webm)$/ : /^(jpe?g|png|gif|webp|svg|avif|bmp)$/;
  if (!ok.test(ext)) return 'endet nicht auf eine ' + (kind === 'sound' ? 'Audio' : 'Bild') + '-Datei (' + (ext ? '.' + ext : 'keine Endung') + '). Vermutlich eine Seite statt einer Datei – Rechtsklick → „Bildadresse kopieren" nutzen.';
  return '';
}
const normItem = it => (typeof it === 'string' || typeof it === 'number') ? { text: s(it, 80), bild: '' } : { text: s(it && it.text, 80), bild: mediaRef(it && it.bild) };
function normQ(q) {
  q = q || {};
  const t = s(q.typ, 20).toLowerCase().replace('ä', 'ae');
  return {
    frage: s(q.frage), antwort: s(q.antwort),
    typ: t === 'schaetzen' ? 'schaetzen' : t === 'reveal' ? 'reveal' : t === 'geoguessr' ? 'geo' : MINI_T.includes(t) ? t : 'buzzer',
    einheit: s(q.einheit, 10), zeit: num(q.zeit), dauer: num(q.dauer) || 20, joker: !!q.joker,
    bild: mediaRef(q.bild), sound: mediaRef(q.sound), antwortBild: mediaRef(q.antwortBild),
    items: (Array.isArray(q.items) ? q.items : []).slice(0, MAX_ITEMS).map(normItem),
    paare: (Array.isArray(q.paare) ? q.paare : []).slice(0, MAX_ITEMS).map(p => ({ links: normItem(p && p.links), rechts: normItem(p && p.rechts) })),
    anfang: s(q.anfang, 30), ende: s(q.ende, 30),
    ziel: { lat: q.ziel && q.ziel.lat != null && q.ziel.lat !== '' ? Number(q.ziel.lat) : '', lng: q.ziel && q.ziel.lng != null && q.ziel.lng !== '' ? Number(q.ziel.lng) : '' }
  };
}
function normPkg(raw) {
  raw = raw || {};
  const cats = Array.isArray(raw.kategorien) ? raw.kategorien : [];
  let werte = Array.isArray(raw.werte) ? raw.werte.map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round).slice(0, MAX_ROWS) : [];
  if (!werte.length) {
    const longest = Math.max(1, ...cats.map(c => Array.isArray(c && c.fragen) ? c.fragen.length : 0));
    const step = num(raw.schritt) || 100;
    werte = Array.from({ length: Math.min(MAX_ROWS, longest) }, (_, i) => step * (i + 1));
  }
  const kategorien = cats.slice(0, MAX_CATS).map((c, i) => {
    const fr = (Array.isArray(c && c.fragen) ? c.fragen : []).map(normQ);
    while (fr.length < werte.length) fr.push(emptyQ());
    return { name: s(c && c.name, 60) || 'Kategorie ' + (i + 1), fragen: fr };
  });
  if (!kategorien.length) kategorien.push(newCat(1, werte.length));
  const fin = raw.finale || {};
  return {
    titel: s(raw.titel, 40) || 'Quiz Show', werte, kategorien,
    finale: { name: s(fin.name, 40) || 'Finale', fragen: (Array.isArray(fin.fragen) ? fin.fragen : []).map(normQ) }
  };
}
const newCat = (n, r) => ({ name: 'Kategorie ' + n, fragen: Array.from({ length: r }, emptyQ) });

// Export-Form: leere Fragen am Ende weg, nur gesetzte Felder
function cleanQ(q, finale) {
  const o = { frage: q.frage.trim(), antwort: q.antwort.trim() };
  if (!finale && q.typ && q.typ !== 'buzzer') o.typ = q.typ;
  if (q.typ === 'schaetzen' && q.einheit) o.einheit = q.einheit.trim();
  if (q.zeit > 0) o.zeit = q.zeit;
  if (!finale && q.typ === 'reveal' && q.dauer) o.dauer = q.dauer;
  if (!finale && q.joker) o.joker = true;
  ['bild', 'sound', 'antwortBild'].forEach(k => { if (q[k]) o[k] = q[k].trim(); });
  const it = i => { const r = {}; if (i.text.trim()) r.text = i.text.trim(); if (i.bild) r.bild = i.bild.trim(); return r; };
  if (!finale && q.typ === 'sortieren') {
    o.items = q.items.filter(itemFilled).map(it);
    if (q.anfang.trim()) o.anfang = q.anfang.trim();
    if (q.ende.trim()) o.ende = q.ende.trim();
  }
  if (!finale && q.typ === 'zuordnen') o.paare = q.paare.filter(p => itemFilled(p.links) && itemFilled(p.rechts)).map(p => ({ links: it(p.links), rechts: it(p.rechts) }));
  if (!finale && q.typ === 'geo' && q.ziel.lat !== '' && q.ziel.lng !== '') o.ziel = { lat: Number(q.ziel.lat), lng: Number(q.ziel.lng) };
  return o;
}
function cleanPkg() {
  const r = rows();
  const out = { titel: pkg.titel.trim() || 'Quiz Show', werte: [...pkg.werte], kategorien: [] };
  pkg.kategorien.forEach(c => {
    const fr = c.fragen.slice(0, r).map(q => cleanQ(q, false));
    while (fr.length && isEmpty(fr[fr.length - 1]) && !fr[fr.length - 1].antwortBild) fr.pop();
    if (fr.length) out.kategorien.push({ name: c.name.trim() || 'Kategorie', fragen: fr });
  });
  const fin = pkg.finale.fragen.map(q => cleanQ(q, true)).filter(q => !isEmpty(q));
  if (fin.length) out.finale = { name: pkg.finale.name.trim() || 'Finale', fragen: fin };
  return out;
}
function usedMedia(data) {
  const set = new Set();
  const take = q => refPaths(q).forEach(k => { const v = getRef(q, k); if (v && !isUrl(v)) set.add(v); });
  data.kategorien.forEach(c => c.fragen.forEach(take));
  if (data.finale) data.finale.fragen.forEach(take);
  return [...set];
}
function allRefs() {   // alle Medien-Referenzen im Modell (auch in leeren Slots)
  const set = new Set();
  const take = q => refPaths(q).forEach(k => { const v = getRef(q, k); if (v && !isUrl(v)) set.add(v); });
  pkg.kategorien.forEach(c => c.fragen.forEach(take));
  pkg.finale.fragen.forEach(take);
  return set;
}

/* ---------- Pruefung ---------- */
function validate() {
  const out = [], r = rows();
  const add = (lvl, text, ci, ri) => out.push({ lvl, text, ci, ri });
  if (pkg.kategorien.length > MAX_CATS) add('err', 'Mehr als ' + MAX_CATS + ' Kategorien.');
  if (!pkg.werte.length) add('err', 'Keine Punktwerte eingetragen.');
  const names = new Set();
  pkg.kategorien.forEach((c, ci) => {
    const nm = c.name.trim();
    if (!nm) add('err', 'Kategorie ' + (ci + 1) + ' hat keinen Namen.', ci);
    if (names.has(nm.toLowerCase())) add('warn', 'Kategorie „' + nm + '" gibt es doppelt.', ci);
    names.add(nm.toLowerCase());
    const fr = c.fragen.slice(0, r);
    let last = -1;
    fr.forEach((q, ri) => { if (!isEmpty(q)) last = ri; });
    if (last < 0) { add('warn', '„' + nm + '" hat keine Fragen und wird beim Export weggelassen.', ci); return; }
    fr.forEach((q, ri) => {
      const label = '„' + nm + '" ' + pkg.werte[ri];
      if (ri < last && isEmpty(q)) { add('warn', label + ': leeres Feld mitten im Board.', ci, ri); return; }
      if (ri > last) return;
      if (!q.frage && !q.bild && !q.sound) add('err', label + ': keine Frage.', ci, ri);
      if (!q.antwort && !MINI_T.includes(q.typ)) add('err', label + ': keine Antwort.', ci, ri);
      if (MINI_T.includes(q.typ)) miniChecks(q, label, ci, ri, add);
      if (q.typ === 'schaetzen' && q.antwort && !Number.isFinite(parseNum(q.antwort))) add('err', label + ': Schätzfrage, aber die Antwort ist keine Zahl.', ci, ri);
      if (q.typ === 'reveal' && !q.bild && !q.sound) add('warn', label + ': Reveal ohne Bild/Sound läuft als normale Buzzer-Frage.', ci, ri);
      checkMedia(q, label, ci, ri, add);
    });
    if (c.fragen.length > r && c.fragen.slice(r).some(q => !isEmpty(q)))
      add('warn', '„' + nm + '" hat mehr Fragen als Punktwerte; die hinteren werden nicht exportiert.', ci);
  });
  pkg.finale.fragen.forEach((q, ri) => {
    const label = 'Finale, Frage ' + (ri + 1);
    if (isEmpty(q)) { add('warn', label + ' ist leer und wird weggelassen.', 'f', ri); return; }
    if (!q.frage && !q.bild && !q.sound) add('err', label + ': keine Frage.', 'f', ri);
    if (!q.antwort) add('err', label + ': keine Antwort.', 'f', ri);
    checkMedia(q, label, 'f', ri, add);
  });
  let total = 0; media.forEach(b => total += b.size);
  if (total > MAX_SOFORT) add('err', 'Medien insgesamt ' + fmtSize(total) + ' – ein Sofort-Paket darf höchstens 40 MB haben.');
  return out;
}
function miniChecks(q, label, ci, ri, add) {
  if (q.typ === 'sortieren') {
    const n = q.items.filter(itemFilled).length;
    if (n < 2) add('err', label + ': Sortieren braucht mindestens 2 Elemente (richtige Reihenfolge von oben nach unten).', ci, ri);
  } else if (q.typ === 'zuordnen') {
    const n = q.paare.filter(p => itemFilled(p.links) && itemFilled(p.rechts)).length;
    if (n < 2) add('err', label + ': Zuordnen braucht mindestens 2 vollständige Paare.', ci, ri);
    if (q.paare.some(p => itemFilled(p.links) !== itemFilled(p.rechts))) add('warn', label + ': Ein Paar ist nur halb ausgefüllt und wird weggelassen.', ci, ri);
  } else if (q.typ === 'geo') {
    const la = q.ziel.lat, ln = q.ziel.lng;
    if (la === '' || ln === '' || !(Math.abs(la) <= 90) || !(Math.abs(ln) <= 180)) add('err', label + ': Geoguessr braucht ein gültiges Ziel (Breite −90 bis 90, Länge −180 bis 180). Per „Auf Karte wählen“ setzen.', ci, ri);
    if (!q.antwort) add('warn', label + ': Kein Ortsname bei „Antwort“ – wird bei der Auflösung angezeigt.', ci, ri);
  }
}
function checkMedia(q, label0, ci, ri, add) {
  refPaths(q).forEach(k0 => {
    const v = getRef(q, k0); if (!v) return;
    const k = k0 === 'sound' ? 'sound' : 'bild', label = refLabel(k0) ? label0 + ' (' + refLabel(k0) + ')' : label0;
    if (isUrl(v)) { const pr = linkProblem(v, k === 'sound' ? 'sound' : 'bild'); if (pr) add('err', label + ': Link ' + pr, ci, ri); return; }
    if (!media.has(v)) add('warn', label + ': Datei „' + v + '" ist nicht geladen. Repo-Paket: muss im media/-Ordner liegen. Sofort-Paket: fehlt.', ci, ri);
    else if (k === 'sound' && media.get(v).size > 3 * 1048576) add('warn', label + ': Sound ist ' + fmtSize(media.get(v).size) + ' – besser kürzen (unter 3 MB).', ci, ri);
  });
}
function parseNum(v) {
  let t = s(v, 60).replace(/[^\d,.\-]/g, '');
  if (!t) return NaN;
  const neg = t.startsWith('-'); t = t.replace(/-/g, '');
  const hasC = t.includes(','), hasP = t.includes('.');
  if (hasC && hasP) { const dec = t.lastIndexOf(',') > t.lastIndexOf('.') ? ',' : '.'; t = t.split(dec === ',' ? '.' : ',').join('').replace(',', '.'); }
  else if (hasP) { const p = t.split('.'); if (p.length > 2 || (p.length === 2 && p[1].length === 3)) t = p.join(''); }
  else if (hasC) { const p = t.split(','); t = p.length > 2 ? p.join('') : p.join('.'); }
  const n = Number(t); return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/* ---------- Speichern ---------- */
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify(pkg)); saveStat = 'Entwurf gespeichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { saveStat = 'Entwurf konnte nicht gespeichert werden'; }
    const el = document.getElementById('savestat'); if (el) el.textContent = saveStat;
  }, 400);
}
function toast(msg, bad) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), bad ? 7000 : 4000);
}
function download(blob, name) {
  window.__exports.push({ name, blob });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
function objUrl(name) {
  if (!urls.has(name) && media.has(name)) urls.set(name, URL.createObjectURL(media.get(name)));
  return urls.get(name) || '';
}

/* ---------- Medien ---------- */
// Bilder verkleinern (max 1280 px) und als JPEG speichern; kleine PNG/GIF bleiben wie sie sind
async function prepareImage(file) {
  const keep = (file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/svg+xml') && file.size < 1048576;
  if (keep) return { blob: file, ext: file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : 'svg' };
  try {
    const bmp = await (window.createImageBitmap ? createImageBitmap(file) : loadImg(file));
    const sc = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(bmp.width * sc)); cv.height = Math.max(1, Math.round(bmp.height * sc));
    const g = cv.getContext('2d');
    if (!g) throw new Error('kein canvas');
    g.drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
    if (!blob) throw new Error('toBlob');
    return { blob, ext: 'jpg' };
  } catch (e) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    return { blob: file, ext: /^(jpe?g|png|gif|webp|svg)$/.test(ext) ? ext : 'jpg' };
  }
}
const loadImg = file => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
function uniqueName(name, blob) {
  if (!media.has(name) || media.get(name).size === blob.size) return name;
  const i = name.lastIndexOf('.'), base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : '';
  let n = 2; while (media.has(base + '-' + n + ext)) n++;
  return base + '-' + n + ext;
}
async function addMedia(file, f, ci, ri) {
  let blob = file, name = file.name || 'datei';
  if (f === 'sound') {
    if (!/^audio\//.test(file.type)) return toast('Das ist keine Audiodatei.', true);
    if (file.size > 3 * 1048576) toast('Sound ist ' + fmtSize(file.size) + ' – für Sofort-Pakete besser auf unter 3 MB kürzen.', true);
  } else {
    if (!/^image\//.test(file.type)) return toast('Das ist keine Bilddatei.', true);
    const r = await prepareImage(file);
    blob = r.blob; name = name.replace(/\.[^.]+$/, '') + '.' + r.ext;
  }
  name = uniqueName(safeName(name), blob);
  media.set(name, blob);
  if (urls.has(name)) { URL.revokeObjectURL(urls.get(name)); urls.delete(name); }
  await idb(() => IDB.put(name, blob));
  setRef(qAt(ci, ri), f, name);
  save(); render();
  toast(name + ' hinzugefügt (' + fmtSize(blob.size) + ')');
}
function removeRef(f, ci, ri) {
  const q = qAt(ci, ri), name = getRef(q, f);
  setRef(q, f, '');
  if (name && !isUrl(name) && !allRefs().has(name)) {   // letzte Referenz weg -> Datei weg
    media.delete(name);
    if (urls.has(name)) { URL.revokeObjectURL(urls.get(name)); urls.delete(name); }
    idb(() => IDB.del(name));
  }
  save(); render();
}

// Datei aus dem Speicher werfen, wenn kein Element sie mehr nutzt
function dropUnused(name) {
  if (!name || isUrl(name) || allRefs().has(name)) return;
  media.delete(name);
  if (urls.has(name)) { URL.revokeObjectURL(urls.get(name)); urls.delete(name); }
  idb(() => IDB.del(name));
}
// Zielort per Karte waehlen (mit Ortssuche ueber Nominatim, nur auf Knopfdruck)
function pickGeo(ci, ri) {
  if (typeof L === 'undefined') return toast('Die Karte konnte nicht geladen werden (Internetverbindung?).', true);
  const q = qAt(ci, ri);
  const box = document.createElement('div');
  box.className = 'geomodal';
  box.innerHTML = `<div class="geodlg"><div class="row"><input type="text" id="geoq" placeholder="Ort suchen, z. B. Eiffelturm Paris" style="flex:1"><button class="ghost" id="geosearch">Suchen</button></div>
    <div id="geopick" class="geomap" style="height:min(55vh,460px)"></div>
    <div class="muted" id="geoinfo">Tippe auf die Karte, um das Ziel zu setzen.</div>
    <div class="row"><button id="geook" disabled>Übernehmen</button><button class="ghost" id="geocancel">Abbrechen</button></div></div>`;
  document.body.appendChild(box);
  let pos = (q.ziel.lat !== '' && q.ziel.lng !== '') ? { lat: Number(q.ziel.lat), lng: Number(q.ziel.lng) } : null;
  const map = L.map('geopick', { minZoom: 2, maxZoom: 18, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView(pos ? [pos.lat, pos.lng] : [30, 10], pos ? 6 : 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, noWrap: true, attribution: '© OpenStreetMap-Mitwirkende' }).addTo(map);
  let marker = null;
  const info = document.getElementById('geoinfo'), ok = document.getElementById('geook');
  const set = (lat, lng) => {
    pos = { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
    if (marker) marker.setLatLng([pos.lat, pos.lng]); else marker = L.marker([pos.lat, pos.lng]).addTo(map);
    info.textContent = 'Ziel: ' + pos.lat + ', ' + pos.lng; ok.disabled = false;
  };
  if (pos) set(pos.lat, pos.lng);
  map.on('click', e => set(e.latlng.lat, e.latlng.wrap().lng));
  const close = () => { map.remove(); box.remove(); };
  document.getElementById('geocancel').onclick = close;
  box.addEventListener('click', e => { if (e.target === box) close(); });
  ok.onclick = () => { q.ziel = { lat: pos.lat, lng: pos.lng }; save(); close(); render(); };
  const search = async () => {
    const term = document.getElementById('geoq').value.trim(); if (!term) return;
    info.textContent = 'Suche …';
    try {
      const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(term), { headers: { 'Accept-Language': 'de' } })).json();
      if (!r.length) { info.textContent = 'Nichts gefunden. Anderen Suchbegriff probieren oder direkt auf die Karte tippen.'; return; }
      const lat = Number(r[0].lat), lng = Number(r[0].lon);
      map.setView([lat, lng], 8); set(lat, lng); info.textContent = (r[0].display_name || '').slice(0, 90) + ' (Pin bei Bedarf verschieben)';
    } catch (e) { info.textContent = 'Suche nicht möglich. Direkt auf die Karte tippen.'; }
  };
  document.getElementById('geosearch').onclick = search;
  document.getElementById('geoq').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  setTimeout(() => map.invalidateSize(), 80);
}

/* ---------- Import / Export ---------- */
async function importFile(file) {
  try {
    let raw;
    if (/\.zip$/i.test(file.name)) {
      if (!window.JSZip) throw new Error('ZIP-Bibliothek nicht geladen (Internetverbindung?).');
      const z = await JSZip.loadAsync(file);
      const jf = z.file('fragen.json') || z.file(/(^|\/)fragen\.json$/)[0];
      if (!jf) throw new Error('Im ZIP ist keine fragen.json.');
      raw = JSON.parse(await jf.async('string'));
      for (const f of z.file(/(^|\/)media\/[^/]+$/)) {
        const name = f.name.split('/').pop();
        const blob = await f.async('blob');
        media.set(name, blob); await idb(() => IDB.put(name, blob));
      }
    } else {
      raw = JSON.parse(await file.text());
      if (raw && raw.medien && typeof raw.medien === 'object') {
        for (const [name, dataUrl] of Object.entries(raw.medien)) {
          try { const blob = await (await fetch(dataUrl)).blob(); const n = safeName(name); media.set(n, blob); await idb(() => IDB.put(n, blob)); } catch (e) {}
        }
      }
    }
    pkg = normPkg(raw); sel = 0;
    save(); render();
    toast('Paket geladen: ' + pkg.kategorien.length + ' Kategorien, ' + media.size + ' Mediendateien.');
  } catch (e) { toast('Laden fehlgeschlagen: ' + e.message, true); }
}
async function exportRepo() {
  const data = cleanPkg();
  if (!data.kategorien.length) return toast('Keine Kategorie mit Fragen – nichts zu exportieren.', true);
  const json = JSON.stringify(data, null, 2) + '\n';
  const used = usedMedia(data).filter(n => media.has(n));
  if (!used.length) { download(new Blob([json], { type: 'application/json' }), 'fragen.json'); return toast('fragen.json exportiert. Ins Repo legen, pushen, fertig.'); }
  if (!window.JSZip) { download(new Blob([json], { type: 'application/json' }), 'fragen.json'); return toast('ZIP-Bibliothek nicht geladen – nur fragen.json exportiert, Medien bitte von Hand in media/ kopieren.', true); }
  const zip = new JSZip();
  zip.file('fragen.json', json);
  zip.file('LIESMICH.txt', 'Repo-Paket aus dem Fragen-Editor.\nInhalt in den Projektordner entpacken: fragen.json ersetzt die alte, die Dateien aus media/ kommen in den media/-Ordner. Dann committen und pushen.\n');
  const mf = zip.folder('media');
  used.forEach(n => mf.file(n, media.get(n)));
  download(await zip.generateAsync({ type: 'blob' }), slug(data.titel) + '-repo-paket.zip');
  toast('Repo-Paket exportiert (' + used.length + ' Mediendateien). Entpacken, committen, pushen.');
}
async function exportSofort() {
  const data = cleanPkg();
  if (!data.kategorien.length) return toast('Keine Kategorie mit Fragen – nichts zu exportieren.', true);
  const used = usedMedia(data), medien = {}, missing = [];
  let total = 0;
  for (const n of used) {
    const b = media.get(n);
    if (!b) { missing.push(n); continue; }
    total += b.size; medien[n] = await toDataUrl(b);
  }
  if (total > MAX_SOFORT) return toast('Medien zu groß für ein Sofort-Paket (' + fmtSize(total) + ', erlaubt 40 MB). Sounds kürzen oder Repo-Paket nutzen.', true);
  if (missing.length && !confirm(missing.length + ' Mediendatei(en) sind nicht geladen und fehlen im Paket:\n' + missing.join(', ') + '\n\nTrotzdem exportieren?')) return;
  data.medien = medien;
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), slug(data.titel) + '.quiz.json');
  toast('Sofort-Paket exportiert (' + fmtSize(total) + '). In der Lobby unter „Fragen" hochladen – vor jedem Spielabend neu.');
}

/* ---------- Rendering ---------- */
function render() {
  const isFin = sel === 'f';
  if (!isFin && !pkg.kategorien[sel]) sel = 0;
  let total = 0; media.forEach(b => total += b.size);
  const checks = validate();
  $app.innerHTML = `
  <div class="ehead"><div class="t">Fragen-Editor</div>
    <div class="r"><span class="muted status" id="savestat">${esc(saveStat)}</span>
      <button class="ghost" data-act="new">Neu</button>
      <button class="ghost" data-act="template">Vorlage laden</button>
      <button class="ghost" data-act="import">Paket laden …</button>
      <button data-act="exportRepo" title="ZIP mit fragen.json + media/ für GitHub">Repo-Paket</button>
      <button data-act="exportSofort" title="Eine Datei mit eingebetteten Medien zum Hochladen in der Lobby">Sofort-Paket</button>
      <a href="/" class="muted" style="margin-left:6px">Zum Quiz</a></div></div>
  <div class="egrid">
    <aside class="eside stack">
      <div class="panel"><h2>Paket</h2>
        <label class="field">Titel<input type="text" data-p="titel" maxlength="40" value="${esc(pkg.titel)}"></label>
        <label class="field">Punktwerte (Komma-getrennt, bis zu ${MAX_ROWS})<input type="text" id="werte" value="${pkg.werte.join(', ')}"></label>
        <div class="kv"><span>Board</span><b>${pkg.kategorien.length} Kategorien × ${rows()} Stufen</b><span>Finale</span><b>${pkg.finale.fragen.length} Fragen</b><span>Medien</span><b>${media.size} Dateien, ${fmtSize(total)}</b></div>
      </div>
      <div class="panel"><h2>Kategorien</h2>
        <ul class="catlist">${pkg.kategorien.map((c, i) => `
          <li class="${!isFin && i === sel ? 'sel' : ''}" data-act="selcat" data-i="${i}">
            <span class="nm">${i + 1}. ${esc(c.name) || '<i>ohne Namen</i>'}</span>
            <span class="cnt">${c.fragen.slice(0, rows()).filter(q => !isEmpty(q)).length}/${rows()}</span>
            <button class="ghost" data-act="movecat" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Nach oben">▲</button>
            <button class="ghost" data-act="movecat" data-i="${i}" data-d="1" ${i === pkg.kategorien.length - 1 ? 'disabled' : ''} title="Nach unten">▼</button></li>`).join('')}
          <li class="fin ${isFin ? 'sel' : ''}" data-act="selfin"><span class="nm">★ ${esc(pkg.finale.name)}</span><span class="cnt">${pkg.finale.fragen.length} Fragen</span></li>
        </ul>
        <div class="row" style="margin-top:8px"><button class="ghost sm" data-act="addcat" ${pkg.kategorien.length >= MAX_CATS ? 'disabled' : ''}>+ Kategorie</button>
          <span class="muted" style="font-size:.85rem">max. ${MAX_CATS}</span></div>
      </div>
      <div class="panel"><h2>Prüfung</h2>${checksHtml(checks)}</div>
      <div class="warnbox"><b>Wichtig zum Sofort-Paket:</b> Bilder und Sounds, die du in der Lobby hochlädst, liegen nur im Arbeitsspeicher des Servers.
        Nach einem Neustart oder wenn der Gratis-Server einschläft (nach etwa 15 Minuten ohne Besucher), sind sie weg – das Paket muss dann vor dem Spiel neu hochgeladen werden.
        <b>Dauerhaft</b> bleiben Medien nur über das <b>Repo-Paket</b>: ZIP entpacken, in GitHub committen, Render deployt.</div>
      <div class="infobox">Dein Entwurf wird automatisch im Browser gespeichert (Text und Dateien), aber nur in <i>diesem</i> Browser. Exportiere regelmäßig ein Paket als Sicherung.</div>
    </aside>
    <section class="emain">${isFin ? finaleEditor() : catEditor(sel)}</section>
  </div>`;
}
function checksHtml(checks) {
  if (!checks.length) return '<ul class="checks"><li class="none">Alles in Ordnung – exportbereit.</li></ul>';
  const err = checks.filter(c => c.lvl === 'err').length;
  return `<div class="muted" style="font-size:.85rem">${err ? err + ' Fehler, ' : ''}${checks.length - err} Hinweise</div><ul class="checks">` +
    checks.slice(0, 40).map(c => `<li class="${c.lvl}" data-act="goto" data-ci="${c.ci === undefined ? '' : c.ci}" data-ri="${c.ri === undefined ? '' : c.ri}">${esc(c.text)}</li>`).join('') +
    (checks.length > 40 ? `<li class="none">… und ${checks.length - 40} weitere</li>` : '') + '</ul>';
}
function catEditor(ci) {
  const c = pkg.kategorien[ci], r = rows();
  const extra = c.fragen.length > r && c.fragen.slice(r).some(q => !isEmpty(q));
  return `<div class="panel">
    <div class="row" style="justify-content:space-between">
      <label class="field" style="flex:1;margin:0">Name der Kategorie<input type="text" data-c="name" maxlength="60" value="${esc(c.name)}"></label>
      <button class="bad sm" data-act="delcat" data-i="${ci}" style="align-self:flex-end">Kategorie löschen</button></div>
    ${extra ? '<div class="warnbox" style="margin-top:10px">Diese Kategorie hat mehr Fragen als Punktwerte. Erhöhe die Punktwerte im Paket oder lösche die hinteren Fragen – sie werden sonst nicht exportiert.</div>' : ''}
    ${c.fragen.slice(0, r).map((q, ri) => qCard(ci, ri, q, false)).join('')}
  </div>`;
}
function finaleEditor() {
  const f = pkg.finale;
  return `<div class="panel">
    <label class="field">Name des Finales<input type="text" data-c="finname" maxlength="40" value="${esc(f.name)}"></label>
    <p class="muted" style="font-size:.9rem">Jede Finalfrage läuft mit verdecktem Einsatz: Die Spieler setzen Punkte, tippen eine Antwort, du bewertest richtig/falsch. Beliebig viele Fragen, keine Joker.</p>
    ${f.fragen.map((q, ri) => qCard('f', ri, q, true)).join('')}
    <div class="row" style="margin-top:12px"><button class="ghost" data-act="addfin">+ Finalfrage</button></div>
  </div>`;
}
function qCard(ci, ri, q, fin) {
  const typ = fin ? 'finale' : q.typ;
  const head = fin ? 'Frage ' + (ri + 1) : pkg.werte[ri] + ' Punkte';
  let extraFields = '';
  if (typ === 'schaetzen') extraFields = `<div class="two"><label class="field">Einheit (z. B. €)<input type="text" data-f="einheit" data-ci="${ci}" data-ri="${ri}" maxlength="10" value="${esc(q.einheit)}"></label>
    <label class="field">Schätzzeit in s (leer = Standard)<input type="text" inputmode="numeric" data-f="zeit" data-ci="${ci}" data-ri="${ri}" value="${q.zeit || ''}"></label></div>`;
  else if (typ === 'reveal') extraFields = `<label class="field">Dauer in s, in der das Bild scharf wird (Sound: Stufen per Knopf)<input type="text" inputmode="numeric" data-f="dauer" data-ci="${ci}" data-ri="${ri}" value="${q.dauer || 20}"></label>`;
  else if (MINI_T.includes(typ)) extraFields = `<label class="field">Zeit in s (leer = Standard ${typ === 'geo' ? 45 : 60})<input type="text" inputmode="numeric" data-f="zeit" data-ci="${ci}" data-ri="${ri}" value="${q.zeit || ''}"></label>`;
  else if (fin) extraFields = `<label class="field">Antwortzeit in s (leer = Standard)<input type="text" inputmode="numeric" data-f="zeit" data-ci="${ci}" data-ri="${ri}" value="${q.zeit || ''}"></label>`;
  return `<div class="qcard ${isEmpty(q) ? 'empty' : ''}" id="q-${ci}-${ri}">
    <div class="qh"><span class="v">${head}</span>
      ${fin ? `<button class="ghost sm" data-act="delfin" data-ri="${ri}">✕ Entfernen</button>` : `
      <label>Typ <select data-f="typ" data-ci="${ci}" data-ri="${ri}">
        <option value="buzzer" ${typ === 'buzzer' ? 'selected' : ''}>Buzzer</option>
        <option value="schaetzen" ${typ === 'schaetzen' ? 'selected' : ''}>Schätzfrage</option>
        <option value="reveal" ${typ === 'reveal' ? 'selected' : ''}>Reveal (Bild/Sound wird enthüllt)</option>
        <option value="sortieren" ${typ === 'sortieren' ? 'selected' : ''}>Mini-Game: Sortieren</option>
        <option value="zuordnen" ${typ === 'zuordnen' ? 'selected' : ''}>Mini-Game: Zuordnen</option>
        <option value="geo" ${typ === 'geo' ? 'selected' : ''}>Mini-Game: Geoguessr (Pin auf Karte)</option></select></label>
      <label><input type="checkbox" data-f="joker" data-ci="${ci}" data-ri="${ri}" ${q.joker ? 'checked' : ''}> festes Joker-Feld</label>`}
    </div>
    <label class="field">Frage${typ === 'reveal' ? ' (wird nach der Freigabe mit dem Medium gezeigt)' : ''}<textarea data-f="frage" data-ci="${ci}" data-ri="${ri}" maxlength="1000">${esc(q.frage)}</textarea></label>
    <div class="two">
      <label class="field">Antwort${typ === 'schaetzen' ? ' (Zahl, z. B. 1,19 oder 1200)' : ''}<input type="text" data-f="antwort" data-ci="${ci}" data-ri="${ri}" maxlength="1000" value="${esc(q.antwort)}"></label>
      ${extraFields}
    </div>
    ${miniEditor(ci, ri, q, typ)}
    <div class="media">${mediaBox(ci, ri, 'bild', typ === 'geo' ? 'Bild (z. B. Foto des gesuchten Ortes)' : 'Bild', q.bild)}${MINI_T.includes(typ) ? '' : mediaBox(ci, ri, 'sound', 'Sound', q.sound)}${mediaBox(ci, ri, 'antwortBild', 'Bild bei der Auflösung', q.antwortBild)}</div>
  </div>`;
}
// Kleines Bildfeld fuer ein Element (Sortieren/Zuordnen)
function itemMedia(ci, ri, path, val) {
  const has = !!val && media.has(val), url = isUrl(val), src = has ? objUrl(val) : url ? val : '';
  const pr = url ? linkProblem(val, 'bild') : '';
  return `<span class="imedia">${src && !pr ? `<img class="ithumb" src="${esc(src)}" alt="" onerror="this.remove()">` : ''}
    <input type="text" class="ilink" data-mu="${path}" data-ci="${ci}" data-ri="${ri}" placeholder="Bild (optional): Datei oder https-Link" value="${esc(val || '')}">
    <label class="filebtn">📷<input type="file" hidden accept="image/*" data-mf="${path}" data-ci="${ci}" data-ri="${ri}"></label>
    ${val ? `<button class="ghost sm" data-mdel="${path}" data-ci="${ci}" data-ri="${ri}" title="Bild entfernen">✕</button>` : ''}
    ${pr ? `<span class="miss">Link ${esc(pr)}</span>` : (val && !has && !url ? '<span class="miss">Datei nicht geladen</span>' : '')}</span>`;
}
function miniEditor(ci, ri, q, typ) {
  const at = `data-ci="${ci}" data-ri="${ri}"`;
  if (typ === 'sortieren') {
    return `<div class="minied"><div class="muted">Elemente in der <b>richtigen Reihenfolge</b> eintragen (oben beginnt die Lösung). Die Spieler sehen sie gemischt. Text, Bild oder beides.</div>
      <div class="two"><label class="field">Beschriftung oben (z. B. älteste zuerst)<input type="text" data-ip="anfang" ${at} maxlength="30" value="${esc(q.anfang)}"></label>
      <label class="field">Beschriftung unten (z. B. jüngste)<input type="text" data-ip="ende" ${at} maxlength="30" value="${esc(q.ende)}"></label></div>
      ${q.items.map((it, i) => `<div class="irow"><span class="inum">${i + 1}</span><input type="text" data-ip="items.${i}.text" ${at} maxlength="80" placeholder="Begriff" value="${esc(it.text)}">${itemMedia(ci, ri, 'items.' + i + '.bild', it.bild)}
        <span class="ibtns"><button class="ghost sm" data-act="itemmove" ${at} data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''}>▲</button><button class="ghost sm" data-act="itemmove" ${at} data-i="${i}" data-d="1" ${i === q.items.length - 1 ? 'disabled' : ''}>▼</button><button class="ghost sm" data-act="itemdel" ${at} data-i="${i}">✕</button></span></div>`).join('')}
      <button class="ghost sm" data-act="itemadd" ${at} ${q.items.length >= MAX_ITEMS ? 'disabled' : ''}>+ Element (max. ${MAX_ITEMS})</button></div>`;
  }
  if (typ === 'zuordnen') {
    return `<div class="minied"><div class="muted">Zusammengehörige Paare eintragen. Links bleibt in dieser Reihenfolge, die rechte Seite wird gemischt. Text, Bild oder beides.</div>
      ${q.paare.map((p, i) => `<div class="irow pair"><span class="inum">${i + 1}</span>
        <div class="pside"><input type="text" data-ip="paare.${i}.links.text" ${at} maxlength="80" placeholder="Links (z. B. Frankreich)" value="${esc(p.links.text)}">${itemMedia(ci, ri, 'paare.' + i + '.links.bild', p.links.bild)}</div>
        <b>→</b>
        <div class="pside"><input type="text" data-ip="paare.${i}.rechts.text" ${at} maxlength="80" placeholder="Rechts (z. B. Paris)" value="${esc(p.rechts.text)}">${itemMedia(ci, ri, 'paare.' + i + '.rechts.bild', p.rechts.bild)}</div>
        <span class="ibtns"><button class="ghost sm" data-act="pairdel" ${at} data-i="${i}">✕</button></span></div>`).join('')}
      <button class="ghost sm" data-act="pairadd" ${at} ${q.paare.length >= MAX_ITEMS ? 'disabled' : ''}>+ Paar (max. ${MAX_ITEMS})</button></div>`;
  }
  if (typ === 'geo') {
    return `<div class="minied"><div class="muted">Die Spieler setzen einen Pin auf einer Weltkarte (ohne Beschriftungen). Wer am nächsten dran ist, gewinnt. Bei „Antwort“ den Ortsnamen eintragen, er wird bei der Auflösung gezeigt.</div>
      <div class="row"><label class="field" style="flex:1">Breitengrad<input type="text" inputmode="decimal" data-ip="ziel.lat" ${at} value="${q.ziel.lat}" placeholder="z. B. 48.8584"></label>
      <label class="field" style="flex:1">Längengrad<input type="text" inputmode="decimal" data-ip="ziel.lng" ${at} value="${q.ziel.lng}" placeholder="z. B. 2.2945"></label>
      <button class="ghost" data-act="pickgeo" ${at} style="align-self:flex-end">🗺️ Auf Karte wählen</button></div></div>`;
  }
  return '';
}
function mediaBox(ci, ri, f, label, val) {
  const has = !!val && media.has(val), url = isUrl(val);
  let prev = '';
  if (val) {
    const src = has ? objUrl(val) : url ? val : '';
    const pr = url ? linkProblem(val, f === 'sound' ? 'sound' : 'bild') : '';
    if (src && !pr) prev += f === 'sound'
      ? `<audio controls preload="metadata" src="${esc(src)}" onerror="this.nextElementSibling.textContent='Datei lädt nicht – kein direkter Link oder Seite blockt Einbettung';this.remove()"></audio><span class="miss"></span>`
      : `<img src="${esc(src)}" alt="" onerror="this.nextElementSibling.textContent='Bild lädt nicht – kein direkter Link oder Seite blockt Einbettung';this.remove()"><span class="miss"></span>`;
    prev += has ? `<span class="ok">✓ ${fmtSize(media.get(val).size)}</span>` : url ? (pr ? `<span class="miss">Link ${esc(pr)}</span>` : '<span class="ok">Link</span>') : '<span class="miss">nicht geladen – muss im media/-Ordner liegen</span>';
  }
  return `<div class="mbox"><div class="ml">${label}</div>
    <div class="row"><input type="text" data-mu="${f}" data-ci="${ci}" data-ri="${ri}" placeholder="Dateiname oder direkter https-Link zur Datei" value="${esc(val || '')}">
      <label class="filebtn">Datei …<input type="file" hidden accept="${f === 'sound' ? 'audio/*' : 'image/*'}" data-mf="${f}" data-ci="${ci}" data-ri="${ri}"></label>
      ${val ? `<button class="ghost" data-mdel="${f}" data-ci="${ci}" data-ri="${ri}" title="Entfernen">✕</button>` : ''}</div>
    ${prev ? `<div class="prev">${prev}</div>` : ''}</div>`;
}
function refreshChecks() {
  const panel = $app.querySelector('.eside .panel:nth-of-type(3)');
  if (panel) panel.innerHTML = '<h2>Prüfung</h2>' + checksHtml(validate());
}

/* ---------- Ereignisse ---------- */
const ciOf = el => el.dataset.ci === 'f' ? 'f' : +el.dataset.ci;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f !== undefined && el.tagName !== 'SELECT' && el.type !== 'checkbox') {
    const q = qAt(ciOf(el), +el.dataset.ri), f = el.dataset.f;
    q[f] = (f === 'zeit' || f === 'dauer') ? num(el.value) : el.value;
    save(); refreshChecks();
  } else if (el.dataset.p === 'titel') { pkg.titel = el.value; save(); }
  else if (el.dataset.c === 'name') { pkg.kategorien[sel].name = el.value; save(); refreshChecks(); }
  else if (el.dataset.c === 'finname') { pkg.finale.name = el.value; save(); }
  else if (el.dataset.mu !== undefined) { setRef(qAt(ciOf(el), +el.dataset.ri), el.dataset.mu, el.value.trim()); save(); refreshChecks(); }
  else if (el.dataset.ip !== undefined) { const q = qAt(ciOf(el), +el.dataset.ri), p = el.dataset.ip; setRef(q, p, /^ziel\./.test(p) ? (el.value.trim() === '' || isNaN(Number(el.value.replace(',', '.'))) ? '' : Number(el.value.replace(',', '.'))) : el.value); save(); refreshChecks(); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.f === 'typ') {
    const q = qAt(ciOf(el), +el.dataset.ri); q.typ = el.value;
    if (q.typ === 'sortieren') while (q.items.length < 3) q.items.push(emptyItem());
    if (q.typ === 'zuordnen') while (q.paare.length < 3) q.paare.push({ links: emptyItem(), rechts: emptyItem() });
    save(); render();
  }
  else if (el.dataset.f === 'joker') { qAt(ciOf(el), +el.dataset.ri).joker = el.checked; save(); refreshChecks(); }
  else if (el.dataset.mf !== undefined) { const file = el.files[0]; if (file) addMedia(file, el.dataset.mf, ciOf(el), +el.dataset.ri); el.value = ''; }
  else if (el.dataset.mu !== undefined) render();
  else if (el.dataset.c === 'name' || el.dataset.c === 'finname') render();
  else if (el.id === 'werte') {
    const w = el.value.split(/[,;\s]+/).map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round).slice(0, MAX_ROWS);
    if (!w.length) { toast('Mindestens ein Punktwert, z. B. 100, 200, 300.', true); return render(); }
    pkg.werte = w;
    pkg.kategorien.forEach(c => { while (c.fragen.length < w.length) c.fragen.push(emptyQ()); });
    save(); render();
  } else if (el.id === 'importfile') { const file = el.files[0]; if (file) importFile(file); el.value = ''; }
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-mdel]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.mdel !== undefined) return removeRef(d.mdel, ciOf(el), +d.ri);
  switch (d.act) {
    case 'itemadd': { const q = qAt(ciOf(el), +d.ri); if (q.items.length < MAX_ITEMS) q.items.push(emptyItem()); save(); render(); break; }
    case 'itemdel': { const q = qAt(ciOf(el), +d.ri), i = +d.i, name = q.items[i].bild; q.items.splice(i, 1); dropUnused(name); save(); render(); break; }
    case 'itemmove': { const q = qAt(ciOf(el), +d.ri), i = +d.i, j = i + +d.d; if (j < 0 || j >= q.items.length) break; [q.items[i], q.items[j]] = [q.items[j], q.items[i]]; save(); render(); break; }
    case 'pairadd': { const q = qAt(ciOf(el), +d.ri); if (q.paare.length < MAX_ITEMS) q.paare.push({ links: emptyItem(), rechts: emptyItem() }); save(); render(); break; }
    case 'pairdel': { const q = qAt(ciOf(el), +d.ri), i = +d.i, p = q.paare[i]; q.paare.splice(i, 1); dropUnused(p.links.bild); dropUnused(p.rechts.bild); save(); render(); break; }
    case 'pickgeo': pickGeo(ciOf(el), +d.ri); break;
    case 'selcat': sel = +d.i; render(); break;
    case 'selfin': sel = 'f'; render(); break;
    case 'addcat': if (pkg.kategorien.length < MAX_CATS) { pkg.kategorien.push(newCat(pkg.kategorien.length + 1, rows())); sel = pkg.kategorien.length - 1; save(); render(); } break;
    case 'delcat': {
      const c = pkg.kategorien[+d.i];
      if (pkg.kategorien.length <= 1) return toast('Die letzte Kategorie kann nicht gelöscht werden.', true);
      if (!confirm('Kategorie „' + c.name + '" mit allen Fragen löschen?')) return;
      pkg.kategorien.splice(+d.i, 1); sel = Math.max(0, +d.i - 1); save(); render(); break;
    }
    case 'movecat': { const i = +d.i, j = i + (+d.d); if (j < 0 || j >= pkg.kategorien.length) return; [pkg.kategorien[i], pkg.kategorien[j]] = [pkg.kategorien[j], pkg.kategorien[i]]; if (sel === i) sel = j; else if (sel === j) sel = i; save(); render(); break; }
    case 'addfin': pkg.finale.fragen.push(emptyQ()); save(); render(); setTimeout(() => { const q = document.getElementById('q-f-' + (pkg.finale.fragen.length - 1)); if (q && q.scrollIntoView) q.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); break;
    case 'delfin': { const q = pkg.finale.fragen[+d.ri]; if (!isEmpty(q) && !confirm('Finalfrage ' + (+d.ri + 1) + ' löschen?')) return; pkg.finale.fragen.splice(+d.ri, 1); save(); render(); break; }
    case 'goto': {
      if (d.ci === '') return;
      sel = d.ci === 'f' ? 'f' : +d.ci; render();
      if (d.ri !== '') { const q = document.getElementById('q-' + d.ci + '-' + d.ri); if (q) { if (q.scrollIntoView) q.scrollIntoView({ behavior: 'smooth', block: 'center' }); q.style.outline = '3px solid var(--gold)'; setTimeout(() => q.style.outline = '', 1500); } }
      break;
    }
    case 'new': if (confirm('Neues, leeres Paket anlegen? Der aktuelle Entwurf und seine Mediendateien werden verworfen.')) { clearAll(); pkg = normPkg({ titel: 'Quiz Show', werte: [100, 200, 300, 400, 500, 600, 700, 800], kategorien: Array.from({ length: 6 }, (_, i) => ({ name: 'Kategorie ' + (i + 1), fragen: [] })) }); sel = 0; save(); render(); } break;
    case 'template': if (confirm('Vorlage mit den 13 Standard-Kategorien laden? Der aktuelle Entwurf wird ersetzt (Mediendateien bleiben).')) loadTemplate(); break;
    case 'import': document.getElementById('importfile').click(); break;
    case 'exportRepo': exportRepo(); break;
    case 'exportSofort': exportSofort(); break;
  }
});
function clearAll() {
  media.clear(); urls.forEach(u => URL.revokeObjectURL(u)); urls.clear();
  idb(() => IDB.clear());
}
async function loadTemplate() {
  try { const raw = await (await fetch('/fragen-vorlage.json')).json(); pkg = normPkg(raw); sel = 0; save(); render(); toast('Vorlage geladen.'); }
  catch (e) { toast('Vorlage konnte nicht geladen werden.', true); }
}

/* ---------- Start ---------- */
(async () => {
  const stored = await idb(() => IDB.all());
  if (stored) stored.forEach((b, n) => media.set(n, b));
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
  if (raw) { pkg = normPkg(raw); saveStat = 'Entwurf wiederhergestellt'; }
  else {
    try { raw = await (await fetch('/fragen-vorlage.json')).json(); } catch (e) { raw = null; }
    pkg = normPkg(raw || { kategorien: [] });
  }
  render();
})();
