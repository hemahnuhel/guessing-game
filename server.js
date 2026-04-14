'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const SessionManager = require('./server/SessionManager');
const Player         = require('./server/Player');
const RateLimiter    = require('./server/RateLimiter');

// App setup
const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// HTTP rate limit 
app.use(rateLimit({
  windowMs:        60_000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — slow down.' },
}));

// Shared state
const sessions   = new SessionManager();
const socketRL   = new RateLimiter();

// Rate limit budgets per socket action
const RL = {
  create:     { max: 3,  ms: 60_000 },
  join:       { max: 5,  ms: 60_000 },
  setQuestion:{ max: 10, ms: 60_000 },
  guess:      { max: 10, ms: 30_000 },
  chat:       { max: 20, ms: 30_000 },
};

// Helpers
const broadcast = (sessionId, event, data) => io.to(sessionId).emit(event, data);

/**
 * Wrap a socket handler with rate limiting.
 * @param {string} action
 * @param {import('socket.io').Socket} socket
 * @param {Function} fn
 * @param {Function} callback
 */
function withRateLimit(action, socket, fn, callback) {
  const { allowed, retryAfter } = socketRL.check(socket.id, action, RL[action].max, RL[action].ms);
  if (!allowed) return callback({ ok: false, reason: `Rate limited — retry in ${retryAfter}s` });
  fn();
}

// Socket events
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  // create_session
  socket.on('create_session', ({ username } = {}, cb) => {
    withRateLimit('create', socket, () => {
      if (!username?.trim() || username.trim().length < 2)
        return cb({ ok: false, reason: 'Username must be at least 2 characters' });

      const master  = new Player(uuidv4(), username.trim(), socket.id);
      const session = sessions.create(master);

      socket.join(session.id);
      socket.data.playerId  = master.id;
      socket.data.sessionId = session.id;

      console.log(`[session created] ${session.id} by ${master.username}`);
      cb({ ok: true, playerId: master.id, session: session.toPublic() });
    }, cb);
  });

  // join_session
  socket.on('join_session', ({ username, sessionId } = {}, cb) => {
    withRateLimit('join', socket, () => {
      if (!username?.trim() || username.trim().length < 2)
        return cb({ ok: false, reason: 'Username must be at least 2 characters' });

      const session = sessions.get(sessionId);
      if (!session) return cb({ ok: false, reason: 'Session not found' });

      const player = new Player(uuidv4(), username.trim(), socket.id);
      const result = session.addPlayer(player);
      if (!result.ok) return cb({ ok: false, reason: result.reason });

      socket.join(session.id);
      socket.data.playerId  = player.id;
      socket.data.sessionId = session.id;

      console.log(`[joined] ${player.username} -> ${session.id}`);
      cb({ ok: true, playerId: player.id, session: session.toPublic() });
      broadcast(session.id, 'session_updated', session.toPublic());
    }, cb);
  });

  // set_question
  socket.on('set_question', ({ question, answer } = {}, cb) => {
    withRateLimit('setQuestion', socket, () => {
      const session = sessions.get(socket.data.sessionId);
      if (!session) return cb({ ok: false, reason: 'Session not found' });

      if (session.gameMaster.id !== socket.data.playerId)
        return cb({ ok: false, reason: 'Only the game master can set questions' });
      if (session.state !== 'lobby')
        return cb({ ok: false, reason: 'Cannot change question while game is running' });
      if (!question?.trim() || question.trim().length < 3)
        return cb({ ok: false, reason: 'Question too short (min 3 chars)' });
      if (!answer?.trim())
        return cb({ ok: false, reason: 'Answer cannot be empty' });

      session.setQuestion(question, answer);
      cb({ ok: true });

      // broadcast updated session so all clients re-render
      broadcast(session.id, 'session_updated', session.toPublic());
      broadcast(session.id, 'system_message', {
        text: 'Game master has set a question. Ready to start!',
        type: 'info',
      });
    }, cb);
  });

  // start_game
  socket.on('start_game', (cb) => {
    const session = sessions.get(socket.data.sessionId);
    if (!session) return cb({ ok: false, reason: 'Session not found' });

    if (session.gameMaster.id !== socket.data.playerId)
      return cb({ ok: false, reason: 'Only the game master can start the game' });

    const result = session.start((expiredSession) => {
      // timer expired
      broadcast(expiredSession.id, 'game_expired', {
        answer:     expiredSession.answer,
        scoreboard: expiredSession.scoreboard(),
      });
      const { newMaster } = expiredSession.endRound();
      broadcast(expiredSession.id, 'round_ended', {
        newMaster: newMaster.toPublic(),
        session:   expiredSession.toPublic(),
      });
    });

    if (!result.ok) return cb({ ok: false, reason: result.reason });

    cb({ ok: true });
    broadcast(session.id, 'game_started', {
      question: session.question,
      session:  session.toPublic(),
    });

    // send a timer tick every second
    const tick = setInterval(() => {
      if (session.state !== 'in_progress') return clearInterval(tick);
      broadcast(session.id, 'timer_tick', { timeRemaining: session.timeRemaining });
    }, 1000);
  });

  // submit_guess 
  socket.on('submit_guess', ({ guess } = {}, cb) => {
    withRateLimit('guess', socket, () => {
      if (!guess?.trim()) return cb({ ok: false, reason: 'Guess cannot be empty' });

      const session = sessions.get(socket.data.sessionId);
      if (!session) return cb({ ok: false, reason: 'Session not found' });

      if (session.gameMaster.id === socket.data.playerId)
        return cb({ ok: false, reason: 'Game master cannot guess their own question' });

      const result = session.submitGuess(socket.data.playerId, guess);
      if (!result.ok) return cb({ ok: false, reason: result.reason });

      cb({ ok: true, correct: result.correct, attemptsLeft: result.attemptsLeft });

      if (result.correct) {
        broadcast(session.id, 'game_won', {
          winner:     result.winner,
          answer:     session.answer,
          scoreboard: session.scoreboard(),
        });
        const { newMaster } = session.endRound();
        broadcast(session.id, 'round_ended', {
          newMaster: newMaster.toPublic(),
          session:   session.toPublic(),
        });
      } else {
        const player = session.players.get(socket.data.playerId);
        broadcast(session.id, 'wrong_guess', {
          username:    player?.username ?? 'Someone',
          attemptsLeft: result.attemptsLeft,
          eliminated:  result.eliminated,
        });
      }
    }, cb);
  });

  // send_message
  socket.on('send_message', ({ text } = {}, cb) => {
    withRateLimit('chat', socket, () => {
      if (!text?.trim()) return cb({ ok: false, reason: 'Message cannot be empty' });

      const session = sessions.get(socket.data.sessionId);
      if (!session) return cb({ ok: false, reason: 'Session not found' });

      const player = session.players.get(socket.data.playerId);
      if (!player) return cb({ ok: false, reason: 'Player not found' });

      cb({ ok: true });
      broadcast(session.id, 'new_message', {
        username:  player.username,
        text:      text.trim().slice(0, 300),
        timestamp: Date.now(),
      });
    }, cb);
  });

  // disconnect
  socket.on('disconnect', () => {
    const { playerId, sessionId } = socket.data ?? {};
    socketRL.clearSocket(socket.id);
    if (!playerId || !sessionId) return;

    const session = sessions.get(sessionId);
    if (!session) return;

    const username = session.players.get(playerId)?.username ?? 'A player';
    const { masterChanged, newMaster } = session.removePlayer(playerId);

    broadcast(sessionId, 'session_updated', session.toPublic());
    broadcast(sessionId, 'system_message', { text: `${username} left.`, type: 'info' });

    if (masterChanged) {
      broadcast(sessionId, 'system_message', {
        text: `${newMaster.username} is the new game master.`,
        type: 'info',
      });
    }

    if (sessions.cleanupIfEmpty(sessionId)) {
      console.log(`[session deleted] ${sessionId}`);
    }

    console.log(`[-] ${username} left ${sessionId}`);
  });
});

// Start
const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => console.log(`\n 🎮 http://localhost:${PORT}\n`));