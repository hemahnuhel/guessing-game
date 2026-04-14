'use strict';

class RateLimiter {
  constructor() {
    this.records = new Map();
  }

  /**
   * @param {string} socketId
   * @param {string} action    - e.g. "guess", "join", "create"
   * @param {number} maxCount  - max calls allowed in window
   * @param {number} windowMs  - rolling window in ms
   * @returns {{ allowed: boolean, retryAfter?: number }}
   */
  check(socketId, action, maxCount, windowMs) {
    const key    = `${action}:${socketId}`;
    const now    = Date.now();
    const record = this.records.get(key);

    if (!record || now > record.resetAt) {
      this.records.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }

    if (record.count >= maxCount) {
      return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
    }

    record.count += 1;
    return { allowed: true };
  }

  // Clean up all records for a disconnected socket
  clearSocket(socketId) {
    for (const key of this.records.keys()) {
      if (key.endsWith(`:${socketId}`)) this.records.delete(key);
    }
  }
}

module.exports = RateLimiter;