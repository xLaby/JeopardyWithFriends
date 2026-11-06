'use strict';
// Designs: nur bekannte Designs werden angenommen, geaenderte Designs gehen an alle (inkl. Beamer)
const { wait, ack, connect } = require('./helpers');

module.exports = async ({ url, t }) => {
  console.log('Designs');
  const host = await connect(url); let HS = null; host.on('state', s => { HS = s; });
  const h = await ack(host, 'host:create'); await wait(150);
  const beam = await connect(url); let BS = null; beam.on('state', s => { BS = s; });
  await ack(beam, 'beamer:join', { code: h.code }); await wait(150);
  t.ok(HS.themes.map(x => x.id).join() === 'classic,neon,future,primetime', 'Standard plus drei neue Designs sind in der Lobby wählbar');
  for (const id of ['neon', 'future', 'primetime']) {
    host.emit('host:setSettings', { theme: id }); await wait(120);
    t.ok(HS.settings.theme === id && BS.settings.theme === id, 'Design ' + id + ' gilt für Spielleiter und Beamer');
  }
  host.emit('host:setSettings', { theme: 'arcade' }); await wait(120);
  t.ok(HS.settings.theme === 'primetime', 'Entfernte Designs (z. B. arcade) werden abgelehnt');
  host.close(); beam.close();
};
