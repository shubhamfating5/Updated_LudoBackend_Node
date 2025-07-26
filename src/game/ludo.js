const { v4: uuidv4 } = require('uuid');

module.exports = class GameManager {
  constructor() {
    this.rooms = new Map(); // roomId -> { players, gameState, start, turnStart, eventId, totalTime }
  }

  initializeRoom(roomId, eventId, playerId, totalTime) {
    this.rooms.set(roomId, {
      players: [{ id: playerId, name: `Player1_${playerId}`, color: this.getColor(0), tokens: this.initTokens() }],
      playerCount: 2,
      gameState: {
        currentPlayer: null,
        dice: null,
        board: this.initBoard(),
        status: 'waiting',
        diceCount: 0,
      },
      start: Date.now(),
      turnStart: Date.now(),
      eventId,
      totalTime, // Total game duration in seconds
    });
    return roomId;
  }

  joinRoom(roomId, player, eventId) {
    const room = this.rooms.get(roomId);
    if (!room || room.eventId !== eventId || room.players.length >= 2 || room.players[0].id === player.id) {
      return false;
    }
    player.color = this.getColor(1);
    player.tokens = this.initTokens();
    room.players.push(player);
    return true;
  }

  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.gameState.status = 'started';
    room.gameState.currentPlayer = room.players[0].id;
    room.turnStart = Date.now();
  }

  initBoard() {
    return {
      path: Array(52).fill(null), // Main 52-position path
      homePaths: Array(4).fill().map(() => Array(6).fill(null)), // 6-position home paths per player
      safeZones: [0, 8, 13, 21, 26, 34, 39, 47], // Starting squares and star tiles
    };
  }

  initTokens() {
    return Array(4).fill().map(() => ({ position: 'base', pathIndex: -1 }));
  }

  getColor(index) {
    const colors = ['red', 'blue', 'green', 'yellow'];
    return colors[index % 4];
  }

  rollDice(roomId, playerId, eventId) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState.currentPlayer !== playerId || room.gameState.status !== 'started' || room.eventId !== eventId) {
      return null;
    }
    const dice = Math.floor(Math.random() * 6) + 1;
    room.gameState.dice = dice;
    room.gameState.diceCount = (room.gameState.diceCount || 0) + 1;
    return { dice, eventId };
  }

  moveToken(roomId, playerId, tokenIndex, steps, eventId, diceCount, kill) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState.currentPlayer !== playerId || !room.gameState.dice || room.eventId !== eventId) {
      return { success: false, eventId };
    }

    const player = room.players.find(p => p.id === playerId);
    const token = player.tokens[tokenIndex];
    const playerIndex = room.players.findIndex(p => p.id === playerId);

    let newPathIndex = token.pathIndex;
    if (token.position === 'base' && steps === 6) {
      token.position = 'path';
      newPathIndex = this.getStartingIndex(playerIndex);
    } else if (token.position === 'path') {
      newPathIndex += steps;
      if (newPathIndex >= 52) {
        const overflow = newPathIndex - 52;
        newPathIndex = this.getStartingIndex(playerIndex) + overflow; // Loop to home entry
      }
      const homeEntryIndex = (this.getStartingIndex(playerIndex) + 51) % 52;
      if (newPathIndex === homeEntryIndex && steps <= 6) {
        token.position = 'homePath';
        newPathIndex = 0;
      }
    } else if (token.position === 'homePath') {
      newPathIndex += steps;
      if (newPathIndex > 5) return { success: false, eventId }; // Can't overshoot home
      if (newPathIndex === 5) token.position = 'home';
    }

    // Check for capture
    let capture = false;
    if (token.position === 'path' && !room.gameState.board.safeZones.includes(newPathIndex % 52)) {
      room.players.forEach((opponent, oppIndex) => {
        if (oppIndex !== playerIndex) {
          opponent.tokens.forEach((oppToken, oppTokenIndex) => {
            if (oppToken.position === 'path' && oppToken.pathIndex === newPathIndex % 52) {
              oppToken.position = 'base';
              oppToken.pathIndex = -1;
              capture = true;
            }
          });
        }
      });
    }

    // Update token position
    token.pathIndex = newPathIndex;
    room.gameState.board.path = this.updateBoardPath(room.players);
    room.gameState.board.homePaths[playerIndex] = player.tokens.map(t => t.position === 'homePath' ? t.pathIndex : null);

    // Handle turn logic based on diceCount and kill
    if (diceCount === 6 || (kill && capture)) {
      room.gameState.dice = null; // Keep turn for 6 or kill
    } else {
      room.gameState.dice = null;
      room.gameState.diceCount = 0;
      this.passTurn(roomId);
    }

    return { success: true, eventId, capture, nextPlayer: room.gameState.currentPlayer };
  }

  checkCapture(room, playerIndex) {
    return room.players.some((opponent, oppIndex) => {
      if (oppIndex !== playerIndex) {
        return opponent.tokens.some(t => t.position === 'base' && t.pathIndex === -1);
      }
      return false;
    });
  }

  getStartingIndex(playerIndex) {
    return [0, 13, 26, 39][playerIndex % 4];
  }

  updateBoardPath(players) {
    const path = Array(52).fill(null);
    players.forEach((player, pIndex) => {
      player.tokens.forEach((token, tIndex) => {
        if (token.position === 'path') {
          path[token.pathIndex % 52] = { playerId: player.id, tokenIndex: tIndex };
        }
      });
    });
    return path;
  }

  passTurn(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const currentIndex = room.players.findIndex(p => p.id === room.gameState.currentPlayer);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.gameState.currentPlayer = room.players[nextIndex].id;
    room.gameState.dice = null;
    room.gameState.diceCount = 0;
    room.turnStart = Date.now();
  }

  checkWinner(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const winner = room.players.find(p => p.tokens.every(t => t.position === 'home'));
    return winner ? winner.id : null;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getGameState(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.gameState;
  }

  getTimers(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { totalTime: 0, turnTime: 0, currentPlayer: null };
    const elapsed = Math.floor((Date.now() - room.start) / 1000);
    const remainingTotalTime = Math.max(0, room.totalTime - elapsed);
    return {
      totalTime: remainingTotalTime,
      turnTime: Math.floor((Date.now() - room.turnStart) / 1000),
      currentPlayer: room.gameState.currentPlayer,
    };
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  removePlayer(playerId) {
    const affected = [];
    for (const [roomId, room] of this.rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === playerId);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        affected.push(roomId);
        if (room.players.length === 0) {
          this.deleteRoom(roomId);
        } else if (room.gameState.currentPlayer === playerId) {
          this.passTurn(roomId);
        }
      }
    }
    return affected;
  }
};