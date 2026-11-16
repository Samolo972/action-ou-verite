// Confort mobile : écran toujours allumé, vibration, petits sons (générés, sans fichier audio).
import { prefs } from './session.js';

// ---------- Écran toujours allumé (Screen Wake Lock API) ----------

let wakeLock = null;
let wantWake = false;

async function acquire() {
  if (!wantWake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  if (wakeLock && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null; // refusé (batterie faible, navigateur…) : on ignore
  }
}

export function keepAwake(on) {
  wantWake = on;
  if (on) acquire();
  else if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// Le verrou est perdu quand l'onglet passe en arrière-plan : on le reprend au retour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});

// ---------- Vibration ----------

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* non supporté */
  }
}

// ---------- Sons ----------

let ctx = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// iOS n'autorise le son qu'après un geste : on « débloque » l'audio au premier contact.
window.addEventListener('pointerdown', () => audio(), { once: true });

function tone(freq, start, dur, type = 'sine', gain = 0.18) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sound = {
  enabled: () => prefs.sound(),
  toggle() {
    prefs.setSound(!prefs.sound());
    return prefs.sound();
  },
  /** C'est ton tour : petit arpège montant. */
  turn() {
    if (!prefs.sound()) return;
    tone(660, 0, 0.15);
    tone(880, 0.12, 0.15);
    tone(1175, 0.24, 0.25);
  },
  /** Fin du minuteur : trois bips. */
  alarm() {
    if (!prefs.sound()) return;
    for (let i = 0; i < 3; i++) tone(988, i * 0.28, 0.2, 'square', 0.12);
  },
  /** Tic de la roue / du compte à rebours. */
  tick() {
    if (!prefs.sound()) return;
    tone(520, 0, 0.06, 'triangle', 0.08);
  },
};
