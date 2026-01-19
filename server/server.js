// server/server.js

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const mime = require('mime');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 5757;
const app = express();
app.use(cors());
app.use(express.json());

// Use the media directory provided by main.js, or fallback to a local one
const MEDIA_DIR = process.env.COWATCH_MEDIA_DIR || path.join(process.cwd(), 'media');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}
console.log(`[CoWatch Server] Using media directory: ${MEDIA_DIR}`);

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.' + (mime.getExtension(file.mimetype) || 'bin');
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

// --- Static File Serving ---

// Serve media files from the designated directory
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1y', immutable: true }));

// Serve the guest page from the /guest URL path. It serves files from the project root.
app.use('/guest', express.static(path.join(__dirname, '..')));

// Serve the main application from the 'app' folder
app.use(express.static(path.join(__dirname, '..', 'app')));


// Rooms in memory
const rooms = Object.create(null);

// --- REST API Endpoints ---

// Health check for Electron's main process
app.get('/api/health', (req, res) => res.json({ ok: true, rooms: Object.keys(rooms).length }));

// List rooms (for the "Join a Room" dropdown)
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: Object.keys(rooms) });
});

// Video upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
  const url = `/media/${req.file.filename}`;
  res.json({ ok: true, url });
});

// --- WebSocket Signaling Server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function ensureRoom(roomId, pin) {
  if (!rooms[roomId]) {
    rooms[roomId] = { pin, clients: new Set(), createdAt: Date.now(), lastActive: Date.now() };
  } else {
    rooms[roomId].lastActive = Date.now();
  }
  return rooms[roomId];
}

function broadcast(roomId, from, payload, includeSelf = false) {
  const room = rooms[roomId];
  if (!room) return;
  room.lastActive = Date.now();
  const payloadStr = JSON.stringify(payload);
  for (const ws of room.clients) {
    if (!includeSelf && ws === from) continue;
    try { ws.send(payloadStr); } catch {}
  }
}

function safeSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}

wss.on('connection', (ws) => {
  ws._roomId = null;
  ws._name = null;

  ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'create') {
      if (!msg.roomId || !msg.pin) return safeSend(ws, { type: 'error', error: 'roomId and pin required' });
      const room = ensureRoom(msg.roomId, msg.pin);
      if (room.pin !== msg.pin) return safeSend(ws, { type: 'error', error: 'PIN mismatch for existing room' });
      
      room.clients.add(ws);
      ws._roomId = msg.roomId;
      ws._name = msg.name || 'host';
      safeSend(ws, { type: 'created', roomId: msg.roomId });
      broadcast(msg.roomId, ws, { type: 'peer-join', name: ws._name });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms[msg.roomId];
      if (!room) return safeSend(ws, { type: 'error', error: 'Room not found' });
      if (room.pin !== msg.pin) return safeSend(ws, { type: 'error', error: 'Wrong PIN' });
      
      room.clients.add(ws);
      ws._roomId = msg.roomId;
      ws._name = msg.name || 'guest';
      safeSend(ws, { type: 'joined', roomId: msg.roomId });
      broadcast(msg.roomId, ws, { type: 'peer-join', name: ws._name });
      return;
    }

    if (!ws._roomId) return safeSend(ws, { type: 'error', error: 'Not in a room' });

    // Relay all other message types to peers in the same room
    broadcast(ws._roomId, ws, msg);
  });

  ws.on('close', () => {
    const roomId = ws._roomId;
    if (!roomId || !rooms[roomId]) return;
    rooms[roomId].clients.delete(ws);
    broadcast(roomId, ws, { type: 'peer-leave', name: ws._name });
    if (rooms[roomId].clients.size === 0) {
      delete rooms[roomId];
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[CoWatch Server] Listening on http://127.0.0.1:${PORT}`);
});