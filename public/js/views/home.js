// Écran d'accueil (maquette « Main ») + formulaire du mode grand écran.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { prefs } from '../session.js';

export const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '’._-]*$/u;
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function cleanCodeInput(v) {
  return v.replace(/[\s-]/g, '').toUpperCase();
}

/** Vérifie un pseudo côté client (le serveur revérifie). Renvoie un message d'erreur ou null. */
export function nameError(v) {
  const n = v.trim().replace(/\s+/g, ' ');
  const len = [...n].length;
  if (len < 2) return 'Ton pseudo doit faire au moins 2 caractères.';
  if (len > 16) return 'Ton pseudo doit faire 16 caractères maximum.';
  if (!NAME_RE.test(n)) return "Lettres, chiffres, espace et - _ . ' uniquement.";
  return null;
}

export function homeView(app) {
  let busy = false;

  const nameInput = h('input', {
    id: 'pseudo',
    class: 'input',
    type: 'text',
    autocomplete: 'nickname',
    maxlength: '16',
    placeholder: 'Ex. Samuel',
    enterkeyhint: 'go',
    value: prefs.name(),
  });
  const nameErr = h('p', { class: 'field-error', id: 'pseudo-err', 'aria-live': 'polite' });
  const codeInput = h('input', {
    id: 'code',
    class: 'input input--code',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    maxlength: '7',
    placeholder: 'K7FQ2M',
    enterkeyhint: 'go',
  });
  const codeErr = h('p', { class: 'field-error', id: 'code-err', 'aria-live': 'polite' });

  function showErr(el, input, msg) {
    el.textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) input.setAttribute('aria-describedby', el.id);
  }

  function checkName() {
    const err = nameError(nameInput.value);
    showErr(nameErr, nameInput, err);
    if (err) nameInput.focus();
    return !err;
  }

  async function create() {
    if (busy || !checkName()) return;
    busy = true;
    createBtn.disabled = true;
    const res = await app.createRoom(nameInput.value.trim());
    busy = false;
    createBtn.disabled = false;
    if (!res.ok) showErr(nameErr, nameInput, res.message);
  }

  async function join() {
    if (busy) return;
    const code = cleanCodeInput(codeInput.value);
    if (!CODE_RE.test(code)) {
      showErr(codeErr, codeInput, 'Le code fait 6 caractères (lettres et chiffres).');
      codeInput.focus();
      return;
    }
    showErr(codeErr, codeInput, null);
    if (!checkName()) return;
    busy = true;
    joinBtn.disabled = true;
    const res = await app.joinRoom(code, nameInput.value.trim(), false);
    busy = false;
    joinBtn.disabled = false;
    if (res.ok) return;
    if (res.error === 'AGE_REQUIRED') {
      // Le niveau +18 est actif : on passe par l'écran d'invitation qui demande la confirmation.
      app.openInvite(code, nameInput.value.trim());
    } else if (res.error === 'NAME_TAKEN' || res.error === 'INVALID_NAME') {
      showErr(nameErr, nameInput, res.message);
    } else {
      showErr(codeErr, codeInput, res.message);
    }
  }

  nameInput.addEventListener('input', () => {
    prefs.setName(nameInput.value.trim());
    if (nameErr.textContent) showErr(nameErr, nameInput, null);
  });
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && create());
  codeInput.addEventListener('input', () => {
    const v = cleanCodeInput(codeInput.value);
    if (v !== codeInput.value) codeInput.value = v;
    if (codeErr.textContent) showErr(codeErr, codeInput, null);
  });
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());

  const createBtn = h('button', { type: 'button', class: 'btn btn--xl btn--orange', onclick: create }, icon('plus', { size: 22, width: 2.4 }), 'Créer une partie');
  const joinBtn = h('button', { type: 'button', class: 'btn btn--join', onclick: join }, 'Rejoindre');

  const el = h(
    'main',
    { class: 'screen screen--home' },
    h('div', { class: 'glow glow--orange', 'aria-hidden': 'true' }),
    h('div', { class: 'glow glow--blue', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand-cards', 'aria-hidden': 'true' }, h('div', { class: 'brand-card brand-card--a' }, 'A'), h('div', { class: 'brand-card brand-card--v' }, 'V')),
      h('h1', { class: 'title-xl' }, 'ACTION', h('br'), 'OU VÉRITÉ'),
      h('p', { class: 'tagline' }, 'Le jeu entre potes, chacun sur son téléphone.'),
    ),
    h('div', { class: 'field' }, h('label', { for: 'pseudo', class: 'label' }, 'Ton pseudo'), nameInput, nameErr),
    createBtn,
    h('div', { class: 'divider' }, 'ou rejoindre'),
    h('div', { class: 'field' }, h('label', { for: 'code', class: 'label' }, 'Code du salon'), h('div', { class: 'input-row' }, codeInput, joinBtn), codeErr),
    h(
      'div',
      { class: 'home-foot' },
      h('p', { class: 'note' }, "Un ami t'a envoyé un lien ? Ouvre-le, le code est déjà rempli."),
      h('button', { type: 'button', class: 'tv-link', onclick: () => app.openTvForm() }, icon('tv', { size: 18 }), 'Afficher sur une télé ou un PC'),
    ),
  );

  return { el };
}

/** Formulaire « Afficher sur une télé ou un PC ». */
export function tvFormView(app) {
  let busy = false;
  const input = h('input', {
    id: 'tv-code',
    class: 'input input--code',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    maxlength: '7',
    placeholder: 'K7FQ2M',
  });
  const err = h('p', { class: 'field-error', id: 'tv-err', 'aria-live': 'polite' });

  async function go() {
    if (busy) return;
    const code = cleanCodeInput(input.value);
    if (!CODE_RE.test(code)) {
      err.textContent = 'Le code fait 6 caractères.';
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    busy = true;
    const res = await app.joinScreen(code);
    busy = false;
    if (!res.ok) {
      err.textContent = res.message;
      input.setAttribute('aria-invalid', 'true');
    }
  }
  input.addEventListener('input', () => {
    input.value = cleanCodeInput(input.value);
    err.textContent = '';
    input.removeAttribute('aria-invalid');
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());

  const el = h(
    'main',
    { class: 'screen screen--home' },
    h('div', { class: 'glow glow--blue-top', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'topbar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': "Retour à l'accueil", onclick: () => app.goHome() }, icon('back')),
      h('div', { class: 'topbar-title' }, h('strong', null, 'Mode grand écran')),
      h('div', { class: 'spacer-44' }),
    ),
    h(
      'div',
      { class: 'invite-head' },
      h('div', { class: 'avatar-xl', 'aria-hidden': 'true' }, icon('tv', { size: 32, width: 2.2 })),
      h('h1', { class: 'title-l' }, 'Afficher la partie', h('br'), 'sur une télé ou un PC'),
      h('p', { class: 'tagline' }, "Cet écran suivra la partie en direct sans compter comme joueur. Les téléphones servent de télécommande."),
    ),
    h('div', { class: 'field' }, h('label', { for: 'tv-code', class: 'label' }, 'Code du salon'), input, err),
    h('button', { type: 'button', class: 'btn btn--xl btn--blue', onclick: go }, 'Afficher la partie', icon('arrow', { width: 2.4 })),
    h('p', { class: 'note push-bottom' }, "En visio, l'hôte peut partager cet écran."),
  );
  setTimeout(() => input.focus(), 50);
  return { el };
}
