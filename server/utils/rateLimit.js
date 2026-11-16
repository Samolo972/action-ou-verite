'use strict';
// Limiteur à seau de jetons (token bucket), en mémoire.
// Chaque clé (socket, IP…) dispose de `capacity` jetons, rechargés à `refillPerSec`.

class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.capacity      jetons max (rafale autorisée)
   * @param {number} opts.refillPerSec  jetons rendus par seconde
   * @param {() => number} [opts.now]   horloge (injectable pour les tests)
   */
  constructor({ capacity, refillPerSec, now = Date.now }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSec / 1000;
    this.now = now;
    this.buckets = new Map();
  }

  /** Consomme `cost` jetons. Renvoie true si autorisé. */
  consume(key, cost = 1) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + (t - b.last) * this.refillPerMs);
      b.last = t;
    }
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  /** Vrai si la clé a encore au moins `cost` jetons (sans consommer). */
  peek(key, cost = 1) {
    const b = this.buckets.get(key);
    if (!b) return true;
    const tokens = Math.min(this.capacity, b.tokens + (this.now() - b.last) * this.refillPerMs);
    return tokens >= cost;
  }

  /** Supprime les seaux pleins (inutiles) pour limiter la mémoire. */
  prune() {
    const t = this.now();
    for (const [key, b] of this.buckets) {
      if (b.tokens + (t - b.last) * this.refillPerMs >= this.capacity) this.buckets.delete(key);
    }
  }

  delete(key) {
    this.buckets.delete(key);
  }
}

module.exports = { RateLimiter };
