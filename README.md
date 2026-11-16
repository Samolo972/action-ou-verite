# Action ou Vérité

Jeu web d'action ou vérité multijoueur : chacun joue sur son téléphone, en présentiel ou en visio. Pas de score, pas de compte, pas de base de données.

- **Back** : Node.js (LTS, ≥ 20) + Express + Socket.IO
- **Front** : HTML / CSS / JavaScript vanilla (modules ES), sans build, une seule page, mobile-first
- **Données** : parties en mémoire côté serveur, cartes dans `data/cards.json`
- **Librairies front** servies en local (`/public/vendor`, polices dans `/public/fonts`)

## Démarrer en local

```bash
npm install
npm start            # http://localhost:3004
npm test             # tests (logique de jeu, moteur de salon, bout en bout)
npm run check:cards  # contrôle de data/cards.json
```

Pour tester depuis un téléphone sur le même Wi-Fi, il faut autoriser l'origine :

```bash
PUBLIC_URL=http://192.168.1.20:3004 ALLOWED_ORIGIN=http://192.168.1.20:3004 npm start
```

(Sans HTTPS, le presse-papiers, le Wake Lock et l'installation PWA peuvent être limités par le navigateur : c'est normal.)

Plusieurs onglets d'un même navigateur peuvent jouer chacun de leur côté : la session est rangée par onglet.

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP local | `3004` |
| `PUBLIC_URL` | URL publique (liens d'invitation, Open Graph) | `http://localhost:PORT` |
| `ALLOWED_ORIGIN` | Origine(s) autorisée(s) pour CORS et WebSocket, séparées par des virgules | `PUBLIC_URL` |
| `NODE_ENV` | `production` active HSTS et `upgrade-insecure-requests` | — |
| `TRUST_PROXY` | `1` : lire l'IP client dans `X-Forwarded-For` (derrière nginx) | `1` si production |

## Structure

```
server/
  index.js          Express, helmet (CSP), route /j/:code, Socket.IO
  config.js         variables d'environnement
  lobby/            moteur de salon réutilisable (voir server/lobby/README.md)
  game/             logique action ou vérité (réglages, tirage, rotation, minuteurs)
  utils/            validation des entrées, limitation de débit
public/
  index.html        page unique (balises Open Graph)
  manifest.json     PWA
  sw.js             service worker (fichiers statiques uniquement)
  css/app.css       feuille commune (variables CSS de la maquette)
  js/               main.js (routeur), composants, écrans (views/)
  vendor/qrcode.js  générateur de QR code (MIT)
  fonts/ icons/
data/cards.json     446 cartes
deploy/             nginx.conf.example, ecosystem.config.js (PM2)
scripts/            vendor.js, make-icons.js, check-cards.js
tests/              node:test
```

## Règles implémentées

- Salon d'attente : onglet **Joueurs** (tout le monde) et **Paramètres** (hôte seulement), changements en direct.
- Paramètres : mode présentiel / à distance, niveaux SOFT / FUN / HARD / +18 (au moins un), type de cartes, minuteur des actions (aucun / 30 s / 60 s / 2 min), changements de carte (0 à 3), ordre (roue au hasard ou chacun son tour), **compte à rebours avant la roue** (aucun / 3 s / 5 s), fin de partie (illimitée / 10 / 20 / 30 tours), cartes « Tout le monde », joueurs max (2 à 12), verrouillage, retardataires.
- **L'hôte lance la roue** à chaque tour. La roue désigne un joueur qui n'est pas encore passé dans la manche (jamais deux fois de suite) ; en ordre fixe, l'ordre d'arrivée. Un joueur déconnecté est sauté.
- Environ 1 tour sur 8, une carte « Tout le monde » remplace la désignation (jamais au 1er tour ni deux fois de suite). Elle ne fait passer personne dans la rotation et **ne compte pas** dans la limite de tours. Seul l'hôte passe au tour suivant.
- Pas de bouton « Passer » : seulement « Changer de carte » (dans la limite) et « Forcer le tour suivant » pour l'hôte.
- Une carte tirée ne revient pas dans la partie tant qu'il en reste (le paquet est recyclé s'il est épuisé). Les cartes `place: "presentiel"` ne sortent jamais à distance, et inversement pour `distance`.
- Le minuteur démarre sur une carte Action (affiché pour tous, grand écran compris) ; à la fin, signal visuel + sonore + vibration, sans passage automatique.
- +18 : confirmation obligatoire pour rejoindre ; si l'hôte l'active avec des joueurs déjà là, chacun doit confirmer avant le lancement (sinon il quitte).
- Hôte : s'il quitte, le rôle passe au joueur suivant immédiatement ; s'il est déconnecté, au bout de 60 s.
- Salon supprimé après 30 min d'inactivité.

## Événements Socket.IO

Toutes les requêtes client → serveur prennent un objet et un accusé de réception `ack(res)` avec `res = { ok: true, ... }` ou `{ ok: false, error: 'CODE', message }`. En cas d'erreur, le serveur émet aussi `error`.

### Client → serveur

| Événement | Données | Qui | Effet |
|---|---|---|---|
| `room:create` | `{ name }` | tous | Crée un salon, l'émetteur devient hôte. Réponse : `{ code, token, memberId }` |
| `room:info` | `{ code }` | tous | Infos publiques avant de rejoindre : hôte, nombre de joueurs, mode, niveaux, `adult`, `joinable`, `reason` |
| `room:join` | `{ code, name, adult }` | tous | Rejoint comme joueur (`adult: true` obligatoire si +18). Réponse : `{ code, token, memberId }` |
| `room:resume` | `{ code, token }` | tous | Reprend sa place (rechargement, veille, réseau) |
| `room:leave` | `{}` | joueur / écran | Quitte le salon |
| `room:kick` | `{ memberId }` | hôte | Exclut un joueur |
| `room:lock` | `{ locked }` | hôte, salon d'attente | Verrouille / déverrouille |
| `room:settings` | réglages partiels, ex. `{ mode: 'distance' }`, `{ levels: ['FUN','HARD'] }`, `{ maxPlayers: 8 }` | hôte, salon d'attente | Change les réglages (valeurs autorisées uniquement) |
| `screen:join` | `{ code }` | tous | Rejoint comme écran (grand écran, jamais joueur) |
| `game:start` | `{}` | hôte | Lance la partie (2 joueurs minimum, confirmations 18+ faites) |
| `game:spin` | `{}` | hôte | Lance la roue (avec compte à rebours si réglé) |
| `game:choose` | `{ type: 'action' \| 'verite' }` | joueur désigné | Choisit, le serveur tire la carte |
| `game:reroll` | `{}` | joueur désigné | Change de carte (dans la limite du réglage) |
| `game:done` | `{}` | joueur désigné (hôte pour une carte « Tout le monde ») | Termine le tour |
| `game:forceNext` | `{}` | hôte | Force le passage au tour suivant |
| `game:end` | `{}` | hôte | Termine la partie |
| `game:restart` | `{}` ou `{ lobby: true }` | hôte, partie terminée | Rejoue avec les mêmes joueurs, ou revient au salon |
| `game:confirmAge` | `{}` | joueur | Confirme avoir 18 ans ou plus |

Un écran ne peut envoyer **aucun** événement de jeu ni de gestion du salon.

### Serveur → client

| Événement | Données |
|---|---|
| `room:state` | État complet, personnalisé : `code`, `inviteUrl`, `phase`, `locked`, `maxPlayers`, `hostId`, `players[]` (`id`, `name`, `slot`, `connected`, `isHost`), `screens`, `you` (`id`, `isHost`, `isScreen`), `game` (`settings`, `phase`, `turn`, `playerTurns`, `participants`, `passed`, `current` { `playerId`, `type`, `card`, `rerollsLeft`, `timer` }, `everyone`, `spin`, `countdown`, `agePending`, `youAdult`, `serverNow`) |
| `room:kicked` | Tu as été exclu |
| `room:closed` | `{ reason: 'expired' \| 'empty' }` |
| `room:replaced` | Ta place a été reprise dans un autre onglet / appareil |
| `game:timerEnd` | `{ playerId }` : fin du minuteur (son + vibration) |
| `error` | `{ code, event, message }` |

Phases de jeu : `lobby → ready → (countdown →) spinning → choosing → card → ready …`, ou `ready → everyone → ready`, puis `ended`.

## Déploiement sur le VPS (Debian, nginx, PM2)

> Port retenu : **3004** (3000 à 3003 sont déjà utilisés sur le VPS).

### 1. DNS

Chez le registrar du domaine, ajouter un enregistrement **A** :

```
av    A    <IP du VPS>    TTL 3600
```

Vérifier : `dig +short av.samuel-josephmyrtil.fr` doit renvoyer l'IP du VPS.

### 2. Installation

```bash
sudo mkdir -p /var/www/action-ou-verite /var/log/action-ou-verite
sudo chown $USER: /var/www/action-ou-verite /var/log/action-ou-verite
git clone https://github.com/Samolo972/action-ou-verite.git /var/www/action-ou-verite
cd /var/www/action-ou-verite
npm ci --omit=dev
npm test   # optionnel (demande npm ci complet)
```

### 3. PM2

```bash
sudo npm install -g pm2          # si PM2 n'est pas déjà installé
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup                      # puis lancer la commande sudo affichée
curl -s http://127.0.0.1:3004/healthz   # {"ok":true}
```

### 4. nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/av.samuel-josephmyrtil.fr
sudo ln -s /etc/nginx/sites-available/av.samuel-josephmyrtil.fr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> Si un autre site du serveur définit déjà `map $http_upgrade $connection_upgrade`, retirer ce bloc du fichier (il ne peut exister qu'une fois).

### 5. HTTPS (certbot)

```bash
sudo certbot --nginx -d av.samuel-josephmyrtil.fr
```

Certbot ajoute le bloc 443 et la redirection HTTP → HTTPS. Le renouvellement est automatique.

### 6. Mise à jour

```bash
cd /var/www/action-ou-verite
git pull
npm ci --omit=dev
pm2 restart action-ou-verite
```

Les parties en cours sont perdues au redémarrage (état en mémoire) : mettre à jour quand personne ne joue.

## Auto-audit de sécurité

Vérifié dans le code (et couvert par des tests quand c'est indiqué) :

**Injections et XSS (OWASP A03)**
- Aucun `innerHTML` / `outerHTML` / `insertAdjacentHTML` dans le front : tout passe par `textContent` ou `createElement` (`public/js/dom.js`). Les icônes SVG sont construites avec `createElementNS`.
- CSP stricte via helmet : `default-src 'self'`, `script-src 'self'`, `style-src 'self'` (pas de `unsafe-inline`, aucun script externe), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`. Les styles dynamiques (roue, minuteur) passent par le CSSOM, autorisé par la CSP. *(test)*
- Pseudos limités à 2–16 caractères (lettres, chiffres, espace, `' . _ -`), normalisés NFC ; un pseudo `<img …>` est refusé. *(test)*
- Pas de base de données, donc pas d'injection SQL / NoSQL ; un code `{ $ne: 1 }` est refusé par la validation de type. *(test)*

**Contrôle d'accès (A01)**
- Le serveur fait autorité : il tire les cartes, désigne les joueurs, gère les minuteurs.
- Chaque événement vérifie le rôle : hôte (`room:kick`, `room:settings`, `room:lock`, `game:start/spin/forceNext/end/restart`), joueur désigné (`game:choose/reroll/done`). *(tests)*
- Les écrans ne peuvent envoyer aucun événement de jeu ni de gestion. *(test)*
- Réglages et verrouillage uniquement en salon d'attente (`BAD_PHASE` sinon).
- Un socket n'agit que pour le joueur auquel il est lié (`member.socketId === socket.id`) ; un ancien onglet remplacé est détaché.

**Authentification / sessions (A07)**
- Token de session : 24 octets aléatoires (`crypto.randomBytes`), comparé à temps constant, jamais diffusé dans `room:state` *(test)*, jamais dans une URL.
- Le lien d'invitation ne contient que le code du salon.
- Codes de salon tirés avec `crypto.randomInt` (31⁶ ≈ 887 millions).

**Abus des WebSockets / déni de service**
- Origine vérifiée à l'ouverture du WebSocket (`allowRequest`), CORS limité à `ALLOWED_ORIGIN`. *(test)*
- `maxHttpBufferSize` à 4 Ko : un message plus gros coupe le socket. *(test)*
- Limitation de débit (seau de jetons) : 20 événements en rafale puis 6/s par socket ; 8 créations de salon / 10 min par IP ; 15 essais de code / 2 min par IP (codes inexistants et tokens invalides), avec blocage même sur un code valide pendant ce temps *(test)* ; 40 connexions simultanées par IP ; 500 salons maximum ; 6 écrans par salon ; 12 joueurs par salon.
- Les charges utiles doivent être des objets simples (`isPlainObject`) ; clés de réglage en liste blanche (une clé `__proto__` est refusée).
- Les gestionnaires d'événements et les minuteurs sont protégés par `try/catch` : une erreur ne fait pas tomber le serveur.
- Nettoyage périodique : salons expirés, seaux de limitation, minuteurs des salons fermés.

**Configuration (A05) et données personnelles**
- helmet : `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options`, COOP/CORP, HSTS en production ; `x-powered-by` désactivé.
- Aucune donnée personnelle stockée : pas de base, pas de cookie. Côté client, `localStorage` ne contient que code + token + pseudo préféré + préférence son.
- Logs : uniquement le démarrage et des messages d'erreur techniques, **jamais de pseudo** ; nginx configuré avec `access_log off`.
- IP client lue dans la dernière entrée de `X-Forwarded-For` (celle ajoutée par nginx), non falsifiable par le client.

**Composants (A06)** : `npm audit` sans vulnérabilité ; trois dépendances de production (express, socket.io, helmet).

**Limites connues**
- La confirmation 18+ est déclarative (case à cocher) : aucune vérification d'âge réelle n'est possible sans collecter de données.
- Un joueur exclu peut revenir avec un autre pseudo s'il a le code (verrouiller le salon l'en empêche).
- L'état est en mémoire : un redémarrage du serveur ferme toutes les parties ; une seule instance (pas de cluster).

## Licence

Code sous licence MIT. Polices Inter et Bricolage Grotesque sous licence SIL OFL (`public/fonts/`), générateur de QR code de Kazuhiko Arase sous licence MIT.
