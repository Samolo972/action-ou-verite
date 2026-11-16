// Connexion Socket.IO (client servi en local par le serveur : /socket.io/socket.io.js).

/* global io */
export const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

/** Envoie un événement et attend la réponse du serveur. Renvoie { ok, error, message, ... }. */
export function request(event, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'OFFLINE', message: 'Pas de connexion au serveur.' });
      return;
    }
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, error: 'TIMEOUT', message: 'Le serveur ne répond pas.' });
      else resolve(res || { ok: false, error: 'SERVER' });
    });
  });
}
