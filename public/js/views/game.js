// Écrans de partie : roue + choix, carte du joueur désigné, carte vue par les autres,
// carte « Tout le monde », fin de partie.
import { h, avatar, setChildren } from '../dom.js';
import { icon } from '../icons.js';
import { createWheel, createTimer, createCard, levelBadges, whoBlock, PLACE_LABEL, MODE_LABEL } from '../components.js';
import { confirmLeave } from './lobby.js';

const turnLabel = (g) => `Tour ${['ready', 'countdown'].includes(g.phase) ? g.turn + 1 : Math.max(1, g.turn)}`;

function forceButton(ctx) {
  return h(
    'button',
    { type: 'button', class: 'btn btn--m btn--host', 'data-fk': 'force', onclick: () => ctx.send('game:forceNext') },
    icon('skip', { size: 18 }),
    'Forcer le tour suivant ',
    h('span', { class: 'tag' }, '· HÔTE'),
  );
}

function hostEndLink(ctx) {
  return h('button', { type: 'button', class: 'link-btn', 'data-fk': 'end', onclick: () => ctx.send('game:end') }, 'Terminer la partie');
}

function quitLink(app) {
  return h('button', { type: 'button', class: 'link-btn', 'data-fk': 'quit', onclick: () => confirmLeave(app) }, 'Quitter la partie');
}

// ---------- Roue ----------

export function wheelView(app) {
  const wheel = createWheel();
  const turnPill = h('span', { class: 'pill' });
  const badges = h('div', { class: 'badges-holder' });
  const order = h('ul', { class: 'order-row', 'aria-label': 'Ordre de passage' });
  const orderNote = h('p', { class: 'note order-note' }, 'Les joueurs grisés sont déjà passés ce tour-ci');
  const bottom = h('div', { class: 'choose' });
  const el = h('main', { class: 'screen screen--wheel' }, h('div', { class: 'topbar w-100' }, turnPill, badges), wheel.el, order, orderNote, bottom);
  let bottomKey = '';
  let lastCount = null;

  function update(ctx) {
    const g = ctx.game;
    const byId = ctx.byId;
    turnPill.textContent = turnLabel(g);
    setChildren(badges, levelBadges(g.settings.levels));

    const segments = g.spin ? g.spin.segments : g.participants;
    const res = wheel.update({ segments, byId, spin: g.phase === 'spinning' || g.phase === 'choosing' ? g.spin : null, offset: ctx.offset });
    const current = g.current ? byId.get(g.current.playerId) : null;

    // Centre de la roue
    if (g.phase === 'ready') wheel.setCenter('Prochain tour', '?');
    else if (g.phase === 'countdown') {
      const left = Math.max(1, Math.ceil((g.countdown.endsAt - (Date.now() + ctx.offset)) / 1000));
      wheel.setCenter('La roue tourne dans', String(left), 'is-count');
      if (left !== lastCount) {
        lastCount = left;
        app.tick();
      }
      app.redrawIn(250);
    } else if (g.phase === 'spinning' && !res.landed) {
      wheel.setCenter("C'est à…", '?');
      wheel.onLanded(res.remaining, () => current && wheel.setCenter("C'est à", current.name));
    } else if (current) wheel.setCenter("C'est à", current.name);

    // Rangée des joueurs
    const passed = new Set(g.passed);
    setChildren(
      order,
      g.participants.map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        const isCur = g.current && g.current.playerId === id && g.phase !== 'ready';
        const cls = isCur ? 'is-current' : passed.has(id) ? 'is-passed' : '';
        const li = h('li', null, avatar(p, cls));
        li.title = p.name;
        return li;
      }),
    );

    // Bas de l'écran
    const mine = current && current.id === ctx.you.id;
    const key = [g.phase, mine, ctx.isHost, current && current.id, g.settings.cardType].join('|');
    if (key === bottomKey) return;
    bottomKey = key;
    const parts = [];
    if (g.phase === 'ready') {
      if (ctx.isHost) {
        parts.push(
          h('button', { type: 'button', class: 'btn btn--xl btn--orange', 'data-fk': 'spin', onclick: () => ctx.send('game:spin') }, 'Lancer la roue', icon('arrow', { width: 2.4 })),
          h('div', { class: 'row-center' }, hostEndLink(ctx), quitLink(app)),
        );
      } else {
        parts.push(h('p', { class: 'waiting' }, "En attente de l'hôte", h('span', { class: 'dots' })), h('div', { class: 'row-center' }, quitLink(app)));
      }
    } else if (g.phase === 'countdown') {
      parts.push(h('p', { class: 'waiting' }, 'Préparez-vous…'));
    } else if (g.phase === 'spinning') {
      parts.push(h('p', { class: 'waiting' }, 'La roue tourne', h('span', { class: 'dots' })));
    } else if (g.phase === 'choosing') {
      if (mine) {
        parts.push(
          h('p', { class: 'choose-q' }, `${current.name}, tu choisis quoi ?`),
          h(
            'div',
            { class: 'choose-grid' },
            h('button', { type: 'button', class: 'choice choice--action', 'data-fk': 'action', onclick: () => ctx.send('game:choose', { type: 'action' }) }, icon('bolt', { size: 30, width: 2.2 }), 'ACTION'),
            h('button', { type: 'button', class: 'choice choice--verite', 'data-fk': 'verite', onclick: () => ctx.send('game:choose', { type: 'verite' }) }, icon('bubbleQ', { size: 30, width: 2.2 }), 'VÉRITÉ'),
          ),
          h('p', { class: 'note' }, `Les autres voient « ${current.name} est en train de choisir… »`),
        );
      } else {
        parts.push(h('p', { class: 'waiting', 'aria-live': 'polite' }, `${current ? current.name : 'Le joueur'} est en train de choisir`, h('span', { class: 'dots' })));
        if (ctx.isHost) parts.push(forceButton(ctx));
      }
    }
    setChildren(bottom, parts);
  }
  return { el, update, destroy: wheel.destroy };
}

// ---------- Carte (joueur désigné et spectateurs) ----------

export function cardView(app) {
  const header = h('div', { class: 'topbar' });
  const card = createCard();
  const actions = h('div', { class: 'actions-col' });
  const timer = createTimer();
  const el = h('main', { class: 'screen screen--card' }, header, card.el, actions);
  let headKey = '';
  let actKey = '';

  function update(ctx) {
    const g = ctx.game;
    const c = g.current;
    const player = ctx.byId.get(c.playerId);
    const name = player ? player.name : 'Le joueur';
    const mine = c.playerId === ctx.you.id;
    const isAction = c.type === 'action';

    // En-tête
    const hk = [mine, c.playerId, c.type, g.turn, Boolean(c.timer)].join('|');
    if (hk !== headKey) {
      headKey = hk;
      const right = c.timer ? timer.el : mine ? h('span') : h('span', { class: 'pill pill--s' }, isAction ? 'Action' : 'Vérité');
      setChildren(
        header,
        mine
          ? whoBlock(player, `À toi, ${name}`, turnLabel(g))
          : whoBlock(player, isAction ? `${name} relève le défi…` : `${name} répond…`, `${turnLabel(g)} · tu regardes`),
        right,
      );
    }
    timer.update(c.timer, ctx.offset);

    // Carte
    const footer = mine
      ? { nodes: [icon('users', { size: 14 }), PLACE_LABEL[c.card.place]] }
      : { wait: true, nodes: [h('span', { class: 'dot-live', 'aria-hidden': 'true' }), isAction ? `${name} est en train de faire l'action` : `En attente de la réponse de ${name}`] };
    card.update(c.card, footer);

    // Boutons
    const ak = [mine, c.rerollsLeft, c.rerollsMax, ctx.isHost, c.playerId].join('|');
    if (ak === actKey) return;
    actKey = ak;
    if (mine) {
      setChildren(
        actions,
        h('button', { type: 'button', class: 'btn btn--xl btn--white', 'data-fk': 'done', onclick: () => ctx.send('game:done') }, icon('check', { width: 2.6 }), "C'est fait, tour suivant"),
        c.rerollsMax > 0
          ? h(
              'button',
              { type: 'button', class: 'btn btn--m btn--outline', 'data-fk': 'reroll', disabled: c.rerollsLeft <= 0, onclick: () => ctx.send('game:reroll') },
              icon('reroll', { size: 18 }),
              'Changer de carte ',
              h('span', { class: 'dim' }, `(${c.rerollsLeft} restant${c.rerollsLeft > 1 ? 's' : ''})`),
            )
          : null,
      );
    } else {
      setChildren(
        actions,
        h('div', { class: 'info-row' }, icon('info', { size: 18 }), h('span', null, `Seul ${name} peut valider ou changer la carte.`)),
        ctx.isHost ? forceButton(ctx) : null,
      );
    }
  }

  return { el, update, destroy: timer.destroy };
}

// ---------- Carte « Tout le monde » ----------

export function everyoneView(app) {
  const header = h('div', { class: 'topbar' });
  const card = createCard();
  const actions = h('div', { class: 'actions-col' });
  const el = h('main', { class: 'screen screen--card' }, header, card.el, actions);
  let key = '';

  function update(ctx) {
    const g = ctx.game;
    setChildren(
      header,
      h('div', { class: 'who-text' }, h('strong', null, 'Carte surprise !'), h('span', null, `${turnLabel(g)} · pour tout le groupe`)),
      h('div', { class: 'stack', 'aria-hidden': 'true' }, ctx.room.players.slice(0, 6).map((p) => avatar(p))),
    );
    card.update(g.everyone, { nodes: ['Environ 1 carte sur 8 est pour tout le groupe'] });
    const k = String(ctx.isHost);
    if (k === key) return;
    key = k;
    setChildren(
      actions,
      ctx.isHost
        ? h('button', { type: 'button', class: 'btn btn--xl btn--white', 'data-fk': 'next', onclick: () => ctx.send('game:done') }, 'Tour suivant', icon('arrow', { width: 2.4 }))
        : null,
      h('p', { class: 'note' }, "Seul l'hôte peut passer au tour suivant"),
    );
  }
  return { el, update };
}

// ---------- Fin de partie ----------

export function endView(app) {
  const el = h('main', { class: 'screen' });
  function update(ctx) {
    const g = ctx.game;
    const s = g.settings;
    el.replaceChildren(
      h(
        'div',
        { class: 'end-hero' },
        h('div', { class: 'brand-cards', 'aria-hidden': 'true' }, h('div', { class: 'brand-card brand-card--a' }, 'A'), h('div', { class: 'brand-card brand-card--v' }, 'V')),
        h('h1', { class: 'title-l' }, 'Partie terminée !'),
        h('p', { class: 'tagline' }, 'Merci d’avoir joué. Ce qui se dit ici reste ici.'),
      ),
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('strong', null, String(g.playerTurns)), h('span', null, g.playerTurns > 1 ? 'tours joués' : 'tour joué')),
        h('div', { class: 'stat' }, h('strong', null, String(ctx.room.players.length)), h('span', null, 'joueurs')),
      ),
      h(
        'div',
        { class: 'panel panel--14' },
        h('span', { class: 'panel-title--strong' }, 'Au programme de cette partie'),
        h('span', { class: 'summary' }, `${MODE_LABEL[s.mode]} · ${s.levels.join(', ')}`),
      ),
      h('ul', { class: 'player-list' }, ctx.room.players.map((p) => h('li', { class: 'player' + (p.connected ? '' : ' is-off') }, avatar(p), h('span', { class: 'player-name' }, p.name), p.isHost ? h('span', { class: 'host-tag' }, 'HÔTE') : null))),
      ctx.isHost
        ? h(
            'div',
            { class: 'actions-col push-bottom' },
            h('button', { type: 'button', class: 'btn btn--xl btn--orange', 'data-fk': 'replay', onclick: () => ctx.send('game:restart') }, icon('replay', { width: 2.4 }), 'Rejouer avec les mêmes joueurs'),
            h('button', { type: 'button', class: 'btn btn--m btn--outline', 'data-fk': 'to-lobby', onclick: () => ctx.send('game:restart', { lobby: true }) }, 'Retour au salon (changer les réglages)'),
            h('div', { class: 'row-center' }, quitLink(app)),
          )
        : h('div', { class: 'actions-col push-bottom' }, h('p', { class: 'waiting' }, "L'hôte peut relancer une partie", h('span', { class: 'dots' })), h('div', { class: 'row-center' }, quitLink(app))),
    );
  }
  return { el, update };
}
