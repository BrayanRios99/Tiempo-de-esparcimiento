const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const COLORS = [0xe63946, 0x1d6fe6, 0xf4c20d, 0x2ecc71, 0x9b59b6, 0xff7f11, 0x00bcd4];
const LAPS_TO_WIN = 5;
const BULLET_DAMAGE = 20;

const players = {};
let colorIndex = 0;
let raceOver = false;

io.on('connection', (socket) => {
  const color = COLORS[colorIndex % COLORS.length];
  colorIndex += 1;

  players[socket.id] = {
    id: socket.id,
    x: 0,
    y: 0,
    angle: 0,
    color: color,
    health: 100,
    alive: true,
    laps: 0,
    name: 'Jugador ' + colorIndex
  };

  socket.emit('currentPlayers', players);
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // Movimiento
  socket.on('playerMove', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = data.x;
    p.y = data.y;
    p.angle = data.angle;
    socket.broadcast.emit('playerMoved', {
      id: socket.id, x: p.x, y: p.y, angle: p.angle
    });
  });

  // Disparo: se reenvia a todos los demas para que vean la bala
  socket.on('shoot', (data) => {
    socket.broadcast.emit('bulletFired', {
      owner: socket.id,
      x: data.x,
      y: data.y,
      angle: data.angle
    });
  });

  // El que dispara avisa que su bala le dio a otro jugador (victim = id del golpeado)
  socket.on('hit', (data) => {
    const victim = players[data.victim];
    if (!victim || !victim.alive || raceOver) return;

    victim.health = Math.max(0, victim.health - BULLET_DAMAGE);
    io.emit('healthUpdate', { id: victim.id, health: victim.health });

    if (victim.health === 0) {
      victim.alive = false;
      io.emit('playerExploded', { id: victim.id });
      setTimeout(() => {
        if (players[victim.id]) {
          players[victim.id].health = 100;
          players[victim.id].alive = true;
          io.emit('playerRespawn', { id: victim.id });
          io.emit('healthUpdate', { id: victim.id, health: 100 });
        }
      }, 3000);
    }
  });

  // Vuelta completada
  socket.on('lapDone', () => {
    const p = players[socket.id];
    if (!p || raceOver) return;
    p.laps += 1;
    io.emit('lapsUpdate', { id: socket.id, laps: p.laps });

    if (p.laps >= LAPS_TO_WIN) {
      raceOver = true;
      io.emit('raceWon', { id: socket.id, name: p.name });
      setTimeout(() => {
        raceOver = false;
        Object.keys(players).forEach((id) => {
          players[id].laps = 0;
          players[id].health = 100;
          players[id].alive = true;
        });
        io.emit('raceReset');
      }, 6000);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Servidor en puerto ' + PORT);
});