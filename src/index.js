const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const registerSocketHandlers = require('./socket');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use(cors({ origin: ORIGIN, credentials: true }));
app.get('/', (_req, res) => res.json({ status: 'Ludo WebSocket Server Running ✅' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

registerSocketHandlers(io);

server.listen(PORT, () => logger.info(`Server listening on port ${PORT}`));