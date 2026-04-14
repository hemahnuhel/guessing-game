'use strict';

const { GameSession } = require('./GameSession');

class SessionManager {
  constructor() {
    /** @type {Map<string, GameSession>} */
    this.sessions = new Map();
  }

  /**
   * @param {import('./Player')} gameMaster
   * @returns {GameSession}
   */
  create(gameMaster) {
    const session = new GameSession(gameMaster);
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * @param {string} id
   * @returns {GameSession|null}
   */
  get(id) {
    return this.sessions.get(id) ?? null;
  }

  // Delete session if empty
  cleanupIfEmpty(id) {
    const session = this.sessions.get(id);
    if (session?.isEmpty()) {
      this.sessions.delete(id);
      return true;
    }
    return false;
  }
}

module.exports = SessionManager;