'use strict';
// Validation des entrées venant des clients. Tout ce qui arrive par socket passe par ici.

// Alphabet des codes de salon : pas de 0/O, 1/I/L (caractères ambigus à l'oral ou à l'écrit).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

// Pseudo : lettres (accents compris), chiffres, espace, apostrophe, point, tiret, tiret bas.
// Doit commencer par une lettre ou un chiffre.
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’._-]*$/u;
const NAME_MIN = 2;
const NAME_MAX = 16;

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const ID_RE = /^[a-f0-9]{12}$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Normalise un code saisi (majuscules, sans espaces) et le valide. Renvoie le code ou null. */
function cleanCode(input) {
  if (typeof input !== 'string' || input.length > 20) return null;
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Nettoie et valide un pseudo. Renvoie le pseudo ou null. */
function cleanName(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  const name = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  const len = [...name].length;
  if (len < NAME_MIN || len > NAME_MAX) return null;
  if (!NAME_RE.test(name)) return null;
  return name;
}

/** Clé de comparaison pour l'unicité des pseudos : insensible à la casse et aux accents. */
function nameKey(name) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function isToken(v) {
  return typeof v === 'string' && TOKEN_RE.test(v);
}

function isMemberId(v) {
  return typeof v === 'string' && ID_RE.test(v);
}

module.exports = {
  CODE_ALPHABET,
  CODE_LENGTH,
  NAME_MIN,
  NAME_MAX,
  isPlainObject,
  cleanCode,
  cleanName,
  nameKey,
  isToken,
  isMemberId,
};
