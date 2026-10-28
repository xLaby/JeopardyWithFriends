'use strict';
// Gemeinsame Ablage: Jedes Modul traegt seine Funktionen hier ein und ruft die der anderen ueber diese Ablage auf.
// So duerfen sich Module gegenseitig aufrufen (z. B. Mini-Games und Spielablauf), ohne dass sich das Laden im Kreis dreht.
// server.js setzt hier zuerst app und io.
const hub = { register(fns) { Object.assign(hub, fns); } };
module.exports = hub;
