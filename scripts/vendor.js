'use strict';
// Copie les librairies front et les polices depuis node_modules vers /public.
// Les fichiers copiés sont versionnés : le serveur n'a besoin d'aucune dépendance front en production.
// Usage : npm run vendor (après npm install)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');

const copies = [
  ['qrcode-generator/dist/qrcode.js', 'public/vendor/qrcode.js'],
  ['qrcode-generator/LICENSE', 'public/vendor/qrcode.LICENSE.txt', true],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'public/fonts/inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-500-normal.woff2', 'public/fonts/inter-500.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'public/fonts/inter-600.woff2'],
  ['@fontsource/inter/files/inter-latin-700-normal.woff2', 'public/fonts/inter-700.woff2'],
  ['@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-600-normal.woff2', 'public/fonts/bricolage-600.woff2'],
  ['@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2', 'public/fonts/bricolage-800.woff2'],
  ['@fontsource/inter/LICENSE', 'public/fonts/OFL-inter.txt', true],
  ['@fontsource/bricolage-grotesque/LICENSE', 'public/fonts/OFL-bricolage.txt', true],
];

for (const [from, to, optional] of copies) {
  const src = path.join(nm, from);
  const dest = path.join(root, to);
  if (!fs.existsSync(src)) {
    if (optional) continue;
    console.error(`Introuvable : ${from} (lance npm install)`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`${from} -> ${to}`);
}
