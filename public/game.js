const socket = io();

const config = {
  type: Phaser.AUTO,
  backgroundColor: '#2e8b2e',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: { create, update }
};

new Phaser.Game(config);

let scene;
let myCar = null;
let cursors;
let track;
let trackGraphics;
let hudText;
const otherCars = {};

// Estado de vueltas
const race = {
  laps: 0,
  passedCheckpoint: false,
  lapStart: 0,
  bestLap: null,
  prevSide: null
};

// ---------- PISTA ----------

function computeTrack() {
  const w = scene.scale.width;
  const h = scene.scale.height;
  return {
    cx: w / 2,
    cy: h / 2,
    outerA: w * 0.46,
    outerB: h * 0.44,
    innerA: w * 0.26,
    innerB: h * 0.20
  };
}

function drawTrack() {
  if (trackGraphics) trackGraphics.destroy();
  track = computeTrack();
  const g = scene.add.graphics();
  g.setDepth(0);

  g.fillStyle(0xdddddd, 1);
  g.fillEllipse(track.cx, track.cy, (track.outerA + 8) * 2, (track.outerB + 8) * 2);

  g.fillStyle(0x3a3a3a, 1);
  g.fillEllipse(track.cx, track.cy, track.outerA * 2, track.outerB * 2);

  g.fillStyle(0xdddddd, 1);
  g.fillEllipse(track.cx, track.cy, (track.innerA + 8) * 2, (track.innerB + 8) * 2);

  g.fillStyle(0x2e8b2e, 1);
  g.fillEllipse(track.cx, track.cy, track.innerA * 2, track.innerB * 2);

  // Linea de meta (arriba, en el centro)
  const topOuter = track.cy - track.outerB;
  const topInner = track.cy - track.innerB;
  g.fillStyle(0xffffff, 0.9);
  g.fillRect(track.cx - 3, topOuter, 6, topInner - topOuter);

  trackGraphics = g;
}

function onAsphalt(x, y) {
  const dx = x - track.cx;
  const dy = y - track.cy;
  const outer = (dx * dx) / (track.outerA * track.outerA) + (dy * dy) / (track.outerB * track.outerB);
  const inner = (dx * dx) / (track.innerA * track.innerA) + (dy * dy) / (track.innerB * track.innerB);
  return outer <= 1 && inner >= 1;
}

// ---------- CARRO ----------

function drawCar(color) {
  const g = scene.add.graphics();

  g.fillStyle(0x111111, 1);
  g.fillRoundedRect(-17, -13, 10, 5, 2);
  g.fillRoundedRect(-17, 8, 10, 5, 2);
  g.fillRoundedRect(8, -13, 10, 5, 2);
  g.fillRoundedRect(8, 8, 10, 5, 2);

  g.fillStyle(0x222222, 1);
  g.fillRect(-23, -10, 4, 20);

  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(26, 0);
  g.lineTo(14, -6);
  g.lineTo(2, -9);
  g.lineTo(-16, -9);
  g.lineTo(-20, -6);
  g.lineTo(-20, 6);
  g.lineTo(-16, 9);
  g.lineTo(2, 9);
  g.lineTo(14, 6);
  g.closePath();
  g.fillPath();

  g.fillStyle(0xffffff, 0.85);
  g.fillRect(-18, -1, 42, 2);

  g.fillStyle(0x1a1a2e, 1);
  g.beginPath();
  g.moveTo(8, 0);
  g.lineTo(2, -5);
  g.lineTo(-8, -5);
  g.lineTo(-11, 0);
  g.lineTo(-8, 5);
  g.lineTo(2, 5);
  g.closePath();
  g.fillPath();

  return g;
}

function makeCar(x, y, angle, color) {
  const car = scene.add.container(x, y, [drawCar(color)]);
  car.angle = angle;
  car.setDepth(10);
  return car;
}

function startPosition() {
  const topOuter = track.cy - track.outerB;
  const topInner = track.cy - track.innerB;
  return {
    x: track.cx - 40 - Math.random() * 120,
    y: (topOuter + topInner) / 2 + (Math.random() - 0.5) * (topInner - topOuter) * 0.5,
    angle: 0
  };
}

// ---------- CHOQUES ENTRE CARROS ----------

const CAR_RADIUS = 20; // dos carros chocan si sus centros estan a menos de 2 x este valor

function checkCarCollisions() {
  Object.keys(otherCars).forEach((id) => {
    const other = otherCars[id];
    const dx = myCar.x - other.x;
    const dy = myCar.y - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = CAR_RADIUS * 2;

    if (dist < minDist) {
      // Direccion de empuje: desde el otro carro hacia el mio
      const nx = dist === 0 ? 1 : dx / dist;
      const ny = dist === 0 ? 0 : dy / dist;

      // Separar los carros para que no se queden pegados
      const push = minDist - dist + 1;
      const px = myCar.x + nx * push;
      const py = myCar.y + ny * push;
      if (onAsphalt(px, py)) {
        myCar.x = px;
        myCar.y = py;
        myCar.lastGoodX = px;
        myCar.lastGoodY = py;
      }

      // Rebote: invertir velocidad con algo de perdida
      if (Math.abs(myCar.speed) < 2) myCar.speed = myCar.speed >= 0 ? 2 : -2;
      myCar.speed = -myCar.speed * 0.7;
    }
  });
}

// ---------- VUELTAS ----------

function formatTime(ms) {
  const total = Math.max(0, ms);
  const min = Math.floor(total / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const dec = Math.floor((total % 1000) / 10);
  return min + ':' + String(sec).padStart(2, '0') + '.' + String(dec).padStart(2, '0');
}

function updateLaps() {
  // Punto de control abajo: si el carro pasa por la mitad inferior, marca el checkpoint
  if (myCar.y > track.cy + track.innerB) {
    race.passedCheckpoint = true;
  }

  // Cruce de la linea de meta: pasar de la izquierda a la derecha del centro, en la parte de arriba
  const side = myCar.x >= track.cx ? 1 : -1;
  const inTopHalf = myCar.y < track.cy;
  if (inTopHalf && race.prevSide === -1 && side === 1) {
    if (race.passedCheckpoint) {
      const now = scene.time.now;
      const lapTime = now - race.lapStart;
      race.laps += 1;
      if (race.bestLap === null || lapTime < race.bestLap) race.bestLap = lapTime;
      race.lapStart = now;
      race.passedCheckpoint = false;
    }
  }
  race.prevSide = side;
}

function updateHud() {
  const current = scene.time.now - race.lapStart;
  const best = race.bestLap === null ? '--' : formatTime(race.bestLap);
  hudText.setText(
    'Vueltas: ' + race.laps + '\n' +
    'Vuelta actual: ' + formatTime(current) + '\n' +
    'Mejor vuelta: ' + best
  );
}

// ---------- ESCENA ----------

function create() {
  scene = this;
  cursors = this.input.keyboard.createCursorKeys();

  drawTrack();

  hudText = this.add.text(16, 16, '', {
    fontFamily: 'monospace',
    fontSize: '20px',
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: { x: 10, y: 8 }
  });
  hudText.setDepth(100);

  this.scale.on('resize', () => {
    drawTrack();
  });

  socket.on('currentPlayers', (players) => {
    Object.keys(players).forEach((id) => {
      const p = players[id];
      if (id === socket.id) {
        const s = startPosition();
        myCar = makeCar(s.x, s.y, s.angle, p.color);
        myCar.speed = 0;
        myCar.lastGoodX = s.x;
        myCar.lastGoodY = s.y;
        race.lapStart = scene.time.now;
        socket.emit('playerMove', { x: s.x, y: s.y, angle: s.angle });
      } else {
        otherCars[id] = makeCar(p.x, p.y, p.angle, p.color);
      }
    });
  });

  socket.on('newPlayer', (p) => {
    otherCars[p.id] = makeCar(p.x, p.y, p.angle, p.color);
  });

  socket.on('playerMoved', (p) => {
    const car = otherCars[p.id];
    if (car) {
      car.x = p.x;
      car.y = p.y;
      car.angle = p.angle;
    }
  });

  socket.on('playerLeft', (id) => {
    if (otherCars[id]) {
      otherCars[id].destroy();
      delete otherCars[id];
    }
  });
}

function update() {
  if (!myCar) return;

  const turnFactor = Math.min(Math.abs(myCar.speed) / 2, 1);
  if (cursors.left.isDown) myCar.angle -= 3 * turnFactor * Math.sign(myCar.speed || 1);
  if (cursors.right.isDown) myCar.angle += 3 * turnFactor * Math.sign(myCar.speed || 1);

  if (cursors.up.isDown) myCar.speed = Math.min(myCar.speed + 0.15, 5);
  else if (cursors.down.isDown) myCar.speed = Math.max(myCar.speed - 0.15, -2);
  else myCar.speed *= 0.98;

  const rad = Phaser.Math.DegToRad(myCar.angle);
  const oldX = myCar.x;
  const oldY = myCar.y;
  const newX = oldX + Math.cos(rad) * myCar.speed;
  const newY = oldY + Math.sin(rad) * myCar.speed;

  if (onAsphalt(newX, newY)) {
    myCar.x = newX;
    myCar.y = newY;
    myCar.lastGoodX = newX;
    myCar.lastGoodY = newY;
  } else {
    myCar.x = myCar.lastGoodX;
    myCar.y = myCar.lastGoodY;
    myCar.speed = -myCar.speed * 0.6;
    const midA = (track.outerA + track.innerA) / 2;
    const midB = (track.outerB + track.innerB) / 2;
    const dx = (myCar.x - track.cx) / midA;
    const dy = (myCar.y - track.cy) / midB;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const sign = dx * dx + dy * dy > 1 ? 1 : -1;
    myCar.x += (-dx / len) * 0.8 * sign;
    myCar.y += (-dy / len) * 0.8 * sign;
  }

  // Choques con otros carros
  checkCarCollisions();

  // Vueltas y marcador
  updateLaps();
  updateHud();

  if (myCar.x !== oldX || myCar.y !== oldY || cursors.left.isDown || cursors.right.isDown) {
    socket.emit('playerMove', { x: myCar.x, y: myCar.y, angle: myCar.angle });
  }
}