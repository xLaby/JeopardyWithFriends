'use strict';
// Quiz Show: Einstiegspunkt. Die Spiellogik liegt in lib/ (siehe README, Abschnitt "Code-Aufbau").
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const hub = require('./lib/hub');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
hub.app = app; hub.io = io;

// Reihenfolge ist egal, jedes Modul traegt seine Funktionen in hub ein
['questions', 'rooms', 'game', 'minigames', 'finale', 'persist', 'awards', 'state'].forEach(m => require('./lib/' + m));
require('./lib/http');
require('./lib/sockets');

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Quiz laeuft auf Port ' + PORT));
