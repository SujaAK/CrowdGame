# CrowdPlay

Forked from [sachgaur/CrowdGame](https://github.com/sachgaur/CrowdGame).

A real-time multiplayer jigsaw puzzle game built for live events — one shared screen, everyone's phone as a controller.

---

## What I changed

I kept the core game intact and focused on things that felt either missing or rough around the edges.

**On the gameplay side:**

The big screen felt a bit lifeless while the puzzle was being solved — you couldn't tell who was winning or how close things were. So I added a live leaderboard that sits on the left side of the screen and updates every time someone places a piece correctly. It's subtle but makes a real difference when there are multiple players competing.

I also added a countdown timer. The admin sets a time limit in minutes before starting — if the puzzle isn't solved in time, the game ends and shows a "Time's Up" screen with the final scores. The clock turns red and starts beeping in the last 60 seconds which adds a nice bit of pressure. Setting it to 0 just disables the timer entirely.

Sound effects were another thing that felt missing. I used the Web Audio API to synthesise everything in code — no audio files needed. There's a satisfying snap when a piece lands correctly, a dull thud for wrong placements, ticking beeps in the final countdown, and a short fanfare when the puzzle is complete. The mobile controller plays sounds too.

**On the security side:**

The original code compared the admin password as plaintext. I swapped that out for bcrypt with 12 salt rounds. The hash is generated on first login and cached — so it's only computed once per server run.

Socket events weren't being validated at all, so a malicious client could send garbage payloads and potentially cause issues. I added validators for every event — room codes, player names, piece IDs, coordinates — anything unexpected gets rejected before it touches the game state.

I also added per-room admin tokens. When the big screen connects to a room, the server hands it a room-scoped JWT. That token is required to start an activity, so random players can't trigger game start by emitting the right socket event.

---

## Setup

You'll need Node.js (I used v22, anything >= 14 should work) and npm.

```bash
git clone https://github.com/SujaAK/CrowdGame.git
cd CrowdGame
npm install
npm run dev
```

The server runs on `https://localhost:3000`. It generates a self-signed SSL certificate automatically — your browser will warn you about it, just click through. The HTTPS is needed for the Web Audio API and vibration API to work on mobile.

---

## Running the game

You need three things open at the same time:

**Admin panel** — `https://localhost:3000/admin`  
Password is `admin123`. Set your grid size, optionally set a time limit, upload an image or leave it blank (it generates a default one), then hit Initialize and Start Activity.

**Big screen** — `https://localhost:3000/screen/ROOMCODE`  
Open this after you initialize the room. This is the shared display everyone watches.

**Player controller** — `https://localhost:3000/join/ROOMCODE`  
Each player opens this on their phone, types a name, and starts dragging pieces. There's also a QR code on the big screen that links directly to the join URL.

---

## Files I touched

```
src/routes/admin.js       — bcrypt login
src/socket/index.js       — payload validation, per-room tokens, leaderboard on piece-placed
src/socket/roomManager.js — timer start/stop/tick logic
public/admin.html         — added the time limit input
public/admin.js           — timer display in console, sends token + time limit on start
public/screen.js          — leaderboard panel, countdown clock, time-up screen
public/mobile.js          — sounds, mobile timer bar, time-up handling
package.json              — added bcrypt
```

---

## Assumptions and known issues

- The self-signed cert will always cause a browser warning in development. That's expected and fine — in a real deployment you'd terminate SSL at a load balancer and run the app on plain HTTP internally.

- Player identity still uses the original MD5-of-display-name approach. It works fine for the intended use case but means two players with the same name in the same room will collide. I didn't want to change the core identity system since it would have touched reconnection logic and the database layer.

- Room state is in memory, so if the server restarts mid-game everything is lost. The original codebase already notes this and suggests the Redis adapter for multi-node deployments — I didn't tackle that.

- The default password is `admin123` and there's no `.env` file committed. For anything beyond local testing, set `ADMIN_PASSWORD` and `JWT_SECRET` as environment variables.

---

## Env vars

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | Set to `production` to disable self-signed cert |
| `ADMIN_PASSWORD` | `admin123` | Change this |
| `JWT_SECRET` | `crowdplay-secret` | Change this |
| `DATABASE_URL` | — | Postgres URL, falls back to SQLite |
| `REDIS_URL` | — | Falls back to in-memory mock |
| `S3_BUCKET` | — | Falls back to local disk storage |

