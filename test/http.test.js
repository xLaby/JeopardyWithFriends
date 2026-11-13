'use strict';
// Laden: Komprimierung, Zwischenspeicher und Versionsnummer der Skripte
module.exports = async ({ url, t }) => {
  console.log('Laden');
  const html = await fetch(url + '/');
  const text = await html.text();
  const ver = (/app\.js\?v=([0-9a-f]{8})/.exec(text) || [])[1];
  t.ok(html.status === 200 && !!ver, 'Startseite verweist auf app.js mit Versionsnummer aus dem Inhalt');
  t.ok(/no-cache/.test(html.headers.get('cache-control') || ''), 'Die Seite selbst wird nie zwischengespeichert');
  const beam = await (await fetch(url + '/beamer.html')).text();
  t.ok(beam.includes('app.js?v=' + ver) && beam.includes('data-beamer'), 'Beamer-Seite nutzt dieselbe Version');
  const ed = await (await fetch(url + '/editor.html')).text();
  t.ok(ed.includes('editor.js?v=' + ver), 'Editor-Seite ebenfalls');
  const js = await fetch(url + '/app.js?v=' + ver);
  t.ok(/immutable/.test(js.headers.get('cache-control') || ''), 'app.js mit Versionsnummer darf lange zwischengespeichert werden');
  t.ok(js.headers.get('content-encoding') === 'gzip' && /Accept-Encoding/i.test(js.headers.get('vary') || ''), 'app.js wird komprimiert ausgeliefert');
  const raw = await fetch(url + '/app.js');
  t.ok(/no-cache/.test(raw.headers.get('cache-control') || ''), 'Ohne Versionsnummer wird neu geprüft (kein veralteter Stand)');
  const css = await fetch(url + '/style.css?v=' + ver);
  t.ok(css.headers.get('content-encoding') === 'gzip' && /immutable/.test(css.headers.get('cache-control') || ''), 'style.css: komprimiert und zwischenspeicherbar');
  const lf = await fetch(url + '/vendor/leaflet/leaflet.css');
  t.ok(/max-age=604800/.test(lf.headers.get('cache-control') || ''), 'Bilder und Leaflet werden eine Woche zwischengespeichert');
  const media = await fetch(url + '/media/beispiel-karte.png');
  t.ok(media.status === 200 && /max-age=86400/.test(media.headers.get('cache-control') || ''), 'Medien werden einen Tag zwischengespeichert');
};
