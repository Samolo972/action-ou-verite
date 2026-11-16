'use strict';
// Moteur de salon : état pur des salons, sans socket ni logique de jeu.
// Réutilisable tel quel dans un autre jeu multijoueur (voir server/lobby/README.md).

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { CODE_ALPHABET, CODE_LENGTH, nameKey } = require('../utils/validation');

const DEFAULTS = {
  maxRooms: 500, // garde-fou mémoire
  minPlayers: 2,
  maxPlayersLimit: 12,
  defaultMaxPlayers: 12,
  slots: 12, // nombre d'emplacements (couleurs d'avatar) distincts
  roomTtlMs: 30 * 60 * 1000, // salon inactif supprimé après 30 min
  hostGraceMs: 60 * 1000, // délai avant transfert si l'hôte est déconnecté
};

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

const newToken = () => crypto.randomBytes(24).toString('base64url'); // 32 caractères
const newId = () => crypto.randomBytes(6).toString('hex'); // 12 caractères

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Événements émis :
 *  - 'changed'       (room)                    l'état visible du salon a changé (à diffuser)
 *  - 'member-removed'(room, member, reason)    un joueur est parti / exclu
 *  - 'host-changed'  (room, oldHostId, newHostId)
 *  - 'room-closed'   (room, reason)            salon supprimé (expired | empty)
 */
class LobbyManager extends EventEmitter {
  /**
   * @param {object} [opts] voir DEFAULTS
   * @param {object} [opts.hooks] crochets du jeu :
   *   - initRoom(room)                     prépare room.game
   *   - canJoin(room, payload)             renvoie un code d'erreur ou null
   *   - onMemberAdded(room, member, payload)
   *   - onMemberRemoved(room, member, reason)
   *   - onConnectionChange(room, member)
   * @param {() => number} [opts.now]
   */
  constructor(opts = {}) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this.hooks = opts.hooks || {};
    this.now = opts.now || Date.now;
    this.rooms = new Map();
    this.hostTimers = new Map();
  }

  // ---------- Création / accès ----------

  createRoom(name, payload = {}) {
    if (this.rooms.size >= this.opts.maxRooms) return { error: 'SERVER_FULL' };
    let code;
    do code = randomCode();
    while (this.rooms.has(code));

    const t = this.now();
    const room = {
      code,
      createdAt: t,
      lastActivity: t,
      hostId: null,
      locked: false,
      maxPlayers: this.opts.defaultMaxPlayers,
      phase: 'lobby', // 'lobby' | 'playing' : le jeu le met à jour
      members: new Map(), // id -> membre (ordre d'arrivée)
      screens: new Map(), // socketId -> écran
      game: {},
    };
    this.rooms.set(code, room);
    this.hooks.initRoom?.(room);
    const member = this._addMember(room, name, payload);
    room.hostId = member.id;
    return { room, member };
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  touch(room) {
    room.lastActivity = this.now();
  }

  playerCount(room) {
    return room.members.size;
  }

  // ---------- Arrivées ----------

  /** Vérifie qu'un nouveau joueur peut entrer. Renvoie un code d'erreur ou null. */
  checkJoin(room, name, payload = {}) {
    if (!room) return 'ROOM_NOT_FOUND';
    if (room.locked) return 'ROOM_LOCKED';
    if (room.members.size >= room.maxPlayers) return 'ROOM_FULL';
    if (name != null && this.isNameTaken(room, name)) return 'NAME_TAKEN';
    return this.hooks.canJoin?.(room, payload) || null;
  }

  isNameTaken(room, name) {
    const key = nameKey(name);
    for (const m of room.members.values()) if (nameKey(m.name) === key) return true;
    return false;
  }

  joinRoom(room, name, payload = {}) {
    const error = this.checkJoin(room, name, payload);
    if (error) return { error };
    const member = this._addMember(room, name, payload);
    this.emit('changed', room);
    return { room, member };
  }

  _addMember(room, name, payload) {
    const used = new Set([...room.members.values()].map((m) => m.slot));
    let slot = 0;
    while (used.has(slot) && slot < this.opts.slots - 1) slot++;
    const member = {
      id: newId(),
      token: newToken(),
      name,
      slot,
      joinedAt: this.now(),
      connected: false,
      socketId: null,
      disconnectedAt: null,
    };
    room.members.set(member.id, member);
    this.touch(room);
    this.hooks.onMemberAdded?.(room, member, payload);
    return member;
  }

  addScreen(room, socketId) {
    room.screens.set(socketId, { socketId, joinedAt: this.now() });
    this.touch(room);
    this.emit('changed', room);
  }

  removeScreen(room, socketId) {
    if (room.screens.delete(socketId)) this.emit('changed', room);
  }

  // ---------- Reconnexion ----------

  /** Retrouve un joueur grâce à son token de session. */
  resume(code, token) {
    const room = this.rooms.get(code);
    if (!room) return null;
    for (const m of room.members.values()) {
      if (safeEqual(m.token, token)) return { room, member: m };
    }
    return null;
  }

  // ---------- Connexion / déconnexion ----------

  setConnected(room, member, socketId) {
    member.connected = true;
    member.socketId = socketId;
    member.disconnectedAt = null;
    this.touch(room);
    if (room.hostId === member.id) this._clearHostTimer(room);
    this.hooks.onConnectionChange?.(room, member);
    this.emit('changed', room);
  }

  setDisconnected(room, member) {
    member.connected = false;
    member.socketId = null;
    member.disconnectedAt = this.now();
    if (room.hostId === member.id) this._startHostTimer(room);
    this.hooks.onConnectionChange?.(room, member);
    this.emit('changed', room);
  }

  _startHostTimer(room) {
    this._clearHostTimer(room);
    const timer = setTimeout(() => {
      this.hostTimers.delete(room.code);
      const host = room.members.get(room.hostId);
      if (this.rooms.get(room.code) === room && host && !host.connected) {
        this.transferHost(room);
        this.emit('changed', room);
      }
    }, this.opts.hostGraceMs);
    timer.unref?.();
    this.hostTimers.set(room.code, timer);
  }

  _clearHostTimer(room) {
    const t = this.hostTimers.get(room.code);
    if (t) clearTimeout(t);
    this.hostTimers.delete(room.code);
  }

  // ---------- Hôte ----------

  /**
   * Passe le rôle d'hôte au joueur suivant (ordre d'arrivée après l'hôte actuel),
   * en privilégiant un joueur connecté. Renvoie le nouvel hôte ou null.
   */
  transferHost(room) {
    const list = [...room.members.values()];
    const idx = list.findIndex((m) => m.id === room.hostId);
    const ordered = idx >= 0 ? [...list.slice(idx + 1), ...list.slice(0, idx)] : list;
    const next = ordered.find((m) => m.connected) || ordered[0] || null;
    if (!next) return null;
    const old = room.hostId;
    room.hostId = next.id;
    this._clearHostTimer(room);
    // Si le nouvel hôte est lui-même déconnecté, son délai de grâce démarre.
    if (!next.connected) this._startHostTimer(room);
    this.emit('host-changed', room, old, next.id);
    return next;
  }

  // ---------- Départs ----------

  /** Retire un joueur (départ volontaire ou exclusion). */
  removeMember(room, memberId, reason = 'left') {
    const member = room.members.get(memberId);
    if (!member) return null;
    const wasHost = room.hostId === memberId;
    if (wasHost) this.transferHost(room);
    room.members.delete(memberId);
    if (room.members.size === 0) {
      this.closeRoom(room, 'empty');
      return member;
    }
    if (wasHost && room.hostId === memberId) room.hostId = null; // ne devrait pas arriver
    this.touch(room);
    this.hooks.onMemberRemoved?.(room, member, reason);
    this.emit('member-removed', room, member, reason);
    this.emit('changed', room);
    return member;
  }

  // ---------- Réglages du salon ----------

  setLocked(room, locked) {
    room.locked = Boolean(locked);
    this.touch(room);
    this.emit('changed', room);
  }

  /** Change le nombre max de joueurs. Renvoie un code d'erreur ou null. */
  setMaxPlayers(room, n) {
    if (!Number.isInteger(n) || n < this.opts.minPlayers || n > this.opts.maxPlayersLimit) return 'INVALID_SETTINGS';
    if (n < room.members.size) return 'MAX_BELOW_PLAYERS';
    room.maxPlayers = n;
    this.touch(room);
    this.emit('changed', room);
    return null;
  }

  // ---------- Fermeture / expiration ----------

  closeRoom(room, reason) {
    if (this.rooms.get(room.code) !== room) return;
    this._clearHostTimer(room);
    this.rooms.delete(room.code);
    room.closed = true;
    this.emit('room-closed', room, reason);
  }

  /** Supprime les salons inactifs depuis plus de roomTtlMs. Renvoie le nombre supprimé. */
  sweep() {
    const limit = this.now() - this.opts.roomTtlMs;
    let n = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.lastActivity < limit) {
        this.closeRoom(room, 'expired');
        n++;
      }
    }
    return n;
  }
}

module.exports = { LobbyManager, randomCode, DEFAULTS };
