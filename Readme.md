# Guess It 🎯

A live multiplayer guessing game built with Node.js, Express, and Socket.io.

## How It Works

One player creates a session and becomes the **Game Master**. Others join using the Session ID. The Game Master sets a question and answer, then starts the game. Players have **3 attempts** and **60 seconds** to guess the answer. First to guess correctly wins **10 points**. The Game Master role rotates after each round.

## Rules

- Minimum 3 players to start
- Game Master cannot guess their own question
- 3 wrong attempts = eliminated for that round
- No new players can join mid-game
- Session is deleted when all players leave

## Stack

- **Backend** — Node.js, Express, Socket.io
- **Frontend** — Vanilla JS, HTML, CSS
- **Rate Limiting** — express-rate-limit (HTTP), custom socket-level limiter

## Project Structure

```
guessing-game/
├── server.js               # Entry point
├── server/
│   ├── Player.js           # Player class
│   ├── GameSession.js      # Game logic
│   ├── SessionManager.js   # Session storage
│   └── RateLimiter.js      # Socket rate limiter
└── public/
    ├── index.html
    ├── css/style.css
    └── js/client.js
```

## Running Locally

```bash
npm install
node server.js
```

Open `http://localhost:3000` in multiple browser tabs to test.

## Deployment

Deployed on [Railway](https://railway.app)