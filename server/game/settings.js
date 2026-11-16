'use strict';
// Réglages d'une partie : valeurs autorisées, valeurs par défaut, validation stricte.

const LEVELS = ['SOFT', 'FUN', 'HARD', '+18'];

const ALLOWED = {
  mode: ['presentiel', 'distance'],
  cardType: ['both', 'action', 'verite'],
  timer: [0, 30, 60, 120], // secondes, 0 = aucun
  rerolls: [0, 1, 2, 3],
  order: ['wheel', 'fixed'],
  endTurns: [0, 10, 20, 30], // 0 = illimitée
  spinCountdown: [0, 3, 5], // secondes avant que la roue tourne, 0 = aucun
};
const BOOLEANS = ['everyone', 'lateJoin'];

const DEFAULT_SETTINGS = Object.freeze({
  mode: 'presentiel',
  levels: ['SOFT', 'FUN'],
  cardType: 'both',
  timer: 60,
  rerolls: 1,
  order: 'wheel',
  endTurns: 0,
  everyone: true,
  spinCountdown: 0,
  lateJoin: true,
});

function defaultSettings() {
  return { ...DEFAULT_SETTINGS, levels: [...DEFAULT_SETTINGS.levels] };
}

/** Valide un objet de réglages partiel. Renvoie un code d'erreur ou null. */
function validateSettings(partial) {
  const keys = Object.keys(partial);
  if (keys.length === 0 || keys.length > 12) return 'INVALID_SETTINGS';
  for (const key of keys) {
    const v = partial[key];
    if (key === 'levels') {
      if (!Array.isArray(v) || v.length < 1 || v.length > LEVELS.length) return 'INVALID_SETTINGS';
      if (!v.every((l) => LEVELS.includes(l))) return 'INVALID_SETTINGS';
      if (new Set(v).size !== v.length) return 'INVALID_SETTINGS';
    } else if (ALLOWED[key]) {
      if (!ALLOWED[key].includes(v)) return 'INVALID_SETTINGS';
    } else if (BOOLEANS.includes(key)) {
      if (typeof v !== 'boolean') return 'INVALID_SETTINGS';
    } else {
      return 'INVALID_SETTINGS';
    }
  }
  return null;
}

/** Applique des réglages déjà validés. Les niveaux sont remis dans l'ordre canonique. */
function applySettings(settings, partial) {
  for (const [key, v] of Object.entries(partial)) {
    settings[key] = key === 'levels' ? LEVELS.filter((l) => v.includes(l)) : v;
  }
  return settings;
}

module.exports = { LEVELS, ALLOWED, DEFAULT_SETTINGS, defaultSettings, validateSettings, applySettings };
