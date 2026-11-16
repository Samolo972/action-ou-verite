'use strict';
// Vérifie data/cards.json : format, doublons, et nombre de cartes par combinaison et par mode.
// Usage : npm run check:cards
const { loadCards, pool } = require('../server/game/deck');
const { LEVELS } = require('../server/game/settings');

let cards;
try {
  cards = loadCards();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const MIN = { action: 40, verite: 40, tous: 20 };
let ok = true;
const rows = [];
for (const type of ['action', 'verite', 'tous']) {
  for (const level of LEVELS) {
    const total = cards.filter((c) => c.type === type && c.level === level).length;
    const presentiel = pool(cards, type, { levels: [level], mode: 'presentiel' }).length;
    const distance = pool(cards, type, { levels: [level], mode: 'distance' }).length;
    const good = total >= MIN[type];
    if (!good) ok = false;
    rows.push({ type, niveau: level, total, presentiel, distance, ok: good ? 'oui' : 'NON' });
  }
}
console.table(rows);
console.log(`${cards.length} cartes au total.`);
process.exit(ok ? 0 : 1);
