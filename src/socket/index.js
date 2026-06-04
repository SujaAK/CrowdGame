const jwt = require('jsonwebtoken');
const config = require('../config');
const RoomManager = require('./roomManager');

// ─── Payload Validators ───────────────────────────────────────────────────────
const validate = {
  roomCode: (v) => typeof v === 'string' && /^[A-Z0-9]{2,8}$/.test(v.toUpperCase()),
  displayName: (v) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 32,
  pieceId: (v) => typeof v === 'string' && v.trim().length > 0,
  coordinate: (v) => typeof v === 'number' && isFinite(v),
  rows: (v) => Number.isInteger(Number(v)) && Number(v) >= 2 && Number(v) <= 10,
  cols: (v) => Number.isInteger(Number(v)) && Number(v) >= 2 && Number(v) <= 10,
};

function validatePayload(socket, eventName, payload, rules) {
  for (const [field, rule] of Object.entries(rules)) {
    if (!rule(payload[field])) {
      console.warn(`[Validation] Invalid field "${field}" in event "${eventName}" from socket ${socket.id}`);
      socket.emit('error-message', `Invalid payload: "${field}" is missing or malformed.`);
      return false;
    }
  }
  return true;
}

// ─── Room Admin Token ─────────────────────────────────────────────────────────
// When a host opens a room, they receive a room-scoped JWT.
// Starting an activity requires this token OR a global admin JWT.
function issueRoomAdminToken(roomCode) {
  return jwt.sign(
    { role: 'room-admin', roomCode },
    config.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function verifyRoomAdminToken(token, roomCode) {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    return payload.role === 'room-admin' && payload.roomCode === roomCode;
  } catch (_) {
    return false;
  }
}

function initSockets(io) {
  const roomManager = new RoomManager(io);

  // ─── Global Admin Auth Middleware ─────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (token) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET);
        if (payload.role === 'admin') socket.isAdmin = true;
      } catch (_) {
        // Invalid token — continue as regular client
      }
    }
    next();
  });

  io.on('connection', (socket) => {

    // ── 1. Host Room ──────────────────────────────────────────────────────────
    socket.on('host-room', async (roomCode) => {
      // roomCode can be empty string (auto-generate) or a valid code
      if (roomCode && !validate.roomCode(roomCode)) {
        socket.emit('error-message', 'Invalid room code format.');
        return;
      }

      console.log(`Host connection request. Custom room code: ${roomCode}`);
      try {
        const existingRoom = roomManager.getRoom(roomCode);
        let room;

        if (existingRoom) {
          existingRoom.hostSocketId = socket.id;
          room = existingRoom;
          console.log(`Screen display connected to existing room: ${roomCode}`);
        } else {
          room = await roomManager.createRoom(socket.id, roomCode);
        }

        socket.join(room.roomCode);
        socket.roomCode = room.roomCode;
        socket.role = 'host';

        // Issue a room-scoped admin token for this host
        const roomAdminToken = issueRoomAdminToken(room.roomCode);

        socket.emit('room-created', {
          roomCode: room.roomCode,
          status: room.status,
          roomAdminToken  // host stores this, sends it back with admin-start-activity
        });

        if (room.activity) {
          socket.emit('activity-start', {
            type: 'jigsaw',
            state: room.activity.getStateForScreen()
          });
        }
      } catch (err) {
        console.error('Error in host-room setup:', err);
        socket.emit('error-message', 'Failed to create room.');
      }
    });

    // ── 2. Player joins room ──────────────────────────────────────────────────
    socket.on('join-room', (data) => {
      if (!data || typeof data !== 'object') {
        socket.emit('error-message', 'Invalid join payload.');
        return;
      }

      if (!validatePayload(socket, 'join-room', data, {
        roomCode: validate.roomCode,
        displayName: validate.displayName,
      })) return;

      const roomCode = data.roomCode.toUpperCase();
      const displayName = data.displayName.trim();
      console.log(`Player '${displayName}' requesting join for Room: ${roomCode}`);

      const result = roomManager.joinRoom(roomCode, socket.id, displayName);
      if (!result.success) {
        socket.emit('error-message', result.error);
        return;
      }

      socket.join(roomCode);
      socket.roomCode = roomCode;
      socket.role = 'player';
      socket.playerId = result.participant.id;

      socket.emit('joined-successfully', {
        playerId: result.participant.id,
        color: result.participant.color,
        displayName: result.participant.displayName
      });

      const room = roomManager.getRoom(roomCode);
      io.to(roomCode).emit('room-update', {
        status: room.status,
        participantsCount: roomManager.getConnectedCount(roomCode)
      });

      if (room.activity) {
        socket.emit('activity-start', {
          type: 'jigsaw',
          state: room.activity.getStateForPlayer(socket.playerId)
        });
      }
    });

    // ── 3. Start activity ─────────────────────────────────────────────────────
    socket.on('admin-start-activity', async (data) => {
      if (!data || typeof data !== 'object') {
        socket.emit('error-message', 'Invalid payload.');
        return;
      }

      const { roomCode, rows, cols, imageUrl, roomAdminToken, timeLimitSeconds } = data;

      if (!validatePayload(socket, 'admin-start-activity', data, {
        roomCode: validate.roomCode,
        rows: validate.rows,
        cols: validate.cols,
      })) return;

      const room = roomManager.getRoom(roomCode.toUpperCase());
      if (!room) {
        socket.emit('error-message', 'Room not found.');
        return;
      }

      // ── Authorization: global admin JWT OR valid room-scoped token ──
      const isRoomHost = socket.id === room.hostSocketId;
      const hasRoomToken = roomAdminToken && verifyRoomAdminToken(roomAdminToken, roomCode.toUpperCase());

      if (!socket.isAdmin && !isRoomHost && !hasRoomToken) {
        console.warn(`Unauthorized admin-start-activity from socket ${socket.id}`);
        socket.emit('error-message', 'Unauthorized: only the room host or admin can start an activity.');
        return;
      }

      const activityConfig = {
        rows: parseInt(rows) || 4,
        cols: parseInt(cols) || 6,
        imageUrl,
        timeLimitSeconds: timeLimitSeconds || null,
      };

      const result = await roomManager.startActivity(roomCode.toUpperCase(), 'jigsaw', activityConfig);
      if (!result.success) {
        socket.emit('error-message', result.error);
        return;
      }

      io.to(room.hostSocketId).emit('activity-start', {
        type: 'jigsaw',
        state: room.activity.getStateForScreen()
      });

      room.participants.forEach((p) => {
        if (p.isConnected && p.socketId) {
          io.to(p.socketId).emit('activity-start', {
            type: 'jigsaw',
            state: room.activity.getStateForPlayer(p.id)
          });
        }
      });
    });

    // ── 4. Move piece (live drag sync) ────────────────────────────────────────
    socket.on('move-piece', (data) => {
      if (socket.role !== 'player' || !socket.roomCode) return;
      if (!data || typeof data !== 'object') return;

      if (!validatePayload(socket, 'move-piece', data, {
        pieceId: validate.pieceId,
        currentX: validate.coordinate,
        currentY: validate.coordinate,
      })) return;

      const room = roomManager.getRoom(socket.roomCode);
      if (!room || !room.activity || room.status !== 'active') return;

      const player = room.participants.get(socket.playerId);
      if (!player) return;

      const { pieceId, currentX, currentY } = data;
      const piece = room.activity.pieces.find(p => p.id === pieceId);
      if (piece && piece.assignedTo === player.id && !piece.isPlaced) {
        piece.currentX = currentX;
        piece.currentY = currentY;
        io.to(room.hostSocketId).emit('piece-move', { pieceId, currentX, currentY });
      }
    });

    // ── 5. Place piece ────────────────────────────────────────────────────────
    socket.on('place-piece', (data) => {
      if (socket.role !== 'player' || !socket.roomCode) return;
      if (!data || typeof data !== 'object') return;

      if (!validatePayload(socket, 'place-piece', data, {
        pieceId: validate.pieceId,
        currentX: validate.coordinate,
        currentY: validate.coordinate,
      })) return;

      const room = roomManager.getRoom(socket.roomCode);
      if (!room || !room.activity || room.status !== 'active') return;

      const player = room.participants.get(socket.playerId);
      if (!player) return;

      const result = room.activity.onPlayerAction(player, 'place-piece', data);
      if (!result || !result.success) {
        socket.emit('error-message', result ? result.error : 'Action failed');
        return;
      }

      if (result.correct) {
        // Build leaderboard snapshot and emit with every correct placement
        const leaderboard = Array.from(room.participants.values())
          .map(p => ({ displayName: p.displayName, score: p.score, color: p.color }))
          .sort((a, b) => b.score - a.score);

        io.to(socket.roomCode).emit('piece-placed', {
          pieceId: result.pieceId,
          correctX: result.correctX,
          correctY: result.correctY,
          placedBy: result.placedBy,
          score: result.score,
          progress: result.progress,
          isSolved: result.isSolved,
          leaderboard,  // live leaderboard update on every placement
        });

        socket.emit('assign-pieces', {
          assignedPieces: room.activity.getStateForPlayer(socket.playerId).assignedPieces
        });

        if (result.isSolved) {
          io.to(socket.roomCode).emit('activity-complete', {
            leaderboard,
            totalPieces: room.activity.totalPieces
          });
          room.status = 'completed';
          roomManager.stopTimer(room.roomCode);
        }
      } else {
        io.to(room.hostSocketId).emit('piece-move', {
          pieceId: result.pieceId,
          currentX: result.currentX,
          currentY: result.currentY
        });
        socket.emit('placement-incorrect', { pieceId: result.pieceId });
      }
    });

    // ── 6. Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      roomManager.handleDisconnect(socket.id);
    });
  });
}

module.exports = initSockets;