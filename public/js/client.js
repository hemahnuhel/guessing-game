'use strict';

class GameClient {
  constructor() {
    this.socket    = io();
    this.playerId  = null;
    this.sessionId = null;
    this.isMaster  = false;

    // round state
    this.attemptsUsed = 0;
    this.eliminated   = false;
    this.roundOver    = false;

    this._bindUI();
    this._bindSocket();
  }

  // UI bindings 

  _bindUI() {
    // tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
      });
    });

    // create session
    document.getElementById('create-btn').addEventListener('click', () => {
      const username = document.getElementById('create-username').value.trim();
      if (!username) return this._toast('Enter a username');
      this.socket.emit('create_session', { username }, res => {
        if (!res.ok) return this._toast(res.reason);
        this._enterGame(res);
      });
    });

    // join session
    document.getElementById('join-btn').addEventListener('click', () => {
      const username   = document.getElementById('join-username').value.trim();
      const sessionId  = document.getElementById('join-session-id').value.trim();
      if (!username)   return this._toast('Enter a username');
      if (!sessionId)  return this._toast('Enter a session ID');
      this.socket.emit('join_session', { username, sessionId }, res => {
        if (!res.ok) return this._toast(res.reason);
        this._enterGame(res);
      });
    });

    // enter key on landing inputs
    ['create-username'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('create-btn').click();
      });
    });
    ['join-username', 'join-session-id'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('join-btn').click();
      });
    });

    // copy session ID
    document.getElementById('session-id-display').addEventListener('click', () => {
      if (!this.sessionId) return;
      navigator.clipboard.writeText(this.sessionId).then(() => this._toast('Session ID copied!'));
    });

    // chat
    document.getElementById('send-msg-btn').addEventListener('click', () => this._sendChat());
    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._sendChat();
    });

    // guess
    document.getElementById('send-guess-btn').addEventListener('click', () => this._sendGuess());
    document.getElementById('guess-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._sendGuess();
    });

    // master: set question
    document.getElementById('set-q-btn').addEventListener('click', () => {
      const question = document.getElementById('q-input').value.trim();
      const answer   = document.getElementById('a-input').value.trim();
      if (!question) return this._toast('Enter a question');
      if (!answer)   return this._toast('Enter an answer');
      this.socket.emit('set_question', { question, answer }, res => {
        if (!res.ok) return this._toast(res.reason);
        this._toast('Question set!');
        document.getElementById('q-input').value = '';
        document.getElementById('a-input').value = '';
      });
    });

    // master: start game
    document.getElementById('start-game-btn').addEventListener('click', () => {
      this.socket.emit('start_game', res => {
        if (!res.ok) this._toast(res.reason);
      });
    });
  }

  // Socket bindings

  _bindSocket() {
    this.socket.on('session_updated', s  => this._renderSession(s));
    this.socket.on('system_message',  d  => this._sysMsg(d.text, d.type));
    this.socket.on('game_started',    d  => this._onGameStarted(d));
    this.socket.on('timer_tick',      d  => this._setTimer(d.timeRemaining));
    this.socket.on('wrong_guess',     d  => this._onWrongGuess(d));
    this.socket.on('game_won',        d  => this._onGameWon(d));
    this.socket.on('game_expired',    d  => this._onGameExpired(d));
    this.socket.on('round_ended',     d  => this._onRoundEnded(d));
    this.socket.on('new_message',     d  => this._addChatMsg(d.username, d.text, false));
    this.socket.on('disconnect',      () => this._sysMsg('Disconnected. Refresh to reconnect.', 'fail'));
  }

  // Enter game

  _enterGame(res) {
    this.playerId  = res.playerId;
    this.sessionId = res.session.id;

    document.getElementById('landing-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    document.getElementById('session-id-display').textContent = this.sessionId;

    this._renderSession(res.session);
    this._sysMsg('Joined session. Share the Session ID with friends!', 'info');
  }

  // Render

  _renderSession(session) {
    // derive master status fresh every render
    this.isMaster = session.gameMaster.id === this.playerId;

    // status dot
    document.getElementById('status-dot').className   = `status-dot ${session.state}`;
    document.getElementById('status-label').textContent =
      session.state === 'lobby'       ? `Lobby · ${session.playerCount} player(s)` :
      session.state === 'in_progress' ? 'Game in progress' : 'Round ended';

    // question banner
    const banner = document.getElementById('question-banner');
    if (session.question) {
      document.getElementById('question-text').textContent = session.question;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    // scoreboard
    this._renderPlayers(session.scoreboard, session.gameMaster.id);

    // master panel
    this._renderMasterPanel(session);

    // guess / chat input visibility
    this._renderInputArea(session);
  }

  _renderPlayers(scoreboard, masterId) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    scoreboard.forEach(p => {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.id === masterId ? ' is-master' : '');
      row.innerHTML = `
        <span>${p.id === masterId ? '👑' : '·'}</span>
        <span class="player-name">${this._esc(p.username)}${p.id === this.playerId ? ' (you)' : ''}</span>
        <span class="player-score">${p.score}pt</span>
      `;
      list.appendChild(row);
    });
  }

  _renderMasterPanel(session) {
    const panel    = document.getElementById('master-panel');
    const startBtn = document.getElementById('start-game-btn');
    const hint     = document.getElementById('master-hint');

    // only show panel to master when not in progress
    if (!this.isMaster || session.state === 'in_progress') {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');

    // canStart comes directly from the server
    startBtn.disabled = !session.canStart;

    if (!session.hasQuestion) {
      hint.textContent = 'Set a question first';
    } else if (session.playerCount < 3) {
      hint.textContent = 'Need at least 3 players';
    } else {
      hint.textContent = 'Ready to start!';
    }
  }

  _renderInputArea(session) {
    const guessRow    = document.getElementById('guess-row');
    const chatRow     = document.getElementById('chat-row');
    const attemptsBar = document.getElementById('attempts-bar');

    const showGuess = session.state === 'in_progress'
      && !this.isMaster
      && !this.eliminated
      && !this.roundOver;

    if (showGuess) {
      guessRow.classList.remove('hidden');
      chatRow.classList.add('hidden');
      attemptsBar.classList.remove('hidden');
      this._renderAttemptDots();
    } else {
      guessRow.classList.add('hidden');
      chatRow.classList.remove('hidden');
      attemptsBar.classList.add('hidden');
    }
  }

  _renderAttemptDots() {
    const bar = document.getElementById('attempts-bar');
    bar.innerHTML = '<span style="margin-right:6px">Attempts:</span>';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'attempt-dot' + (i < this.attemptsUsed ? ' used' : '');
      bar.appendChild(dot);
    }
    const label = document.createElement('span');
    label.style.marginLeft = '8px';
    label.textContent = `${3 - this.attemptsUsed} left`;
    bar.appendChild(label);
  }

  // Socket event handlers

  _onGameStarted({ question, session }) {
    this.attemptsUsed = 0;
    this.eliminated   = false;
    this.roundOver    = false;
    this._renderSession(session);
    this._setTimer(60);
    this._sysMsg('Game started! 60 seconds, 3 attempts. Go!', 'info');
  }

  _setTimer(seconds) {
    const el = document.getElementById('timer-number');
    el.textContent = seconds;
    el.classList.toggle('urgent', seconds <= 10);
    document.getElementById('timer-box').classList.remove('hidden');
  }

  _onWrongGuess({ username, attemptsLeft, eliminated }) {
    this._sysMsg(`${username} guessed wrong — ${attemptsLeft} attempt(s) left.`);
    if (eliminated) this._sysMsg(`${username} has been eliminated.`, 'fail');
  }

  _onGameWon({ winner, answer, scoreboard }) {
    this.roundOver = true;
    const youWon   = winner.id === this.playerId;
    this._sysMsg(
      youWon
        ? `🎉 You won! The answer was "${answer}". +10 points!`
        : `${winner.username} won! The answer was "${answer}".`,
      'win'
    );
    document.getElementById('timer-box').classList.add('hidden');
    this._renderPlayers(scoreboard, null);
    this._renderInputArea({ state: 'ended' });
  }

  _onGameExpired({ answer, scoreboard }) {
    this.roundOver = true;
    this._sysMsg(`⏰ Time's up! No one guessed. The answer was "${answer}".`, 'fail');
    document.getElementById('timer-box').classList.add('hidden');
    this._renderPlayers(scoreboard, null);
    this._renderInputArea({ state: 'ended' });
  }

  _onRoundEnded({ newMaster, session }) {
    this.roundOver = false;
    this._renderSession(session);
    const youAreMaster = newMaster.id === this.playerId;
    this._sysMsg(
      youAreMaster
        ? '👑 You are the new game master — set a question!'
        : `${newMaster.username} is the new game master.`,
      'info'
    );
  }

  // Actions

  _sendChat() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;
    this.socket.emit('send_message', { text }, res => {
      if (!res.ok) this._toast(res.reason);
    });
    input.value = '';
  }

  _sendGuess() {
    const input = document.getElementById('guess-input');
    const guess = input.value.trim();
    if (!guess) return;
    input.value = '';

    this.socket.emit('submit_guess', { guess }, res => {
      if (!res.ok) return this._toast(res.reason);
      if (res.correct) return; // game_won event handles everything

      this.attemptsUsed += 1;
      this._renderAttemptDots();
      this._toast(`Wrong! ${res.attemptsLeft} attempt(s) left.`);

      if (res.attemptsLeft === 0) {
        this.eliminated = true;
        document.getElementById('guess-row').classList.add('hidden');
        document.getElementById('attempts-bar').classList.add('hidden');
        document.getElementById('chat-row').classList.remove('hidden');
        this._sysMsg('You used all your attempts.', 'fail');
      }
    });
  }

  // Helpers

  _addChatMsg(username, text, isOwn) {
    const area = document.getElementById('chat-area');
    const msg  = document.createElement('div');
    msg.className = 'msg' + (isOwn ? ' own' : '');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msg.innerHTML = `
      <div class="msg-header">
        <span class="msg-username">${this._esc(username)}</span>
        <span>${time}</span>
      </div>
      <div class="msg-body">${this._esc(text)}</div>
    `;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
  }

  _sysMsg(text, type = '') {
    const area = document.getElementById('chat-area');
    const msg  = document.createElement('div');
    msg.className = `msg system ${type}`;
    msg.innerHTML = `<div class="msg-body">${this._esc(text)}</div>`;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
  }

  _toast(text, ms = 2800) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

document.addEventListener('DOMContentLoaded', () => { window.game = new GameClient(); });