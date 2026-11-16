// Composants partagés : roue, minuteur, carte, badges, fenêtre modale.
import { h, avatar, levelClass, setChildren } from './dom.js';
import { icon } from './icons.js';

export const COLORS = ['#FF8A3D', '#4DA8FF', '#5BD69B', '#FFD23F', '#FF4FA3', '#B18CFF', '#4FD1C5', '#FF6B4A', '#A6E05A', '#FFB37A', '#7FA8FF', '#F7A8D8'];

export const TYPE_LABEL = { action: 'ACTION', verite: 'VÉRITÉ', tous: 'TOUT LE MONDE' };
export const MODE_LABEL = { presentiel: 'Présentiel', distance: 'À distance' };
export const PLACE_LABEL = { both: 'Présentiel et à distance', presentiel: 'Présentiel uniquement', distance: 'À distance uniquement' };

/** Heure du serveur estimée côté client. */
export const serverNow = (offset) => Date.now() + offset;

export function levelBadge(level, extra = '') {
  return h('span', { class: `level-badge lv-${levelClass(level)} ${extra}`.trim() }, level);
}

export function levelBadges(levels) {
  return h('div', { class: 'badges', 'aria-label': 'Niveaux : ' + levels.join(', ') }, levels.map((l) => levelBadge(l)));
}

// ---------- Roue ----------

export function createWheel() {
  const disc = h('div', { class: 'wheel', role: 'img', 'aria-label': 'Roue des joueurs' });
  const top = h('span');
  const main = h('strong');
  const el = h(
    'div',
    { class: 'wheel-zone' },
    h('div', { class: 'wheel-pointer', 'aria-hidden': 'true' }),
    disc,
    h('div', { class: 'wheel-center', 'aria-live': 'polite' }, top, main),
  );
  let rotation = 0;
  let segKey = '';
  let spinKey = null;
  let revealTimer = null;

  function paint(segments, byId) {
    const key = segments.map((id) => id + ':' + (byId.get(id)?.slot ?? 0)).join('|');
    if (key === segKey) return;
    segKey = key;
    const n = segments.length;
    if (n === 0) {
      disc.style.background = '#2E2C45';
      return;
    }
    if (n === 1) {
      disc.style.background = COLORS[(byId.get(segments[0])?.slot ?? 0) % 12];
      return;
    }
    const step = 360 / n;
    const stops = segments.map((id, i) => {
      const c = COLORS[(byId.get(id)?.slot ?? i) % 12];
      return `${c} ${(i * step).toFixed(3)}deg ${((i + 1) * step).toFixed(3)}deg`;
    });
    disc.style.background = `conic-gradient(from 0deg, ${stops.join(', ')})`;
  }

  function setCenter(t, m, mode = '') {
    top.textContent = t;
    main.textContent = m;
    const len = [...m].length;
    main.className = mode || (len > 9 ? 'is-long' : len > 5 ? 'is-mid' : '');
  }

  /**
   * @param {object} o
   * @param {string[]} o.segments  ids des joueurs (ordre de la roue)
   * @param {Map} o.byId           joueurs par id
   * @param {object|null} o.spin   { targetId, startedAt, duration }
   * @param {number} o.offset      décalage horloge serveur
   * @param {(landed: boolean) => void} [o.onCenter] remplit le centre selon l'état
   */
  function update({ segments, byId, spin, offset }) {
    paint(segments, byId);
    if (!spin) return { landed: true };
    const key = spin.startedAt + ':' + spin.targetId;
    const elapsed = serverNow(offset) - spin.startedAt;
    const remaining = Math.max(0, spin.duration - elapsed);
    if (key !== spinKey) {
      spinKey = key;
      const n = segments.length || 1;
      const idx = Math.max(0, segments.indexOf(spin.targetId));
      const step = 360 / n;
      const center = (idx + 0.5) * step;
      const jitter = (Math.random() - 0.5) * step * 0.5;
      const want = (((360 - center - jitter) % 360) + 360) % 360;
      const base = Math.ceil(rotation / 360) * 360 + (remaining > 300 ? 360 * 5 : 0);
      rotation = base + want;
      if (remaining > 300) {
        disc.style.transition = `transform ${remaining}ms cubic-bezier(0.15, 0.65, 0.12, 1)`;
      } else {
        disc.style.transition = 'none';
      }
      // Force le navigateur à prendre en compte la transition avant de changer la rotation.
      void disc.offsetWidth;
      disc.style.transform = `rotate(${rotation}deg)`;
    }
    return { landed: remaining <= 0, remaining };
  }

  function onLanded(ms, fn) {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(fn, ms);
  }

  return { el, update, setCenter, onLanded, destroy: () => clearTimeout(revealTimer) };
}

// ---------- Minuteur ----------

export function createTimer({ tv = false } = {}) {
  const ring = h('div', { class: 'timer-ring' });
  const value = h('div', { class: 'timer-value' }, '0:00');
  const el = h('div', { class: 'timer' + (tv ? ' tv-timer' : ''), role: 'timer', 'aria-label': 'Minuteur' }, ring, value);
  let timer = null;
  let offset = 0;
  let interval = null;
  let lastSec = -1;

  function draw() {
    if (!timer) return;
    const left = Math.max(0, timer.endsAt - serverNow(offset));
    const ratio = timer.duration ? left / timer.duration : 0;
    const deg = Math.round(ratio * 360);
    const over = timer.expired || left <= 0;
    el.classList.toggle('is-over', over);
    if (!over) ring.style.background = `conic-gradient(#FF8A3D 0deg ${deg}deg, #2E2C45 ${deg}deg 360deg)`;
    else ring.style.background = '';
    const s = Math.ceil(left / 1000);
    if (s !== lastSec) {
      lastSec = s;
      value.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      el.setAttribute('aria-label', over ? 'Temps écoulé' : `Minuteur : ${s} secondes restantes`);
    }
  }

  function update(t, off) {
    timer = t;
    offset = off;
    el.hidden = !t;
    if (t && !interval) interval = setInterval(draw, 200);
    if (!t && interval) {
      clearInterval(interval);
      interval = null;
    }
    lastSec = -1;
    draw();
  }

  return { el, update, destroy: () => clearInterval(interval) };
}

// ---------- Carte ----------

export function createCard({ tv = false } = {}) {
  const kind = h('span', { class: 'card-kind' });
  const badgeHolder = h('span');
  const text = h('p', { class: 'card-text' });
  const foot = h('div', { class: 'card-foot' });
  const inner = h('div', { class: tv ? 'tv-card-inner' : 'play-card-inner' }, h('div', { class: 'card-top' }, kind, badgeHolder), text, foot);
  const el = h('div', { class: tv ? 'tv-card' : 'play-card' }, inner);
  let cardId = null;

  function update(card, footer) {
    if (!card) return;
    const type = card.type;
    const base = tv ? `tv-card tv-card--${type}` : `play-card play-card--${type}`;
    if (card.id !== cardId) {
      // Nouvelle carte : on rejoue l'animation de retournement.
      el.className = base;
      void el.offsetWidth;
      el.className = base + ' is-flip';
      cardId = card.id;
    }
    const ic = type === 'action' ? 'bolt' : type === 'verite' ? 'bubble' : 'users';
    setChildren(kind, icon(ic, { size: tv ? 30 : 22, width: 2.2 }), TYPE_LABEL[type]);
    setChildren(badgeHolder, levelBadge(card.level, tv ? '' : 'level-badge--card'));
    text.textContent = card.text;
    text.classList.toggle('is-long', card.text.length > (tv ? 120 : 110));
    foot.className = 'card-foot' + (footer && footer.wait ? ' card-foot--wait' : '');
    setChildren(foot, footer ? footer.nodes : []);
  }
  return { el, update };
}

// ---------- Fenêtre modale ----------

/** Ouvre une fenêtre modale. Renvoie une fonction de fermeture. */
export function openModal({ title, text, actions, dismissable = true, labelledBy = 'modal-title' }) {
  closeModal();
  const back = h('div', { class: 'modal-back', id: 'modal' });
  const box = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy },
    h('h2', { id: labelledBy }, title),
    text ? h('p', null, text) : null,
    actions,
  );
  back.append(box);
  if (dismissable) {
    back.addEventListener('click', (e) => {
      if (e.target === back) closeModal();
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }
  document.body.append(back);
  box.querySelector('button')?.focus();
  return closeModal;
}

export function closeModal() {
  document.getElementById('modal')?.remove();
}

/** Ligne d'avatar d'un joueur + nom. */
export function whoBlock(player, title, subtitle) {
  return h('div', { class: 'who' }, avatar(player), h('div', { class: 'who-text' }, h('strong', null, title), h('span', null, subtitle)));
}

export { icon, avatar };
