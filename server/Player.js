'use strict';

const MAX_ATTEMPTS = 3;
const WIN_POINTS   = 10;

class Player {
  /**
   * @param {string} id       - unique player id (uuid)
   * @param {string} username
   * @param {string} socketId
   */
  constructor(id, username, socketId) {
    this.id       = id;
    this.username = username;
    this.socketId = socketId;
    this.score    = 0;

    // reset each round
    this.attempts            = 0;
    this.hasGuessedCorrectly = false;
    this.isEliminated        = false;
  }

  // round state

  resetRound() {
    this.attempts            = 0;
    this.hasGuessedCorrectly = false;
    this.isEliminated        = false;
  }

  // Record one attempt. Returns attempts remaining.
  recordAttempt() {
    this.attempts += 1;
    const remaining = MAX_ATTEMPTS - this.attempts;
    if (remaining <= 0) this.isEliminated = true;
    return remaining;
  }

  canGuess() {
    return !this.hasGuessedCorrectly && !this.isEliminated;
  }

  awardWin() {
    this.hasGuessedCorrectly = true;
    this.score += WIN_POINTS;
  }

  // never expose socketId
  toPublic() {
    return { id: this.id, username: this.username, score: this.score };
  }
}

module.exports = Player;