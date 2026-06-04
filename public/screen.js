// State configuration
const SCREEN_STATE = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  COMPLETE: 'complete'
};

let currentState = SCREEN_STATE.LOBBY;
let socket = null;
let roomCode = '';
let startTime = null;

// Canvas assets
let bgCanvas = null;
let bgCtx = null;
let puzzleCanvas = null;
let puzzleCtx = null;

let stars = [];
let particles = [];
let animationFrameId = null;
let confettiInterval = null;

// Game State
let puzzleImage = new Image();
let puzzleData = null;
let dragPositions = new Map();

// ── Timer State ───────────────────────────────────────────────────────────────
let timerInterval = null;
let timeRemaining = null;
let timeLimitSeconds = null;

// ── Audio Synthesizer ─────────────────────────────────────────────────────────
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

const Sound = {
  playSnap() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  },

  playTick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  },

  playUrgentTick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  },

  playTimeUp() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 1.0);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.0);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.0);
  },

  playComplete() {
    if (!audioCtx) return;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(261.63, audioCtx.currentTime);
    osc1.frequency.setValueAtTime(329.63, audioCtx.currentTime + 0.15);
    osc1.frequency.setValueAtTime(392.00, audioCtx.currentTime + 0.3);
    osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime + 0.45);
    osc2.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);
    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + 1.2);
    osc2.stop(audioCtx.currentTime + 1.2);
  }
};

// ── Particle Effects ──────────────────────────────────────────────────────────
function spawnSparks(x, y, color, count = 25) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 5 + 2,
      color,
      alpha: 1,
      decay: Math.random() * 0.02 + 0.01
    });
  }
}

// ── Starfield ─────────────────────────────────────────────────────────────────
function initStars() {
  stars = [];
  for (let i = 0; i < 80; i++) {
    stars.push({
      x: Math.random() * bgCanvas.width,
      y: Math.random() * bgCanvas.height,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.5 + 0.1
    });
  }
}

function updateStars() {
  stars.forEach(s => {
    s.y += s.speed;
    if (s.y > bgCanvas.height) { s.y = 0; s.x = Math.random() * bgCanvas.width; }
  });
}

function drawBackground() {
  bgCtx.fillStyle = '#060313';
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

  if (currentState === SCREEN_STATE.LOBBY) {
    const glowGrad = bgCtx.createRadialGradient(
      bgCanvas.width / 2, bgCanvas.height * 0.8, 50,
      bgCanvas.width / 2, bgCanvas.height * 0.8, bgCanvas.width * 0.6
    );
    glowGrad.addColorStop(0, 'rgba(255, 0, 127, 0.12)');
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bgCtx.fillStyle = glowGrad;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  }

  bgCtx.fillStyle = '#ffffff';
  stars.forEach(s => {
    bgCtx.globalAlpha = s.speed * 1.5;
    bgCtx.fillRect(s.x, s.y, s.size, s.size);
  });
  bgCtx.globalAlpha = 1.0;
}

// ── Timer UI ──────────────────────────────────────────────────────────────────
function renderTimer(seconds, limit) {
  let el = document.getElementById('screenTimer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'screenTimer';
    el.style.cssText = `
      position: fixed;
      top: 18px;
      right: 24px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 2.2rem;
      font-weight: bold;
      z-index: 999;
      padding: 6px 18px;
      border-radius: 8px;
      border: 2px solid #00f3ff;
      background: rgba(6,3,19,0.82);
      letter-spacing: 3px;
      transition: color 0.3s, border-color 0.3s, box-shadow 0.3s;
    `;
    document.body.appendChild(el);
  }

  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  el.textContent = `⏱ ${mins}:${secs}`;

  // Turn red and pulse when under 60 seconds
  if (seconds <= 60) {
    el.style.color = '#ff4500';
    el.style.borderColor = '#ff4500';
    el.style.boxShadow = '0 0 18px #ff4500aa';
    el.style.animation = 'timerPulse 1s infinite';
  } else {
    el.style.color = '#00f3ff';
    el.style.borderColor = '#00f3ff';
    el.style.boxShadow = '0 0 12px #00f3ff55';
    el.style.animation = 'none';
  }
}

function removeTimer() {
  const el = document.getElementById('screenTimer');
  if (el) el.remove();
}

// ── Live Leaderboard ──────────────────────────────────────────────────────────
function renderLiveLeaderboard(leaderboard) {
  let panel = document.getElementById('liveLeaderboard');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'liveLeaderboard';
    panel.style.cssText = `
      position: fixed;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      width: 210px;
      background: rgba(6,3,19,0.88);
      border: 1px solid rgba(0,243,255,0.3);
      border-radius: 12px;
      padding: 14px 12px;
      z-index: 998;
      font-family: 'Share Tech Mono', monospace;
      box-shadow: 0 0 20px rgba(0,243,255,0.1);
    `;
    panel.innerHTML = `
      <div style="color:#00f3ff;font-size:0.75rem;letter-spacing:2px;margin-bottom:10px;text-align:center;">
        🏆 LEADERBOARD
      </div>
      <div id="liveLeaderboardList"></div>
    `;
    document.body.appendChild(panel);
  }

  const list = document.getElementById('liveLeaderboardList');
  if (!list) return;

  // Animate out old entries, replace with new
  list.style.opacity = '0.4';
  setTimeout(() => {
    list.innerHTML = '';
    leaderboard.slice(0, 8).forEach((player, index) => {
      const medals = ['🥇', '🥈', '🥉'];
      const rank = medals[index] || `${index + 1}.`;

      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 4px;
        margin-bottom: 4px;
        border-radius: 6px;
        background: ${index === 0 ? 'rgba(255,184,0,0.08)' : 'transparent'};
        border-left: 3px solid ${player.color};
        transition: all 0.3s;
      `;
      row.innerHTML = `
        <span style="font-size:0.7rem;">
          <span style="margin-right:4px;">${rank}</span>
          <span style="color:${player.color};font-size:0.68rem;">
            ${player.displayName.toUpperCase().slice(0, 10)}
          </span>
        </span>
        <span style="color:#ffb800;font-size:0.68rem;font-weight:bold;">
          ${player.score}
        </span>
      `;
      list.appendChild(row);
    });
    list.style.opacity = '1';
    list.style.transition = 'opacity 0.3s';
  }, 150);
}

function removeLiveLeaderboard() {
  const el = document.getElementById('liveLeaderboard');
  if (el) el.remove();
}

// ── Socket Connection ─────────────────────────────────────────────────────────
function setupConnection() {
  const pathParts = window.location.pathname.split('/');
  roomCode = pathParts[pathParts.length - 1].toUpperCase();

  if (!roomCode || roomCode === 'SCREEN') {
    document.getElementById('joinUrlVal').textContent = 'Error: Invalid Room Code.';
    return;
  }

  document.getElementById('roomCodeVal').textContent = roomCode;
  document.getElementById('hudRoomCode').textContent = roomCode;

  fetch(`/api/room/config?roomCode=${roomCode}`)
    .then(res => res.json())
    .then(config => {
      document.getElementById('joinUrlVal').textContent = config.joinUrl;
      document.getElementById('qrcode').innerHTML = `<img src="${config.qrDataUrl}" alt="QR code" />`;
    })
    .catch(err => console.error('Error fetching QR config:', err));

  socket = io();
  socket.emit('host-room', roomCode);

  socket.on('room-created', (data) => {
    console.log('Room registered on server:', data);
  });

  socket.on('player-joined', (player) => {
    initAudio();
    addPlayerToLobbyGrid(player);
  });

  socket.on('player-left', (player) => {
    removePlayerFromLobbyGrid(player.id);
  });

  socket.on('room-update', (data) => {
    document.getElementById('playerCount').textContent = data.participantsCount;
  });

  socket.on('activity-start', (data) => {
    if (data.type === 'jigsaw') startJigsawPuzzle(data.state);
  });

  socket.on('piece-move', (data) => {
    dragPositions.set(data.pieceId, { currentX: data.currentX, currentY: data.currentY });
  });

  // ── Piece placed — update board + live leaderboard ──────────────────────────
  socket.on('piece-placed', (data) => {
    const { pieceId, correctX, correctY, placedBy, progress, isSolved, leaderboard } = data;

    dragPositions.delete(pieceId);

    if (puzzleData) {
      const piece = puzzleData.pieces.find(p => p.id === pieceId);
      if (piece) {
        piece.isPlaced = true;
        piece.currentX = correctX;
        piece.currentY = correctY;
        piece.placedByName = placedBy;
      }
    }

    Sound.playSnap();
    spawnSparks(correctX + (puzzleData.pieceWidth / 2), correctY + (puzzleData.pieceHeight / 2), '#ff007f');
    spawnSparks(correctX + (puzzleData.pieceWidth / 2), correctY + (puzzleData.pieceHeight / 2), '#00f3ff');

    const ticker = document.getElementById('activityTicker');
    ticker.textContent = `🎯 ${placedBy} placed a piece! (${progress}% solved)`;
    ticker.classList.add('pulse');
    setTimeout(() => ticker.classList.remove('pulse'), 400);

    document.getElementById('hudProgressFill').style.width = `${progress}%`;
    document.getElementById('hudProgressText').textContent = `${progress}%`;

    // Update live leaderboard on every placement
    if (leaderboard && leaderboard.length > 0) {
      renderLiveLeaderboard(leaderboard);
    }
  });

  // ── Timer tick from server ──────────────────────────────────────────────────
  socket.on('timer-tick', (data) => {
    timeRemaining = data.timeRemaining;
    timeLimitSeconds = data.timeLimitSeconds;
    renderTimer(data.timeRemaining, data.timeLimitSeconds);

    // Play tick sound — urgent every second under 10s, subtle every 10s otherwise
    if (data.timeRemaining <= 10) {
      Sound.playUrgentTick();
    } else if (data.timeRemaining % 10 === 0) {
      Sound.playTick();
    }
  });

  // ── Time's up ───────────────────────────────────────────────────────────────
  socket.on('time-up', (data) => {
    Sound.playTimeUp();
    removeTimer();
    removeLiveLeaderboard();
    triggerTimeUp(data);
  });

  // ── Puzzle solved ───────────────────────────────────────────────────────────
  socket.on('activity-complete', (data) => {
    removeTimer();
    removeLiveLeaderboard();
    triggerPuzzleCompletion(data);
  });
}

// ── Lobby Utilities ───────────────────────────────────────────────────────────
function addPlayerToLobbyGrid(player) {
  const grid = document.getElementById('playerGrid');
  if (document.getElementById(`p-${player.id}`)) return;

  const div = document.createElement('div');
  div.id = `p-${player.id}`;
  div.className = 'player-avatar';
  div.style.borderColor = player.color;
  div.style.textShadow = `0 0 5px ${player.color}`;
  div.style.boxShadow = `0 0 8px ${player.color}22`;
  div.textContent = player.displayName.toUpperCase();
  grid.appendChild(div);

  document.getElementById('playerCount').textContent = grid.children.length;
}

function removePlayerFromLobbyGrid(playerId) {
  const el = document.getElementById(`p-${playerId}`);
  if (el) el.remove();
  document.getElementById('playerCount').textContent =
    document.getElementById('playerGrid').children.length;
}

// ── Jigsaw Draw Engine ────────────────────────────────────────────────────────
function startJigsawPuzzle(state) {
  currentState = SCREEN_STATE.PLAYING;
  startTime = new Date();

  if (confettiInterval !== null) {
    clearInterval(confettiInterval);
    confettiInterval = null;
  }

  document.getElementById('lobbyScreen').classList.remove('active');
  document.getElementById('lobbyScreen').classList.add('hidden');
  document.getElementById('gameplayScreen').classList.remove('hidden');
  document.getElementById('gameplayScreen').classList.add('active');

  puzzleData = state;
  if (state.pieces) preCachePieceImages(state.pieces);
  puzzleImage.src = state.imageUrl;

  document.getElementById('hudProgressFill').style.width = `${state.progress}%`;
  document.getElementById('hudProgressText').textContent = `${state.progress}%`;
}

function updateJigsaw() {
  if (currentState !== SCREEN_STATE.PLAYING || !puzzleData) return;

  puzzleData.pieces.forEach(p => {
    if (!p.isPlaced) {
      const dragPos = dragPositions.get(p.id);
      if (dragPos) {
        p.currentX += (dragPos.currentX - p.currentX) * 0.2;
        p.currentY += (dragPos.currentY - p.currentY) * 0.2;
      } else {
        p.currentX += Math.sin(Date.now() / 1500 + p.row) * 0.15;
        p.currentY += Math.cos(Date.now() / 1500 + p.col) * 0.15;
      }
    }
  });

  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.alpha -= pt.decay;
    if (pt.alpha <= 0) particles.splice(i, 1);
  }
}

function drawJigsaw() {
  if (currentState !== SCREEN_STATE.PLAYING || !puzzleData) return;

  puzzleCtx.clearRect(0, 0, puzzleCanvas.width, puzzleCanvas.height);

  if (puzzleImage.complete) {
    puzzleCtx.save();
    puzzleCtx.globalAlpha = 0.08;
    puzzleCtx.drawImage(puzzleImage, 0, 0, puzzleCanvas.width, puzzleCanvas.height);
    puzzleCtx.restore();
  }

  // Grid lines
  puzzleCtx.strokeStyle = 'rgba(0, 243, 255, 0.15)';
  puzzleCtx.lineWidth = 1;
  for (let r = 0; r <= puzzleData.rows; r++) {
    const y = r * puzzleData.pieceHeight;
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(0, y);
    puzzleCtx.lineTo(puzzleCanvas.width, y);
    puzzleCtx.stroke();
  }
  for (let c = 0; c <= puzzleData.cols; c++) {
    const x = c * puzzleData.pieceWidth;
    puzzleCtx.beginPath();
    puzzleCtx.moveTo(x, 0);
    puzzleCtx.lineTo(x, puzzleCanvas.height);
    puzzleCtx.stroke();
  }

  // Placed pieces
  puzzleData.pieces.forEach(p => {
    if (p.isPlaced && p.imgElement) {
      puzzleCtx.drawImage(p.imgElement, p.currentX, p.currentY, puzzleData.pieceWidth, puzzleData.pieceHeight);
    }
  });

  // Floating unplaced pieces
  puzzleData.pieces.forEach(p => {
    if (!p.isPlaced && p.imgElement) {
      puzzleCtx.save();
      puzzleCtx.shadowBlur = 15;
      puzzleCtx.shadowColor = '#00f3ff';
      puzzleCtx.strokeStyle = 'rgba(0, 243, 255, 0.6)';
      puzzleCtx.lineWidth = 2;
      puzzleCtx.strokeRect(p.currentX, p.currentY, puzzleData.pieceWidth, puzzleData.pieceHeight);
      puzzleCtx.drawImage(p.imgElement, p.currentX, p.currentY, puzzleData.pieceWidth, puzzleData.pieceHeight);
      puzzleCtx.restore();
    }
  });

  // Particles
  particles.forEach(pt => {
    puzzleCtx.save();
    puzzleCtx.globalAlpha = pt.alpha;
    puzzleCtx.shadowBlur = pt.size * 2;
    puzzleCtx.shadowColor = pt.color;
    puzzleCtx.fillStyle = pt.color;
    puzzleCtx.beginPath();
    puzzleCtx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    puzzleCtx.fill();
    puzzleCtx.restore();
  });
}

function preCachePieceImages(pieces) {
  pieces.forEach(p => {
    const img = new Image();
    img.src = p.imageUrl;
    p.imgElement = img;
  });
}

// ── Puzzle Complete ───────────────────────────────────────────────────────────
function triggerPuzzleCompletion({ leaderboard, totalPieces }) {
  currentState = SCREEN_STATE.COMPLETE;
  Sound.playComplete();

  const durationSec = Math.round((new Date() - startTime) / 1000);

  document.getElementById('gameplayScreen').classList.remove('active');
  document.getElementById('gameplayScreen').classList.add('hidden');
  document.getElementById('completionScreen').classList.remove('hidden');
  document.getElementById('completionScreen').classList.add('active');

  document.getElementById('totalSlicesPlaced').textContent = totalPieces;
  document.getElementById('solvedDuration').textContent = `${durationSec} seconds`;

  // Hide time-up banner if showing
  const timeUpBanner = document.getElementById('timeUpBanner');
  if (timeUpBanner) timeUpBanner.remove();

  renderFinalLeaderboard(leaderboard);

  confettiInterval = setInterval(() => {
    if (currentState === SCREEN_STATE.COMPLETE) {
      const rx = Math.random() * puzzleCanvas.width;
      const ry = Math.random() * puzzleCanvas.height * 0.4;
      spawnSparks(rx, ry, '#39ff14', 8);
      spawnSparks(rx, ry, '#00f3ff', 8);
    }
  }, 400);
}

// ── Time's Up ─────────────────────────────────────────────────────────────────
function triggerTimeUp({ leaderboard, totalPieces, piecesPlaced }) {
  currentState = SCREEN_STATE.COMPLETE;

  document.getElementById('gameplayScreen').classList.remove('active');
  document.getElementById('gameplayScreen').classList.add('hidden');
  document.getElementById('completionScreen').classList.remove('hidden');
  document.getElementById('completionScreen').classList.add('active');

  // Show time-up banner instead of "solved" message
  document.getElementById('totalSlicesPlaced').textContent = `${piecesPlaced} / ${totalPieces}`;
  document.getElementById('solvedDuration').textContent = `Time's Up!`;

  // Inject a red banner at the top of the completion screen
  const completionScreen = document.getElementById('completionScreen');
  const banner = document.createElement('div');
  banner.id = 'timeUpBanner';
  banner.style.cssText = `
    text-align: center;
    font-family: 'Share Tech Mono', monospace;
    font-size: 2.5rem;
    color: #ff4500;
    text-shadow: 0 0 20px #ff4500;
    margin-bottom: 16px;
    letter-spacing: 4px;
    animation: timerPulse 0.8s infinite;
  `;
  banner.textContent = `⏰ TIME'S UP!`;
  completionScreen.insertBefore(banner, completionScreen.firstChild);

  renderFinalLeaderboard(leaderboard);

  // Red sparks instead of green confetti
  confettiInterval = setInterval(() => {
    if (currentState === SCREEN_STATE.COMPLETE) {
      const rx = Math.random() * puzzleCanvas.width;
      const ry = Math.random() * puzzleCanvas.height * 0.4;
      spawnSparks(rx, ry, '#ff4500', 8);
      spawnSparks(rx, ry, '#ff007f', 8);
    }
  }, 400);
}

// ── Final Leaderboard (completion/time-up screen) ─────────────────────────────
function renderFinalLeaderboard(leaderboard) {
  const list = document.getElementById('leaderboardList');
  if (!list) return;
  list.innerHTML = '';

  leaderboard.forEach((player, index) => {
    const item = document.createElement('div');
    item.className = `leaderboard-item ${index === 0 ? 'first-place' : ''}`;
    const rankPrefix = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    item.innerHTML = `
      <div class="rank-name">
        <span class="rank">${rankPrefix}</span>
        <span class="name" style="color: ${player.color}">${player.displayName.toUpperCase()}</span>
      </div>
      <div class="score">${player.score} PTS</div>
    `;
    list.appendChild(item);
  });
}

// ── Game Loop ─────────────────────────────────────────────────────────────────
function gameLoop() {
  updateStars();
  drawBackground();

  if (currentState === SCREEN_STATE.PLAYING) {
    updateJigsaw();
    drawJigsaw();
  }

  animationFrameId = requestAnimationFrame(gameLoop);
}

function handleResize() {
  if (bgCanvas) {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    initStars();
  }
}

// ── CSS animation for timer pulse ─────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes timerPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.04); }
  }
`;
document.head.appendChild(style);

window.addEventListener('DOMContentLoaded', () => {
  bgCanvas = document.getElementById('bgCanvas');
  bgCtx = bgCanvas.getContext('2d');
  puzzleCanvas = document.getElementById('puzzleCanvas');
  puzzleCtx = puzzleCanvas.getContext('2d');

  window.addEventListener('resize', handleResize);
  handleResize();
  setupConnection();
  gameLoop();
});