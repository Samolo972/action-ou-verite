'use strict';
// Branche le LobbyManager sur Socket.IO : événements room:*, screen:*, et relais des événements de jeu.
// Le jeu se déclare via un objet `game` (voir server/lobby/README.md pour le contrat).

const { RateLimiter } = require('../utils/rateLimit');
const { isPlainObject, cleanCode, cleanName, isToken, isMemberId } = require('../utils/validation');

const MESSAGES = {
  ROOM_NOT_FOUND: "Ce salon n'existe pas ou a expiré.",
  ROOM_LOCKED: 'Ce salon est verrouillé.',
  ROOM_FULL: 'Ce salon est plein.',
  NAME_TAKEN: 'Ce pseudo est déjà pris dans ce salon.',
  INVALID_NAME: 'Pseudo invalide : 2 à 16 caractères (lettres, chiffres, espace, - _ . \').',
  INVALID_CODE: 'Code invalide : 6 caractères.',
  INVALID_SETTINGS: 'Réglage invalide.',
  MAX_BELOW_PLAYERS: 'Il y a déjà plus de joueurs que ce maximum.',
  AGE_REQUIRED: 'Le niveau +18 est activé : tu dois confirmer avoir 18 ans ou plus.',
  GAME_IN_PROGRESS: 'La partie a déjà commencé et les retardataires ne sont pas acceptés.',
  NOT_IN_ROOM: "Tu n'es plus dans ce salon.",
  NOT_HOST: "Seul l'hôte peut faire ça.",
  NOT_YOUR_TURN: "Ce n'est pas ton tour.",
  FORBIDDEN: 'Action non autorisée.',
  BAD_PHASE: "Impossible pour l'instant.",
  RATE_LIMIT: 'Doucement ! Trop de requêtes, réessaie dans un instant.',
  TOO_MANY_ATTEMPTS: 'Trop de tentatives. Réessaie dans quelques minutes.',
  SERVER_FULL: 'Le serveur est plein, réessaie plus tard.',
  SESSION_EXPIRED: 'Session expirée.',
  SERVER: 'Erreur du serveur.',
};

const noop = () => {};

/** IP du client. Derrière nginx, on prend la dernière entrée de X-Forwarded-For (ajoutée par nginx). */
function clientIp(socket, trustProxy) {
  if (trustProxy) {
    const xff = socket.handshake.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length < 512) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return socket.handshake.address || 'unknown';
}

/**
 * @param {object} p
 * @param {import('socket.io').Server} p.io
 * @param {import('./LobbyManager').LobbyManager} p.manager
 * @param {object} p.game
 * @param {string} p.publicUrl
 * @param {boolean} [p.trustProxy]
 * @param {object} [p.limits]
 */
function attachLobby({ io, manager, game, publicUrl, trustProxy = false, limits = {} }) {
  const L = {
    eventsPerSocket: { capacity: 20, refillPerSec: 6 }, // tout événement
    createPerIp: { capacity: 8, refillPerSec: 8 / 600 }, // 8 salons / 10 min
    codeTriesPerIp: { capacity: 15, refillPerSec: 15 / 120 }, // 15 essais de code / 2 min
    connectionsPerIp: 40,
    ...limits,
  };
  const socketLimiter = new RateLimiter(L.eventsPerSocket);
  const createLimiter = new RateLimiter(L.createPerIp);
  const codeLimiter = new RateLimiter(L.codeTriesPerIp);
  const connCount = new Map();

  const channel = (room) => `room:${room.code}`;
  const inviteUrl = (room) => `${publicUrl}/j/${room.code}`;

  // ---------- Diffusion de l'état ----------

  function publicPlayers(room) {
    return [...room.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      slot: m.slot,
      connected: m.connected,
      isHost: m.id === room.hostId,
    }));
  }

  function stateFor(room, viewer) {
    return {
      code: room.code,
      inviteUrl: inviteUrl(room),
      phase: room.phase,
      locked: room.locked,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      players: publicPlayers(room),
      screens: room.screens.size,
      you: viewer,
      game: game.view(room, viewer),
    };
  }

  function broadcast(room) {
    if (room.closed) return;
    for (const m of room.members.values()) {
      if (m.socketId) {
        io.to(m.socketId).emit('room:state', stateFor(room, { id: m.id, isHost: m.id === room.hostId, isScreen: false }));
      }
    }
    if (room.screens.size) {
      const screenState = stateFor(room, { id: null, isHost: false, isScreen: true });
      for (const socketId of room.screens.keys()) io.to(socketId).emit('room:state', screenState);
    }
  }

  // Diffusions regroupées : plusieurs changements dans le même tick = un seul envoi.
  const pending = new Set();
  function scheduleBroadcast(room) {
    if (pending.has(room)) return;
    pending.add(room);
    setImmediate(() => {
      pending.delete(room);
      broadcast(room);
    });
  }

  const api = {
    broadcast: scheduleBroadcast,
    emit: (room, event, data) => io.to(channel(room)).emit(event, data),
    touch: (room) => manager.touch(room),
  };
  game.attach?.(api);

  manager.on('changed', scheduleBroadcast);
  manager.on('room-closed', (room, reason) => {
    io.to(channel(room)).emit('room:closed', { reason });
    io.in(channel(room)).socketsLeave(channel(room));
    for (const s of io.sockets.sockets.values()) {
      if (s.data.code === room.code) resetSocket(s);
    }
    game.onRoomClosed?.(room);
  });
  manager.on('member-removed', (room, member, reason) => {
    // Le socket d'un joueur exclu est prévenu et détaché du salon.
    for (const s of io.sockets.sockets.values()) {
      if (s.data.code === room.code && s.data.memberId === member.id) {
        if (reason === 'kicked') s.emit('room:kicked', {});
        s.leave(channel(room));
        resetSocket(s);
      }
    }
  });

  function resetSocket(socket) {
    socket.data.code = null;
    socket.data.memberId = null;
    socket.data.isScreen = false;
  }

  // ---------- Contexte ----------

  function context(socket) {
    const { code, memberId, isScreen } = socket.data;
    if (!code) return null;
    const room = manager.getRoom(code);
    if (!room) return null;
    if (isScreen) return { room, member: null, isScreen: true, isHost: false };
    const member = room.members.get(memberId);
    if (!member || member.socketId !== socket.id) return null;
    return { room, member, isScreen: false, isHost: room.hostId === member.id };
  }

  /** Détache le socket de son salon actuel (sans retirer le joueur : il pourra revenir). */
  function detach(socket) {
    const ctx = context(socket);
    if (ctx) {
      socket.leave(channel(ctx.room));
      if (ctx.isScreen) manager.removeScreen(ctx.room, socket.id);
      else manager.setDisconnected(ctx.room, ctx.member);
    }
    resetSocket(socket);
  }

  function bindMember(socket, room, member) {
    detach(socket);
    // Si ce joueur est déjà ouvert dans un autre onglet, l'ancien est remplacé.
    if (member.socketId && member.socketId !== socket.id) {
      const old = io.sockets.sockets.get(member.socketId);
      if (old) {
        old.emit('room:replaced', {});
        old.leave(channel(room));
        resetSocket(old);
      }
    }
    socket.data.code = room.code;
    socket.data.memberId = member.id;
    socket.data.isScreen = false;
    socket.join(channel(room));
    manager.setConnected(room, member, socket.id);
  }

  // ---------- Connexions ----------

  io.use((socket, next) => {
    const ip = clientIp(socket, trustProxy);
    const n = (connCount.get(ip) || 0) + 1;
    if (n > L.connectionsPerIp) return next(new Error('TOO_MANY_CONNECTIONS'));
    connCount.set(ip, n);
    socket.data.ip = ip;
    socket.once('disconnect', () => {
      const c = (connCount.get(ip) || 1) - 1;
      if (c <= 0) connCount.delete(ip);
      else connCount.set(ip, c);
    });
    next();
  });

  io.on('connection', (socket) => {
    resetSocket(socket);
    const ip = socket.data.ip;

    function fail(event, ack, code) {
      socket.emit('error', { code, event, message: MESSAGES[code] || MESSAGES.SERVER });
      ack({ ok: false, error: code, message: MESSAGES[code] || MESSAGES.SERVER });
    }

    /** Enregistre un gestionnaire avec limitation, validation de forme et capture d'erreur. */
    function on(event, handler) {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = {};
        }
        if (typeof ack !== 'function') ack = noop;
        if (!socketLimiter.consume(socket.id)) return fail(event, ack, 'RATE_LIMIT');
        if (payload === undefined || payload === null) payload = {};
        if (!isPlainObject(payload)) return fail(event, ack, 'FORBIDDEN');
        try {
          const err = handler(payload, ack);
          if (err) fail(event, ack, err);
        } catch (e) {
          console.error(`[socket] erreur sur ${event} :`, e && e.message);
          fail(event, ack, 'SERVER');
        }
      });
    }

    /** Essai de code (anti-bruteforce) : renvoie un code d'erreur si l'IP a trop essayé. */
    function codeAttempt() {
      return codeLimiter.consume(ip) ? null : 'TOO_MANY_ATTEMPTS';
    }
    /** Vrai si l'IP a épuisé ses essais : on refuse même un code valide tant que ça dure. */
    function codeBlocked() {
      return !codeLimiter.peek(ip);
    }

    // --- Créer un salon ---
    on('room:create', (p, ack) => {
      const name = cleanName(p.name);
      if (!name) return 'INVALID_NAME';
      if (!createLimiter.consume(ip)) return 'TOO_MANY_ATTEMPTS';
      const res = manager.createRoom(name, p);
      if (res.error) return res.error;
      bindMember(socket, res.room, res.member);
      ack({ ok: true, code: res.room.code, token: res.member.token, memberId: res.member.id });
      return null;
    });

    // --- Infos publiques d'un salon (écran d'invitation) ---
    on('room:info', (p, ack) => {
      if (codeBlocked()) return 'TOO_MANY_ATTEMPTS';
      const code = cleanCode(p.code);
      if (!code) return 'INVALID_CODE';
      const room = manager.getRoom(code);
      if (!room) return codeAttempt() || 'ROOM_NOT_FOUND';
      const host = room.members.get(room.hostId);
      const blocked = room.locked ? 'ROOM_LOCKED' : room.members.size >= room.maxPlayers ? 'ROOM_FULL' : game.joinBlocker?.(room) || null;
      ack({
        ok: true,
        info: {
          code,
          hostName: host ? host.name : null,
          playerCount: room.members.size,
          maxPlayers: room.maxPlayers,
          joinable: !blocked,
          reason: blocked,
          message: blocked ? MESSAGES[blocked] : null,
          ...game.publicInfo(room),
        },
      });
      return null;
    });

    // --- Rejoindre comme joueur ---
    on('room:join', (p, ack) => {
      if (codeBlocked()) return 'TOO_MANY_ATTEMPTS';
      const code = cleanCode(p.code);
      if (!code) return 'INVALID_CODE';
      const name = cleanName(p.name);
      if (!name) return 'INVALID_NAME';
      const room = manager.getRoom(code);
      if (!room) return codeAttempt() || 'ROOM_NOT_FOUND';
      const res = manager.joinRoom(room, name, p);
      if (res.error) return res.error;
      bindMember(socket, room, res.member);
      ack({ ok: true, code, token: res.member.token, memberId: res.member.id });
      return null;
    });

    // --- Reprendre sa place (rechargement, veille, perte de réseau) ---
    on('room:resume', (p, ack) => {
      if (codeBlocked()) return 'TOO_MANY_ATTEMPTS';
      const code = cleanCode(p.code);
      if (!code || !isToken(p.token)) return 'SESSION_EXPIRED';
      const found = manager.resume(code, p.token);
      if (!found) return codeAttempt() || 'SESSION_EXPIRED';
      bindMember(socket, found.room, found.member);
      ack({ ok: true, code, memberId: found.member.id });
      return null;
    });

    // --- Rejoindre comme écran (télé / PC) ---
    on('screen:join', (p, ack) => {
      if (codeBlocked()) return 'TOO_MANY_ATTEMPTS';
      const code = cleanCode(p.code);
      if (!code) return 'INVALID_CODE';
      const room = manager.getRoom(code);
      if (!room) return codeAttempt() || 'ROOM_NOT_FOUND';
      if (room.screens.size >= 6) return 'ROOM_FULL';
      detach(socket);
      socket.data.code = code;
      socket.data.isScreen = true;
      socket.join(channel(room));
      manager.addScreen(room, socket.id);
      ack({ ok: true, code });
      return null;
    });

    // --- Quitter ---
    on('room:leave', (p, ack) => {
      const ctx = context(socket);
      if (!ctx) {
        resetSocket(socket);
        ack({ ok: true });
        return null;
      }
      socket.leave(channel(ctx.room));
      if (ctx.isScreen) {
        manager.removeScreen(ctx.room, socket.id);
        resetSocket(socket);
      } else {
        manager.removeMember(ctx.room, ctx.member.id, 'left');
        resetSocket(socket);
      }
      ack({ ok: true });
      return null;
    });

    // --- Exclure un joueur (hôte) ---
    on('room:kick', (p, ack) => {
      const ctx = context(socket);
      if (!ctx || ctx.isScreen) return 'NOT_IN_ROOM';
      if (!ctx.isHost) return 'NOT_HOST';
      if (!isMemberId(p.memberId) || p.memberId === ctx.member.id) return 'FORBIDDEN';
      if (!ctx.room.members.has(p.memberId)) return 'FORBIDDEN';
      manager.removeMember(ctx.room, p.memberId, 'kicked');
      ack({ ok: true });
      return null;
    });

    // --- Verrouiller (hôte, salon d'attente) ---
    on('room:lock', (p, ack) => {
      const ctx = context(socket);
      if (!ctx || ctx.isScreen) return 'NOT_IN_ROOM';
      if (!ctx.isHost) return 'NOT_HOST';
      if (ctx.room.phase !== 'lobby') return 'BAD_PHASE';
      if (typeof p.locked !== 'boolean') return 'INVALID_SETTINGS';
      manager.setLocked(ctx.room, p.locked);
      ack({ ok: true });
      return null;
    });

    // --- Réglages (hôte, salon d'attente uniquement) ---
    on('room:settings', (p, ack) => {
      const ctx = context(socket);
      if (!ctx || ctx.isScreen) return 'NOT_IN_ROOM';
      if (!ctx.isHost) return 'NOT_HOST';
      if (ctx.room.phase !== 'lobby') return 'BAD_PHASE';
      const { maxPlayers, ...rest } = p;
      // Tout valider avant d'appliquer quoi que ce soit.
      if (maxPlayers !== undefined) {
        if (!Number.isInteger(maxPlayers) || maxPlayers < manager.opts.minPlayers || maxPlayers > manager.opts.maxPlayersLimit) return 'INVALID_SETTINGS';
        if (maxPlayers < ctx.room.members.size) return 'MAX_BELOW_PLAYERS';
      }
      const err = game.validateSettings(ctx.room, rest);
      if (err) return err;
      if (maxPlayers !== undefined) manager.setMaxPlayers(ctx.room, maxPlayers);
      game.applySettings(ctx.room, rest);
      manager.touch(ctx.room);
      scheduleBroadcast(ctx.room);
      ack({ ok: true });
      return null;
    });

    // --- Événements de jeu ---
    for (const [event, spec] of Object.entries(game.events)) {
      on(event, (p, ack) => {
        const ctx = context(socket);
        if (!ctx) return 'NOT_IN_ROOM';
        if (ctx.isScreen) return 'FORBIDDEN'; // un écran n'envoie jamais d'événement de jeu
        if (spec.role === 'host' && !ctx.isHost) return 'NOT_HOST';
        const err = spec.handler(ctx, p);
        if (err) return err;
        manager.touch(ctx.room);
        scheduleBroadcast(ctx.room);
        ack({ ok: true });
        return null;
      });
    }

    socket.on('disconnect', () => {
      detach(socket);
      socketLimiter.delete(socket.id);
    });
  });

  // Ménage périodique : salons expirés et seaux de limitation pleins.
  const sweepTimer = setInterval(() => {
    manager.sweep();
    socketLimiter.prune();
    createLimiter.prune();
    codeLimiter.prune();
  }, 60 * 1000);
  sweepTimer.unref?.();

  return { api, broadcast, MESSAGES, stop: () => clearInterval(sweepTimer) };
}

module.exports = { attachLobby, MESSAGES };
