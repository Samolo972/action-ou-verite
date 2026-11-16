'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { PORT, PUBLIC_URL, ALLOWED_ORIGIN, IS_PROD, TRUST_PROXY } = require('./config');
const { LobbyManager, attachLobby } = require('./lobby');
const { createGame } = require('./game');
const { loadCards } = require('./game/deck');
const { cleanCode } = require('./utils/validation');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
// Derrière nginx : l'IP réelle du client arrive dans X-Forwarded-For.
app.set('trust proxy', TRUST_PROXY ? 1 : false);

const wsOrigins = ALLOWED_ORIGIN.map((o) => o.replace(/^http/, 'ws'));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...wsOrigins],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // HSTS seulement en production (en local on est en http).
    strictTransportSecurity: IS_PROD ? { maxAge: 15552000 } : false,
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

// Page unique : les URL absolues (Open Graph) sont injectées au démarrage.
const indexHtml = fs
  .readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replaceAll('%PUBLIC_URL%', PUBLIC_URL);

function sendIndex(res) {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(indexHtml);
}

app.get('/', (req, res) => sendIndex(res));

// Lien d'invitation : on valide seulement le format du code, le statut du salon est vérifié par socket.
app.get('/j/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!code) return res.redirect(302, '/');
  if (code !== req.params.code) return res.redirect(301, `/j/${code}`);
  return sendIndex(res);
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    maxAge: IS_PROD ? '7d' : 0,
    setHeaders(res, filePath) {
      // Code (JS, CSS), service worker et manifeste : toujours revalidés auprès du serveur (ETag),
      // sinon les téléphones gardent une ancienne version après une mise à jour.
      // Polices, icônes et librairies tierces : cache long, elles ne changent pas.
      if (/\.(js|css|json)$/.test(filePath) && !filePath.includes(`${path.sep}vendor${path.sep}`)) {
        res.set('Cache-Control', 'no-cache');
      }
    },
  }),
);

app.use((req, res) => res.status(404).type('text').send('Page introuvable'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 4096, // aucun message légitime ne dépasse quelques centaines d'octets
  pingInterval: 20000,
  pingTimeout: 20000,
  // CORS ne protège pas les WebSockets : on vérifie l'origine nous-mêmes.
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    cb(null, !origin || ALLOWED_ORIGIN.includes(origin));
  },
});

const cards = loadCards();
const game = createGame({ cards });
const manager = new LobbyManager({ hooks: game.hooks });
attachLobby({ io, manager, game, publicUrl: PUBLIC_URL, trustProxy: TRUST_PROXY });

server.listen(PORT, () => {
  console.log(`Action ou Vérité démarré sur le port ${PORT} (${PUBLIC_URL}), ${cards.length} cartes`);
});

module.exports = { app, server, io };
