'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
// Each character can be held by one player per room. Set UNIQUE_CHARACTERS=false to allow duplicates.
const UNIQUE = process.env.UNIQUE_CHARACTERS !== 'false';
const CHARACTERS = ['pacman', 'ghost1', 'ghost2', 'ghost3'];
const DIRS = ['up', 'down', 'left', 'right', 'none'];
const COLS = 19, ROWS = 21;

const app = express();
app.get('/healthz', (_req, res) => res.send('ok'));          // handy Render health-check path
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);                                // same origin as the page: no URL or CORS config needed

const rooms = new Map();                                      // room -> Map(socket.id -> player)
const roomMap = name => { if (!rooms.has(name)) rooms.set(name, new Map()); return rooms.get(name); };
const cleanRoom = r => String(r || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
const pub = p => ({ id: p.id, name: p.name, character: p.character, x: p.x, y: p.y, dir: p.dir });
const takenIn = room => [...roomMap(room).values()].map(p => p.character);
const lobbyState = room => ({ unique: UNIQUE, taken: takenIn(room) });
const num = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+n) ? +n : lo));
function freeName(room) {
  const used = new Set([...roomMap(room).values()].map(p => p.name));
  let n = 1; while (used.has('P' + n)) n++;
  return 'P' + n;
}

io.on('connection', socket => {
  let room = null;

  // Selection screen: subscribe to the room so the "taken" marks stay live.
  socket.on('lobby:enter', data => {
    if (room) return;
    room = cleanRoom(data && data.room);
    socket.join(room);
    socket.emit('lobby:state', lobbyState(room));
  });

  socket.on('join', (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const character = data && data.character;
    if (!CHARACTERS.includes(character)) return reply({ ok: false, error: 'Unknown character.' });
    if (!room) { room = cleanRoom(data && data.room); socket.join(room); }
    const players = roomMap(room);
    if (UNIQUE && [...players.values()].some(p => p.id !== socket.id && p.character === character)) {
      return reply({ ok: false, error: 'Someone just picked that character.', taken: takenIn(room) });
    }
    const isNew = !players.has(socket.id);
    const me = players.get(socket.id) || { id: socket.id, name: freeName(room), x: 9, y: 15, dir: 'none', last: 0 };
    me.character = character;
    players.set(socket.id, me);
    reply({ ok: true, you: pub(me), unique: UNIQUE, players: [...players.values()].filter(p => p.id !== socket.id).map(pub) });
    socket.to(room).emit(isNew ? 'player:joined' : 'player:changed', pub(me));
    io.to(room).emit('lobby:state', lobbyState(room));
  });

  socket.on('move', d => {
    const me = room && roomMap(room).get(socket.id);
    const now = Date.now();
    if (!me || !d || now - me.last < 25) return;               // cheap flood guard
    me.last = now;
    me.x = num(d.x, -1, COLS); me.y = num(d.y, 0, ROWS - 1);
    me.dir = DIRS.includes(d.dir) ? d.dir : 'none';
    socket.to(room).volatile.emit('player:moved', { id: me.id, x: me.x, y: me.y, dir: me.dir });
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const players = roomMap(room);
    if (players.delete(socket.id)) io.to(room).emit('player:left', { id: socket.id });
    io.to(room).emit('lobby:state', lobbyState(room));
    if (!players.size) rooms.delete(room);
  });
});

server.listen(PORT, () => console.log('Pac-Pen listening on port ' + PORT));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
