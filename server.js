
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const rooms = new Map();

app.use(express.static('dist'));

io.on('connection', (socket) => {
  socket.on('join', (roomId) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { html: '', css: '' });
    }
    socket.emit('initial', rooms.get(roomId));
  });

  socket.on('codeChange', ({ roomId, type, code }) => {
    if (rooms.has(roomId)) {
      rooms.get(roomId)[type] = code;
      socket.to(roomId).emit('codeUpdate', { type, code });
    }
  });
});

app.get('/new', (req, res) => {
  const roomId = nanoid(10);
  res.redirect(`/${roomId}`);
});

app.get('/:roomId', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 9090;

httpServer.listen(port, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});
