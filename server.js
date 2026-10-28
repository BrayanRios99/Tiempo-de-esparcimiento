const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Todos los jugadores conectados: { idDelSocket: { x, y, angle, color } }
const players = {};

function randomColor() {
  return Math.floor(Math.random() * 0xffffff);
}

io.on('connection', (socket) => {
  console.log('Jugador conectado:', socket.id);

  // Crear al nuevo jugador en una posicion inicial
  players[socket.id] = {
    x: 200 + Math.random() * 400,
    y: 300 + Math.random() * 200,
    angle: 0,
    color: randomColor()
  };

  // Mandarle al nuevo jugador la lista completa
  socket.emit('currentPlayers', players);

  // Avisar a los demas que llego uno nuevo
  socket.broadcast.emit('newPlayer', { id: socket.id, ...players[socket.id] });

  // Cuando un jugador se mueve
  socket.on('playerMove', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.angle = data.angle;
    socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, angle: p.angle });
  });

  // Cuando se desconecta
  socket.on('disconnect', () => {
    console.log('Jugador desconectado:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Juego en http://localhost:' + PORT);
});