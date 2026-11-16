'use strict';
// Configuration lue dans les variables d'environnement (voir .env.example).

const PORT = Number.parseInt(process.env.PORT, 10) || 3004;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || PUBLIC_URL)
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const IS_PROD = process.env.NODE_ENV === 'production';
// Derrière nginx (production), l'IP du client est lue dans X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : IS_PROD;

module.exports = { PORT, PUBLIC_URL, ALLOWED_ORIGIN, IS_PROD, TRUST_PROXY };
