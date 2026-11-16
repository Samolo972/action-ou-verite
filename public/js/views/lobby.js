// Salon d'attente : onglets Joueurs / Paramètres (maquettes « Lobby » et « Parametres »).
import { h, avatar, toast } from '../dom.js';
import { icon } from '../icons.js';
import { MODE_LABEL, openModal, closeModal } from '../components.js';
import { sound } from '../comfort.js';
import { copyText } from './share.js';

const LEVELS = ['SOFT', 'FUN', 'HARD', '+18'];
const CARD_TYPES = [['both', 'Les deux'], ['action', 'Actions'], ['verite', 'Vérités']];
const TIMERS = [[0, 'Aucun'], [30, '30 s'], [60, '60 s'], [120, '2 min']];
const REROLLS = [[0, '0'], [1, '1'], [2, '2'], [3, '3']];
const ORDERS = [['wheel', 'Roue au hasard'], ['fixed', 'Chacun son tour']];
const ENDS = [[0, 'Illimitée'], [10, '10 tours'], [20, '20 tours'], [30, '30 tours']];
const COUNTDOWNS = [[0, 'Aucun'], [3, '3 s'], [5, '5 s']];

/** Résumé lisible des réglages (affiché chez tout le monde). */
export function settingsSummary(s) {
  const type = { both: 'actions et vérités', action: 'actions uniquement', verite: 'vérités uniquement' }[s.cardType];
  const parts = [
    MODE_LABEL[s.mode],
    s.levels.join(', '),
    type,
    s.timer ? `minuteur ${s.timer === 120 ? '2 min' : s.timer + ' s'}` : 'sans minuteur',
    s.rerolls === 0 ? 'aucun changement de carte' : `${s.rerolls} changement${s.rerolls > 1 ? 's' : ''} de carte`,
    s.order === 'wheel' ? 'roue au hasard' : 'chacun son tour',
    s.endTurns ? `${s.endTurns} tours` : 'partie illimitée',
    s.everyone ? 'cartes « Tout le monde »' : 'sans cartes « Tout le monde »',
  ];
  if (s.spinCountdown) parts.push(`compte à rebours ${s.spinCountdown} s`);
  return parts.join(' · ');
}

function soundButton() {
  const on = sound.enabled();
  const btn = h(
    'button',
    { type: 'button', class: 'icon-btn', 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'Son', 'data-fk': 'sound' },
    icon(on ? 'sound' : 'mute'),
  );
  btn.addEventListener('click', () => {
    const now = sound.toggle();
    btn.setAttribute('aria-pressed', now ? 'true' : 'false');
    btn.replaceChildren(icon(now ? 'sound' : 'mute'));
    toast(now ? 'Son activé' : 'Son coupé');
  });
  return btn;
}

export function confirmLeave(app) {
  openModal({
    title: 'Quitter le salon ?',
    text: app.ctx().isHost ? "Le rôle d'hôte passera au joueur suivant." : 'Tu pourras revenir avec le code si le salon est encore ouvert.',
    actions: h(
      'div',
      { class: 'actions-col' },
      h('button', { type: 'button', class: 'btn btn--xl btn--orange', onclick: () => { closeModal(); app.leave(); } }, icon('logout', { width: 2.4 }), 'Quitter'),
      h('button', { type: 'button', class: 'btn btn--m btn--outline', onclick: closeModal }, 'Rester'),
    ),
  });
}

export function lobbyView(app) {
  const el = h('main', { class: 'screen' });

  function chipGroup({ title, hint, key, options, cols, color, value, ctx }) {
    return h(
      'fieldset',
      { class: 'setting' },
      h('legend', { class: 'setting-head' }, h('h2', { class: 'h2' }, title), hint ? h('span', { class: 'hint' }, hint) : null),
      h(
        'div',
        { class: `chips chips--${cols}` },
        options.map(([v, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: `chip${color ? ' chip--' + color : ''}`,
              'aria-pressed': value === v ? 'true' : 'false',
              'data-fk': `${key}-${v}`,
              onclick: () => value !== v && ctx.send('room:settings', { [key]: v }),
            },
            label,
          ),
        ),
      ),
    );
  }

  function switchRow({ label, hint, on, fk, onToggle }) {
    return h(
      'button',
      { type: 'button', class: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'data-fk': fk, onclick: onToggle },
      h('span', { class: 'switch-text' }, h('strong', null, label), h('span', null, hint)),
      h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'knob' })),
    );
  }

  function playersTab(ctx) {
    const { room, isHost, you } = ctx;
    const s = ctx.game.settings;
    return h(
      'div',
      { class: 'settings', role: isHost ? 'tabpanel' : null, id: 'panel-players' },
      h(
        'div',
        { class: 'code-card' },
        h('span', { class: 'label-c' }, 'Invite tes potes avec ce code'),
        h('span', { class: 'code-big', 'aria-label': 'Code du salon : ' + [...room.code].join(' ') }, room.code),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--s btn--secondary',
              'data-fk': 'copy-link',
              onclick: async (e) => {
                const ok = await copyText(room.inviteUrl);
                const b = e.currentTarget;
                b.textContent = ok ? 'Copié !' : 'Copie impossible';
                setTimeout(() => b.isConnected && (b.textContent = 'Copier le lien'), 2000);
              },
            },
            'Copier le lien',
          ),
          h('button', { type: 'button', class: 'btn btn--s btn--secondary', 'data-fk': 'open-qr', onclick: () => app.setUI({ share: true }) }, 'QR code'),
        ),
      ),
      h(
        'section',
        { class: 'field', 'aria-labelledby': 'players-title' },
        h('div', { class: 'list-head' }, h('h2', { class: 'h2', id: 'players-title' }, 'Joueurs'), h('span', null, `${room.players.length} / ${room.maxPlayers}`)),
        h(
          'ul',
          { class: 'player-list' },
          room.players.map((p) =>
            h(
              'li',
              { class: 'player' + (p.connected ? '' : ' is-off') },
              avatar(p),
              h('span', { class: 'player-name' }, p.name, p.id === you.id ? h('span', { class: 'faint' }, ' (toi)') : null),
              !p.connected ? h('span', { class: 'state-tag' }, 'hors ligne') : null,
              p.isHost ? h('span', { class: 'host-tag' }, 'HÔTE') : null,
              isHost && !p.isHost
                ? h(
                    'button',
                    { type: 'button', class: 'kick', 'aria-label': `Exclure ${p.name}`, 'data-fk': 'kick-' + p.id, onclick: () => confirmKick(ctx, p) },
                    icon('close', { size: 18 }),
                  )
                : null,
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'panel panel--14' },
        h('span', { class: 'panel-title--strong' }, 'Réglages actuels'),
        h('span', { class: 'summary' }, settingsSummary(s)),
        room.locked ? h('span', { class: 'summary' }, 'Salon verrouillé : plus personne ne peut entrer.') : null,
        room.screens ? h('span', { class: 'summary' }, `${room.screens} écran${room.screens > 1 ? 's' : ''} connecté${room.screens > 1 ? 's' : ''}`) : null,
      ),
    );
  }

  function confirmKick(ctx, p) {
    openModal({
      title: `Exclure ${p.name} ?`,
      text: 'Ce joueur sera retiré du salon.',
      actions: h(
        'div',
        { class: 'actions-col' },
        h('button', { type: 'button', class: 'btn btn--xl btn--orange', onclick: () => { closeModal(); ctx.send('room:kick', { memberId: p.id }); } }, 'Exclure'),
        h('button', { type: 'button', class: 'btn btn--m btn--outline', onclick: closeModal }, 'Annuler'),
      ),
    });
  }

  function settingsTab(ctx) {
    const s = ctx.game.settings;
    const room = ctx.room;
    const toggleLevel = (l) => {
      const next = s.levels.includes(l) ? s.levels.filter((x) => x !== l) : [...s.levels, l];
      if (next.length === 0) return toast('Garde au moins un niveau.');
      ctx.send('room:settings', { levels: next });
    };
    return h(
      'div',
      { class: 'settings', role: 'tabpanel', id: 'panel-settings' },
      chipGroup({
        ctx,
        title: 'Mode',
        hint: s.mode === 'presentiel' ? 'Tout le monde dans la même pièce : toutes les actions sortent.' : 'En visio : seules les actions visibles à la caméra sortent.',
        key: 'mode',
        options: [['presentiel', 'Présentiel'], ['distance', 'À distance']],
        cols: 2,
        color: 'white',
        value: s.mode,
      }),
      h(
        'fieldset',
        { class: 'setting' },
        h('legend', { class: 'setting-head' }, h('h2', { class: 'h2' }, 'Niveaux'), h('span', { class: 'hint' }, 'Plusieurs choix possibles')),
        h(
          'div',
          { class: 'chips chips--4' },
          LEVELS.map((l) =>
            h(
              'button',
              {
                type: 'button',
                class: `chip chip--${l === '+18' ? 'x18' : l}`,
                'aria-pressed': s.levels.includes(l) ? 'true' : 'false',
                'data-fk': 'level-' + l,
                onclick: () => toggleLevel(l),
              },
              l,
            ),
          ),
        ),
      ),
      chipGroup({ ctx, title: 'Type de cartes', hint: 'Limiter la partie aux actions ou aux vérités', key: 'cardType', options: CARD_TYPES, cols: 3, color: 'orange', value: s.cardType }),
      switchRow({
        label: 'Cartes « Tout le monde »',
        hint: 'Environ 1 tour sur 8, une carte pour tout le groupe',
        on: s.everyone,
        fk: 'everyone',
        onToggle: () => ctx.send('room:settings', { everyone: !s.everyone }),
      }),
      chipGroup({ ctx, title: 'Minuteur des actions', hint: 'Temps pour réaliser une action', key: 'timer', options: TIMERS, cols: 4, value: s.timer }),
      chipGroup({ ctx, title: 'Changements de carte par tour', hint: 'Seule échappatoire : il n’y a pas de bouton passer', key: 'rerolls', options: REROLLS, cols: 4, value: s.rerolls }),
      chipGroup({ ctx, title: 'Ordre de passage', hint: 'Avec la roue, tout le monde passe avant que quelqu’un rejoue', key: 'order', options: ORDERS, cols: 2, value: s.order }),
      chipGroup({ ctx, title: 'Compte à rebours avant la roue', hint: "Quand l'hôte lance la roue", key: 'spinCountdown', options: COUNTDOWNS, cols: 3, value: s.spinCountdown }),
      chipGroup({ ctx, title: 'Fin de partie', hint: 'La partie s’arrête automatiquement après X tours', key: 'endTurns', options: ENDS, cols: 4, value: s.endTurns }),
      h(
        'div',
        { class: 'setting' },
        h('h2', { class: 'h2', id: 'max-title' }, 'Nombre de joueurs max'),
        h(
          'div',
          { class: 'stepper', role: 'group', 'aria-labelledby': 'max-title' },
          h(
            'button',
            {
              type: 'button',
              'aria-label': 'Moins de joueurs',
              'data-fk': 'max-minus',
              disabled: room.maxPlayers <= Math.max(2, room.players.length),
              onclick: () => ctx.send('room:settings', { maxPlayers: room.maxPlayers - 1 }),
            },
            icon('minus', { width: 2.4 }),
          ),
          h('output', { 'aria-live': 'polite' }, String(room.maxPlayers)),
          h(
            'button',
            {
              type: 'button',
              'aria-label': 'Plus de joueurs',
              'data-fk': 'max-plus',
              disabled: room.maxPlayers >= 12,
              onclick: () => ctx.send('room:settings', { maxPlayers: room.maxPlayers + 1 }),
            },
            icon('plus', { width: 2.4 }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'setting' },
        h('h2', { class: 'h2' }, 'Salon'),
        switchRow({ label: 'Verrouiller le salon', hint: 'Plus personne ne peut entrer', on: room.locked, fk: 'lock', onToggle: () => ctx.send('room:lock', { locked: !room.locked }) }),
        switchRow({
          label: 'Rejoindre en cours de partie',
          hint: 'Un retardataire entre au tour suivant',
          on: s.lateJoin,
          fk: 'late',
          onToggle: () => ctx.send('room:settings', { lateJoin: !s.lateJoin }),
        }),
      ),
      h('p', { class: 'note' }, "Seul l'hôte voit cet onglet. Les changements s'appliquent tout de suite."),
    );
  }

  function update(ctx) {
    const { room, isHost } = ctx;
    const tab = isHost ? app.ui.tab || 'players' : 'players';
    const enough = room.players.length >= 2;

    const tabs = isHost
      ? h(
          'div',
          { class: 'tabs', role: 'tablist', 'aria-label': 'Salon' },
          [
            ['players', `Joueurs (${room.players.length})`, 'users'],
            ['settings', 'Paramètres', 'sliders'],
          ].map(([id, label, ic]) =>
            h(
              'button',
              {
                type: 'button',
                class: 'tab',
                role: 'tab',
                id: 'tab-' + id,
                'aria-selected': tab === id ? 'true' : 'false',
                'aria-controls': 'panel-' + id,
                'data-fk': 'tab-' + id,
                onclick: () => app.setUI({ tab: id }),
              },
              icon(ic, { size: 18 }),
              label,
            ),
          ),
        )
      : null;

    let footer;
    if (isHost) {
      const blocked = !enough ? 'Il faut au moins 2 joueurs pour lancer.' : null;
      footer = h(
        'div',
        { class: 'actions-col push-bottom' },
        blocked ? h('p', { class: 'note' }, blocked) : null,
        h(
          'button',
          { type: 'button', class: 'btn btn--xl btn--orange', 'data-fk': 'start', disabled: Boolean(blocked), onclick: () => ctx.send('game:start') },
          'Lancer la partie',
          icon('arrow', { width: 2.4 }),
        ),
      );
    } else {
      footer = h('p', { class: 'waiting push-bottom' }, "En attente du lancement par l'hôte", h('span', { class: 'dots' }));
    }

    el.replaceChildren(
      h(
        'div',
        { class: 'topbar' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitter le salon', 'data-fk': 'leave', onclick: () => confirmLeave(app) }, icon('back')),
        h('div', { class: 'topbar-title' }, h('strong', null, `Salon ${room.code}`), h('span', null, isHost ? "Tu es l'hôte" : 'Tu es joueur')),
        soundButton(),
      ),
      tabs,
      tab === 'settings' ? settingsTab(ctx) : playersTab(ctx),
      footer,
    );
  }

  return { el, update };
}

