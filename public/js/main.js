// Point d'entrée : connexion, état du salon, choix de l'écran à afficher.
import { h, toast } from './dom.js';
import { socket, request } from './net.js';
import { session, screenSession } from './session.js';
import { keepAwake, vibrate, sound } from './comfort.js';
import { closeModal } from './components.js';
import { homeView, tvFormView } from './views/home.js';
import { inviteView, noticeView } from './views/invite.js';
import { lobbyView, ageModal } from './views/lobby.js';
import { shareView } from './views/share.js';
import { wheelView, cardView, everyoneView, endView } from './views/game.js';
import { tvView } from './views/tv.js';

const root = document.getElementById('app');
const banner = document.getElementById('banner');

function parseEntry() {
  const m = location.pathname.match(/^\/j\/([A-Za-z0-9]{6})\/?$/);
  return m ? { kind: 'invite', code: m[1].toUpperCase() } : { kind: 'home' };
}

const entry = parseEntry();
// Lien d'invitation vers un autre salon que celui mémorisé : on part sur une nouvelle arrivée.
if (entry.kind === 'invite') {
  const s = session.get();
  if (s && s.code !== entry.code) session.clear();
  screenSession.clear();
}

const state = {
  room: null, // dernier room:state reçu
  offset: 0, // heure serveur - heure locale
  entry,
  notice: null,
  presetName: null,
  resuming: Boolean(session.get() || screenSession.get()),
  ageModalOpen: false,
  lastTurnAlert: null,
};

let current = { key: null, view: null };
let redrawTimer = null;

// ---------- Contexte passé aux écrans ----------

function ctx() {
  const room = state.room;
  if (!room) return null;
  const byId = new Map(room.players.map((p) => [p.id, p]));
  return {
    room,
    game: room.game,
    you: room.you,
    me: byId.get(room.you.id) || null,
    isHost: room.you.isHost,
    byId,
    offset: state.offset,
    send,
  };
}

async function send(event, payload = {}) {
  const res = await request(event, payload);
  if (!res.ok) toast(res.message || 'Erreur.', { error: true });
  return res;
}

// ---------- Actions ----------

function waitConnected(ms = 6000) {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

const app = {
  ui: { tab: 'players', share: false },
  ctx,

  async createRoom(name) {
    await waitConnected();
    const res = await request('room:create', { name });
    if (res.ok) {
      session.set(res.code, res.token);
      screenSession.clear();
      state.notice = null;
      history.replaceState(null, '', '/');
    }
    return res;
  },

  async joinRoom(code, name, adult) {
    await waitConnected();
    const res = await request('room:join', { code, name, adult: adult === true });
    if (res.ok) {
      session.set(res.code, res.token);
      screenSession.clear();
      state.notice = null;
      history.replaceState(null, '', '/');
    }
    return res;
  },

  async roomInfo(code) {
    await waitConnected();
    return request('room:info', { code });
  },

  async joinScreen(code) {
    await waitConnected();
    const res = await request('screen:join', { code });
    if (res.ok) {
      screenSession.set(code);
      session.clear();
      history.replaceState(null, '', '/');
    }
    return res;
  },

  async leave() {
    closeModal();
    state.ageModalOpen = false;
    if (socket.connected) await request('room:leave');
    session.clear();
    screenSession.clear();
    state.room = null;
    state.entry = { kind: 'home' };
    history.replaceState(null, '', '/');
    app.ui = { tab: 'players', share: false };
    render();
  },

  goHome() {
    state.notice = null;
    state.entry = { kind: 'home' };
    history.replaceState(null, '', '/');
    render();
  },

  openInvite(code, presetName) {
    state.presetName = presetName;
    state.entry = { kind: 'invite', code };
    history.pushState(null, '', `/j/${code}`);
    render();
  },

  openTvForm() {
    state.entry = { kind: 'tv' };
    render();
  },

  retake() {
    state.notice = null;
    state.resuming = true;
    render();
    resume();
  },

  setUI(patch) {
    const shareChanged = 'share' in patch && patch.share !== app.ui.share;
    Object.assign(app.ui, patch);
    render();
    if (shareChanged || 'tab' in patch) window.scrollTo(0, 0);
  },

  tick() {
    sound.tick();
  },

  /** Redessine l'écran dans `ms` (compte à rebours). */
  redrawIn(ms) {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(render, ms);
  },
};

// ---------- Rendu ----------

function loadingView() {
  return {
    el: h(
      'main',
      { class: 'screen screen--invite' },
      h('div', { class: 'message-box' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { role: 'status' }, 'Connexion à la partie…')),
    ),
  };
}

function pickView() {
  const room = state.room;
  if (room) {
    if (room.you.isScreen) return ['tv', () => tvView(app)];
    const phase = room.game.phase;
    if (phase === 'lobby') return app.ui.share ? ['share', () => shareView(app)] : ['lobby', () => lobbyView(app)];
    if (['ready', 'countdown', 'spinning', 'choosing'].includes(phase)) return ['wheel', () => wheelView(app)];
    if (phase === 'card') return ['card', () => cardView(app)];
    if (phase === 'everyone') return ['everyone', () => everyoneView(app)];
    return ['end', () => endView(app)];
  }
  if (state.resuming) return ['loading', loadingView];
  if (state.notice) return ['notice:' + state.notice, () => noticeView(app, state.notice)];
  if (state.entry.kind === 'invite') return ['invite:' + state.entry.code, () => inviteView(app, state.entry.code, state.presetName)];
  if (state.entry.kind === 'tv') return ['tvform', () => tvFormView(app)];
  return ['home', () => homeView(app)];
}

function render() {
  const [key, factory] = pickView();
  const focusKey = document.activeElement?.dataset?.fk;
  if (key !== current.key) {
    current.view?.destroy?.();
    const view = factory();
    current = { key, view };
    root.replaceChildren(view.el);
    document.body.classList.toggle('is-tv', key === 'tv');
    if (!key.startsWith('lobby') && !key.startsWith('share')) window.scrollTo(0, 0);
  }
  const c = ctx();
  if (c && current.view.update) current.view.update(c);

  // Garde le focus clavier sur le même bouton après un nouveau rendu.
  if (focusKey && document.activeElement === document.body) {
    root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
  afterRender(c);
}

function afterRender(c) {
  // Écran toujours allumé pendant la partie.
  keepAwake(Boolean(c && c.room.phase === 'playing'));

  // Confirmation 18+ demandée quand l'hôte active le niveau +18 avec des joueurs déjà présents.
  const needAge = Boolean(c && !c.you.isScreen && c.game.phase === 'lobby' && c.game.settings.levels.includes('+18') && !c.game.youAdult);
  if (needAge && !state.ageModalOpen) {
    state.ageModalOpen = true;
    ageModal(app);
  } else if (!needAge && state.ageModalOpen) {
    state.ageModalOpen = false;
    closeModal();
  }

  // C'est ton tour : vibration + son, une seule fois par tour.
  if (c && !c.you.isScreen && c.game.current && c.game.current.playerId === c.you.id && ['choosing', 'card'].includes(c.game.phase)) {
    const k = c.game.turn + ':' + c.game.playerTurns;
    if (state.lastTurnAlert !== k) {
      state.lastTurnAlert = k;
      vibrate([120, 60, 120]);
      sound.turn();
    }
  }
}

// ---------- Connexion ----------

async function resume() {
  const s = session.get();
  const scr = screenSession.get();
  if (s) {
    const res = await request('room:resume', { code: s.code, token: s.token });
    if (!res.ok) {
      session.clear();
      const hadRoom = Boolean(state.room);
      state.room = null;
      state.resuming = false;
      if (hadRoom || res.error === 'SESSION_EXPIRED') state.notice = state.entry.kind === 'invite' ? null : 'lost';
      render();
    }
  } else if (scr) {
    const res = await request('screen:join', { code: scr.code });
    if (!res.ok) {
      screenSession.clear();
      state.room = null;
      state.resuming = false;
      state.notice = 'lost';
      render();
    }
  } else if (state.resuming) {
    state.resuming = false;
    render();
  }
}

function showBanner(on) {
  banner.hidden = !on;
}

socket.on('connect', () => {
  showBanner(false);
  if (session.get() || screenSession.get()) resume();
});

socket.on('disconnect', () => {
  if (state.room || session.get()) showBanner(true);
});

socket.on('connect_error', () => {
  if (state.room || session.get() || state.resuming) showBanner(true);
});

socket.on('room:state', (data) => {
  state.room = data;
  state.resuming = false;
  state.notice = null;
  state.offset = data.game.serverNow - Date.now();
  render();
});

socket.on('room:kicked', () => {
  session.clear();
  state.room = null;
  state.notice = 'kicked';
  closeModal();
  state.ageModalOpen = false;
  history.replaceState(null, '', '/');
  render();
});

socket.on('room:closed', ({ reason } = {}) => {
  session.clear();
  screenSession.clear();
  state.room = null;
  state.notice = reason === 'expired' ? 'expired' : 'empty';
  closeModal();
  state.ageModalOpen = false;
  render();
});

socket.on('room:replaced', () => {
  state.room = null;
  state.notice = 'replaced';
  closeModal();
  state.ageModalOpen = false;
  render();
});

socket.on('game:timerEnd', () => {
  sound.alarm();
  vibrate([250, 100, 250, 100, 250]);
  render();
});

window.addEventListener('popstate', () => {
  if (state.room) return;
  state.entry = parseEntry();
  render();
});

// Service worker (PWA) : uniquement les fichiers statiques.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

render();
