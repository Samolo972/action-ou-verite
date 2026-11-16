'use strict';
// Point d'entrée du moteur de salon réutilisable.
const { LobbyManager, DEFAULTS } = require('./LobbyManager');
const { attachLobby, MESSAGES } = require('./socketAdapter');

module.exports = { LobbyManager, attachLobby, DEFAULTS, MESSAGES };
