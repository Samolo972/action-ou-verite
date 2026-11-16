'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LobbyManager } = require('../server/lobby/LobbyManager');
const { createGame } = require('../server/game');
const { pool, draw, placeAllowed, checkCards } = require('../server/game/deck');
const { validateSettings, LEVELS } = require('../server/game/settings');

// ---------- Outils de test ----------

/** Jeu de cartes synthétique : n cartes par type × niveau × place. */
function makeCards(n = 5) {
  const cards = [];
  for (const type of ['action', 'verite', 'tous'])
    for (const level of LEVELS)
      for (const place of ['both', 'presentiel', 'distance'])
        for (let i = 0; i < n; i++) {
          const id = `${type}-${level.replace('+', 'x')}-${place}-${i}`.toLowerCase();
          cards.push({ id, type, level, place, text: `Carte de test numéro ${id}` });
        }
  return cards;
}

/** Ordonnanceur manuel : les minuteurs ne partent que quand on appelle flush(). */
function fakeScheduler() {
  const tasks = new Map();
  let seq = 0;
  return {
    set(fn, ms) {
      const id = ++seq;
      tasks.set(id, { fn, ms });
      return id;
    },
    clear(id) {
      tasks.delete(id);
    },
    flush() {
      const list = [...tasks.entries()];
      tasks.clear();
      for (const [, t] of list) t.fn();
    },
    get size() {
      return tasks.size;
    },
  };
}

/** Salon prêt avec n joueurs connectés. */
function setup({ players = 3, cards = makeCards(), rng = Math.random, everyoneChance = 0, settings = {} } = {}) {
  const scheduler = fakeScheduler();
  const game = createGame({ cards, rng, scheduler, everyoneChance, spinMs: 10 });
  const emitted = [];
  game.attach({ broadcast() {}, emit: (room, ev, data) => emitted.push([ev, data]), touch() {} });
  const lobby = new LobbyManager({ hooks: game.hooks });
  const names = ['Samuel', 'Inès', 'Yanis', 'Léa', 'Mehdi', 'Nora', 'Tom', 'Zoé'];
  const { room, member: host } = lobby.createRoom(names[0], {});
  const members = [host];
  for (let i = 1; i < players; i++) members.push(lobby.joinRoom(room, names[i], {}).member);
  members.forEach((m) => lobby.setConnected(room, m, 's-' + m.id));
  if (Object.keys(settings).length) {
    assert.equal(game.validateSettings(room, settings), null);
    game.applySettings(room, settings);
  }
  const ctx = (m) => ({ room, member: m, isHost: room.hostId === m.id, isScreen: false });
  const send = (event, m, payload = {}) => {
    const spec = game.events[event];
    if (spec.role === 'host' && room.hostId !== m.id) return 'NOT_HOST';
    return spec.handler(ctx(m), payload);
  };
  const byId = (id) => members.find((m) => m.id === id);
  return { game, lobby, room, host, members, scheduler, send, byId, emitted };
}

/** Lance la roue et attend la fin de l'animation. Renvoie le joueur désigné (ou null si carte Tout le monde). */
function spin(t) {
  assert.equal(t.send('game:spin', t.host), null);
  if (t.room.game.phase === 'everyone') return null;
  assert.equal(t.room.game.phase, 'spinning');
  t.scheduler.flush();
  return t.byId(t.room.game.current.playerId);
}

/** Joue un tour complet (Action) et le termine. */
function playTurn(t, type = 'action') {
  const p = spin(t);
  if (!p) {
    assert.equal(t.send('game:done', t.host), null);
    return null;
  }
  if (t.room.game.phase === 'choosing') assert.equal(t.send('game:choose', p, { type }), null);
  assert.equal(t.room.game.phase, 'card');
  assert.equal(t.send('game:done', p), null);
  return p;
}

// ---------- Réglages ----------

test('réglages : seules les valeurs autorisées passent', () => {
  assert.equal(validateSettings({ mode: 'distance' }), null);
  assert.equal(validateSettings({ levels: ['HARD', '+18'] }), null);
  assert.equal(validateSettings({ timer: 120, rerolls: 3, endTurns: 30, spinCountdown: 5 }), null);
  assert.equal(validateSettings({ levels: [] }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ levels: ['SOFT', 'SOFT'] }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ levels: ['EXTREME'] }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ timer: 45 }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ rerolls: 4 }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ rerolls: '1' }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ everyone: 'oui' }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ __proto__: 1, mode: 'distance', hack: true }), 'INVALID_SETTINGS');
  assert.equal(validateSettings({ endTurns: 15 }), 'INVALID_SETTINGS');
});

// ---------- Tirage et filtrage ----------

test('filtrage : niveau, type et mode respectés', () => {
  const cards = makeCards(3);
  const p = pool(cards, 'action', { levels: ['FUN', 'HARD'], mode: 'distance' });
  assert.ok(p.length > 0);
  for (const c of p) {
    assert.equal(c.type, 'action');
    assert.ok(['FUN', 'HARD'].includes(c.level));
    assert.notEqual(c.place, 'presentiel');
  }
  const pres = pool(cards, 'verite', { levels: ['SOFT'], mode: 'presentiel' });
  for (const c of pres) assert.notEqual(c.place, 'distance');
  assert.equal(placeAllowed('presentiel', 'distance'), false);
  assert.equal(placeAllowed('both', 'distance'), true);
});

test("aucune carte « présentiel » en mode à distance sur 500 tours", () => {
  const t = setup({ players: 4, everyoneChance: 0.3, settings: { mode: 'distance', levels: ['SOFT', 'FUN', 'HARD', '+18'] } });
  assert.equal(t.send('game:start', t.host), null);
  for (let i = 0; i < 500; i++) {
    const p = spin(t);
    const g = t.room.game;
    if (!p) {
      assert.notEqual(g.everyone.place, 'presentiel');
      t.send('game:done', t.host);
      continue;
    }
    t.send('game:choose', p, { type: i % 2 ? 'action' : 'verite' });
    assert.notEqual(g.current.card.place, 'presentiel');
    t.send('game:done', p);
  }
});

test('niveaux et type non sélectionnés ne sortent jamais', () => {
  const t = setup({ players: 3, everyoneChance: 0.3, settings: { levels: ['HARD'], cardType: 'verite' } });
  assert.equal(t.send('game:start', t.host), null);
  for (let i = 0; i < 300; i++) {
    const p = spin(t);
    const g = t.room.game;
    if (!p) {
      assert.equal(g.everyone.level, 'HARD');
      t.send('game:done', t.host);
      continue;
    }
    // Vérités uniquement : le choix est sauté.
    assert.equal(g.phase, 'card');
    assert.equal(g.current.card.type, 'verite');
    assert.equal(g.current.card.level, 'HARD');
    assert.equal(t.send('game:choose', p, { type: 'action' }), 'BAD_PHASE');
    t.send('game:done', p);
  }
});

test('« Actions uniquement » : choisir Vérité est refusé', () => {
  const t = setup({ settings: { cardType: 'action' } });
  t.send('game:start', t.host);
  const p = spin(t);
  assert.equal(t.room.game.phase, 'card');
  assert.equal(t.room.game.current.card.type, 'action');
  assert.ok(p);
});

test('une carte déjà tirée ne revient pas tant qu’il en reste', () => {
  const cards = makeCards(4);
  const settings = { levels: ['SOFT'], mode: 'presentiel' };
  const candidates = pool(cards, 'action', settings);
  const drawn = new Set();
  const seen = new Set();
  for (let i = 0; i < candidates.length; i++) {
    const c = draw(candidates, drawn, Math.random);
    assert.ok(!seen.has(c.id), 'carte répétée avant épuisement du paquet');
    seen.add(c.id);
  }
  assert.equal(seen.size, candidates.length);
  // Paquet épuisé : on recycle plutôt que de bloquer.
  assert.ok(draw(candidates, drawn, Math.random));
});

test('le changement de carte ne redonne jamais la même carte', () => {
  const cards = makeCards(1);
  const candidates = pool(cards, 'action', { levels: ['SOFT'], mode: 'presentiel' }); // 2 cartes
  const drawn = new Set();
  const first = draw(candidates, drawn, Math.random);
  for (let i = 0; i < 20; i++) {
    const next = draw(candidates, drawn, Math.random, first.id);
    assert.notEqual(next.id, first.id);
  }
});

// ---------- Rotation ----------

test('roue au hasard : tout le monde passe avant qu’un joueur rejoue', () => {
  const t = setup({ players: 5 });
  t.send('game:start', t.host);
  for (let round = 0; round < 20; round++) {
    const seen = new Set();
    for (let i = 0; i < 5; i++) seen.add(playTurn(t).id);
    assert.equal(seen.size, 5, `manche ${round} : quelqu'un a rejoué trop tôt`);
  }
});

test('roue : jamais deux fois de suite le même joueur, même entre deux manches', () => {
  const t = setup({ players: 3 });
  t.send('game:start', t.host);
  let last = null;
  for (let i = 0; i < 90; i++) {
    const p = playTurn(t);
    assert.notEqual(p.id, last);
    last = p.id;
  }
});

test('chacun son tour : ordre fixe d’arrivée', () => {
  const t = setup({ players: 4, settings: { order: 'fixed' } });
  t.send('game:start', t.host);
  const order = [];
  for (let i = 0; i < 8; i++) order.push(playTurn(t).name);
  assert.deepEqual(order, ['Samuel', 'Inès', 'Yanis', 'Léa', 'Samuel', 'Inès', 'Yanis', 'Léa']);
});

test('un joueur déconnecté est sauté, puis rejoue à son retour', () => {
  const t = setup({ players: 3, settings: { order: 'fixed' } });
  t.send('game:start', t.host);
  const ines = t.members[1];
  t.lobby.setDisconnected(t.room, ines);
  assert.equal(playTurn(t).name, 'Samuel');
  assert.equal(playTurn(t).name, 'Yanis');
  t.lobby.setConnected(t.room, ines, 'back');
  // De retour, elle passe avant la fin de la manche.
  assert.equal(playTurn(t).name, 'Inès');
  assert.equal(playTurn(t).name, 'Samuel');
});

test('retardataire : entre dans la rotation au tour suivant', () => {
  const t = setup({ players: 2, settings: { order: 'fixed' } });
  t.send('game:start', t.host);
  spin(t); // tour en cours de Samuel
  const late = t.lobby.joinRoom(t.room, 'Zoé', {}).member;
  t.lobby.setConnected(t.room, late, 's-late');
  t.members.push(late);
  assert.ok(t.room.game.pending.includes(late.id));
  assert.ok(!t.room.game.participants.includes(late.id));
  const p = t.byId(t.room.game.current.playerId);
  t.send('game:choose', p, { type: 'verite' });
  t.send('game:done', p);
  const names = [playTurn(t).name, playTurn(t).name];
  assert.deepEqual(names, ['Inès', 'Zoé']);
});

test('rejoindre en cours de partie désactivé : arrivée refusée', () => {
  const t = setup({ players: 2, settings: { lateJoin: false } });
  t.send('game:start', t.host);
  assert.equal(t.lobby.joinRoom(t.room, 'Zoé', {}).error, 'GAME_IN_PROGRESS');
});

// ---------- Cartes « Tout le monde » ----------

test('« Tout le monde » : environ 1 tour sur 8, ne compte pas dans la rotation', () => {
  const t = setup({ players: 4, everyoneChance: 1 / 8 });
  t.send('game:start', t.host);
  let everyone = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const passedBefore = t.room.game.passed.length;
    t.send('game:spin', t.host);
    const g = t.room.game;
    if (g.phase === 'everyone') {
      everyone++;
      assert.equal(g.current, null);
      assert.equal(g.passed.length, passedBefore, 'la carte Tout le monde ne doit faire passer personne');
      assert.equal(g.everyone.type, 'tous');
      t.send('game:done', t.host);
    } else {
      t.scheduler.flush();
      const p = t.byId(g.current.playerId);
      t.send('game:choose', p, { type: 'action' });
      t.send('game:done', p);
    }
  }
  const ratio = everyone / N;
  // Jamais au 1er tour ni deux fois de suite : un peu moins de 1/8.
  assert.ok(ratio > 0.07 && ratio < 0.16, `ratio observé ${ratio}`);
});

test('« Tout le monde » : seul l’hôte passe au tour suivant', () => {
  let n = 0;
  const t = setup({ players: 3, everyoneChance: 1, rng: () => (n++ % 2 ? 0.5 : 0) });
  t.send('game:start', t.host);
  playTurn(t); // 1er tour : jamais de carte Tout le monde
  t.send('game:spin', t.host);
  assert.equal(t.room.game.phase, 'everyone');
  assert.equal(t.send('game:done', t.members[1]), 'NOT_HOST');
  assert.equal(t.send('game:done', t.host), null);
  assert.equal(t.room.game.phase, 'ready');
});

test('« Tout le monde » désactivé : jamais de carte surprise', () => {
  const t = setup({ players: 3, everyoneChance: 1, settings: { everyone: false } });
  t.send('game:start', t.host);
  for (let i = 0; i < 50; i++) assert.ok(playTurn(t));
});

// ---------- Changements de carte ----------

test('limite de changements de carte par tour', () => {
  for (const max of [0, 1, 2, 3]) {
    const t = setup({ settings: { rerolls: max } });
    t.send('game:start', t.host);
    for (let turn = 0; turn < 3; turn++) {
      const p = spin(t);
      t.send('game:choose', p, { type: 'verite' });
      for (let i = 0; i < max; i++) {
        const before = t.room.game.current.card.id;
        assert.equal(t.send('game:reroll', p), null);
        assert.notEqual(t.room.game.current.card.id, before);
        assert.equal(t.room.game.current.rerollsLeft, max - i - 1);
      }
      assert.equal(t.send('game:reroll', p), 'NO_REROLL_LEFT');
      t.send('game:done', p);
    }
  }
});

test('seul le joueur désigné peut choisir, changer ou valider', () => {
  const t = setup({ players: 3 });
  t.send('game:start', t.host);
  const p = spin(t);
  const other = t.members.find((m) => m.id !== p.id);
  assert.equal(t.send('game:choose', other, { type: 'action' }), 'NOT_YOUR_TURN');
  assert.equal(t.send('game:choose', p, { type: 'n-importe' }), 'FORBIDDEN');
  t.send('game:choose', p, { type: 'action' });
  assert.equal(t.send('game:reroll', other), 'NOT_YOUR_TURN');
  assert.equal(t.send('game:done', other), 'NOT_YOUR_TURN');
  assert.equal(t.send('game:spin', t.host), 'BAD_PHASE');
});

test('aucun moyen de passer son tour sans le forçage de l’hôte', () => {
  const t = setup({ players: 3 });
  t.send('game:start', t.host);
  const p = spin(t);
  // Pendant le choix, le joueur ne peut pas valider sans carte.
  assert.equal(t.send('game:done', p), 'BAD_PHASE');
  assert.equal(t.send('game:forceNext', p.id === t.host.id ? t.members[1] : p), 'NOT_HOST');
  assert.ok(!('game:skip' in t.game.events) && !('game:pass' in t.game.events));
  assert.equal(t.send('game:forceNext', t.host), null);
  assert.equal(t.room.game.phase, 'ready');
});

test("l'hôte peut forcer le tour suivant à chaque étape", () => {
  const t = setup({ players: 3 });
  t.send('game:start', t.host);
  t.send('game:spin', t.host);
  assert.equal(t.send('game:forceNext', t.host), null); // pendant la roue
  const p = spin(t);
  assert.equal(t.send('game:forceNext', t.host), null); // pendant le choix
  const q = spin(t);
  t.send('game:choose', q, { type: 'action' });
  assert.equal(t.send('game:forceNext', t.host), null); // pendant la carte
  assert.ok(p && q);
});

// ---------- Minuteur ----------

test('minuteur : démarre sur une Action, pas sur une Vérité, ne passe pas le tour', () => {
  const t = setup({ settings: { timer: 30 } });
  t.send('game:start', t.host);
  let p = spin(t);
  t.send('game:choose', p, { type: 'verite' });
  assert.equal(t.room.game.current.timer, null);
  t.send('game:done', p);
  p = spin(t);
  t.send('game:choose', p, { type: 'action' });
  const timer = t.room.game.current.timer;
  assert.equal(timer.duration, 30000);
  t.scheduler.flush();
  assert.equal(t.room.game.current.timer.expired, true);
  assert.equal(t.room.game.phase, 'card', 'le tour ne passe pas automatiquement');
  assert.deepEqual(t.emitted.at(-1)[0], 'game:timerEnd');
});

test('minuteur désactivé : aucun minuteur', () => {
  const t = setup({ settings: { timer: 0 } });
  t.send('game:start', t.host);
  const p = spin(t);
  t.send('game:choose', p, { type: 'action' });
  assert.equal(t.room.game.current.timer, null);
});

// ---------- Compte à rebours avant la roue ----------

test('compte à rebours avant la roue', () => {
  const t = setup({ settings: { spinCountdown: 3 } });
  t.send('game:start', t.host);
  t.send('game:spin', t.host);
  assert.equal(t.room.game.phase, 'countdown');
  assert.equal(t.room.game.countdown.duration, 3000);
  t.scheduler.flush();
  assert.equal(t.room.game.phase, 'spinning');
});

// ---------- Fin de partie ----------

test('fin de partie après 10 tours de joueurs (les cartes Tout le monde ne comptent pas)', () => {
  const t = setup({ players: 3, everyoneChance: 0.3, settings: { endTurns: 10 } });
  t.send('game:start', t.host);
  let playerTurns = 0;
  let guard = 0;
  while (t.room.game.phase !== 'ended' && guard++ < 200) {
    if (playTurn(t)) playerTurns++;
  }
  assert.equal(playerTurns, 10);
  assert.equal(t.room.game.phase, 'ended');
  assert.ok(t.room.game.turn >= 10);
  assert.equal(t.send('game:spin', t.host), 'BAD_PHASE');
});

test('partie illimitée : ne s’arrête pas seule', () => {
  const t = setup({ settings: { endTurns: 0 } });
  t.send('game:start', t.host);
  for (let i = 0; i < 60; i++) playTurn(t);
  assert.equal(t.room.game.phase, 'ready');
});

test('rejouer avec les mêmes joueurs, ou retour au salon', () => {
  const t = setup({ settings: { endTurns: 10 } });
  t.send('game:start', t.host);
  assert.equal(t.send('game:restart', t.host), 'BAD_PHASE');
  t.send('game:end', t.host);
  assert.equal(t.room.game.phase, 'ended');
  assert.equal(t.send('game:restart', t.members[1]), 'NOT_HOST');
  assert.equal(t.send('game:restart', t.host), null);
  assert.equal(t.room.game.phase, 'ready');
  assert.equal(t.room.game.turn, 0);
  assert.equal(t.room.game.participants.length, 3);
  t.send('game:end', t.host);
  assert.equal(t.send('game:restart', t.host, { lobby: true }), null);
  assert.equal(t.room.phase, 'lobby');
  assert.equal(t.room.game.phase, 'lobby');
});

// ---------- Lancement, +18, départs ----------

test('lancement : hôte seulement, 2 joueurs minimum', () => {
  const solo = setup({ players: 1 });
  assert.equal(solo.send('game:start', solo.host), 'NOT_ENOUGH_PLAYERS');
  const t = setup({ players: 2 });
  assert.equal(t.send('game:start', t.members[1]), 'NOT_HOST');
  assert.equal(t.send('game:start', t.host), null);
  assert.equal(t.room.phase, 'playing');
  assert.equal(t.send('game:start', t.host), 'BAD_PHASE');
});

test('+18 : aucune confirmation d’âge, on rejoint et on lance directement', () => {
  const scheduler = fakeScheduler();
  const game = createGame({ cards: makeCards(), scheduler, everyoneChance: 0 });
  const lobby = new LobbyManager({ hooks: game.hooks });
  const { room, member: host } = lobby.createRoom('Samuel', {});
  lobby.joinRoom(room, 'Inès', {});
  game.applySettings(room, { levels: ['HARD', '+18'] });
  assert.ok(lobby.joinRoom(room, 'Yanis', {}).member);
  assert.ok(!('game:confirmAge' in game.events));
  assert.equal(game.events['game:start'].handler({ room, member: host, isHost: true }, {}), null);
});

test('départ du joueur dont c’est le tour : tour suivant sans le compter', () => {
  const t = setup({ players: 3, settings: { endTurns: 10, order: 'fixed' } });
  t.send('game:start', t.host);
  assert.equal(playTurn(t).name, 'Samuel');
  const q = spin(t);
  assert.equal(q.name, 'Inès');
  const before = t.room.game.playerTurns;
  t.lobby.removeMember(t.room, q.id, 'left');
  assert.equal(t.room.game.phase, 'ready');
  assert.equal(t.room.game.playerTurns, before);
  assert.ok(!t.room.game.participants.includes(q.id));
  assert.equal(playTurn(t).name, 'Yanis');
});

test('vue client : aucune donnée secrète (token) dans l’état', () => {
  const t = setup();
  t.send('game:start', t.host);
  spin(t);
  const json = JSON.stringify(t.game.view(t.room, { id: t.host.id }));
  for (const m of t.members) assert.ok(!json.includes(m.token));
});

test('le fichier de cartes réel est valide et assez fourni', () => {
  const { loadCards } = require('../server/game/deck');
  const cards = loadCards();
  assert.deepEqual(checkCards(cards), []);
  for (const level of LEVELS) {
    for (const type of ['action', 'verite']) {
      const n = cards.filter((c) => c.type === type && c.level === level).length;
      assert.ok(n >= 40, `${type} ${level} : ${n} cartes (40 minimum)`);
      // En mode à distance, il doit rester assez de cartes jouables.
      const remote = pool(cards, type, { levels: [level], mode: 'distance' }).length;
      assert.ok(remote >= 15, `${type} ${level} à distance : ${remote} cartes`);
    }
    const tous = cards.filter((c) => c.type === 'tous' && c.level === level).length;
    assert.ok(tous >= 20, `tous ${level} : ${tous} cartes (20 minimum)`);
  }
});
