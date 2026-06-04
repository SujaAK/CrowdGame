document.addEventListener('DOMContentLoaded', () => {
  let socket = null;
  let authToken = null;
  let activeRoomCode = null;
  let uploadedImageUrl = null;
  let roomAdminToken = null; // per-room admin token received on host-room

  // DOM Elements
  const loginSection = document.getElementById('loginSection');
  const controlSection = document.getElementById('controlSection');
  const loginForm = document.getElementById('loginForm');
  const adminPassword = document.getElementById('adminPassword');
  const loginError = document.getElementById('loginError');

  const setupForm = document.getElementById('setupForm');
  const roomCodeInput = document.getElementById('roomCodeInput');
  const gridRows = document.getElementById('gridRows');
  const gridCols = document.getElementById('gridCols');
  const timeLimitInput = document.getElementById('timeLimitMinutes');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('puzzleImageFile');
  const uploadStatus = document.getElementById('uploadStatus');
  const imagePreviewContainer = document.getElementById('imagePreviewContainer');
  const imagePreview = document.getElementById('imagePreview');
  const clearImageBtn = document.getElementById('clearImageBtn');
  const createRoomBtn = document.getElementById('createRoomBtn');

  const consolePlaceholder = document.getElementById('consolePlaceholder');
  const consoleActive = document.getElementById('consoleActive');
  const activeRoomCodeDisp = document.getElementById('activeRoomCode');
  const activeRoomStatusDisp = document.getElementById('activeRoomStatus');
  const qrCodeWrapper = document.getElementById('qrCodeWrapper');
  const activeJoinUrl = document.getElementById('activeJoinUrl');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const attendeesCount = document.getElementById('attendeesCount');
  const puzzleProgress = document.getElementById('puzzleProgress');
  const startActivityBtn = document.getElementById('startActivityBtn');
  const resetRoomBtn = document.getElementById('resetRoomBtn');
  const consoleLog = document.getElementById('consoleLog');

  // ── Console Logger ──────────────────────────────────────────────────────────
  function consoleLogMsg(msg) {
    const time = new Date().toLocaleTimeString();
    consoleLog.innerHTML += `\n[${time}] ${msg}`;
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  // ── 1. Admin Authentication ─────────────────────────────────────────────────
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword.value })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        authToken = data.token;
        loginSection.classList.add('hidden');
        controlSection.classList.remove('hidden');
        initializeSocket();
      } else {
        loginError.textContent = data.error || 'Authentication failed.';
        loginError.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Login error:', err);
      loginError.textContent = 'Network error connecting to authentication service.';
      loginError.classList.remove('hidden');
    }
  });

  // ── 2. Socket Initialization ────────────────────────────────────────────────
  function initializeSocket() {
    socket = io({ auth: { token: authToken } });

    socket.on('connect', () => {
      console.log('Admin socket connected.');
    });

    // Store the room-scoped admin token issued by the server on host-room
    socket.on('room-created', (data) => {
      if (data.roomAdminToken) {
        roomAdminToken = data.roomAdminToken;
        console.log('[Admin] Room admin token received.');
      }
    });

    socket.on('player-joined', (data) => {
      consoleLogMsg(`👤 Player '${data.displayName}' connected.`);
      attendeesCount.textContent = data.count;
    });

    socket.on('player-left', (data) => {
      consoleLogMsg(`👤 Player '${data.displayName}' disconnected.`);
      attendeesCount.textContent = data.count;
    });

    socket.on('piece-placed', (data) => {
      puzzleProgress.textContent = `${data.progress}%`;
      consoleLogMsg(`🧩 Piece placed by ${data.placedBy}! Progress: ${data.progress}%`);
    });

    // Timer tick — update admin console with remaining time
    socket.on('timer-tick', (data) => {
      const mins = Math.floor(data.timeRemaining / 60).toString().padStart(2, '0');
      const secs = (data.timeRemaining % 60).toString().padStart(2, '0');
      const timerDisp = document.getElementById('adminTimerDisplay');
      if (timerDisp) {
        timerDisp.textContent = `⏱ ${mins}:${secs}`;
        timerDisp.style.color = data.timeRemaining <= 60 ? '#ff4500' : '#00f3ff';
      }
    });

    socket.on('time-up', (data) => {
      consoleLogMsg(`⏰ TIME'S UP! Pieces placed: ${data.piecesPlaced}/${data.totalPieces}`);
      activeRoomStatusDisp.textContent = 'TIME UP';
      activeRoomStatusDisp.className = 'value status-badge completed';
    });

    socket.on('activity-complete', (data) => {
      consoleLogMsg(`🏆 PUZZLE COMPLETE! All pieces placed.`);
      activeRoomStatusDisp.textContent = 'COMPLETED';
      activeRoomStatusDisp.className = 'value status-badge completed';
    });

    socket.on('error-message', (msg) => {
      consoleLogMsg(`[ERROR] ${msg}`);
      alert(msg);
    });
  }

  // ── 3. File Upload Handling ─────────────────────────────────────────────────
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#00f3ff';
    dropzone.style.background = 'rgba(0, 243, 255, 0.08)';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'rgba(0, 243, 255, 0.3)';
    dropzone.style.background = 'rgba(0, 243, 255, 0.02)';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'rgba(0, 243, 255, 0.3)';
    dropzone.style.background = 'rgba(0, 243, 255, 0.02)';
    if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  });

  async function handleFileUpload(file) {
    if (!file.type.startsWith('image/')) {
      alert('File must be an image type (PNG, JPEG, GIF).');
      return;
    }

    uploadStatus.classList.remove('hidden');
    dropzone.classList.add('hidden');

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('/api/admin/upload-puzzle-image', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
      });

      const data = await response.json();

      if (response.ok && data.success) {
        uploadedImageUrl = data.imageUrl;
        imagePreview.src = uploadedImageUrl;
        imagePreviewContainer.classList.remove('hidden');
      } else {
        alert(data.error || 'Image upload failed.');
        dropzone.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Error uploading file to storage server.');
      dropzone.classList.remove('hidden');
    } finally {
      uploadStatus.classList.add('hidden');
    }
  }

  clearImageBtn.addEventListener('click', () => {
    uploadedImageUrl = null;
    fileInput.value = '';
    imagePreviewContainer.classList.add('hidden');
    dropzone.classList.remove('hidden');
  });

  // ── 4. Room Creation ────────────────────────────────────────────────────────
  setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = 'Initializing...';

    const customCode = roomCodeInput.value.trim().toUpperCase();

    try {
      const urlParams = customCode ? `?roomCode=${customCode}` : '';
      const response = await fetch(`/api/room/config${urlParams}`);
      const roomConfig = await response.json();

      activeRoomCode = roomConfig.roomCode;
      activeRoomCodeDisp.textContent = activeRoomCode;

      socket.emit('host-room', activeRoomCode);

      qrCodeWrapper.innerHTML = `<img src="${roomConfig.qrDataUrl}" alt="Join QR Code" />`;
      activeJoinUrl.textContent = roomConfig.joinUrl;

      consolePlaceholder.classList.add('hidden');
      consoleActive.classList.remove('hidden');

      consoleLogMsg(`Event initialized. Waiting for screen display / screen/${activeRoomCode} connection...`);
      const hostLink = `${window.location.protocol}//${window.location.host}/screen/${activeRoomCode}`;
      consoleLogMsg(`👉 PLEASE OPEN SCREEN DISPLAY AT: ${hostLink}`);

      createRoomBtn.textContent = 'Room Active';
    } catch (err) {
      console.error('Room creation failed:', err);
      alert('Failed to initialize event room.');
      createRoomBtn.disabled = false;
      createRoomBtn.textContent = 'Initialize Screen Room';
    }
  });

  // ── 5. Start Activity ───────────────────────────────────────────────────────
  startActivityBtn.addEventListener('click', () => {
    if (!activeRoomCode || !socket) return;

    const rows = parseInt(gridRows.value) || 4;
    const cols = parseInt(gridCols.value) || 6;

    // Parse time limit — convert minutes to seconds (0 = no limit)
    const timeLimitMinutes = timeLimitInput ? parseFloat(timeLimitInput.value) : 0;
    const timeLimitSeconds = timeLimitMinutes > 0 ? Math.round(timeLimitMinutes * 60) : null;

    socket.emit('admin-start-activity', {
      roomCode: activeRoomCode,
      rows,
      cols,
      imageUrl: uploadedImageUrl,
      roomAdminToken,   // send the room-scoped token for authorization
      timeLimitSeconds, // null = no timer, number = countdown seconds
    });

    const timerMsg = timeLimitSeconds
      ? ` | ⏱ Timer: ${timeLimitMinutes} min`
      : ' | ⏱ No time limit';

    consoleLogMsg(`🚀 Activity started (grid: ${rows}x${cols}${timerMsg}). Slicing image...`);
    activeRoomStatusDisp.textContent = 'ACTIVE';
    activeRoomStatusDisp.className = 'value status-badge active';
    startActivityBtn.disabled = true;

    // Show timer display in console area if timer is set
    if (timeLimitSeconds) {
      const timerEl = document.createElement('div');
      timerEl.id = 'adminTimerDisplay';
      timerEl.style.cssText = 'font-size:1.4rem;font-weight:bold;color:#00f3ff;margin:8px 0;letter-spacing:2px;';
      timerEl.textContent = `⏱ ${String(Math.floor(timeLimitSeconds / 60)).padStart(2, '0')}:${String(timeLimitSeconds % 60).padStart(2, '0')}`;
      consoleLog.parentElement.insertBefore(timerEl, consoleLog);
    }
  });

  // ── 6. Reset Session ────────────────────────────────────────────────────────
  resetRoomBtn.addEventListener('click', () => {
    if (!confirm('Are you sure you want to terminate the current room session? This will disconnect all players.')) return;
    window.location.reload();
  });

  // ── 7. Copy Join URL ────────────────────────────────────────────────────────
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(activeJoinUrl.textContent)
      .then(() => {
        const prev = copyUrlBtn.textContent;
        copyUrlBtn.textContent = 'Copied!';
        setTimeout(() => copyUrlBtn.textContent = prev, 2000);
      })
      .catch(err => console.error('Copy failed:', err));
  });
});