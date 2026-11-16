// Mémoire locale (localStorage), protégée : en navigation privée elle peut être indisponible.
// On n'y garde que le code du salon, le token de session et des préférences, jamais d'info personnelle.
//
// Plusieurs onglets du même navigateur doivent pouvoir jouer chacun de son côté (tests à plusieurs onglets) :
// chaque onglet a un identifiant (sessionStorage) et sa session est rangée sous cet identifiant.
// Un onglet actif rafraîchit son « battement » toutes les 5 s. Un nouvel onglet (ou l'appli relancée
// après une mise en veille) peut reprendre une session dont le battement est arrêté depuis plus de 15 s.

const STORE = 'av.sessions';
const NAME_KEY = 'av.name';
const SOUND_KEY = 'av.sound';
const STALE_MS = 15000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : la reconnexion après rechargement ne marchera pas, le jeu oui */
  }
}

function tabId() {
  try {
    let id = sessionStorage.getItem('av.tab');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('av.tab', id);
    }
    return id;
  } catch {
    return 'default';
  }
}
const TAB = tabId();

function all() {
  const s = read(STORE, {});
  return s && typeof s === 'object' ? s : {};
}
function save(map) {
  const now = Date.now();
  for (const [k, v] of Object.entries(map)) if (!v || now - v.ts > MAX_AGE_MS) delete map[k];
  write(STORE, Object.keys(map).length ? map : null);
}

/** Session de cet onglet, ou une session orpheline à reprendre. */
function mine() {
  const map = all();
  if (map[TAB]) return map[TAB];
  // Pas de session pour cet onglet : on reprend la plus récente des sessions abandonnées.
  const now = Date.now();
  const orphans = Object.entries(map)
    .filter(([, v]) => v && now - v.ts > STALE_MS)
    .sort((a, b) => b[1].ts - a[1].ts);
  if (!orphans.length) return null;
  const [oldKey, entry] = orphans[0];
  delete map[oldKey];
  map[TAB] = { ...entry, ts: now };
  save(map);
  return map[TAB];
}

function put(entry) {
  const map = all();
  if (entry) map[TAB] = { ...entry, ts: Date.now() };
  else delete map[TAB];
  save(map);
}

// Battement : signale que cet onglet utilise toujours sa session.
setInterval(() => {
  const map = all();
  if (map[TAB]) {
    map[TAB].ts = Date.now();
    save(map);
  }
}, 5000);

let cached = mine();

export const session = {
  get: () => (cached && cached.kind === 'player' && typeof cached.code === 'string' && typeof cached.token === 'string' ? cached : null),
  set: (code, token) => put((cached = { kind: 'player', code, token })),
  clear: () => {
    if (cached && cached.kind === 'player') put((cached = null));
  },
};

export const screenSession = {
  get: () => (cached && cached.kind === 'screen' && typeof cached.code === 'string' ? cached : null),
  set: (code) => put((cached = { kind: 'screen', code })),
  clear: () => {
    if (cached && cached.kind === 'screen') put((cached = null));
  },
};

export const prefs = {
  name: () => {
    const n = read(NAME_KEY);
    return typeof n === 'string' ? n : '';
  },
  setName: (n) => write(NAME_KEY, n),
  sound: () => read(SOUND_KEY) !== false,
  setSound: (on) => write(SOUND_KEY, Boolean(on)),
};
