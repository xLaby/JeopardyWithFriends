'use strict';
// Fragenpaket: Normalisieren und Standardpaket
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');   // Projektordner
const { MAX_CATS, MAX_ROWS, isMini, MINI_TIME, SORT_HEARTS, MAX_ITEMS } = require('./config');
const hub = require('./hub');

// ---------- Fragen ----------
const str = (v, max = 1000) => String(v == null ? '' : v).trim().slice(0, max);

const safeName = n => str(n, 80).toLowerCase().replace(/[^\w\-.]/g, '_');

// Medien: https-Link, hochgeladenes Medium (/blob/...) oder Dateiname im Ordner "media"
function mediaPath(v) {
  v = str(v, 2000);
  if (!v) return '';
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^\/blob\/[A-Z0-9]{4}\/[\w\-.%]+$/.test(v)) return v;
  if (/^[\w\-. ()\/]+$/.test(v) && !v.includes('..')) return 'media/' + v.replace(/^\/?media\//, '');
  return '';
}

// Zahl aus Text: "1.200" -> 1200, "12,50" -> 12.5, "ca. 300 EUR" -> 300
function parseNum(v) {
  let s = str(v, 60).replace(/[^\d,.\-]/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const hasC = s.includes(','), hasP = s.includes('.');
  if (hasC && hasP) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(',', '.');
  } else if (hasP) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  } else if (hasC) {
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

const itemOf = v => {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') { const t = str(v, 80); return t ? { text: t, bild: '', info: '', start: false } : null; }
  const o = { text: str(v.text, 80), bild: mediaPath(v.bild), info: str(v.info, 40), start: !!v.start };
  return o.text || o.bild ? o : null;
};
const coord = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
function normQuestion(f, finale) {
  f = f || {};
  const t = str(f.typ, 20).toLowerCase().replace('ä', 'ae');
  const zeit = Math.round(Number(f.zeit)), dauer = Math.round(Number(f.dauer));
  const q = {
    frage: str(f.frage), antwort: str(f.antwort),
    bild: mediaPath(f.bild), sound: mediaPath(f.sound), antwortBild: mediaPath(f.antwortBild), karte: mediaPath(f.karte),
    joker: !!f.joker,
    typ: finale ? 'finale' : t === 'schaetzen' ? 'schaetzen' : t === 'reveal' ? 'reveal' : 'buzzer',
    zeit: Number.isFinite(zeit) && zeit > 0 ? Math.min(zeit, 600) : 0,
    dauer: Number.isFinite(dauer) && dauer >= 4 ? Math.min(dauer, 120) : 20,
    einheit: str(f.einheit, 10)
  };
  if (!finale) {
    if (t === 'sortieren') {
      const items = (Array.isArray(f.items) ? f.items : []).map(itemOf).filter(Boolean).slice(0, MAX_ITEMS);
      const hz = Math.round(Number(f.herzen));
      if (items.length >= 2) Object.assign(q, { typ: 'sortieren', items, anfang: str(f.anfang, 30), ende: str(f.ende, 30),
        abwaerts: !!f.abwaerts, herzen: Number.isFinite(hz) && hz >= 1 ? Math.min(hz, 5) : SORT_HEARTS });
    } else if (t === 'zuordnen') {
      const paare = (Array.isArray(f.paare) ? f.paare : []).map(p => { const l = itemOf(p && p.links), r = itemOf(p && p.rechts); return l && r ? { links: l, rechts: r } : null; }).filter(Boolean).slice(0, MAX_ITEMS);
      if (paare.length >= 2) Object.assign(q, { typ: 'zuordnen', paare });
    } else if (t === 'geo' || t === 'geoguessr') {
      // Kartenbild: Ziel als Anteil der Bildbreite/-hoehe (0 bis 1, von links oben); aspekt = Breite / Hoehe des Bildes
      const x = coord(f.ziel && f.ziel.x), y = coord(f.ziel && f.ziel.y), asp = Number(f.aspekt);
      if (q.karte && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1)
        Object.assign(q, { typ: 'geo', ziel: { x, y }, aspekt: Number.isFinite(asp) && asp >= 0.2 && asp <= 5 ? asp : 1 });
    }
    if (isMini(q.typ) && !q.zeit) q.zeit = MINI_TIME[q.typ];
  }
  if (q.typ === 'reveal' && !q.bild && !q.sound) q.typ = 'buzzer';   // ohne Bild oder Sound gibt es nichts zu enthuellen
  return q;
}

function normalize(data) {
  if (!data || !Array.isArray(data.kategorien) || !data.kategorien.length)
    throw new Error('Die Datei braucht eine Liste "kategorien".');
  if (data.kategorien.length > MAX_CATS)
    throw new Error('Maximal ' + MAX_CATS + ' Kategorien erlaubt.');
  // Punktwerte: "werte" (Liste) oder "schritt" (100, 200, ...), Anzahl Stufen = laengste Kategorie
  const werte = Array.isArray(data.werte) ? data.werte.map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round).slice(0, MAX_ROWS) : [];
  const longest = Math.max(1, ...data.kategorien.map(c => Array.isArray(c.fragen) ? c.fragen.length : 0));
  const rows = werte.length || Math.min(MAX_ROWS, longest);
  const schritt = Math.round(Number(data.schritt));
  const values = werte.length ? werte : Array.from({ length: rows }, (_, i) => (schritt > 0 ? schritt : 100) * (i + 1));
  const out = {
    titel: str(data.titel, 40) || 'Quiz Show',
    values,
    kategorien: data.kategorien.map((c, i) => {
      const fragen = (Array.isArray(c.fragen) ? c.fragen : []).slice(0, rows).map(f => normQuestion(f, false));
      if (!fragen.length) throw new Error('Kategorie ' + (i + 1) + ' hat keine Fragen.');
      return { name: str(c.name, 60) || 'Kategorie ' + (i + 1), fragen };
    }),
    finale: null
  };
  const fin = data.finale;
  if (fin && Array.isArray(fin.fragen) && fin.fragen.length) {
    out.finale = { name: str(fin.name, 40) || 'Finale', fragen: fin.fragen.slice(0, 20).map(f => normQuestion(f, true)) };
  }
  return out;
}
const defaultData = () =>
  normalize(JSON.parse(fs.readFileSync(path.join(ROOT, 'fragen.json'), 'utf8')));


hub.register({ str, safeName, mediaPath, parseNum, itemOf, coord, normQuestion, normalize, defaultData });
