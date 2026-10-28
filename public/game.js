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

const LAPS_TO_WIN = 5;
const CAR_RADIUS = 20;
const TRACK_HALF_WIDTH = 55; // la pista mide el doble de esto de ancho

let scene;
let myCar = null;
let cursors;
let spaceKey;
let trackGraphics;
let track = null;
let hudText;
let bannerText;
const otherCars = {};
const bullets = [];
let lastShot = 0;
let dead = false;
let raceFinished = false;

const race = {
  laps: 0,
  passedCheckpoint: false,
  lapStart: 0,
  bestLap: null,
  prevSide: null
};

// ---------- PISTA: CIRCUITO CON CURVAS ----------
// Se define con puntos en coordenadas de 0 a 1 (porcentaje de la pantalla).
// La linea se suaviza con una curva cerrada y el asfalto es todo lo que este cerca de ella.

const CONTROL_POINTS = [
  [0.50, 0.14], // recta superior (meta)
  [0.72, 0.14],
  [0.86, 0.26], // curva derecha arriba
  [0.88, 0.46],
  [0.76, 0.58], // ese hacia adentro
  [0.80, 0.78], // curva derecha abajo
  [0.62, 0.88],
  [0.42, 0.80], // recta inferior
  [0.28, 0.88],
  [0.14, 0.74], // curva izquierda abajo
  [0.14, 0.50],
  [0.26, 0.40], // ese hacia adentro
  [0.16, 0.24], // curva izquierda arriba
  [0.30, 0.14]
];

function computeTrack() {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const pts = CONTROL_POINTS.map((p) => new Phaser.Math.Vector2(p[0] * w, p[1] * h));
  const curve = new Phaser.Curves.Spline(pts);
  // Cerrar el circuito: repetir los primeros puntos al final
  const closed = new Phaser.Curves.Spline(pts.concat([pts[0].clone(), pts[1].clone()]));
  const samples = closed.getPoints(600);
  return { w: w, h: h, samples: samples, curve: curve };
}

// Distancia minima de un punto a la linea central
function distanceToCenterLine(x, y) {
  let best = Infinity;
  const s = track.samples;
  for (let i = 0; i < s.length; i++) {
    const dx = x - s[i].x;
    const dy = y - s[i].y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function onAsphalt(x, y) {
  return distanceToCenterLine(x, y) <= TRACK_HALF_WIDTH;
}

function drawTrack() {
  if (trackGraphics) trackGraphics.destroy();
  track = computeTrack();
  const g = scene.add.graphics();
  g.setDepth(0);
  const s = track.samples;

  // Borde claro
  g.lineStyle(TRACK_HALF_WIDTH * 2 + 16, 0xdddddd, 1);
  g.beginPath();
  g.moveTo(s[0].x, s[0].y);
  for (let i = 1; i < s.length; i++) g.lineTo(s[i].x, s[i].y);
  g.strokePath();

  // Asfalto
  g.lineStyle(TRACK_HALF_WIDTH * 2, 0x3a3a3a, 1);
  g.beginPath();
  g.moveTo(s[0].x, s[0].y);
  for (let i = 1; i < s.length; i++) g.lineTo(s[i].x, s[i].y);
  g.strokePath();

  // Linea central punteada
  g.lineStyle(3, 0xffffff, 0.35);
  for (let i = 0; i < s.length - 1; i += 6) {
    g.lineBetween(s[i].x, s[i].y, s[i + 1].x, s[i + 1].y);
  }

  // Linea de meta: perpendicular a la pista en el primer punto
  const a = s[0];
  const b = s[3];
  const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
  g.lineStyle(8, 0xffffff, 1);
  g.lineBetween(
    a.x + Math.cos(ang) * TRACK_HALF_WIDTH, a.y + Math.sin(ang) * TRACK_HALF_WIDTH,
    a.x - Math.cos(ang) * TRACK_HALF_WIDTH, a.y - Math.sin(ang) * TRACK_HALF_WIDTH
  );

  trackGraphics = g;
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
  const body = drawCar(color);
  const car = scene.add.container(x, y, [body]);
  car.angle = angle;
  car.setDepth(10);
  car.health = 100;
  car.healthBar = scene.add.graphics();
  car.healthBar.setDepth(20);
  return car;
}

function drawHealthBar(car) {
  const g = car.healthBar;
  g.clear();
  if (!car.visible) return;
  const w = 40;
  const x = car.x - w / 2;
  const y = car.y - 34;
  g.fillStyle(0x000000, 0.6);
  g.fillRect(x - 1, y - 1, w + 2, 7);
  const pct = Math.max(0, car.health) / 100;
  const col = pct > 0.5 ? 0x2ecc71 : pct > 0.25 ? 0xf4c20d : 0xe63946;
  g.fillStyle(col, 1);
  g.fillRect(x, y, w * pct, 5);
}

// Salida: sobre la linea central, un poco antes de la meta
function startPosition() {
  const s = track.samples;
  const idx = s.length - 20 - Math.floor(Math.random() * 25); // atras de la meta
  const p = s[idx];
  const q = s[(idx + 1) % s.length];
  const angle = Phaser.Math.RadToDeg(Math.atan2(q.y - p.y, q.x - p.x));
  return {
    x: p.x + (Math.random() - 0.5) * 30,
    y: p.y + (Math.random() - 0.5) * 30,
    angle: angle
  };
}

function respawnMyCar() {
  const s = startPosition();
  myCar.x = s.x;
  myCar.y = s.y;
  myCar.angle = s.angle;
  myCar.speed = 0;
  myCar.lastGoodX = s.x;
  myCar.lastGoodY = s.y;
  myCar.setVisible(true);
  myCar.health = 100;
  race.passedCheckpoint = false;
  race.prevSide = null;
  dead = false;
  socket.emit('playerMove', { x: s.x, y: s.y, angle: s.angle });
}

// ---------- EXPLOSION ----------

function explode(x, y) {
  for (let i = 0; i < 14; i++) {
    const p = scene.add.circle(x, y, 4 + Math.random() * 5, i % 2 ? 0xff7f11 : 0xf4c20d);
    p.setDepth(30);
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 50;
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(ang) * dist,
      y: y + Math.sin(ang) * dist,
      alpha: 0,
      duration: 600,
      onComplete: () => p.destroy()
    });
  }
}

// ---------- BALAS ----------

function spawnBullet(x, y, angle, owner) {
  const rad = Phaser.Math.DegToRad(angle);
  const sprite = scene.add.circle(x + Math.cos(rad) * 30, y + Math.sin(rad) * 30, 4, 0xffffff);
  sprite.setDepth(15);
  bullets.push({
    sprite: sprite,
    vx: Math.cos(rad) * 10,
    vy: Math.sin(rad) * 10,
    owner: owner,
    life: 80
  });
}

// Solo el DUENO de la bala comprueba si le dio a un rival, y avisa al servidor.
function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.sprite.x += b.vx;
    b.sprite.y += b.vy;
    b.life -= 1;

    let remove = b.life <= 0;

    if (!remove && b.owner === socket.id) {
      const ids = Object.keys(otherCars);
      for (let k = 0; k < ids.length; k++) {
        const other = otherCars[ids[k]];
        if (!other.visible) continue;
        const dx = b.sprite.x - other.x;
        const dy = b.sprite.y - other.y;
        if (Math.sqrt(dx * dx + dy * dy) < CAR_RADIUS + 4) {
          socket.emit('hit', { victim: ids[k] });
          remove = true;
          break;
        }
      }
    }

    if (remove) {
      b.sprite.destroy();
      bullets.splice(i, 1);
    }
  }
}

function tryShoot() {
  if (!myCar || dead || raceFinished) return;
  const now = scene.time.now;
  if (now - lastShot < 350) return; // enfriamiento entre disparos
  lastShot = now;
  spawnBullet(myCar.x, myCar.y, myCar.angle, socket.id);
  socket.emit('shoot', { x: myCar.x, y: myCar.y, angle: myCar.angle });
}

// ---------- CHOQUES ENTRE CARROS ----------

function checkCarCollisions() {
  Object.keys(otherCars).forEach((id) => {
    const other = otherCars[id];
    if (!other.visible) return;
    const dx = myCar.x - other.x;
    const dy = myCar.y - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = CAR_RADIUS * 2;

    if (dist < minDist) {
      const nx = dist === 0 ? 1 : dx / dist;
      const ny = dist === 0 ? 0 : dy / dist;
      const push = minDist - dist + 1;
      const px = myCar.x + nx * push;
      const py = myCar.y + ny * push;
      if (onAsphalt(px, py)) {
        myCar.x = px;
        myCar.y = py;
        myCar.lastGoodX = px;
        myCar.lastGoodY = py;
      }
      if (Math.abs(myCar.speed) < 2) myCar.speed = myCar.speed >= 0 ? 2 : -2;
      myCar.speed = -myCar.speed * 0.7;
    }
  });
}

// ---------- VUELTAS ----------
// Checkpoint: pasar por la mitad de la pista (indice de muestra en la mitad del circuito).
// Meta: cruzar el primer punto de la pista avanzando en el sentido del circuito.

function formatTime(ms) {
  const total = Math.max(0, ms);
  const min = Math.floor(total / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const dec = Math.floor((total % 1000) / 10);
  return min + ':' + String(sec).padStart(2, '0') + '.' + String(dec).padStart(2, '0');
}

function nearestSampleIndex(x, y) {
  let best = Infinity;
  let idx = 0;
  const s = track.samples;
  for (let i = 0; i < s.length; i++) {
    const dx = x - s[i].x;
    const dy = y - s[i].y;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; idx = i; }
  }
  return idx;
}

function updateLaps() {
  const n = track.samples.length;
  const idx = nearestSampleIndex(myCar.x, myCar.y);

  // Checkpoint: haber pasado por la zona de la mitad del circuito
  if (idx > n * 0.4 && idx < n * 0.6) {
    race.passedCheckpoint = true;
  }

  // Cruce de meta: pasar del final del circuito (ultimo 10%) al inicio (primer 10%)
  const zone = idx < n * 0.1 ? 'start' : idx > n * 0.9 ? 'end' : 'mid';
  if (race.prevSide === 'end' && zone === 'start') {
    if (race.passedCheckpoint) {
      const now = scene.time.now;
      const lapTime = now - race.lapStart;
      race.laps += 1;
      if (race.bestLap === null || lapTime < race.bestLap) race.bestLap = lapTime;
      race.lapStart = now;
      race.passedCheckpoint = false;
      socket.emit('lapDone');
    }
  }
  if (zone !== 'mid') race.prevSide = zone;
  else if (race.prevSide === 'start') race.prevSide = 'mid';
}

function updateHud() {
  const current = scene.time.now - race.lapStart;
  const best = race.bestLap === null ? '--' : formatTime(race.bestLap);
  hudText.setText(
    'Vueltas: ' + race.laps + ' / ' + LAPS_TO_WIN + '\n' +
    'Vuelta actual: ' + formatTime(current) + '\n' +
    'Mejor vuelta: ' + best + '\n' +
    'Disparar: barra espaciadora'
  );
}

function showBanner(text, ms) {
  bannerText.setText(text);
  bannerText.setVisible(true);
  if (ms) {
    scene.time.delayedCall(ms, () => bannerText.setVisible(false));
  }
}

// ---------- ESCENA ----------

function create() {
  scene = this;
  cursors = this.input.keyboard.createCursorKeys();
  spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

  drawTrack();

  hudText = this.add.text(16, 16, '', {
    fontFamily: 'monospace',
    fontSize: '18px',
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: { x: 10, y: 8 }
  });
  hudText.setDepth(100);

  bannerText = this.add.text(this.scale.width / 2, this.scale.height / 2, '', {
    fontFamily: 'Arial',
    fontSize: '48px',
    fontStyle: 'bold',
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: { x: 24, y: 16 },
    align: 'center'
  });
  bannerText.setOrigin(0.5);
  bannerText.setDepth(200);
  bannerText.setVisible(false);

  this.scale.on('resize', () => {
    drawTrack();
    bannerText.setPosition(this.scale.width / 2, this.scale.height / 2);
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
        otherCars[id].health = p.health;
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
      otherCars[id].healthBar.destroy();
      otherCars[id].destroy();
      delete otherCars[id];
    }
  });

  socket.on('bulletFired', (b) => {
    spawnBullet(b.x, b.y, b.angle, b.owner);
  });

  socket.on('healthUpdate', (d) => {
    if (d.id === socket.id) {
      if (myCar) myCar.health = d.health;
    } else if (otherCars[d.id]) {
      otherCars[d.id].health = d.health;
    }
  });

  socket.on('playerExploded', (d) => {
    if (d.id === socket.id) {
      if (myCar) {
        explode(myCar.x, myCar.y);
        myCar.setVisible(false);
        dead = true;
        myCar.speed = 0;
        showBanner('¡Explotaste! Reapareces en 3 segundos', 2800);
      }
    } else if (otherCars[d.id]) {
      explode(otherCars[d.id].x, otherCars[d.id].y);
      otherCars[d.id].setVisible(false);
    }
  });

  socket.on('playerRespawn', (d) => {
    if (d.id === socket.id) {
      if (myCar) respawnMyCar();
    } else if (otherCars[d.id]) {
      otherCars[d.id].setVisible(true);
    }
  });

  socket.on('raceWon', (d) => {
    raceFinished = true;
    const mine = d.id === socket.id;
    showBanner(mine ? '¡GANASTE LA CARRERA!' : '¡' + d.name + ' ganó la carrera!', 0);
  });

  socket.on('raceReset', () => {
    raceFinished = false;
    bannerText.setVisible(false);
    race.laps = 0;
    race.bestLap = null;
    race.lapStart = scene.time.now;
    if (myCar) respawnMyCar();
  });
}

function update() {
  if (!myCar) return;

  drawHealthBar(myCar);
  Object.keys(otherCars).forEach((id) => drawHealthBar(otherCars[id]));

  updateBullets();

  if (dead || raceFinished) {
    updateHud();
    return;
  }

  const turnFactor = Math.min(Math.abs(myCar.speed) / 2, 1);
  if (cursors.left.isDown) myCar.angle -= 3 * turnFactor * Math.sign(myCar.speed || 1);
  if (cursors.right.isDown) myCar.angle += 3 * turnFactor * Math.sign(myCar.speed || 1);

  if (cursors.up.isDown) myCar.speed = Math.min(myCar.speed + 0.15, 5);
  else if (cursors.down.isDown) myCar.speed = Math.max(myCar.speed - 0.15, -2);
  else myCar.speed *= 0.98;

  if (spaceKey.isDown) tryShoot();

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
    // Rebote contra el borde: volver a la ultima posicion buena e invertir velocidad
    myCar.x = myCar.lastGoodX;
    myCar.y = myCar.lastGoodY;
    myCar.speed = -myCar.speed * 0.6;
    if (Math.abs(myCar.speed) < 1) myCar.speed = myCar.speed >= 0 ? 1 : -1;
  }

  checkCarCollisions();
  updateLaps();
  updateHud();

  if (myCar.x !== oldX || myCar.y !== oldY || cursors.left.isDown || cursors.right.isDown) {
    socket.emit('playerMove', { x: myCar.x, y: myCar.y, angle: myCar.angle });
  }
}