// Mode grand écran (maquette « GrandEcran ») : mise en page 16:9 mise à l'échelle de la fenêtre.
import { h, avatar, setChildren } from '../dom.js';
import { icon } from '../icons.js';
import { createWheel, createTimer, createCard, MODE_LABEL, TYPE_LABEL } from '../components.js';
import { qrBlock } from './share.js';

export function tvView(app) {
  const stage = h('div', { class: 'tv-stage' });
  const fsBtn = h('button', { type: 'button', class: 'icon-btn tv-fs', 'aria-label': 'Plein écran', onclick: toggleFullscreen }, icon('fullscreen'));
  const el = h('main', { class: 'tv' }, stage, fsBtn);

  const wheel = createWheel();
  const timer = createTimer({ tv: true });
  const card = createCard({ tv: true });
  let layoutKey = '';
  let qrFor = null;
  let qrNode = null;

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  fsBtn.hidden = !document.documentElement.requestFullscreen;

  function fit() {
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fit);
  setTimeout(fit, 0);

  // Colonne de droite (joueurs + code)
  const playersList = h('ul');
  const joinCode = h('strong');
  const joinBox = h('div', { class: 'tv-join' }, h('span'), joinCode);
  const timerBox = h('div', { class: 'tv-box' }, timer.el, h('span', { class: 'muted' }, 'Temps restant'));
  const side = h('div', { class: 'tv-side' }, timerBox, h('div', { class: 'tv-players' }, h('span', null, 'Joueurs'), playersList), joinBox);
  const main = h('div', { class: 'tv-main' });

  function renderPlayers(ctx) {
    const g = ctx.game;
    const passed = new Set(g.passed);
    const playing = g.phase !== 'lobby';
    setChildren(
      playersList,
      ctx.room.players.map((p) => {
        const isCur = playing && g.current && g.current.playerId === p.id && g.phase !== 'ready';
        const cls = ['tv-player', isCur ? 'is-current' : playing && passed.has(p.id) ? 'is-passed' : '', p.connected ? '' : 'is-off'].join(' ');
        return h('li', { class: cls }, avatar(p), h('span', null, p.name));
      }),
    );
  }

  function headBlock(player, title, sub) {
    return h(
      'div',
      { class: 'tv-head' },
      player ? avatar(player) : h('span', { class: 'avatar c1', 'aria-hidden': 'true' }, icon('users', { size: 30, stroke: '#0F0E17', width: 2.2 })),
      h('div', { class: 'tv-head-text' }, h('strong', null, title), h('span', null, sub)),
    );
  }

  function update(ctx) {
    const { room, game: g } = ctx;
    const host = room.players.find((p) => p.isHost);
    const shortUrl = room.inviteUrl.replace(/^https?:\/\//, '').replace(/\/j\/.*/, '');
    joinBox.firstChild.textContent = `Rejoindre : ${shortUrl}`;
    joinCode.textContent = room.code;
    renderPlayers(ctx);

    const phase = g.phase;
    const kind = phase === 'lobby' ? 'lobby' : ['ready', 'countdown', 'spinning', 'choosing'].includes(phase) ? 'wheel' : phase;
    if (kind !== layoutKey) {
      layoutKey = kind;
      stage.replaceChildren(h('div', { class: 'glow', 'aria-hidden': 'true' }));
      if (kind === 'lobby') {
        stage.append(main, side);
      } else if (kind === 'ended') {
        stage.append(main, side);
      } else {
        stage.append(main, side);
      }
    }
    timerBox.hidden = !(phase === 'card' && g.current && g.current.timer);
    joinBox.hidden = kind === 'lobby';

    const turn = `Tour ${['ready', 'countdown'].includes(phase) ? g.turn + 1 : Math.max(1, g.turn)}`;
    const current = g.current ? ctx.byId.get(g.current.playerId) : null;

    if (kind === 'lobby') {
      if (qrFor !== room.inviteUrl) {
        qrFor = room.inviteUrl;
        qrNode = qrBlock(room.inviteUrl, { size: 320, caption: null, label: `QR code pour rejoindre le salon ${room.code}` });
      }
      setChildren(
        main,
        h(
          'div',
          { class: 'tv-lobby' },
          qrNode,
          h(
            'div',
            { class: 'tv-lobby-text' },
            h('p', { class: 'kicker' }, host ? `${host.name} lance un Action ou Vérité` : 'Action ou Vérité'),
            h('p', { class: 'kicker' }, 'Scanne le QR code ou va sur'),
            h('p', { class: 'url' }, room.inviteUrl.replace(/^https?:\/\//, '')),
            h('span', { class: 'code-huge' }, room.code),
            h('p', { class: 'kicker' }, `${MODE_LABEL[g.settings.mode]} · ${g.settings.levels.join(', ')} · ${room.players.length} joueur${room.players.length > 1 ? 's' : ''}`),
          ),
        ),
      );
    } else if (kind === 'wheel') {
      let title = 'Qui va jouer ?';
      if (phase === 'countdown') title = 'La roue va tourner…';
      if (phase === 'spinning') title = 'La roue tourne…';
      if (phase === 'choosing' && current) title = `${current.name} choisit…`;
      if (!main.querySelector('.wheel-zone')) {
        setChildren(main, h('div'), h('div', { class: 'tv-center' }, wheel.el));
      }
      main.firstChild.replaceWith(headBlock(phase === 'choosing' ? current : null, title, `${turn} · ${MODE_LABEL[g.settings.mode]}`));
      const segments = g.spin ? g.spin.segments : g.participants;
      const res = wheel.update({ segments, byId: ctx.byId, spin: phase === 'spinning' || phase === 'choosing' ? g.spin : null, offset: ctx.offset });
      if (phase === 'ready') wheel.setCenter('Prochain tour', '?');
      else if (phase === 'countdown') {
        const left = Math.max(1, Math.ceil((g.countdown.endsAt - (Date.now() + ctx.offset)) / 1000));
        wheel.setCenter('La roue tourne dans', String(left), 'is-count');
        app.redrawIn(250);
      } else if (phase === 'spinning' && !res.landed) {
        wheel.setCenter("C'est à…", '?');
        wheel.onLanded(res.remaining, () => current && wheel.setCenter("C'est à", current.name));
      } else if (current) wheel.setCenter("C'est à", current.name);
    } else if (kind === 'card') {
      const c = g.current;
      if (!main.contains(card.el)) setChildren(main, h('div'), card.el);
      main.firstChild.replaceWith(headBlock(current, `${current ? current.name : 'Le joueur'} a choisi ${c.type === 'action' ? 'Action' : 'Vérité'}`, `${turn} · ${MODE_LABEL[g.settings.mode]}`));
      card.update(c.card, null);
      timer.update(c.timer, ctx.offset);
    } else if (kind === 'everyone') {
      if (!main.contains(card.el)) setChildren(main, h('div'), card.el);
      main.firstChild.replaceWith(headBlock(null, 'Carte surprise : ' + TYPE_LABEL.tous.toLowerCase() + ' !', `${turn} · pour tout le groupe`));
      card.update(g.everyone, null);
    } else if (kind === 'ended') {
      setChildren(
        main,
        h(
          'div',
          { class: 'tv-center' },
          h('div', { class: 'brand-cards', 'aria-hidden': 'true' }, h('div', { class: 'brand-card brand-card--a' }, 'A'), h('div', { class: 'brand-card brand-card--v' }, 'V')),
          h('p', { class: 'tv-big-msg' }, 'Partie terminée !'),
          h('p', { class: 'kicker muted' }, `${g.playerTurns} tour${g.playerTurns > 1 ? 's' : ''} joué${g.playerTurns > 1 ? 's' : ''} · ${room.players.length} joueurs`),
        ),
      );
    }
    if (kind !== 'card') timer.update(null, ctx.offset);
  }

  return {
    el,
    update,
    destroy() {
      window.removeEventListener('resize', fit);
      wheel.destroy();
      timer.destroy();
    },
  };
}
