'use strict';
// Tests de bout en bout : vrai serveur, vrais sockets.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL_ = `http://localhost:${PORT}`;
let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), PUBLIC_URL: URL_, NODE_ENV: 'test', TRUST_PROXY: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serveur non démarré')), 8000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('démarré')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
});

test.after(() => server.kill());

const clients = [];
function client(opts = {}) {
  const s = io(URL_, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { origin: URL_ }, ...opts });
  clients.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const emit = (s, ev, p = {}) => new Promise((r) => s.emit(ev, p, r));
const nextState = (s) => new Promise((r) => s.once('room:state', r));
test.afterEach(() => {
  while (clients.length) clients.pop().close();
});

test('page d’accueil et lien d’invitation servis avec les en-têtes de sécurité', async () => {
  const res = await fetch(URL_ + '/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const html = await res.text();
  assert.match(html, /og:title" content="Rejoins ma partie d'Action ou Vérité"/);
  assert.ok(html.includes(`${URL_}/icons/og.png`));
  assert.equal((await fetch(URL_ + '/j/K7FQ2M')).status, 200);
  const bad = await fetch(URL_ + '/j/<script>', { redirect: 'manual' });
  assert.equal(bad.status, 302);
  const lower = await fetch(URL_ + '/j/k7fq2m', { redirect: 'manual' });
  assert.equal(lower.status, 301);
});

test('origine WebSocket étrangère refusée', async () => {
  await assert.rejects(client({ extraHeaders: { origin: 'https://evil.example' } }));
});

test('créer, rejoindre par code, infos du salon, reconnexion par token', async () => {
  const host = await client();
  const created = await emit(host, 'room:create', { name: 'Samuel' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-HJKMNP-Z2-9]{6}$/);

  const guest = await client();
  const info = await emit(guest, 'room:info', { code: created.code.toLowerCase() });
  assert.equal(info.ok, true);
  assert.equal(info.info.hostName, 'Samuel');
  assert.equal(info.info.playerCount, 1);

  const taken = await emit(guest, 'room:join', { code: created.code, name: 'samuel' });
  assert.equal(taken.error, 'NAME_TAKEN');
  const statePromise = nextState(guest);
  const joined = await emit(guest, 'room:join', { code: created.code, name: 'Inès' });
  assert.equal(joined.ok, true);
  const st = await statePromise;
  assert.equal(st.players.length, 2);
  assert.equal(st.you.isHost, false);
  assert.ok(!JSON.stringify(st).includes(joined.token), 'le token ne doit jamais circuler dans l’état');

  // L'invité « recharge la page » : nouveau socket, même token.
  guest.close();
  const again = await client();
  const resumed = await emit(again, 'room:resume', { code: created.code, token: joined.token });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.memberId, joined.memberId);
  const wrong = await emit(again, 'room:resume', { code: created.code, token: 'x'.repeat(32) });
  assert.equal(wrong.ok, false);
});

test("un écran ne compte pas comme joueur et ne peut envoyer aucun événement de jeu", async () => {
  const host = await client();
  const { code } = await emit(host, 'room:create', { name: 'Samuel' });
  const tv = await client();
  const st = nextState(tv);
  assert.equal((await emit(tv, 'screen:join', { code })).ok, true);
  const s = await st;
  assert.equal(s.you.isScreen, true);
  assert.equal(s.players.length, 1);
  for (const ev of ['game:start', 'game:spin', 'game:choose', 'game:done', 'game:forceNext', 'room:kick', 'room:settings']) {
    const r = await emit(tv, ev, { type: 'action' });
    assert.equal(r.ok, false, ev);
  }
});

test('seul l’hôte règle, exclut et lance ; validation stricte des réglages', async () => {
  const host = await client();
  const { code } = await emit(host, 'room:create', { name: 'Samuel' });
  const guest = await client();
  const j = await emit(guest, 'room:join', { code, name: 'Inès' });
  assert.equal((await emit(guest, 'room:settings', { mode: 'distance' })).error, 'NOT_HOST');
  assert.equal((await emit(guest, 'game:start')).error, 'NOT_HOST');
  assert.equal((await emit(host, 'room:settings', { mode: 'lune' })).error, 'INVALID_SETTINGS');
  assert.equal((await emit(host, 'room:settings', { timer: '60' })).error, 'INVALID_SETTINGS');
  assert.equal((await emit(host, 'room:settings', { maxPlayers: 1 })).error, 'INVALID_SETTINGS');
  assert.equal((await emit(host, 'room:settings', { mode: 'distance', maxPlayers: 6 })).ok, true);
  const kicked = new Promise((r) => guest.once('room:kicked', r));
  assert.equal((await emit(host, 'room:kick', { memberId: j.memberId })).ok, true);
  await kicked;
  assert.equal((await emit(guest, 'game:choose', { type: 'action' })).error, 'NOT_IN_ROOM');
});

test('départ de l’hôte : le rôle passe au joueur suivant', async () => {
  const host = await client();
  const { code } = await emit(host, 'room:create', { name: 'Samuel' });
  const guest = await client();
  await emit(guest, 'room:join', { code, name: 'Inès' });
  const st = new Promise((r) => guest.on('room:state', (x) => x.players.length === 1 && r(x)));
  await emit(host, 'room:leave');
  const s = await st;
  assert.equal(s.you.isHost, true);
  assert.equal(s.players.length, 1);
});

test('entrées malformées refusées sans planter le serveur', async () => {
  const s = await client();
  assert.equal((await emit(s, 'room:create', { name: '<img src=x onerror=alert(1)>' })).error, 'INVALID_NAME');
  assert.equal((await emit(s, 'room:join', { code: { $ne: 1 }, name: 'Bob' })).error, 'INVALID_CODE');
  assert.equal((await emit(s, 'room:create', [1, 2, 3])).ok, false);
  const big = 'x'.repeat(10000);
  s.emit('room:create', { name: big }); // dépasse maxHttpBufferSize : le serveur coupe ce socket
  const s2 = await client();
  assert.equal((await emit(s2, 'room:info', { code: 'ZZZZZ' })).error, 'INVALID_CODE');
});

test('anti-bruteforce : trop de codes inexistants bloque les essais', async () => {
  const s = await client();
  let blocked = false;
  for (let i = 0; i < 30; i++) {
    const r = await emit(s, 'room:info', { code: 'ZZZZZ' + 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[i] });
    if (r.error === 'TOO_MANY_ATTEMPTS') {
      blocked = true;
      break;
    }
    assert.ok(['ROOM_NOT_FOUND', 'RATE_LIMIT'].includes(r.error), r.error);
  }
  assert.ok(blocked, 'les essais de code doivent finir par être bloqués');
});
