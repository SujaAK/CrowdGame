const { db } = require('../services/db');
const redisService = require('../services/redis');
const crypto = require('crypto');

const NEON_COLORS = [
  '#ff007f', // Neon Pink
  '#00f3ff', // Neon Cyan
  '#ffb800', // Neon Yellow
  '#39ff14', // Neon Green
  '#9d00ff', // Neon Purple
  '#ff4500', // Neon Orange-Red
  '#e0b0ff', // Mauve Neon
  '#ff00ff'  // Magenta
];

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.timers = new Map(); // roomCode -> interval handle

    if (!redisService.isMock()) {
      this.initRedisPubSub();
    }
  }

  initRedisPubSub() {
    const pubSubClient = redisService.client.duplicate();
    pubSubClient.connect().then(() => {
      pubSubClient.subscribe('room_updates', (message) => {
        const { roomCode, type, data } = JSON.parse(message);
      });
    });
  }

  generateRoomCode() {
    let code;
    do {
      code = crypto.randomBytes(2).toString('hex').toUpperCase();
    } while (this.rooms.has(code));
    return code;
  }

  async createRoom(hostSocketId, customCode = null) {
    const roomCode = customCode ? customCode.toUpperCase() : this.generateRoomCode();
    const roomId = crypto.randomUUID();

    const roomState = {
      id: roomId,
      roomCode,
      hostSocketId,
      status: 'waiting',
      participants: new Map(),
      activity: null,
      createdAt: new Date(),
      // Timer state
      timeLimitSeconds: null,
      timerStartedAt: null,
      timeRemainingSeconds: null,
    };

    this.rooms.set(roomCode, roomState);

    if (db) {
      db('rooms')
        .insert({
          id: roomId,
          room_code: roomCode,
          activity_type: 'jigsaw',
          status: 'waiting',
          created_at: new Date()
        })
        .onConflict('room_code')
        .merge()
        .catch(err => console.error('DB error saving room:', err));
    }

    console.log(`Room created: ${roomCode} with ID: ${roomId}`);
    return roomState;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(roomCode.toUpperCase());
  }

  joinRoom(roomCode, socketId, displayName) {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.participants.size >= 100) {
      return { success: false, error: 'Room is full' };
    }

    const playerId = crypto.createHash('md5').update(displayName.toLowerCase().trim()).digest('hex');
    let participant = room.participants.get(playerId);

    if (participant) {
      participant.socketId = socketId;
      participant.isConnected = true;
      console.log(`Player ${displayName} reconnected to room ${roomCode}`);
    } else {
      const color = NEON_COLORS[room.participants.size % NEON_COLORS.length];
      participant = {
        id: playerId,
        displayName,
        color,
        socketId,
        score: 0,
        isConnected: true,
        joinedAt: new Date()
      };
      room.participants.set(playerId, participant);
      console.log(`Player ${displayName} joined room ${roomCode}`);

      if (db) {
        db('participants').insert({
          id: crypto.randomUUID(),
          room_id: room.id,
          display_name: displayName,
          color: color,
          socket_id: socketId,
          score: 0,
          is_connected: true
        }).catch(err => console.error('DB error saving participant:', err));
      }
    }

    if (room.activity) {
      room.activity.onPlayerJoin(participant);
    }

    this.io.to(room.hostSocketId).emit('player-joined', {
      id: participant.id,
      displayName: participant.displayName,
      color: participant.color,
      score: participant.score,
      count: this.getConnectedCount(roomCode)
    });

    return { success: true, participant };
  }

  getConnectedCount(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return 0;
    return Array.from(room.participants.values()).filter(p => p.isConnected).length;
  }

  handleDisconnect(socketId) {
    for (const [roomCode, room] of this.rooms.entries()) {
      if (room.hostSocketId === socketId) {
        console.log(`Host disconnected from room: ${roomCode}`);
        this.stopTimer(roomCode);
        this.io.to(roomCode).emit('host-disconnected');
        this.rooms.delete(roomCode);

        if (db) {
          db('rooms')
            .where({ id: room.id })
            .update({ status: 'completed', completed_at: new Date() })
            .catch(err => console.error('DB error updating room status:', err));
        }
        return;
      }

      for (const [playerId, p] of room.participants.entries()) {
        if (p.socketId === socketId) {
          console.log(`Player ${p.displayName} disconnected from room: ${roomCode}`);
          p.isConnected = false;

          if (room.activity) {
            room.activity.onPlayerLeave(p);
          }

          if (db) {
            db('participants')
              .where({ socket_id: socketId })
              .update({ is_connected: false })
              .catch(err => console.error('DB error updating participant:', err));
          }

          this.io.to(room.hostSocketId).emit('player-left', {
            id: p.id,
            displayName: p.displayName,
            count: this.getConnectedCount(roomCode)
          });
          return;
        }
      }
    }
  }

  async startActivity(roomCode, activityType, activityConfig = {}) {
    const room = this.getRoom(roomCode);
    if (!room) return { success: false, error: 'Room not found' };

    room.status = 'active';

    let ActivityClass;
    if (activityType === 'jigsaw') {
      ActivityClass = require('../activities/jigsaw');
    } else {
      return { success: false, error: 'Unknown activity type' };
    }

    const activityInstance = new ActivityClass(roomCode, activityConfig, this);
    await activityInstance.onStart();
    room.activity = activityInstance;

    room.participants.forEach(p => {
      if (p.isConnected) activityInstance.onPlayerJoin(p);
    });

    if (db) {
      db('rooms')
        .where({ id: room.id })
        .update({ status: 'active', started_at: new Date() })
        .catch(err => console.error('DB error starting room activity:', err));
    }

    // ── Start countdown timer if configured ──────────────────────────────────
    if (activityConfig.timeLimitSeconds && activityConfig.timeLimitSeconds > 0) {
      this.startTimer(roomCode, activityConfig.timeLimitSeconds);
    }

    this.syncRoomToRedis(roomCode);
    return { success: true };
  }

  // ── Timer Methods ──────────────────────────────────────────────────────────

  startTimer(roomCode, timeLimitSeconds) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    room.timeLimitSeconds = timeLimitSeconds;
    room.timeRemainingSeconds = timeLimitSeconds;
    room.timerStartedAt = Date.now();

    console.log(`[Timer] Starting ${timeLimitSeconds}s countdown for room ${roomCode}`);

    // Emit initial tick immediately so screen shows correct value from the start
    this.io.to(roomCode).emit('timer-tick', {
      timeRemaining: timeLimitSeconds,
      timeLimitSeconds,
    });

    const interval = setInterval(() => {
      const room = this.getRoom(roomCode);
      if (!room || room.status !== 'active') {
        this.stopTimer(roomCode);
        return;
      }

      room.timeRemainingSeconds -= 1;

      this.io.to(roomCode).emit('timer-tick', {
        timeRemaining: room.timeRemainingSeconds,
        timeLimitSeconds: room.timeLimitSeconds,
      });

      // Time's up
      if (room.timeRemainingSeconds <= 0) {
        this.stopTimer(roomCode);
        room.status = 'completed';

        const leaderboard = Array.from(room.participants.values())
          .map(p => ({ displayName: p.displayName, score: p.score, color: p.color }))
          .sort((a, b) => b.score - a.score);

        console.log(`[Timer] Time's up for room ${roomCode}`);

        this.io.to(roomCode).emit('time-up', {
          leaderboard,
          totalPieces: room.activity ? room.activity.totalPieces : 0,
          piecesPlaced: room.activity ? room.activity.pieces.filter(p => p.isPlaced).length : 0,
        });

        if (db) {
          db('rooms')
            .where({ id: room.id })
            .update({ status: 'completed', completed_at: new Date() })
            .catch(err => console.error('DB error completing room:', err));
        }
      }
    }, 1000);

    this.timers.set(roomCode, interval);
  }

  stopTimer(roomCode) {
    const interval = this.timers.get(roomCode);
    if (interval) {
      clearInterval(interval);
      this.timers.delete(roomCode);
      console.log(`[Timer] Stopped timer for room ${roomCode}`);
    }
  }

  // ── Redis Sync ─────────────────────────────────────────────────────────────

  async syncRoomToRedis(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return;

    const data = {
      id: room.id,
      roomCode: room.roomCode,
      status: room.status,
      participantCount: room.participants.size,
      progress: room.activity ? room.activity.getProgress() : 0
    };

    redisService.client
      .set(`room:${roomCode}`, JSON.stringify(data), { EX: 86400 })
      .catch(err => console.error('Redis error syncing room:', err));
  }
}

module.exports = RoomManager;