'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LobbyManager } = require('../server/lobby/LobbyManager');
const { cleanCode, cleanName, CODE_ALPHABET } = require('../server/utils/validation');
const { RateLimiter } = require('../server/utils/rateLimit');

function connect(lobby, room, member) {
  lobby.setConnected(room, member, 'sock-' + member.id);
}

test('le code de salon fait 6 caractères de l’alphabet sans ambiguïté', () => {
  const lobby = new LobbyManager();
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    const { room } = lobby.createRoom('Joueur' + i);
    assert.match(room.code, /^[A-Z2-9]{6}$/);
    for (const c of room.code) assert.ok(CODE_ALPHABET.includes(c));
    assert.ok(!/[01OIL]/.test(room.code));
    codes.add(room.code);
  }
  assert.equal(codes.size, 200);
});

test('le créateur est hôte, les pseudos sont uniques (casse et accents ignorés)', () => {
  const lobby = new LobbyManager();
  const { room, member } = lobby.createRoom('Léa');
  assert.equal(room.hostId, member.id);
  assert.equal(lobby.joinRoom(room, 'lea').error, 'NAME_TAKEN');
  assert.equal(lobby.joinRoom(room, 'LÉA').error, 'NAME_TAKEN');
  assert.ok(lobby.joinRoom(room, 'Inès').member);
});

test('salon verrouillé ou plein : arrivée refusée', () => {
  const lobby = new LobbyManager();
  const { room } = lobby.createRoom('Samuel');
  assert.equal(lobby.setMaxPlayers(room, 2), null);
  assert.ok(lobby.joinRoom(room, 'Inès').member);
  assert.equal(lobby.joinRoom(room, 'Yanis').error, 'ROOM_FULL');
  assert.equal(lobby.setMaxPlayers(room, 1), 'INVALID_SETTINGS');
  assert.equal(lobby.setMaxPlayers(room, 13), 'INVALID_SETTINGS');
  lobby.setMaxPlayers(room, 12);
  lobby.setLocked(room, true);
  assert.equal(lobby.joinRoom(room, 'Yanis').error, 'ROOM_LOCKED');
});

test('max joueurs ne peut pas descendre sous le nombre de joueurs présents', () => {
  const lobby = new LobbyManager();
  const { room } = lobby.createRoom('Samuel');
  lobby.joinRoom(room, 'Inès');
  lobby.joinRoom(room, 'Yanis');
  assert.equal(lobby.setMaxPlayers(room, 2), 'MAX_BELOW_PLAYERS');
});

test('le crochet canJoin du jeu peut refuser une arrivée', () => {
  const lobby = new LobbyManager({ hooks: { canJoin: (room, p) => (p.invited ? null : 'GAME_IN_PROGRESS') } });
  const { room } = lobby.createRoom('Samuel', {});
  assert.equal(lobby.joinRoom(room, 'Inès', {}).error, 'GAME_IN_PROGRESS');
  assert.ok(lobby.joinRoom(room, 'Inès', { invited: true }).member);
});

test('reconnexion par token', () => {
  const lobby = new LobbyManager();
  const { room, member } = lobby.createRoom('Samuel');
  assert.equal(member.token.length, 32);
  assert.equal(lobby.resume(room.code, member.token).member, member);
  assert.equal(lobby.resume(room.code, 'x'.repeat(32)), null);
  assert.equal(lobby.resume('AAAAAA', member.token), null);
});

test("départ de l'hôte : le rôle passe au joueur suivant", () => {
  const lobby = new LobbyManager();
  const { room, member: host } = lobby.createRoom('Samuel');
  const { member: ines } = lobby.joinRoom(room, 'Inès');
  const { member: yanis } = lobby.joinRoom(room, 'Yanis');
  [host, ines, yanis].forEach((m) => connect(lobby, room, m));
  lobby.removeMember(room, host.id, 'left');
  assert.equal(room.hostId, ines.id);
  lobby.removeMember(room, ines.id, 'left');
  assert.equal(room.hostId, yanis.id);
});

test("transfert d'hôte : un joueur connecté est préféré", () => {
  const lobby = new LobbyManager();
  const { room, member: host } = lobby.createRoom('Samuel');
  const { member: ines } = lobby.joinRoom(room, 'Inès');
  const { member: yanis } = lobby.joinRoom(room, 'Yanis');
  connect(lobby, room, host);
  connect(lobby, room, yanis); // Inès est déconnectée
  lobby.removeMember(room, host.id, 'left');
  assert.equal(room.hostId, yanis.id);
  assert.ok(ines);
});

test("hôte déconnecté plus longtemps que le délai de grâce : transfert", async () => {
  const lobby = new LobbyManager({ hostGraceMs: 30 });
  const { room, member: host } = lobby.createRoom('Samuel');
  const { member: ines } = lobby.joinRoom(room, 'Inès');
  connect(lobby, room, host);
  connect(lobby, room, ines);
  lobby.setDisconnected(room, host);
  assert.equal(room.hostId, host.id);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(room.hostId, ines.id);
});

test("hôte qui revient pendant le délai de grâce : il garde son rôle", async () => {
  const lobby = new LobbyManager({ hostGraceMs: 40 });
  const { room, member: host } = lobby.createRoom('Samuel');
  const { member: ines } = lobby.joinRoom(room, 'Inès');
  connect(lobby, room, host);
  connect(lobby, room, ines);
  lobby.setDisconnected(room, host);
  connect(lobby, room, host);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(room.hostId, host.id);
});

test('exclusion et salon vide supprimé', () => {
  const lobby = new LobbyManager();
  const closed = [];
  lobby.on('room-closed', (room, reason) => closed.push(reason));
  const { room, member: host } = lobby.createRoom('Samuel');
  const { member: ines } = lobby.joinRoom(room, 'Inès');
  lobby.removeMember(room, ines.id, 'kicked');
  assert.equal(room.members.has(ines.id), false);
  lobby.removeMember(room, host.id, 'left');
  assert.equal(lobby.getRoom(room.code), null);
  assert.deepEqual(closed, ['empty']);
});

test('les écrans ne comptent pas comme joueurs', () => {
  const lobby = new LobbyManager();
  const { room } = lobby.createRoom('Samuel');
  lobby.addScreen(room, 'tv1');
  lobby.addScreen(room, 'tv2');
  assert.equal(lobby.playerCount(room), 1);
  lobby.setMaxPlayers(room, 2);
  assert.ok(lobby.joinRoom(room, 'Inès').member);
});

test('expiration des salons inactifs (30 min)', () => {
  let now = 1_000_000;
  const lobby = new LobbyManager({ now: () => now });
  const { room } = lobby.createRoom('Samuel');
  const { room: active } = lobby.createRoom('Inès');
  now += 29 * 60 * 1000;
  lobby.touch(active);
  assert.equal(lobby.sweep(), 0);
  now += 2 * 60 * 1000;
  assert.equal(lobby.sweep(), 1);
  assert.equal(lobby.getRoom(room.code), null);
  assert.ok(lobby.getRoom(active.code));
});

test('emplacements (couleurs) distincts et réutilisés', () => {
  const lobby = new LobbyManager();
  const { room, member: a } = lobby.createRoom('Samuel');
  const { member: b } = lobby.joinRoom(room, 'Inès');
  const { member: c } = lobby.joinRoom(room, 'Yanis');
  assert.deepEqual([a.slot, b.slot, c.slot], [0, 1, 2]);
  lobby.removeMember(room, b.id);
  assert.equal(lobby.joinRoom(room, 'Léa').member.slot, 1);
});

test('validation : pseudo et code', () => {
  assert.equal(cleanName('  Léa  '), 'Léa');
  assert.equal(cleanName('Jean   Marc'), 'Jean Marc');
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('x'.repeat(17)), null);
  assert.equal(cleanName('<script>'), null);
  assert.equal(cleanName('-abc'), null);
  assert.equal(cleanName(42), null);
  assert.equal(cleanName("O'Neil"), "O'Neil");
  assert.equal(cleanCode('k7fq2m'), 'K7FQ2M');
  assert.equal(cleanCode('K7F Q2M'), 'K7FQ2M');
  assert.equal(cleanCode('K7FQ2'), null);
  assert.equal(cleanCode('K0FQ2M'), null);
  assert.equal(cleanCode({}), null);
});

test('limiteur de débit', () => {
  let now = 0;
  const rl = new RateLimiter({ capacity: 3, refillPerSec: 1, now: () => now });
  assert.ok(rl.consume('a'));
  assert.ok(rl.consume('a'));
  assert.ok(rl.consume('a'));
  assert.equal(rl.consume('a'), false);
  assert.ok(rl.consume('b'));
  now += 1000;
  assert.ok(rl.consume('a'));
  assert.equal(rl.consume('a'), false);
});
