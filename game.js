const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  score: document.getElementById("score"),
  level: document.getElementById("level"),
  lives: document.getElementById("lives"),
  enemies: document.getElementById("enemies"),
  message: document.getElementById("message")
};

const TILE = 24;
const COLS = 26;
const ROWS = 26;
const TANK = 30;
const DIRS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};
const DIR_LIST = Object.keys(DIRS);
const PLAYER_START = { x: 8 * TILE + 9, y: 22 * TILE + 12 };

const keys = new Set();
const touchDirs = new Set();
let fireHeld = false;
let lastTime = 0;

const state = {
  running: false,
  paused: false,
  over: false,
  won: false,
  level: 1,
  score: 0,
  lives: 3,
  enemiesTotal: 0,
  enemiesLeft: 0,
  spawnTimer: 0,
  player: null,
  enemies: [],
  bullets: [],
  walls: [],
  particles: [],
  base: { x: 12 * TILE, y: 24 * TILE, w: 2 * TILE, h: 2 * TILE, alive: true }
};

function rectsHit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeTank(x, y, kind) {
  return {
    x,
    y,
    w: TANK,
    h: TANK,
    kind,
    dir: kind === "player" ? "up" : "down",
    speed: kind === "player" ? 150 : 72 + state.level * 4,
    reload: 0,
    turnTimer: 0,
    invincible: kind === "player" ? 2.2 : 0
  };
}

function addWall(tx, ty, type = "brick") {
  state.walls.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE, type });
}

function fillWall(x1, y1, x2, y2, type = "brick") {
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) addWall(x, y, type);
  }
}

function buildMap() {
  state.walls = [];
  const columns = [3, 4, 8, 9, 16, 17, 21, 22];
  for (const x of columns) {
    fillWall(x, 3, x, 6);
    fillWall(x, 9, x, 12);
    fillWall(x, 15, x, 18);
  }
  fillWall(6, 7, 7, 7);
  fillWall(18, 7, 19, 7);
  fillWall(6, 14, 7, 14);
  fillWall(18, 14, 19, 14);
  fillWall(11, 10, 14, 10, "steel");
  fillWall(11, 15, 14, 15, "steel");
  fillWall(0, 12, 2, 12, "steel");
  fillWall(23, 12, 25, 12, "steel");
  fillWall(11, 23, 14, 23);
  addWall(11, 24);
  addWall(14, 24);
}

function startGame() {
  state.running = true;
  state.paused = false;
  state.over = false;
  state.won = false;
  state.level = 1;
  state.score = 0;
  state.lives = 3;
  startLevel();
}

function startLevel() {
  buildMap();
  state.base = { x: 12 * TILE, y: 24 * TILE, w: 2 * TILE, h: 2 * TILE, alive: true };
  state.player = makeTank(PLAYER_START.x, PLAYER_START.y, "player");
  state.enemies = [];
  state.bullets = [];
  state.particles = [];
  state.enemiesTotal = 8 + state.level * 3;
  state.enemiesLeft = state.enemiesTotal;
  state.spawnTimer = 0;
  ui.message.textContent = `Level ${state.level}`;
  syncHud();
}

function nextLevel() {
  state.level += 1;
  startLevel();
}

function endGame(won = false) {
  state.over = true;
  state.running = false;
  state.won = won;
  ui.message.textContent = won ? "Victory" : "Game Over";
}

function syncHud() {
  ui.score.textContent = state.score;
  ui.level.textContent = state.level;
  ui.lives.textContent = state.lives;
  ui.enemies.textContent = state.enemiesLeft + state.enemies.length;
  if (!state.running && !state.over) ui.message.textContent = "Press Enter";
}

function spawnEnemy() {
  if (state.enemiesLeft <= 0 || state.enemies.length >= 4) return;
  const spots = [
    { x: 0.5 * TILE, y: 0.5 * TILE },
    { x: 12.5 * TILE, y: 0.5 * TILE },
    { x: 24 * TILE, y: 0.5 * TILE }
  ];
  const spot = spots[Math.floor(Math.random() * spots.length)];
  const enemy = makeTank(spot.x, spot.y, "enemy");
  if ([state.player, ...state.enemies].some(tank => tank && rectsHit(enemy, tank))) return;
  state.enemies.push(enemy);
  state.enemiesLeft -= 1;
}

function collidesWithWorld(rect, self = null) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > canvas.width || rect.y + rect.h > canvas.height) return true;
  if (state.walls.some(wall => rectsHit(rect, wall))) return true;
  if (state.base.alive && rectsHit(rect, state.base)) return true;
  const tanks = [state.player, ...state.enemies].filter(Boolean).filter(tank => tank !== self);
  return tanks.some(tank => rectsHit(rect, tank));
}

function moveTank(tank, dir, dt) {
  tank.dir = dir;
  const vector = DIRS[dir];
  const next = {
    ...tank,
    x: tank.x + vector.x * tank.speed * dt,
    y: tank.y + vector.y * tank.speed * dt
  };
  next.x = clamp(next.x, 0, canvas.width - tank.w);
  next.y = clamp(next.y, 0, canvas.height - tank.h);
  if (!collidesWithWorld(next, tank)) {
    tank.x = next.x;
    tank.y = next.y;
    return true;
  }
  return false;
}

function currentPlayerDir() {
  if (keys.has("ArrowUp") || keys.has("KeyW") || touchDirs.has("up")) return "up";
  if (keys.has("ArrowRight") || keys.has("KeyD") || touchDirs.has("right")) return "right";
  if (keys.has("ArrowDown") || keys.has("KeyS") || touchDirs.has("down")) return "down";
  if (keys.has("ArrowLeft") || keys.has("KeyA") || touchDirs.has("left")) return "left";
  return null;
}

function shoot(tank) {
  if (tank.reload > 0) return;
  if (tank.kind === "player" && state.bullets.some(bullet => bullet.owner === tank)) return;
  const dir = DIRS[tank.dir];
  state.bullets.push({
    x: tank.x + tank.w / 2 - 4 + dir.x * 18,
    y: tank.y + tank.h / 2 - 4 + dir.y * 18,
    w: 8,
    h: 8,
    dir: tank.dir,
    owner: tank,
    speed: tank.kind === "player" ? 310 : 215
  });
  tank.reload = tank.kind === "player" ? 0.35 : 0.9;
}

function updatePlayer(dt) {
  const player = state.player;
  if (!player) return;
  player.reload = Math.max(0, player.reload - dt);
  player.invincible = Math.max(0, player.invincible - dt);
  const dir = currentPlayerDir();
  if (dir) moveTank(player, dir, dt);
  if (keys.has("Space") || fireHeld) shoot(player);
}

function updateEnemies(dt) {
  for (const enemy of state.enemies) {
    enemy.reload = Math.max(0, enemy.reload - dt);
    enemy.turnTimer -= dt;
    const player = state.player;
    if (enemy.turnTimer <= 0) {
      enemy.turnTimer = 0.45 + Math.random() * 1.1;
      const horizontal = player && Math.abs(player.x - enemy.x) > Math.abs(player.y - enemy.y);
      if (player && Math.random() < 0.55) {
        enemy.dir = horizontal ? (player.x > enemy.x ? "right" : "left") : (player.y > enemy.y ? "down" : "up");
      } else {
        enemy.dir = DIR_LIST[Math.floor(Math.random() * DIR_LIST.length)];
      }
    }
    if (!moveTank(enemy, enemy.dir, dt)) {
      enemy.dir = DIR_LIST[Math.floor(Math.random() * DIR_LIST.length)];
      enemy.turnTimer = 0.15;
    }
    if (Math.random() < 0.018 + state.level * 0.002) shoot(enemy);
  }
}

function pop(x, y, color) {
  for (let i = 0; i < 9; i += 1) {
    state.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 130,
      vy: (Math.random() - 0.5) * 130,
      life: 0.35,
      color
    });
  }
}

function destroyPlayer() {
  const player = state.player;
  if (!player || player.invincible > 0) return;
  pop(player.x + player.w / 2, player.y + player.h / 2, "#f2d25c");
  state.lives -= 1;
  if (state.lives <= 0) {
    endGame(false);
    return;
  }
  state.player = makeTank(PLAYER_START.x, PLAYER_START.y, "player");
}

function updateBullets(dt) {
  for (const bullet of state.bullets) {
    const vector = DIRS[bullet.dir];
    bullet.x += vector.x * bullet.speed * dt;
    bullet.y += vector.y * bullet.speed * dt;
  }

  const remove = new Set();
  state.bullets.forEach((bullet, i) => {
    if (bullet.x < -12 || bullet.y < -12 || bullet.x > canvas.width + 12 || bullet.y > canvas.height + 12) {
      remove.add(i);
      return;
    }

    const wallIndex = state.walls.findIndex(wall => rectsHit(bullet, wall));
    if (wallIndex >= 0) {
      const wall = state.walls[wallIndex];
      if (wall.type === "brick") state.walls.splice(wallIndex, 1);
      pop(bullet.x + 4, bullet.y + 4, wall.type === "brick" ? "#b86a42" : "#bec7c7");
      remove.add(i);
      return;
    }

    if (state.base.alive && rectsHit(bullet, state.base)) {
      state.base.alive = false;
      pop(state.base.x + state.base.w / 2, state.base.y + state.base.h / 2, "#e66d58");
      remove.add(i);
      endGame(false);
      return;
    }

    if (bullet.owner.kind === "player") {
      const hitIndex = state.enemies.findIndex(enemy => rectsHit(bullet, enemy));
      if (hitIndex >= 0) {
        const enemy = state.enemies[hitIndex];
        state.enemies.splice(hitIndex, 1);
        state.score += 100;
        pop(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "#e66d58");
        remove.add(i);
      }
    } else if (state.player && rectsHit(bullet, state.player)) {
      remove.add(i);
      destroyPlayer();
    }
  });

  state.bullets = state.bullets.filter((_, i) => !remove.has(i));
}

function updateParticles(dt) {
  for (const particle of state.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
  }
  state.particles = state.particles.filter(particle => particle.life > 0);
}

function update(dt) {
  if (!state.running || state.paused || state.over) return;
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnEnemy();
    state.spawnTimer = Math.max(0.9, 2.2 - state.level * 0.12);
  }
  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateParticles(dt);
  if (state.player && state.enemies.some(enemy => rectsHit(enemy, state.player))) destroyPlayer();
  if (state.enemiesLeft <= 0 && state.enemies.length === 0) nextLevel();
  syncHud();
}

function drawGrid() {
  ctx.fillStyle = "#11120d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(246,240,208,0.035)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += TILE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += TILE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawWall(wall) {
  ctx.fillStyle = wall.type === "steel" ? "#98a3a6" : "#9c5637";
  ctx.fillRect(wall.x + 1, wall.y + 1, wall.w - 2, wall.h - 2);
  if (wall.type === "brick") {
    ctx.fillStyle = "#c5784b";
    ctx.fillRect(wall.x + 3, wall.y + 4, wall.w - 6, 4);
    ctx.fillRect(wall.x + 3, wall.y + 15, wall.w - 6, 4);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(wall.x + 11, wall.y + 2, 2, 9);
    ctx.fillRect(wall.x + 6, wall.y + 13, 2, 9);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(wall.x + 4, wall.y + 4, wall.w - 8, 3);
  }
}

function drawBase() {
  const base = state.base;
  ctx.fillStyle = base.alive ? "#e6c84f" : "#6a332f";
  ctx.fillRect(base.x + 7, base.y + 8, 34, 30);
  ctx.fillStyle = base.alive ? "#f6f0d0" : "#2e1c1b";
  ctx.beginPath();
  ctx.moveTo(base.x + 24, base.y + 5);
  ctx.lineTo(base.x + 38, base.y + 22);
  ctx.lineTo(base.x + 10, base.y + 22);
  ctx.closePath();
  ctx.fill();
}

function drawTank(tank) {
  const isPlayer = tank.kind === "player";
  if (isPlayer && tank.invincible > 0 && Math.floor(performance.now() / 90) % 2 === 0) return;
  ctx.save();
  ctx.translate(tank.x + tank.w / 2, tank.y + tank.h / 2);
  const rotations = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
  ctx.rotate(rotations[tank.dir]);

  ctx.fillStyle = isPlayer ? "#e6c84f" : "#6fb08f";
  ctx.fillRect(-12, -14, 9, 28);
  ctx.fillRect(3, -14, 9, 28);
  ctx.fillStyle = isPlayer ? "#f0df86" : "#8bc6a9";
  ctx.fillRect(-9, -11, 18, 22);
  ctx.fillStyle = "#202218";
  ctx.fillRect(-3, -20, 6, 17);
  ctx.fillStyle = isPlayer ? "#7d6820" : "#245341";
  ctx.fillRect(-6, -6, 12, 12);
  ctx.restore();
}

function drawBullet(bullet) {
  ctx.fillStyle = bullet.owner.kind === "player" ? "#fff3b1" : "#ff9a76";
  ctx.fillRect(bullet.x, bullet.y, bullet.w, bullet.h);
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.globalAlpha = clamp(particle.life / 0.35, 0, 1);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function drawOverlay() {
  if (state.running && !state.paused) return;
  ctx.fillStyle = "rgba(17,18,13,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e6c84f";
  ctx.font = "bold 34px Trebuchet MS, Arial";
  ctx.textAlign = "center";
  ctx.fillText(state.paused ? "PAUSED" : (state.over ? (state.won ? "VICTORY" : "GAME OVER") : "TANK BATTLE"), canvas.width / 2, canvas.height / 2 - 12);
  ctx.fillStyle = "#f6f0d0";
  ctx.font = "18px Trebuchet MS, Arial";
  ctx.fillText("Press Enter", canvas.width / 2, canvas.height / 2 + 24);
}

function render() {
  drawGrid();
  state.walls.forEach(drawWall);
  drawBase();
  if (state.player) drawTank(state.player);
  state.enemies.forEach(drawTank);
  state.bullets.forEach(drawBullet);
  drawParticles();
  drawOverlay();
}

function loop(time) {
  const dt = Math.min((time - lastTime) / 1000 || 0, 0.033);
  lastTime = time;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", event => {
  if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "Enter") {
    if (!state.running || state.over) startGame();
    return;
  }
  if (event.code === "KeyP" && state.running) {
    state.paused = !state.paused;
    ui.message.textContent = state.paused ? "Paused" : `Level ${state.level}`;
    return;
  }
  keys.add(event.code);
});

window.addEventListener("keyup", event => {
  keys.delete(event.code);
});

document.querySelectorAll("[data-dir]").forEach(button => {
  const dir = button.dataset.dir;
  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchDirs.add(dir);
  });
  button.addEventListener("pointerup", () => touchDirs.delete(dir));
  button.addEventListener("pointercancel", () => touchDirs.delete(dir));
});

document.querySelector("[data-action='fire']").addEventListener("pointerdown", event => {
  event.preventDefault();
  fireHeld = true;
});
document.querySelector("[data-action='fire']").addEventListener("pointerup", () => {
  fireHeld = false;
});
document.querySelector("[data-action='fire']").addEventListener("pointercancel", () => {
  fireHeld = false;
});

syncHud();
render();
requestAnimationFrame(loop);
