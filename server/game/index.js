'use strict';
// Logique « Action ou Vérité », branchée sur le moteur de salon (contrat : server/lobby/README.md).
// Le serveur fait autorité : il désigne les joueurs, tire les cartes et gère les minuteurs.

const { defaultSettings, validateSettings, applySettings, isAdult } = require('./settings');
const { pool, draw } = require('./deck');

const SPIN_MS = 4000; // durée de l'animation de la roue
const EVERYONE_CHANCE = 1 / 8;

/**
 * Phases de room.game.phase :
 *  lobby → ready ⇄ (countdown →) spinning → choosing → card → ready …
 *                                 └→ everyone → ready …
 *  … → ended → (restart) ready  |  (retour salon) lobby
 */

const defaultScheduler = {
  set: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clear: (t) => clearTimeout(t),
};

/**
 * @param {object} deps
 * @param {object[]} deps.cards
 * @param {() => number} [deps.rng]
 * @param {() => number} [deps.now]
 * @param {{set: Function, clear: Function}} [deps.scheduler]
 * @param {number} [deps.spinMs]
 * @param {number} [deps.everyoneChance]
 */
function createGame(deps) {
  const cards = deps.cards;
  const rng = deps.rng || Math.random;
  const now = deps.now || Date.now;
  const scheduler = deps.scheduler || defaultScheduler;
  const spinMs = deps.spinMs ?? SPIN_MS;
  const everyoneChance = deps.everyoneChance ?? EVERYONE_CHANCE;
  let api = { broadcast() {}, emit() {}, touch() {} };

  // ---------- Outils ----------

  function freshState(settings) {
    return {
      settings,
      phase: 'lobby',
      turn: 0, // numéro du tour affiché (cartes « Tout le monde » comprises)
      playerTurns: 0, // tours joués par un joueur (comptent pour la fin de partie)
      participants: [], // ids dans la rotation, ordre d'arrivée
      pending: [], // retardataires : entrent dans la rotation au tour suivant
      passed: [], // joueurs déjà passés dans la manche en cours
      lastPlayerId: null,
      lastWasEveryone: false,
      current: null, // { playerId, type, card, rerollsLeft, timer }
      everyone: null, // carte « Tout le monde » en cours
      spin: null, // { targetId, segments, startedAt, duration }
      countdown: null, // { endsAt }
      drawn: new Set(), // ids des cartes déjà sorties
      timers: {},
    };
  }

  function clearTimer(g, name) {
    if (g.timers[name]) scheduler.clear(g.timers[name]);
    delete g.timers[name];
  }

  function clearAllTimers(g) {
    for (const name of Object.keys(g.timers)) clearTimer(g, name);
  }

  function setTimer(room, name, ms, fn) {
    const g = room.game;
    clearTimer(g, name);
    g.timers[name] = scheduler.set(() => {
      delete g.timers[name];
      if (room.closed || room.game !== g) return;
      try {
        fn();
      } catch (e) {
        console.error('[game] erreur de minuteur :', e && e.message);
      }
      api.broadcast(room);
    }, ms);
  }

  const allowedTypes = (s) => (s.cardType === 'both' ? ['action', 'verite'] : [s.cardType]);

  function agePending(room) {
    if (!isAdult(room.game.settings)) return [];
    return [...room.members.values()].filter((m) => !m.adult).map((m) => m.id);
  }

  // ---------- Rotation ----------

  /** Ajoute les retardataires à la rotation et retire les absents définitifs. */
  function syncParticipants(room) {
    const g = room.game;
    for (const id of g.pending) if (room.members.has(id) && !g.participants.includes(id)) g.participants.push(id);
    g.pending = [];
    g.participants = g.participants.filter((id) => room.members.has(id));
    g.passed = g.passed.filter((id) => g.participants.includes(id));
  }

  /** Désigne le prochain joueur selon l'ordre de passage. */
  function pickPlayer(room) {
    const g = room.game;
    const connected = (id) => room.members.get(id)?.connected;
    let eligible = g.participants.filter((id) => !g.passed.includes(id) && connected(id));
    if (eligible.length === 0) {
      // Manche terminée (ou restants absents) : nouvelle manche.
      g.passed = [];
      eligible = g.participants.filter(connected);
      if (eligible.length > 1 && g.settings.order !== 'fixed') eligible = eligible.filter((id) => id !== g.lastPlayerId);
    }
    if (eligible.length === 0) eligible = [...g.participants];
    if (eligible.length === 0) return null;
    if (g.settings.order === 'fixed') return eligible[0];
    return eligible[Math.floor(rng() * eligible.length)];
  }

  // ---------- Tirage ----------

  function drawFor(room, type, excludeId) {
    const g = room.game;
    return draw(pool(cards, type, g.settings), g.drawn, rng, excludeId);
  }

  function startActionTimer(room) {
    const g = room.game;
    const c = g.current;
    clearTimer(g, 'action');
    c.timer = null;
    if (c.type !== 'action' || !g.settings.timer) return;
    const duration = g.settings.timer * 1000;
    c.timer = { startedAt: now(), endsAt: now() + duration, duration, expired: false };
    setTimer(room, 'action', duration, () => {
      if (g.current === c && c.timer) {
        c.timer.expired = true;
        api.emit(room, 'game:timerEnd', { playerId: c.playerId });
      }
    });
  }

  function showCard(room, type) {
    const g = room.game;
    const card = drawFor(room, type);
    if (!card) return 'NO_CARDS';
    g.current.type = type;
    g.current.card = card;
    g.phase = 'card';
    startActionTimer(room);
    return null;
  }

  // ---------- Tours ----------

  function beginTurn(room) {
    const g = room.game;
    clearTimer(g, 'countdown');
    g.countdown = null;
    syncParticipants(room);
    g.turn += 1;
    g.current = null;
    g.everyone = null;
    g.spin = null;

    // Carte « Tout le monde » : environ 1 tour sur 8, jamais deux de suite, jamais au premier tour.
    if (g.settings.everyone && g.turn > 1 && !g.lastWasEveryone && rng() < everyoneChance) {
      const card = drawFor(room, 'tous');
      if (card) {
        g.everyone = card;
        g.phase = 'everyone';
        g.lastWasEveryone = true;
        return null;
      }
    }
    g.lastWasEveryone = false;

    const playerId = pickPlayer(room);
    if (!playerId) {
      g.turn -= 1;
      g.phase = 'ready';
      return 'NOT_ENOUGH_PLAYERS';
    }
    if (!g.passed.includes(playerId)) g.passed.push(playerId);
    g.lastPlayerId = playerId;
    g.current = { playerId, type: null, card: null, rerollsLeft: g.settings.rerolls, timer: null };
    g.spin = { targetId: playerId, segments: [...g.participants], startedAt: now(), duration: spinMs };
    g.phase = 'spinning';
    setTimer(room, 'spin', spinMs, () => {
      if (g.phase !== 'spinning' || g.current?.playerId !== playerId) return;
      const types = allowedTypes(g.settings);
      if (types.length === 1) {
        // Une seule sorte de carte : le choix Action / Vérité est sauté.
        if (showCard(room, types[0])) g.phase = 'choosing';
      } else {
        g.phase = 'choosing';
      }
    });
    return null;
  }

  /** Termine le tour en cours. `counted` : le tour compte pour la fin de partie. */
  function endTurn(room, counted) {
    const g = room.game;
    clearTimer(g, 'action');
    clearTimer(g, 'spin');
    clearTimer(g, 'countdown');
    const wasEveryone = g.phase === 'everyone';
    if (counted && !wasEveryone) g.playerTurns += 1;
    g.current = null;
    g.everyone = null;
    g.spin = null;
    g.countdown = null;
    if (g.settings.endTurns && g.playerTurns >= g.settings.endTurns) {
      g.phase = 'ended';
    } else {
      g.phase = 'ready';
    }
  }

  function startGame(room) {
    const g = room.game;
    const keep = g.drawn; // on évite de revoir les mêmes cartes en rejouant dans le même salon
    clearAllTimers(g);
    room.game = freshState(g.settings);
    room.game.drawn = keep;
    room.game.participants = [...room.members.keys()];
    room.game.phase = 'ready';
    room.phase = 'playing';
  }

  // ---------- Événements ----------

  const isTurnPlayer = (ctx) => ctx.room.game.current?.playerId === ctx.member.id;
  const playing = (g) => !['lobby', 'ended'].includes(g.phase);

  const events = {
    'game:start': {
      role: 'host',
      handler(ctx) {
        const { room } = ctx;
        if (room.game.phase !== 'lobby') return 'BAD_PHASE';
        if (room.members.size < 2) return 'NOT_ENOUGH_PLAYERS';
        if (agePending(room).length) return 'AGE_PENDING';
        if (!allowedTypes(room.game.settings).some((t) => pool(cards, t, room.game.settings).length)) return 'NO_CARDS';
        startGame(room);
        return null;
      },
    },

    'game:spin': {
      role: 'host',
      handler(ctx) {
        const { room } = ctx;
        const g = room.game;
        if (g.phase !== 'ready') return 'BAD_PHASE';
        const secs = g.settings.spinCountdown;
        if (secs) {
          g.phase = 'countdown';
          g.countdown = { endsAt: now() + secs * 1000, duration: secs * 1000 };
          setTimer(room, 'countdown', secs * 1000, () => {
            if (g.phase === 'countdown') beginTurn(room);
          });
          return null;
        }
        return beginTurn(room);
      },
    },

    'game:choose': {
      role: 'player',
      handler(ctx, p) {
        const g = ctx.room.game;
        if (g.phase !== 'choosing') return 'BAD_PHASE';
        if (!isTurnPlayer(ctx)) return 'NOT_YOUR_TURN';
        if (!allowedTypes(g.settings).includes(p.type)) return 'FORBIDDEN';
        return showCard(ctx.room, p.type);
      },
    },

    'game:reroll': {
      role: 'player',
      handler(ctx) {
        const g = ctx.room.game;
        if (g.phase !== 'card') return 'BAD_PHASE';
        if (!isTurnPlayer(ctx)) return 'NOT_YOUR_TURN';
        const c = g.current;
        if (c.rerollsLeft <= 0) return 'NO_REROLL_LEFT';
        const card = drawFor(ctx.room, c.type, c.card.id);
        if (!card) return 'NO_CARDS';
        c.card = card;
        c.rerollsLeft -= 1;
        startActionTimer(ctx.room);
        return null;
      },
    },

    'game:done': {
      role: 'player',
      handler(ctx) {
        const g = ctx.room.game;
        if (g.phase === 'everyone') {
          if (!ctx.isHost) return 'NOT_HOST';
          endTurn(ctx.room, true);
          return null;
        }
        if (g.phase !== 'card') return 'BAD_PHASE';
        if (!isTurnPlayer(ctx)) return 'NOT_YOUR_TURN';
        endTurn(ctx.room, true);
        return null;
      },
    },

    'game:forceNext': {
      role: 'host',
      handler(ctx) {
        const g = ctx.room.game;
        if (!['countdown', 'spinning', 'choosing', 'card', 'everyone'].includes(g.phase)) return 'BAD_PHASE';
        // Un compte à rebours interrompu n'a désigné personne : on revient simplement à « prêt ».
        endTurn(ctx.room, g.phase !== 'countdown');
        return null;
      },
    },

    'game:end': {
      role: 'host',
      handler(ctx) {
        const g = ctx.room.game;
        if (!playing(g)) return 'BAD_PHASE';
        clearAllTimers(g);
        g.current = null;
        g.everyone = null;
        g.spin = null;
        g.countdown = null;
        g.phase = 'ended';
        return null;
      },
    },

    'game:restart': {
      role: 'host',
      handler(ctx, p) {
        const { room } = ctx;
        const g = room.game;
        if (g.phase !== 'ended') return 'BAD_PHASE';
        if (p.lobby === true) {
          // Retour au salon d'attente pour changer les réglages.
          clearAllTimers(g);
          const keep = g.drawn;
          room.game = freshState(g.settings);
          room.game.drawn = keep;
          room.phase = 'lobby';
          return null;
        }
        if (room.members.size < 2) return 'NOT_ENOUGH_PLAYERS';
        if (agePending(room).length) return 'AGE_PENDING';
        startGame(room);
        return null;
      },
    },

    'game:confirmAge': {
      role: 'player',
      handler(ctx) {
        ctx.member.adult = true;
        return null;
      },
    },
  };

  // ---------- Contrat du moteur de salon ----------

  return {
    events,

    attach(a) {
      api = a;
    },

    hooks: {
      initRoom(room) {
        room.game = freshState(defaultSettings());
      },
      canJoin(room, payload) {
        const g = room.game;
        if (room.phase === 'playing' && !g.settings.lateJoin) return 'GAME_IN_PROGRESS';
        if (isAdult(g.settings) && payload.adult !== true) return 'AGE_REQUIRED';
        return null;
      },
      onMemberAdded(room, member, payload) {
        member.adult = payload.adult === true;
        const g = room.game;
        if (g && room.phase === 'playing') g.pending.push(member.id);
      },
      onMemberRemoved(room, member) {
        const g = room.game;
        g.pending = g.pending.filter((id) => id !== member.id);
        g.participants = g.participants.filter((id) => id !== member.id);
        g.passed = g.passed.filter((id) => id !== member.id);
        // Si c'était son tour, on passe au suivant sans le compter.
        if (g.current && g.current.playerId === member.id && playing(g)) endTurn(room, false);
      },
      onConnectionChange() {},
    },

    joinBlocker(room) {
      return room.phase === 'playing' && !room.game.settings.lateJoin ? 'GAME_IN_PROGRESS' : null;
    },

    publicInfo(room) {
      const s = room.game.settings;
      return { mode: s.mode, levels: [...s.levels], adult: isAdult(s), playing: room.phase === 'playing' };
    },

    validateSettings(room, partial) {
      if (Object.keys(partial).length === 0) return null; // seulement maxPlayers
      return validateSettings(partial);
    },

    applySettings(room, partial) {
      if (Object.keys(partial).length) applySettings(room.game.settings, partial);
    },

    onRoomClosed(room) {
      clearAllTimers(room.game);
    },

    /** Partie « jeu » de room:state. Ne contient aucune donnée secrète. */
    view(room, viewer) {
      const g = room.game;
      const c = g.current;
      return {
        serverNow: now(),
        settings: { ...g.settings, levels: [...g.settings.levels] },
        phase: g.phase,
        turn: g.turn,
        playerTurns: g.playerTurns,
        participants: [...g.participants],
        pending: [...g.pending],
        passed: [...g.passed],
        current: c
          ? {
              playerId: c.playerId,
              type: c.type,
              card: c.card,
              rerollsLeft: c.rerollsLeft,
              rerollsMax: g.settings.rerolls,
              timer: c.timer,
            }
          : null,
        everyone: g.everyone,
        spin: g.spin,
        countdown: g.countdown,
        agePending: agePending(room),
        youAdult: viewer && viewer.id ? Boolean(room.members.get(viewer.id)?.adult) : false,
      };
    },

    // Exposé pour les tests.
    _internal: { pickPlayer, beginTurn, endTurn },
  };
}

module.exports = { createGame, SPIN_MS, EVERYONE_CHANCE };
