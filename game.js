'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    // Never fall below the level this game started at
    level = gameStartLevel + Math.floor(lines / 10);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// ---- Skins ----
// Each skin supplies a palette indexed like PIECES (index 0 unused), the
// canvas background and grid colours, and its own block renderer. drawBlock()
// and drawGrid() delegate to the active skin, so switching skins only needs a
// redraw. Renderers must leave shadowBlur and globalAlpha reset.

const SKIN_STORAGE_KEY = 'tetris-skin';
const DEFAULT_SKIN = 'retro';

// Rounded-rectangle path built from arcs, so it works without ctx.roundRect.
function roundedRectPath(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

const SKINS = {
  retro: {
    colors: COLORS,
    background: '#1a1a25',
    grid: '#22222e',
    drawBlock(context, x, y, colorIndex, size, alpha) {
      context.globalAlpha = alpha;
      context.fillStyle = this.colors[colorIndex];
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
    },
  },

  neon: {
    colors: [null, '#00f0ff', '#fff200', '#e040fb', '#39ff14', '#ff1744', '#3d8bff', '#ff9100'],
    background: '#000000',
    grid: '#0e0e18',
    drawBlock(context, x, y, colorIndex, size, alpha) {
      const color = this.colors[colorIndex];
      const px = x * size + 3, py = y * size + 3, s = size - 6;
      context.globalAlpha = alpha;
      context.shadowColor = color;
      context.shadowBlur = size * 0.5;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px, py, s, s);
      context.shadowBlur = 0;
      context.globalAlpha = alpha * 0.25;
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
    },
  },

  pastel: {
    colors: [null, '#a0e7e5', '#fff1a8', '#d5b8ff', '#b5ead7', '#ffb5c2', '#a7c7e7', '#ffd3a5'],
    background: '#f7f3fb',
    grid: '#ebe4f3',
    drawBlock(context, x, y, colorIndex, size, alpha) {
      const px = x * size + 2, py = y * size + 2, s = size - 4;
      context.globalAlpha = alpha;
      roundedRectPath(context, px, py, s, s, size * 0.25);
      context.fillStyle = this.colors[colorIndex];
      context.fill();
      context.strokeStyle = 'rgba(80,60,110,0.18)';
      context.lineWidth = 1;
      context.stroke();
      // soft sheen in the upper-left corner
      context.fillStyle = 'rgba(255,255,255,0.55)';
      roundedRectPath(context, px + s * 0.18, py + s * 0.14, s * 0.32, s * 0.16, s * 0.08);
      context.fill();
    },
  },

  pixel: {
    colors: [null, '#3cbcfc', '#f8d800', '#b846f8', '#58d854', '#f83800', '#0058f8', '#fc9838'],
    background: '#141428',
    grid: '#1f1f3a',
    drawBlock(context, x, y, colorIndex, size, alpha) {
      // A 10 x 10 "pixel" texture: bevelled edges, a shine pixel and dithering.
      const u = size / 10;
      const ox = x * size, oy = y * size;
      const dot = (cx, cy, w, h, style) => {
        context.fillStyle = style;
        context.fillRect(ox + cx * u, oy + cy * u, w * u, h * u);
      };
      context.globalAlpha = alpha;
      dot(0, 0, 10, 10, this.colors[colorIndex]);
      dot(0, 0, 10, 1, 'rgba(255,255,255,0.45)');
      dot(0, 1, 1, 9, 'rgba(255,255,255,0.3)');
      dot(0, 9, 10, 1, 'rgba(0,0,0,0.5)');
      dot(9, 0, 1, 9, 'rgba(0,0,0,0.4)');
      dot(2, 2, 2, 1, 'rgba(255,255,255,0.8)');
      dot(2, 3, 1, 1, 'rgba(255,255,255,0.8)');
      for (let r = 2; r < 9; r++)
        for (let c = 2; c < 9; c++)
          if ((r + c) % 4 === 0 && r + c > 7) dot(c, r, 1, 1, 'rgba(0,0,0,0.18)');
    },
  },
};

const skinSelect = document.getElementById('skin-select');
let activeSkinId = DEFAULT_SKIN;
let activeSkin = SKINS[DEFAULT_SKIN];

function loadSkinPreference() {
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    if (stored && Object.prototype.hasOwnProperty.call(SKINS, stored)) return stored;
  } catch (e) { /* storage unavailable */ }
  return DEFAULT_SKIN;
}

function saveSkinPreference(id) {
  try { localStorage.setItem(SKIN_STORAGE_KEY, id); } catch (e) { /* storage unavailable */ }
}

function applySkin(id) {
  if (!Object.prototype.hasOwnProperty.call(SKINS, id)) id = DEFAULT_SKIN;
  document.body.classList.remove(`skin-${activeSkinId}`);
  activeSkinId = id;
  activeSkin = SKINS[id];
  document.body.classList.add(`skin-${id}`);
  if (skinSelect) skinSelect.value = id;
  // Redraw once so the change shows while paused or after game over too.
  if (board && current && next) {
    draw();
    drawNext();
  }
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => {
    applySkin(skinSelect.value);
    saveSkinPreference(activeSkinId);
    skinSelect.blur(); // give the keyboard back to the game
  });
  // While focused, arrows/Space must drive the game, not the select. The
  // event still bubbles to the document handler.
  skinSelect.addEventListener('keydown', e => {
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.save();
  activeSkin.drawBlock(context, x, y, colorIndex, size, alpha ?? 1);
  context.restore(); // resets shadowBlur, globalAlpha and styles per block
}

function drawBackground(context, width, height) {
  context.fillStyle = activeSkin.background;
  context.fillRect(0, 0, width, height);
}

function drawGrid() {
  ctx.strokeStyle = activeSkin.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

// ---- End skins ----

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground(ctx, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  drawBackground(nextCtx, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  // endGame() may have run during lockPiece(); don't schedule another frame
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  // Snapshot: changing the menu setting mid-game only affects the next game
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  hidePauseMenu();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

// ---- Pause menu ----

const START_LEVEL_MIN = 1;
const START_LEVEL_MAX = 10;
const START_LEVEL_KEY = 'tetris.startLevel';

const pauseMenu = document.getElementById('pause-menu');
const pauseResumeBtn = document.getElementById('pause-resume');
const pauseRestartBtn = document.getElementById('pause-restart');
const pauseControlsBtn = document.getElementById('pause-controls');
const pauseControlsList = document.getElementById('pause-controls-list');
const pauseLevel = document.getElementById('pause-level');
const pauseLevelValue = document.getElementById('pause-level-value');
const pauseLevelDown = document.getElementById('pause-level-down');
const pauseLevelUp = document.getElementById('pause-level-up');

// Level the next game starts at (persisted across reloads), and the one
// the current game started at
let startLevel = loadStartLevel();
let gameStartLevel = startLevel;

function clampStartLevel(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return START_LEVEL_MIN;
  return Math.min(START_LEVEL_MAX, Math.max(START_LEVEL_MIN, n));
}

function loadStartLevel() {
  try {
    const stored = localStorage.getItem(START_LEVEL_KEY);
    return stored === null ? START_LEVEL_MIN : clampStartLevel(stored);
  } catch {
    return START_LEVEL_MIN;
  }
}

function saveStartLevel() {
  try {
    localStorage.setItem(START_LEVEL_KEY, String(startLevel));
  } catch {
    // Storage unavailable (private mode, blocked): keep the in-memory value
  }
}

function renderStartLevel() {
  pauseLevelValue.textContent = startLevel;
  pauseLevelDown.disabled = startLevel <= START_LEVEL_MIN;
  pauseLevelUp.disabled = startLevel >= START_LEVEL_MAX;
}

function changeStartLevel(delta) {
  const value = clampStartLevel(startLevel + delta);
  if (value === startLevel) return;
  startLevel = value;
  saveStartLevel();
  renderStartLevel();
}

function setControlsVisible(visible) {
  pauseControlsList.classList.toggle('hidden', !visible);
  pauseControlsBtn.setAttribute('aria-expanded', String(visible));
  pauseControlsBtn.textContent = visible ? 'Ocultar controles' : 'Ver controles';
}

// Drop focus so a later Space/Enter cannot re-activate a menu button
function blurActive() {
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
}

function hidePauseMenu() {
  pauseMenu.classList.add('hidden');
  blurActive();
}

function openPauseMenu() {
  paused = true;
  cancelAnimationFrame(animId);
  setControlsVisible(false);
  renderStartLevel();
  pauseMenu.classList.remove('hidden');
  pauseResumeBtn.focus();
}

function resumeGame() {
  if (!paused || gameOver) return;
  paused = false;
  hidePauseMenu();
  // Don't let the paused time count towards gravity
  dropAccum = 0;
  lastTime = performance.now();
  loop(lastTime);
}

function togglePause() {
  if (gameOver) return;
  if (paused) resumeGame();
  else openPauseMenu();
}

// Keyboard-navigable items, in visual order
function pauseMenuItems() {
  return [pauseResumeBtn, pauseRestartBtn, pauseControlsBtn, pauseLevel];
}

// Handles every key while the menu is open; nothing reaches the game
function handlePauseMenuKey(e) {
  const items = pauseMenuItems();
  const idx = items.indexOf(document.activeElement);
  switch (e.code) {
    case 'Tab':
      // Keep focus inside the menu
      e.preventDefault();
      if (e.shiftKey) items[idx <= 0 ? items.length - 1 : idx - 1].focus();
      else items[(idx + 1) % items.length].focus();
      break;
    case 'ArrowUp':
      e.preventDefault();
      items[idx <= 0 ? items.length - 1 : idx - 1].focus();
      break;
    case 'ArrowDown':
      e.preventDefault();
      items[(idx + 1) % items.length].focus();
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      if (document.activeElement === pauseLevel) {
        changeStartLevel(e.code === 'ArrowLeft' ? -1 : 1);
      }
      break;
    case 'Space':
    case 'Enter':
    case 'NumpadEnter':
      // Focused buttons activate natively; elsewhere just stop page scrolling
      if (!(document.activeElement instanceof HTMLButtonElement)) e.preventDefault();
      break;
  }
}

pauseResumeBtn.addEventListener('click', resumeGame);
pauseRestartBtn.addEventListener('click', init);
pauseControlsBtn.addEventListener('click', () => {
  setControlsVisible(pauseControlsList.classList.contains('hidden'));
});
pauseLevelDown.addEventListener('click', () => { changeStartLevel(-1); pauseLevel.focus(); });
pauseLevelUp.addEventListener('click', () => { changeStartLevel(1); pauseLevel.focus(); });

// ---- End pause menu ----

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') {
    // Ignore auto-repeat and browser shortcuts such as Cmd/Ctrl+P
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) togglePause();
    return;
  }
  if (paused) { handlePauseMenuKey(e); return; }
  if (gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

applySkin(loadSkinPreference());
init();
