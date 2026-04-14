'use strict';

const { v4: uuidv4 } = require('uuid');

const STATE = {
  LOBBY:       'lobby',
  IN_PROGRESS: 'in_progress',
  ENDED:       'ended',
};

const ROUND_DURATION_MS = 60_000;
const MIN_PLAYERS       = 3; // master + 2 others

class GameSession {
  /**
   * @param {import('./Player')} gameMaster
   */
  constructor(gameMaster) {
    this.id         = uuidv4();
    this.state      = STATE.LOBBY;
    this.gameMaster = gameMaster;

    /** @type {Map<string, import('./Player')>} playerId -> Player */
    this.players = new Map();
    this.players.set(gameMaster.id, gameMaster);

    this.question      = null;
    this.answer        = null; // stored lowercase
    this.winner        = null;
    this._timer        = null;
    this.timeRemaining = ROUND_DURATION_MS / 1000;

    /** Called with (session) when the timer expires */
    this._onExpire = null;
  }

  // player management

  /**
   * @param {import('./Player')} player
   * @returns {{ ok: boolean, reason?: string }}
   */
  addPlayer(player) {
    if (this.state !== STATE.LOBBY)
      return { ok: false, reason: 'Game already in progress' };
    if (this.players.has(player.id))
      return { ok: false, reason: 'Already in session' };

    this.players.set(player.id, player);
    return { ok: true };
  }

  /**
   * Remove a player. Rotate master if needed.
   * @param {string} playerId
   * @returns {{ masterChanged: boolean, newMaster?: import('./Player') }}
   */
  removePlayer(playerId) {
    this.players.delete(playerId);

    if (this.gameMaster.id === playerId && this.players.size > 0) {
      this.gameMaster = this.players.values().next().value;
      return { masterChanged: true, newMaster: this.gameMaster };
    }

    return { masterChanged: false };
  }

  isEmpty() { return this.players.size === 0; }

  // question

  /**
   * @param {string} question
   * @param {string} answer
   */
  setQuestion(question, answer) {
    this.question = question.trim();
    this.answer   = answer.trim().toLowerCase();
  }

  hasQuestion() { return Boolean(this.question && this.answer); }

  // game flow

  /**
   * @param {(session: GameSession) => void} onExpire
   * @returns {{ ok: boolean, reason?: string }}
   */
  start(onExpire) {
    if (this.players.size < MIN_PLAYERS)
      return { ok: false, reason: `Need at least ${MIN_PLAYERS} players to start` };
    if (!this.hasQuestion())
      return { ok: false, reason: 'Set a question before starting' };

    this.state      = STATE.IN_PROGRESS;
    this.winner     = null;
    this._onExpire  = onExpire;
    this.timeRemaining = ROUND_DURATION_MS / 1000;

    for (const p of this.players.values()) p.resetRound();

    this._startTimer();
    return { ok: true };
  }

  _startTimer() {
    this._timer = setInterval(() => {
      this.timeRemaining -= 1;
      if (this.timeRemaining <= 0) {
        clearInterval(this._timer);
        this._timer = null;
        if (this.state === STATE.IN_PROGRESS) {
          this.state = STATE.ENDED;
          if (this._onExpire) this._onExpire(this);
        }
      }
    }, 1000);
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * @param {string} playerId
   * @param {string} guess
   * @returns {{ ok: boolean, reason?: string, correct?: boolean, attemptsLeft?: number, eliminated?: boolean, winner?: object }}
   */
  submitGuess(playerId, guess) {
    if (this.state !== STATE.IN_PROGRESS)
      return { ok: false, reason: 'Game is not in progress' };
    if (this.winner)
      return { ok: false, reason: 'Round already won' };

    const player = this.players.get(playerId);
    if (!player)
      return { ok: false, reason: 'Player not in session' };
    if (!player.canGuess())
      return { ok: false, reason: 'No attempts remaining' };

    const correct      = guess.trim().toLowerCase() === this.answer;
    const attemptsLeft = player.recordAttempt();

    if (correct) {
      player.awardWin();
      this.winner = player;
      this.state  = STATE.ENDED;
      this._stopTimer();
      return { ok: true, correct: true, winner: player.toPublic() };
    }

    return { ok: true, correct: false, attemptsLeft, eliminated: player.isEliminated };
  }

  /**
   * End the round: rotate master, reset for next round.
   * @returns {{ newMaster: import('./Player') }}
   */
  endRound() {
    this._stopTimer();

    // rotate master to next player
    const list        = Array.from(this.players.values());
    const masterIndex = list.findIndex(p => p.id === this.gameMaster.id);
    this.gameMaster   = list[(masterIndex + 1) % list.length];

    // reset round state
    this.question      = null;
    this.answer        = null;
    this.winner        = null;
    this.state         = STATE.LOBBY;
    this.timeRemaining = ROUND_DURATION_MS / 1000;

    for (const p of this.players.values()) p.resetRound();

    return { newMaster: this.gameMaster };
  }

  // serialisation

  scoreboard() {
    return Array.from(this.players.values())
      .map(p => p.toPublic())
      .sort((a, b) => b.score - a.score);
  }

  //public snapshot sent to clients (Does NOT include the answer)

  toPublic() {
    return {
      id:          this.id,
      state:       this.state,
      gameMaster:  this.gameMaster.toPublic(),
      playerCount: this.players.size,
      question:    this.question,
      hasQuestion: this.hasQuestion(),
      scoreboard:  this.scoreboard(),
      canStart:    this.players.size >= MIN_PLAYERS && this.hasQuestion(),
    };
  }
}

module.exports = { GameSession, STATE };