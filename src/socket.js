const GameManager = require('./game/ludo');
const logger = require('./utils/logger');

const game = new GameManager();
const roomIntervals = new Map();

module.exports = function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    logger.info(`User connected: ${socket.id}`);

    socket.on('initializeGame', ({ roomId, eventId, playerId, totalTime }) => {
      if (!roomId || !eventId || !playerId || !totalTime || totalTime <= 0) {
        socket.emit('error', { eventId, message: 'Invalid room ID, event ID, player ID, or total time' });
        return;
      }
      const initializedRoomId = game.initializeRoom(roomId, eventId, playerId, totalTime);
      socket.join(roomId);
      io.to(roomId).emit('gameInit', {
        eventId,
        roomId,
        playerId,
        totalTime
      });
      logger.info(`Game initialized with room ${roomId}, event ${eventId}, player ${playerId}, totalTime ${totalTime}`);
    });

    socket.on('joinRoom', ({ roomId, eventId, playerId }) => {
      if (!roomId || !eventId || !playerId) {
        socket.emit('error', { eventId, message: 'Invalid room ID, event ID, or player ID' });
        return;
      }
      const joined = game.joinRoom(roomId, { id: playerId, name: `Player2_${playerId}` }, eventId);
      if (joined) {
        socket.join(roomId);
        const room = game.getRoom(roomId);
        io.to(roomId).emit('roomUpdate', { eventId, roomId, room });
        logger.info(`Player ${playerId} joined room ${roomId} with event ${eventId}`);
        if (room.players.length === 2) {
          game.startGame(roomId);
          const gameState = game.getGameState(roomId);
          io.to(roomId).emit('gameStarted', {
            eventId,
            gameState,
            players: room.players.map(p => ({ id: p.id, name: p.name }))
          });
          startRoomTimer(roomId, io);
          logger.info(`Game started in room ${roomId} with event ${eventId}`);
        }
      } else {
        socket.emit('error', { eventId, message: 'Room not found, event ID mismatch, or invalid player ID' });
      }
    });

    socket.on('rollDice', ({ roomId, eventId }) => {
      const result = game.rollDice(roomId, socket.id, eventId);
      if (result) {
        io.to(roomId).emit('diceRolled', { eventId, playerId: socket.id, dice: result.dice });
        io.to(roomId).emit('gameUpdate', { eventId, gameState: game.getGameState(roomId) });
        if (result.dice !== 6) {
          game.passTurn(roomId);
          io.to(roomId).emit('turnChanged', {
            eventId,
            nextPlayer: game.getGameState(roomId).currentPlayer
          });
        } else {
          io.to(roomId).emit('turnContinued', { eventId, playerId: socket.id });
        }
      } else {
        socket.emit('error', { eventId, message: 'Not your turn, invalid room, or event ID mismatch' });
      }
    });

    socket.on('moveToken', ({ roomId, tokenIndex, steps, eventId, diceCount, kill }) => {
      const result = game.moveToken(roomId, socket.id, tokenIndex, steps, eventId, diceCount, kill);
      if (result.success) {
        const gameState = game.getGameState(roomId);
        io.to(roomId).emit('gameUpdate', { eventId, gameState });
        if (result.capture || diceCount === 6) {
          io.to(roomId).emit('turnContinued', { eventId, playerId: socket.id });
        } else {
          io.to(roomId).emit('turnChanged', { eventId, nextPlayer: result.nextPlayer });
        }
        const winner = game.checkWinner(roomId);
        if (winner) {
          io.to(roomId).emit('gameOver', { eventId, winner });
          clearInterval(roomIntervals.get(roomId));
          roomIntervals.delete(roomId);
        }
      } else {
        socket.emit('error', { eventId, message: 'Invalid move or event ID mismatch' });
      }
    });

    socket.on('chatMessage', ({ roomId, message, eventId }) => {
      io.to(roomId).emit('chatMessage', { eventId, playerId: socket.id, message });
    });

    socket.on('disconnect', () => {
      const rooms = game.removePlayer(socket.id);
      rooms.forEach((roomId) => {
        const room = game.getRoom(roomId);
        if (room) {
          io.to(roomId).emit('playerLeft', {
            eventId: room.eventId,
            players: room.players
          });
          io.to(roomId).emit('gameUpdate', {
            eventId: room.eventId,
            gameState: game.getGameState(roomId)
          });
          if (room.players.length === 0) {
            clearInterval(roomIntervals.get(roomId));
            roomIntervals.delete(roomId);
          }
        }
      });
      logger.info(`User disconnected: ${socket.id}`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error for ${socket.id}: ${err.message}`);
    });
  });

  function startRoomTimer(roomId, io) {
    if (!roomIntervals.has(roomId)) {
      const interval = setInterval(() => {
        const room = game.getRoom(roomId);
        if (!room) {
          clearInterval(roomIntervals.get(roomId));
          roomIntervals.delete(roomId);
          return;
        }
        const { totalTime, turnTime, currentPlayer } = game.getTimers(roomId);
        if (totalTime <= 0) {
          io.to(roomId).emit('gameOver', { eventId: room.eventId, winner: null });
          clearInterval(roomIntervals.get(roomId));
          roomIntervals.delete(roomId);
          game.deleteRoom(roomId);
          return;
        }
        if (turnTime >= 40) {
          game.passTurn(roomId);
          io.to(roomId).emit('turnChanged', {
            eventId: room.eventId,
            nextPlayer: game.getGameState(roomId).currentPlayer
          });
          io.to(roomId).emit('gameUpdate', {
            eventId: room.eventId,
            gameState: game.getGameState(roomId)
          });
        }
        io.to(roomId).emit('timerUpdate', {
          eventId: room.eventId,
          totalTime,
          turnTime,
          currentPlayer
        });
      }, 1000);
      roomIntervals.set(roomId, interval);
    }
  }
};