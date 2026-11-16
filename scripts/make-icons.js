'use strict';
// Génère les icônes PWA et l'image Open Graph à partir de SVG (police Bricolage Grotesque locale).
// Usage : npm run icons (dépendances de dev : @resvg/resvg-js, wawoff2). Les PNG produits sont versionnés.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const wawoff = require('wawoff2');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

async function fonts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-fonts-'));
  const files = [];
  for (const [src, name] of [
    ['public/fonts/bricolage-800.woff2', 'bricolage-800.ttf'],
    ['public/fonts/inter-600.woff2', 'inter-600.ttf'],
  ]) {
    const ttf = await wawoff.decompress(fs.readFileSync(path.join(root, src)));
    const f = path.join(tmp, name);
    fs.writeFileSync(f, Buffer.from(ttf));
    files.push(f);
  }
  return files;
}

// Deux cartes « A » orange et « V » bleue, comme sur l'accueil de la maquette.
function cards(cx, cy, s) {
  const w = 64 * s;
  const hgt = 88 * s;
  const r = 14 * s;
  const gap = 10 * s;
  const fs_ = 34 * s;
  const card = (x, color, letter, angle) =>
    `<g transform="rotate(${angle} ${x + w / 2} ${cy})"><rect x="${x}" y="${cy - hgt / 2}" width="${w}" height="${hgt}" rx="${r}" fill="${color}"/>` +
    `<text x="${x + w / 2}" y="${cy + fs_ * 0.36}" font-family="Bricolage Grotesque 96pt ExtraBold, Bricolage Grotesque 96pt, Bricolage Grotesque" font-weight="800" font-size="${fs_}" fill="#0F0E17" text-anchor="middle">${letter}</text></g>`;
  return card(cx - gap / 2 - w, '#FF8A3D', 'A', -10) + card(cx + gap / 2, '#4DA8FF', 'V', 10);
}

function iconSvg(size, { maskable = false, rounded = true } = {}) {
  // Zone sûre des icônes « maskable » : 80 % du centre.
  const scale = (maskable ? 0.62 : 0.8) * (size / 160);
  const bg = rounded && !maskable ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#0F0E17"/>` : `<rect width="${size}" height="${size}" fill="#0F0E17"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}${cards(size / 2, size / 2, scale)}</svg>`;
}

function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
  </defs>
  <rect width="1200" height="630" fill="#0F0E17"/>
  <circle cx="160" cy="80" r="220" fill="#FF8A3D" opacity="0.22" filter="url(#b)"/>
  <circle cx="1080" cy="560" r="240" fill="#4DA8FF" opacity="0.22" filter="url(#b)"/>
  ${cards(300, 315, 2.6)}
  <text x="560" y="250" font-family="Bricolage Grotesque 96pt ExtraBold, Bricolage Grotesque 96pt, Bricolage Grotesque" font-weight="800" font-size="92" fill="#FFFFFE">ACTION</text>
  <text x="560" y="345" font-family="Bricolage Grotesque 96pt ExtraBold, Bricolage Grotesque 96pt, Bricolage Grotesque" font-weight="800" font-size="92" fill="#FFFFFE">OU VÉRITÉ</text>
  <text x="562" y="420" font-family="Inter" font-weight="600" font-size="32" fill="#B8B6CC">Rejoins ma partie sur ton téléphone</text>
</svg>`;
}

(async () => {
  const fontFiles = await fonts();
  const render = (svg, file) => {
    const png = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng();
    fs.writeFileSync(path.join(out, file), png);
    console.log('icons/' + file, png.length, 'octets');
  };
  render(iconSvg(192), 'icon-192.png');
  render(iconSvg(512), 'icon-512.png');
  render(iconSvg(512, { maskable: true }), 'icon-maskable-512.png');
  render(iconSvg(180, { rounded: false }), 'apple-touch-icon.png');
  render(ogSvg(), 'og.png');
  // Favicon vectoriel (texte converti en formes inutile : les lettres A/V restent lisibles à 16 px avec la police système).
  fs.writeFileSync(
    path.join(out, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0F0E17"/>` +
      `<rect x="8" y="14" width="22" height="34" rx="5" fill="#FF8A3D" transform="rotate(-10 19 31)"/>` +
      `<rect x="34" y="14" width="22" height="34" rx="5" fill="#4DA8FF" transform="rotate(10 45 31)"/></svg>\n`,
  );
  console.log('icons/icon.svg');
})();
