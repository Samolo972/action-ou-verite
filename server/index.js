'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { PORT, PUBLIC_URL, ALLOWED_ORIGIN, IS_PROD } = require('./config');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
// Derrière nginx : l'IP réelle du client arrive dans X-Forwarded-For.
app.set('trust proxy', 1);

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
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    maxAge: IS_PROD ? '7d' : 0,
    setHeaders(res, filePath) {
      // Le service worker et le manifeste doivent toujours être revalidés.
      if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
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
});

server.listen(PORT, () => {
  console.log(`Action ou Vérité démarré sur le port ${PORT} (${PUBLIC_URL})`);
});

module.exports = { app, server, io };
