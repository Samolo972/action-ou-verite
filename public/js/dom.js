// Petits outils DOM. Aucune donnée utilisateur ne passe par innerHTML : tout est en textContent.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Crée un élément.
 * h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Texte', autreNoeud)
 * Les enfants de type chaîne deviennent des nœuds texte (jamais du HTML).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Remplace le contenu d'un élément. */
export function setChildren(el, ...children) {
  clear(el);
  return append(el, children);
}

/** Icône SVG en trait (24×24). `paths` = liste de [balise, attributs]. */
export function svg(paths, { size = 20, stroke = 'currentColor', width = 2, label } = {}) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', width);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, attrs] of paths) {
    const p = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    el.append(p);
  }
  return el;
}

let toastTimer = null;
/** Message temporaire en bas de l'écran. */
export function toast(message, { error = false, ms = 2800 } = {}) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast' + (error ? ' is-error' : ''), role: error ? 'alert' : 'status' }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), ms);
}

/** Pastille d'avatar (initiale + couleur de l'emplacement). */
export function avatar(player, extraClass = '') {
  const initial = player ? [...player.name][0].toUpperCase() : '?';
  return h('span', { class: `avatar c${player ? player.slot % 12 : 0} ${extraClass}`.trim(), 'aria-hidden': 'true' }, initial);
}

/** Libellé de niveau sans caractère spécial pour les classes CSS. */
export const levelClass = (level) => (level === '+18' ? 'x18' : level);
