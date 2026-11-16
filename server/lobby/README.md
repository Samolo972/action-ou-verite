# Moteur de salon (`server/lobby/`)

Module indépendant du jeu, réutilisable pour n'importe quel jeu multijoueur en Socket.IO.
Il ne dépend que de `server/utils/` (validation et limitation de débit).

## Ce qu'il gère

- Création d'un salon avec un code de 6 caractères (alphabet sans 0/O/1/I/L, tiré avec `crypto.randomInt`, soit 31⁶ ≈ 887 millions de codes)
- Arrivée d'un joueur avec un pseudo unique dans le salon (insensible à la casse et aux accents)
- Arrivée d'écrans (spectateurs passifs, jamais joueurs ; 6 maximum par salon)
- Rôle d'hôte : le créateur. S'il quitte, le rôle passe au joueur suivant (ordre d'arrivée, connecté en priorité). S'il est déconnecté plus de 60 s, même chose.
- Reconnexion par token de session (32 caractères aléatoires, comparaison à temps constant)
- Exclusion par l'hôte, verrouillage, nombre max de joueurs (2 à 12)
- Expiration des salons inactifs (30 min)
- Limitation de débit : événements par socket, créations de salon par IP, essais de code par IP, connexions simultanées par IP

## Utilisation

```js
const { LobbyManager, attachLobby } = require('./lobby');

const game = createMyGame(); // voir le contrat ci-dessous
const manager = new LobbyManager({ hooks: game.hooks });
attachLobby({ io, manager, game, publicUrl: 'https://exemple.fr', trustProxy: true });
```

## Contrat du jeu

| Membre | Rôle |
|---|---|
| `hooks.initRoom(room)` | Initialise `room.game` à la création |
| `hooks.canJoin(room, payload)` | Code d'erreur si l'arrivée est refusée (ex. `AGE_REQUIRED`), sinon `null` |
| `hooks.onMemberAdded(room, member, payload)` | Un joueur arrive |
| `hooks.onMemberRemoved(room, member, reason)` | Un joueur part (`left` ou `kicked`) |
| `hooks.onConnectionChange(room, member)` | Un joueur se déconnecte ou revient |
| `attach(api)` | Reçoit `{ broadcast(room), emit(room, event, data), touch(room) }` |
| `view(room, viewer)` | Partie « jeu » de `room:state` pour ce spectateur (`viewer = { id, isHost, isScreen }`) |
| `publicInfo(room)` | Infos montrées avant de rejoindre (`room:info`) |
| `joinBlocker(room)` | Raison pour laquelle personne ne peut rejoindre en ce moment, ou `null` |
| `validateSettings(room, s)` / `applySettings(room, s)` | Réglages propres au jeu (`room:settings`) |
| `events` | `{ 'jeu:action': { role: 'host' \| 'player', handler(ctx, payload) } }` : renvoie un code d'erreur ou `null` |
| `onRoomClosed(room)` | Nettoyage (minuteurs…) |

Le jeu met `room.phase` à `'lobby'` ou `'playing'` : les réglages ne sont acceptés qu'en `'lobby'`.
Un écran ne peut envoyer aucun événement de jeu (refus `FORBIDDEN`).
