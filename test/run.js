'use strict';
// Startet einen Server auf freiem Port, fuehrt alle *.test.js aus und beendet sich mit Fehlercode bei Fehlern.
// Aufruf: npm test
const fs = require('fs');
const path = require('path');
const { startServer, reporter } = require('./helpers');

(async () => {
  const srv = await startServer();
  const t = reporter();
  const only = process.argv[2];
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only || f.includes(only))).sort();
  let crashed = false;
  for (const f of files) {
    console.log('\n=== ' + f + ' ===');
    try { await require(path.join(__dirname, f))({ url: srv.url, t }); }
    catch (e) { crashed = true; console.error('  ABBRUCH in ' + f + ': ' + (e && e.stack || e)); }
  }
  srv.stop();
  console.log('\n' + (t.total - t.fails) + ' von ' + t.total + ' Prüfungen bestanden' + (crashed ? ', mindestens ein Test ist abgebrochen' : ''));
  process.exit(t.fails || crashed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
