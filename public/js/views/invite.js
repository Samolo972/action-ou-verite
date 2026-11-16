// Arrivée par un lien d'invitation (maquette « InviteArrivee ») + messages d'erreur.
import { h, levelClass } from '../dom.js';
import { icon } from '../icons.js';
import { MODE_LABEL } from '../components.js';
import { prefs } from '../session.js';
import { nameError } from './home.js';

export function inviteView(app, code, presetName) {
  let info = null;
  let adultOk = false;
  let busy = false;

  const el = h('main', { class: 'screen screen--invite' });

  function renderLoading() {
    el.replaceChildren(
      h('div', { class: 'glow glow--blue-top', 'aria-hidden': 'true' }),
      h('div', { class: 'message-box' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', null, 'Recherche du salon…')),
    );
  }

  function renderError(message) {
    el.replaceChildren(
      h('div', { class: 'glow glow--blue-top', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'message-box' },
        h('div', { class: 'icon-circle', 'aria-hidden': 'true' }, icon('lock', { size: 30 })),
        h('h1', { class: 'title-l' }, 'Impossible de rejoindre'),
        h('p', { role: 'alert' }, message),
      ),
      h('button', { type: 'button', class: 'btn btn--xl btn--orange push-bottom', onclick: () => app.goHome() }, icon('plus', { size: 22, width: 2.4 }), 'Créer ma propre partie'),
    );
  }

  function renderForm() {
    const nameInput = h('input', {
      id: 'pseudo2',
      class: 'input',
      type: 'text',
      autocomplete: 'nickname',
      maxlength: '16',
      placeholder: 'Ex. Léa',
      enterkeyhint: 'go',
      value: presetName || prefs.name(),
    });
    const nameErr = h('p', { class: 'field-error', id: 'pseudo2-err', 'aria-live': 'polite' });
    const joinBtn = h('button', { type: 'button', class: 'btn btn--xl btn--blue push-bottom', onclick: join }, 'Rejoindre la partie', icon('arrow', { width: 2.4 }));

    const age = info.adult
      ? h(
          'button',
          { type: 'button', class: 'age-check', role: 'checkbox', 'aria-checked': 'false', onclick: toggleAge },
          h('span', { class: 'box' }, icon('check', { size: 16, width: 3, stroke: '#0F0E17' })),
          h('span', null, 'Je confirme avoir 18 ans ou plus (le niveau +18 est activé)'),
        )
      : null;

    function canJoin() {
      return !nameError(nameInput.value) && (!info.adult || adultOk);
    }
    function refresh() {
      const ok = canJoin();
      joinBtn.disabled = !ok || busy;
      joinBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
    }
    function toggleAge() {
      adultOk = !adultOk;
      age.setAttribute('aria-checked', adultOk ? 'true' : 'false');
      refresh();
    }
    async function join() {
      const err = nameError(nameInput.value);
      if (err) {
        nameErr.textContent = err;
        nameInput.setAttribute('aria-invalid', 'true');
        return;
      }
      if (!canJoin() || busy) return;
      busy = true;
      refresh();
      const res = await app.joinRoom(code, nameInput.value.trim(), adultOk);
      busy = false;
      refresh();
      if (res.ok) return;
      if (res.error === 'NAME_TAKEN' || res.error === 'INVALID_NAME') {
        nameErr.textContent = res.message;
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.focus();
      } else {
        renderError(res.message);
      }
    }
    nameInput.addEventListener('input', () => {
      prefs.setName(nameInput.value.trim());
      nameErr.textContent = '';
      nameInput.removeAttribute('aria-invalid');
      refresh();
    });
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());

    const host = info.hostName || '?';
    const count = info.playerCount;
    const sub = `Salon ${info.code} · ${count} joueur${count > 1 ? 's' : ''} déjà là` + (info.playing ? ' · partie en cours' : '');
    el.replaceChildren(
      h('div', { class: 'glow glow--blue-top', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'invite-head' },
        h('div', { class: 'avatar-xl', 'aria-hidden': 'true' }, [...host][0].toUpperCase()),
        h('h1', { class: 'title-l' }, `${host} t'invite`, h('br'), 'à un Action ou Vérité'),
        h('span', { class: 'muted small-14' }, sub),
      ),
      h(
        'div',
        { class: 'panel' },
        h('span', { class: 'panel-title' }, 'Au programme'),
        h(
          'div',
          { class: 'tags' },
          h('span', { class: 'tag-pill' }, MODE_LABEL[info.mode] || info.mode),
          info.levels.map((l) => h('span', { class: `tag-pill lv-${levelClass(l)}` }, l)),
        ),
      ),
      h('div', { class: 'field' }, h('label', { for: 'pseudo2', class: 'label' }, 'Ton pseudo'), nameInput, nameErr),
      age,
      joinBtn,
    );
    refresh();
  }

  async function load() {
    renderLoading();
    const res = await app.roomInfo(code);
    if (!res.ok) {
      renderError(res.message || "Ce salon n'existe pas ou a expiré.");
      return;
    }
    info = res.info;
    if (!info.joinable) renderError(info.message || 'Ce salon ne peut pas accueillir de nouveaux joueurs.');
    else renderForm();
  }

  load();
  return { el, reload: load };
}

/** Écran de message (exclu, salon fermé, ouvert ailleurs). */
export function noticeView(app, notice) {
  const map = {
    kicked: ['Tu as été exclu', "L'hôte t'a retiré du salon."],
    expired: ['Salon expiré', 'Ce salon est resté inactif trop longtemps et a été fermé.'],
    empty: ['Salon fermé', 'Tous les joueurs sont partis.'],
    replaced: ['Partie ouverte ailleurs', 'Tu as rouvert cette partie dans un autre onglet ou un autre appareil.'],
    lost: ['Place perdue', "Impossible de retrouver ta place dans ce salon : il a peut-être été fermé."],
  };
  const [title, text] = map[notice] || map.lost;
  const el = h(
    'main',
    { class: 'screen screen--invite' },
    h('div', { class: 'glow glow--blue-top', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'message-box' },
      h('div', { class: 'icon-circle', 'aria-hidden': 'true' }, icon(notice === 'replaced' ? 'tv' : 'logout', { size: 30 })),
      h('h1', { class: 'title-l' }, title),
      h('p', { role: 'status' }, text),
    ),
    notice === 'replaced'
      ? h('button', { type: 'button', class: 'btn btn--xl btn--white push-bottom', onclick: () => app.retake() }, 'Reprendre ici')
      : null,
    h('button', { type: 'button', class: 'btn btn--xl btn--orange' + (notice === 'replaced' ? '' : ' push-bottom'), onclick: () => app.goHome() }, icon('plus', { size: 22, width: 2.4 }), 'Créer ma propre partie'),
  );
  return { el };
}
