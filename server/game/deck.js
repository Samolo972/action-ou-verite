'use strict';
// Cartes : chargement, contrôle du format, filtrage et tirage sans remise.

const fs = require('fs');
const path = require('path');
const { LEVELS } = require('./settings');

const TYPES = ['action', 'verite', 'tous'];
const PLACES = ['both', 'presentiel', 'distance'];

/** Vérifie le format d'une liste de cartes. Renvoie la liste des problèmes (vide si tout va bien). */
function checkCards(cards) {
  const problems = [];
  if (!Array.isArray(cards)) return ['Le fichier doit contenir un tableau de cartes.'];
  const ids = new Set();
  const texts = new Set();
  for (const c of cards) {
    const where = `carte ${c && c.id}`;
    if (!c || typeof c !== 'object') {
      problems.push('Entrée invalide.');
      continue;
    }
    if (typeof c.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(c.id)) problems.push(`${where} : id invalide`);
    if (ids.has(c.id)) problems.push(`${where} : id en double`);
    ids.add(c.id);
    if (!TYPES.includes(c.type)) problems.push(`${where} : type invalide`);
    if (!LEVELS.includes(c.level)) problems.push(`${where} : niveau invalide`);
    if (!PLACES.includes(c.place)) problems.push(`${where} : place invalide`);
    if (typeof c.text !== 'string' || c.text.trim().length < 10 || c.text.length > 400) problems.push(`${where} : texte invalide`);
    const key = String(c.text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (texts.has(key)) problems.push(`${where} : texte en double`);
    texts.add(key);
  }
  return problems;
}

function loadCards(file = path.join(__dirname, '..', '..', 'data', 'cards.json')) {
  const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = checkCards(cards);
  if (problems.length) throw new Error(`cards.json invalide :\n- ${problems.slice(0, 20).join('\n- ')}`);
  return cards.map((c) => Object.freeze({ id: c.id, type: c.type, level: c.level, place: c.place, text: c.text }));
}

/** Une carte peut-elle sortir dans ce mode ? */
function placeAllowed(place, mode) {
  return place === 'both' || place === mode;
}

/**
 * Cartes compatibles avec un type et les réglages (niveaux + mode).
 * @param {object[]} cards
 * @param {'action'|'verite'|'tous'} type
 * @param {{levels: string[], mode: string}} settings
 */
function pool(cards, type, settings) {
  return cards.filter((c) => c.type === type && settings.levels.includes(c.level) && placeAllowed(c.place, settings.mode));
}

/**
 * Tire une carte au hasard parmi celles pas encore sorties.
 * Si toutes sont sorties, on recycle (sauf la carte à exclure).
 * @param {object[]} candidates  résultat de pool()
 * @param {Set<string>} drawn    cartes déjà tirées dans la partie (modifié)
 * @param {() => number} rng
 * @param {string} [excludeId]   carte actuellement affichée (changement de carte)
 * @returns {object|null}
 */
function draw(candidates, drawn, rng, excludeId) {
  let fresh = candidates.filter((c) => !drawn.has(c.id) && c.id !== excludeId);
  if (fresh.length === 0) {
    // Plus aucune carte neuve : on remet en jeu ce paquet-là.
    for (const c of candidates) drawn.delete(c.id);
    fresh = candidates.filter((c) => c.id !== excludeId);
  }
  if (fresh.length === 0) return null;
  const card = fresh[Math.floor(rng() * fresh.length)];
  drawn.add(card.id);
  return card;
}

module.exports = { TYPES, PLACES, checkCards, loadCards, placeAllowed, pool, draw };
