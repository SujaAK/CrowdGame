document.addEventListener('DOMContentLoaded', () => {
  let socket = null;
  let roomCode = '';
  let myPlayerId = '';
  let myColor = '';
  let myDisplayName = '';
  let piecesPlacedCount = 0;
  let currentAssignedPieces = [];
  let selectedPieceIndex = 0;

  // Workspace configuration
  const CANVAS_WIDTH = 1200;
  const CANVAS_HEIGHT = 800;
  let puzzleRows = 4;
  let puzzleCols = 6;

  // DOM Elements
  const joinSection = document.getElementById('joinSection');
  const waitingSection = document.getElementById('waitingSection');
  const gameplaySection = document.getElementById('gameplaySection');
  const completeSection = document.getElementById('completeSection');

  const joinForm = document.getElementById('joinForm');
  const displayNameInput = document.getElementById('displayNameInput');
  const joinRoomCode = document.getElementById('joinRoomCode');

  const welcomeText = document.getElementById('welcomeText');
  const playerColorVal = document.getElementById('playerColorVal');

  const headerPilotName = document.getElementById('headerPilotName');
  const headerColorDot = document.getElementById('headerColorDot');
  const gameProgressPct = document.getElementById('gameProgressPct');
  const assignedPiecesPool = document.getElementById('assignedPiecesPool');
  const dragBoard = document.getElementById('dragBoard');
  const pieceSelectorContainer = document.getElementById('pieceSelectorContainer');
  const myContributionsVal = document.getElementById('myContributionsVal');

  // Extract roomCode from URL (/join/ABCD)
  const pathParts = window.location.pathname.split('/');
  roomCode = pathParts[pathParts.length - 1].toUpperCase();
  joinRoomCode.textContent = roomCode;

  // ── Audio Synthesizer ───────────────────────────────────────────────────────
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  const Sound = {
    // Correct placement — satisfying rising snap
    playSnap() {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.06);
      osc.frequency.exponentialRampToValueAtTime(1100, audioCtx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.22);
    },

    // Wrong placement — low thud
    playWrong() {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    },

    // Puzzle complete — ascending fanfare
    playComplete() {
      if (!audioCtx) return;
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.13);
        gain.gain.setValueAtTime(0, audioCtx.currentTime + i * 0.13);
        gain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + i * 0.13 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.13 + 0.4);
        osc.start(audioCtx.currentTime + i * 0.13);
        osc.stop(audioCtx.currentTime + i * 0.13 + 0.4);
      });
    },

    // Timer urgent — high beep for last 10s
    playUrgentBeep() {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(1100, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    },

    // Time's up — descending alarm
    playTimeUp() {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 1.0);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.0);
      osc.start();
      osc.stop(audioCtx.currentTime + 1.0);
    }
  };

  // ── Timer Display ───────────────────────────────────────────────────────────
  function renderMobileTimer(seconds) {
    let el = document.getElementById('mobileTimer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mobileTimer';
      el.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        text-align: center;
        font-family: monospace;
        font-size: 1.3rem;
        font-weight: bold;
        padding: 6px 0;
        z-index: 999;
        letter-spacing: 3px;
        transition: background 0.3s, color 0.3s;
      `;
      document.body.insertBefore(el, document.body.firstChild);
    }

    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    el.textContent = `⏱ ${mins}:${secs}`;

    if (seconds <= 60) {
      el.style.background = 'rgba(255,69,0,0.9)';
      el.style.color = '#fff';
    } else {
      el.style.background = 'rgba(0,243,255,0.15)';
      el.style.color = '#00f3ff';
    }
  }

  function removeMobileTimer() {
    const el = document.getElementById('mobileTimer');
    if (el) el.remove();
  }

  // ── 1. Join Form ────────────────────────────────────────────────────────────
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    myDisplayName = displayNameInput.value.trim();
    if (!myDisplayName) return;
    initAudio(); // unlock AudioContext on user gesture
    initializeSocketConnection();
  });

  // ── 2. Socket Connection ────────────────────────────────────────────────────
  function initializeSocketConnection() {
    socket = io();

    socket.on('connect', () => {
      socket.emit('join-room', { roomCode, displayName: myDisplayName });
    });

    socket.on('joined-successfully', (data) => {
      myPlayerId = data.playerId;
      myColor = data.color;

      welcomeText.textContent = `WELCOME, ${myDisplayName.toUpperCase()}`;
      playerColorVal.textContent = getNeonColorName(myColor);
      playerColorVal.style.color = myColor;

      joinSection.classList.add('hidden');
      waitingSection.classList.remove('hidden');
    });

    socket.on('room-update', (data) => {
      if (data.status === 'active') {
        waitingSection.classList.add('hidden');
        gameplaySection.classList.remove('hidden');
      }
    });

    socket.on('activity-start', (data) => {
      waitingSection.classList.add('hidden');
      completeSection.classList.add('hidden');
      gameplaySection.classList.remove('hidden');

      headerPilotName.textContent = myDisplayName.toUpperCase();
      headerColorDot.style.backgroundColor = myColor;
      headerColorDot.style.boxShadow = `0 0 8px ${myColor}`;

      gameProgressPct.textContent = `${data.state.progress}%`;
      currentAssignedPieces = data.state.assignedPieces || [];
      selectedPieceIndex = 0;

      if (data.state.imageUrl) {
        dragBoard.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.65)), url(${data.state.imageUrl})`;
        dragBoard.style.backgroundSize = '100% 100%';
        dragBoard.style.backgroundPosition = 'center';
      }

      const gridOverlay = document.getElementById('gridOverlay');
      if (gridOverlay && data.state.rows && data.state.cols) {
        puzzleRows = data.state.rows;
        puzzleCols = data.state.cols;
        gridOverlay.style.gridTemplateColumns = `repeat(${puzzleCols}, 1fr)`;
        gridOverlay.style.gridTemplateRows = `repeat(${puzzleRows}, 1fr)`;
        gridOverlay.innerHTML = '';
        for (let i = 0; i < puzzleRows * puzzleCols; i++) {
          gridOverlay.appendChild(document.createElement('div'));
        }
      }

      renderAssignedPieces();
    });

    socket.on('assign-pieces', (data) => {
      currentAssignedPieces = data.assignedPieces || [];
      selectedPieceIndex = Math.max(0, Math.min(selectedPieceIndex, currentAssignedPieces.length - 1));
      renderAssignedPieces();
    });

    socket.on('piece-placed', (data) => {
      gameProgressPct.textContent = `${data.progress}%`;
      if (data.placedBy.toLowerCase() === myDisplayName.toLowerCase()) {
        piecesPlacedCount++;
        triggerHapticFeedback(true);
        Sound.playSnap(); // ✅ correct placement sound
      }
    });

    socket.on('placement-incorrect', (data) => {
      triggerHapticFeedback(false);
      Sound.playWrong(); // ❌ wrong placement sound
      const el = document.getElementById(data.pieceId);
      if (el) {
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 500);
      }
    });

    // ── Timer events ──────────────────────────────────────────────────────────
    socket.on('timer-tick', (data) => {
      renderMobileTimer(data.timeRemaining);
      if (data.timeRemaining <= 10) {
        Sound.playUrgentBeep();
      }
    });

    socket.on('time-up', () => {
      removeMobileTimer();
      Sound.playTimeUp();
      gameplaySection.classList.add('hidden');
      completeSection.classList.remove('hidden');
      myContributionsVal.textContent = piecesPlacedCount;

      // Show time's up message
      const msg = document.createElement('div');
      msg.style.cssText = `
        text-align:center;
        color:#ff4500;
        font-size:1.4rem;
        font-weight:bold;
        letter-spacing:2px;
        margin-bottom:12px;
      `;
      msg.textContent = "⏰ TIME'S UP!";
      completeSection.insertBefore(msg, completeSection.firstChild);
    });

    socket.on('activity-complete', () => {
      removeMobileTimer();
      Sound.playComplete(); // 🎉 completion fanfare
      gameplaySection.classList.add('hidden');
      completeSection.classList.remove('hidden');
      myContributionsVal.textContent = piecesPlacedCount;
    });

    socket.on('host-disconnected', () => {
      alert('Event Big Screen disconnected. Returning to entry screen.');
      window.location.reload();
    });

    socket.on('error-message', (msg) => {
      alert(msg);
      window.location.reload();
    });
  }

  // ── 3. Piece Renderer & Touch Drag Engine ───────────────────────────────────
  function renderAssignedPieces() {
    assignedPiecesPool.innerHTML = '';
    pieceSelectorContainer.innerHTML = '';

    if (!currentAssignedPieces || currentAssignedPieces.length === 0) {
      assignedPiecesPool.innerHTML = '<div class="minimap-hint" style="color:var(--color-cyan)">Waiting for piece assignment...</div>';
      return;
    }

    selectedPieceIndex = Math.max(0, Math.min(selectedPieceIndex, currentAssignedPieces.length - 1));

    const p = currentAssignedPieces[selectedPieceIndex];
    const el = document.createElement('div');
    el.className = 'draggable-piece';
    el.id = p.id;

    const percentWidth = 100 / puzzleCols;
    const percentHeight = 100 / puzzleRows;
    el.style.width = `${percentWidth}%`;
    el.style.height = `${percentHeight}%`;
    el.style.left = '50%';
    el.style.top = '75%';
    el.innerHTML = `<img src="${p.imageUrl}" alt="Puzzle Piece" draggable="false" />`;

    assignedPiecesPool.appendChild(el);
    setupDragging(el, p);

    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;bottom:6px;left:0;right:0;text-align:center;font-size:11px;color:rgba(0,243,255,0.5);font-family:monospace;pointer-events:none;';
    hint.textContent = `Target: row ${p.row + 1}, col ${p.col + 1}`;
    assignedPiecesPool.appendChild(hint);

    if (currentAssignedPieces.length > 1) {
      currentAssignedPieces.forEach((piece, idx) => {
        const tab = document.createElement('div');
        tab.className = `piece-tab ${idx === selectedPieceIndex ? 'active' : ''}`;
        tab.innerHTML = `
          <div class="piece-tab-thumb">
            <img src="${piece.imageUrl}" alt="Piece Thumbnail" draggable="false" />
          </div>
          <div class="piece-tab-info">
            <span class="tab-title">Piece ${idx + 1}</span>
            <span class="tab-target">Row ${piece.row + 1}, Col ${piece.col + 1}</span>
          </div>
        `;
        tab.addEventListener('click', () => {
          if (selectedPieceIndex !== idx) {
            selectedPieceIndex = idx;
            renderAssignedPieces();
          }
        });
        pieceSelectorContainer.appendChild(tab);
      });
    }
  }

  function setupDragging(element, pieceInfo) {
    let active = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;
    let xOffset = 0;
    let yOffset = 0;

    element.addEventListener('pointerdown', dragStart);

    function dragStart(e) {
      e.preventDefault();
      active = true;
      element.classList.add('dragging');
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      document.addEventListener('pointermove', drag, { passive: false });
      document.addEventListener('pointerup', dragEnd);
    }

    function drag(e) {
      if (!active) return;
      e.preventDefault();

      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      xOffset = currentX;
      yOffset = currentY;

      element.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px)) scale(1.1)`;

      const rect = dragBoard.getBoundingClientRect();
      const touchX = e.clientX - rect.left;
      const touchY = e.clientY - rect.top;

      const cellWidth = rect.width / puzzleCols;
      const cellHeight = rect.height / puzzleRows;

      const targetCol = Math.max(0, Math.min(puzzleCols - 1, Math.floor(touchX / cellWidth)));
      const targetRow = Math.max(0, Math.min(puzzleRows - 1, Math.floor(touchY / cellHeight)));

      const canvasX = Math.round(targetCol * (CANVAS_WIDTH / puzzleCols));
      const canvasY = Math.round(targetRow * (CANVAS_HEIGHT / puzzleRows));

      socket.emit('move-piece', {
        pieceId: pieceInfo.id,
        currentX: canvasX,
        currentY: canvasY
      });
    }

    function dragEnd(e) {
      if (!active) return;
      active = false;
      element.classList.remove('dragging');

      document.removeEventListener('pointermove', drag);
      document.removeEventListener('pointerup', dragEnd);

      const rect = dragBoard.getBoundingClientRect();
      const touchX = e.clientX - rect.left;
      const touchY = e.clientY - rect.top;

      const cellWidth = rect.width / puzzleCols;
      const cellHeight = rect.height / puzzleRows;

      const targetCol = Math.max(0, Math.min(puzzleCols - 1, Math.floor(touchX / cellWidth)));
      const targetRow = Math.max(0, Math.min(puzzleRows - 1, Math.floor(touchY / cellHeight)));

      const canvasX = Math.round(targetCol * (CANVAS_WIDTH / puzzleCols));
      const canvasY = Math.round(targetRow * (CANVAS_HEIGHT / puzzleRows));

      socket.emit('place-piece', {
        pieceId: pieceInfo.id,
        currentX: canvasX,
        currentY: canvasY
      });

      xOffset = 0;
      yOffset = 0;
      element.style.transform = `translate(-50%, -50%)`;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function getNeonColorName(hex) {
    const colors = {
      '#ff007f': 'NEON PINK',
      '#00f3ff': 'NEON CYAN',
      '#ffb800': 'NEON GOLD',
      '#39ff14': 'NEON GRASS',
      '#9d00ff': 'NEON AMETHYST',
      '#ff4500': 'NEON RED',
      '#e0b0ff': 'NEON MAUVE',
      '#ff00ff': 'NEON MAGENTA'
    };
    return colors[hex] || 'NEON PILOT';
  }

  function triggerHapticFeedback(success) {
    if ('vibrate' in navigator) {
      navigator.vibrate(success ? [40, 40, 60] : 200);
    }
  }
});