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

let board, current, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Deals the next piece from the 7-bag (see "Hold and queue" below).
function randomPiece() {
  if (!bag.length) refillBag();
  return createPiece(bag.shift());
}

function createPiece(type) {
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

function rotateCCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

// [dx, dy] offsets tried in order: wall kicks first, then floor kicks
// (negative dy lifts the piece) so it can rotate while resting on the stack.
const ROTATION_KICKS = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0],
  [0, -1], [-1, -1], [1, -1], [0, -2],
];

// dir: 1 = clockwise, -1 = anticlockwise. Returns true if the piece rotated.
function tryRotate(dir = 1) {
  const rotated = dir < 0 ? rotateCCW(current.shape) : rotateCW(current.shape);
  const wasGrounded = isGrounded();
  for (const [dx, dy] of ROTATION_KICKS) {
    if (!collide(rotated, current.x + dx, current.y + dy)) {
      current.shape = rotated;
      current.x += dx;
      current.y += dy;
      onPieceMoved(wasGrounded);
      return true;
    }
  }
  return false;
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
  trackCombo(cleared);
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

// On the ground, soft drop does nothing: the lock delay decides when to lock.
function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    noteDescent();
    score += 1;
    updateHUD();
  }
}

function lockPiece() {
  merge();
  clearLines();
  canHold = true; // one hold per piece, re-enabled on every lock
  spawn();
}

// Brings in `piece` (a swapped-out held piece) or, by default, the queue head.
function spawn(piece) {
  current = piece || takeFromQueue();
  resetLockState();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  drawHold();
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
  if (board && current && queue.length) {
    draw();
    drawNext();
    drawHold();
  } else {
    drawEmptyBoard();
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

// Draws the «SIGUIENTES» queue: QUEUE_SIZE pieces stacked in equal slots.
function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  drawBackground(nextCtx, nextCanvas.width, nextCanvas.height);
  const slotH = nextCanvas.height / QUEUE_SIZE;
  queue.forEach((piece, i) => drawPreview(nextCtx, nextCanvas.width, i * slotH, slotH, piece.type, false));
}

// ---- Hold and queue ----
// Pieces are dealt from a shuffled bag of all 7 types (no long droughts),
// QUEUE_SIZE of them are shown ahead, and the player can hold one piece per
// lock. `held` is a piece type (0 = none); `canHold` resets in lockPiece().

const QUEUE_SIZE = 3;
const PREVIEW_CELL = 24;
// Grey used for the held piece while hold is unavailable, per skin.
const HOLD_LOCKED_COLORS = { retro: '#5a5a66', neon: '#8a8a99', pastel: '#c4bfcc', pixel: '#7c7c7c' };

const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');

let bag = [];
let queue = [];
let held = 0;
let canHold = true;

// Fisher–Yates shuffle of the 7 piece types, appended to the bag.
function refillBag() {
  const types = [1, 2, 3, 4, 5, 6, 7];
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  bag.push(...types);
}

function takeFromQueue() {
  const piece = queue.shift();
  queue.push(randomPiece());
  return piece;
}

// Called from init(): new bag, full queue, empty hold.
function resetHoldQueue() {
  bag = [];
  queue = [];
  for (let i = 0; i < QUEUE_SIZE; i++) queue.push(randomPiece());
  held = 0;
  canHold = true;
}

function holdPiece() {
  if (!canHold) return;
  const swapped = held;
  held = current.type;
  canHold = false;
  dropAccum = 0; // the incoming piece gets a full gravity interval
  spawn(swapped ? createPiece(swapped) : null);
}

// Draws a piece's trimmed shape centred in a slot, with the active skin.
// `locked` paints it in the skin's grey via a palette override.
function drawPreview(context, width, slotY, slotH, type, locked) {
  const shape = PIECES[type];
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
  const cell = PREVIEW_CELL;
  // Whole-pixel offsets keep the pixel-art skin crisp
  const ox = Math.round((width - (maxC - minC + 1) * cell) / 2) / cell - minC;
  const oy = (slotY + Math.round((slotH - (maxR - minR + 1) * cell) / 2)) / cell - minR;
  const skin = locked
    ? Object.create(activeSkin, { colors: { value: new Array(8).fill(HOLD_LOCKED_COLORS[activeSkinId] || '#666') } })
    : activeSkin;
  for (let r = minR; r <= maxR; r++)
    for (let c = minC; c <= maxC; c++)
      if (shape[r][c]) {
        context.save();
        skin.drawBlock(context, ox + c, oy + r, shape[r][c], cell, locked ? 0.7 : 1);
        context.restore();
      }
}

// Draws the «RESERVA» panel, greyed out while hold is unavailable.
function drawHold() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  drawBackground(holdCtx, holdCanvas.width, holdCanvas.height);
  if (held) drawPreview(holdCtx, holdCanvas.width, 0, holdCanvas.height, held, !canHold);
}

// ---- End hold and queue ----

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  showGameOverHighScores();
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  updateAutoShift(dt);
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    // A grounded piece no longer locks here; updateLockDelay() does it
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      noteDescent();
    }
  }
  updateLockDelay(dt);
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
  clearHeldKeys();
  resetHoldQueue();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  hidePauseMenu();
  resetHighScoreRun();
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
  clearHeldKeys(); // keyups during the menu would be missed
  setControlsVisible(false);
  renderStartLevel();
  renderHandling();
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
  return [pauseResumeBtn, pauseRestartBtn, pauseControlsBtn, pauseLevel, pauseDas, pauseArr];
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
      } else if (document.activeElement === pauseDas) {
        changeHandling('das', e.code === 'ArrowLeft' ? -1 : 1);
      } else if (document.activeElement === pauseArr) {
        changeHandling('arr', e.code === 'ArrowLeft' ? -1 : 1);
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

// ---- Fine controls ----
// Lock delay with capped move resets, and our own DAS/ARR for sideways
// movement, driven by loop() from tracked keydown/keyup state rather than
// the OS key repeat. DAS/ARR are configurable in the pause menu.

const LOCK_DELAY = 500;      // ms a grounded piece waits before locking
const MAX_LOCK_RESETS = 15;  // successful moves/rotations that restart it

let lockTimer = 0;   // ms spent grounded since the last reset
let lockResets = 0;  // resets used since spawn or the last new lowest row
let lowestY = 0;     // lowest row reached by the current piece

function isGrounded() {
  return collide(current.shape, current.x, current.y + 1);
}

// Called from spawn() for every new piece.
function resetLockState() {
  lockTimer = 0;
  lockResets = 0;
  lowestY = current.y;
}

// Called after the piece moves down; reaching a new lowest row refills the
// resets, so the cap only limits stalling in place.
function noteDescent() {
  if (current.y > lowestY) {
    lowestY = current.y;
    lockTimer = 0;
    lockResets = 0;
  }
}

// Called after every successful sideways move or rotation.
function onPieceMoved(wasGrounded) {
  if ((wasGrounded || isGrounded()) && lockResets < MAX_LOCK_RESETS) {
    lockTimer = 0;
    lockResets++;
  }
}

// Called from loop() each frame. The timer only runs while grounded and is
// not cleared by being lifted off the ground, so floor kicks cannot be used
// to stall once the resets are spent.
function updateLockDelay(dt) {
  if (gameOver || !isGrounded()) return;
  lockTimer += Math.max(0, dt);
  if (lockTimer >= LOCK_DELAY) lockPiece();
}

const HANDLING_KEY = 'tetris.handling';
const HANDLING_LIMITS = {
  das: { min: 50, max: 300, step: 10, def: 170 },
  arr: { min: 0, max: 100, step: 5, def: 50 },
};

const pauseDas = document.getElementById('pause-das');
const pauseArr = document.getElementById('pause-arr');

let handling = loadHandling();

function clampHandling(name, v) {
  const { min, max, def } = HANDLING_LIMITS[name];
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function loadHandling() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(HANDLING_KEY));
  } catch {
    // storage unavailable or corrupt: use the defaults
  }
  const ok = data && typeof data === 'object';
  return {
    das: clampHandling('das', ok && data.das != null ? data.das : HANDLING_LIMITS.das.def),
    arr: clampHandling('arr', ok && data.arr != null ? data.arr : HANDLING_LIMITS.arr.def),
  };
}

function saveHandling() {
  try {
    localStorage.setItem(HANDLING_KEY, JSON.stringify(handling));
  } catch {
    // storage unavailable: keep the in-memory values
  }
}

function renderHandling() {
  for (const [name, el] of [['das', pauseDas], ['arr', pauseArr]]) {
    const { min, max } = HANDLING_LIMITS[name];
    el.querySelector('.pause-level-value').textContent = handling[name];
    el.querySelector('[data-delta="-1"]').disabled = handling[name] <= min;
    el.querySelector('[data-delta="1"]').disabled = handling[name] >= max;
  }
}

function changeHandling(name, delta) {
  const value = clampHandling(name, handling[name] + delta * HANDLING_LIMITS[name].step);
  if (value === handling[name]) return;
  handling[name] = value;
  saveHandling();
  renderHandling();
}

for (const [name, el] of [['das', pauseDas], ['arr', pauseArr]]) {
  for (const btn of el.querySelectorAll('[data-delta]')) {
    btn.addEventListener('click', () => {
      changeHandling(name, Number(btn.dataset.delta));
      el.focus();
    });
  }
}

// Sideways input: the most recently pressed held direction wins.
let leftHeld = false;
let rightHeld = false;
let shiftDir = 0;       // -1, 0 or 1
let shiftTimer = 0;     // ms since the direction was pressed / last repeat
let shiftCharged = false;

function shiftPiece(dir) {
  if (collide(current.shape, current.x + dir, current.y)) return false;
  const wasGrounded = isGrounded();
  current.x += dir;
  onPieceMoved(wasGrounded);
  return true;
}

function startShift(dir) {
  shiftDir = dir;
  shiftTimer = 0;
  shiftCharged = false;
}

function pressShift(dir) {
  if (dir < 0) leftHeld = true;
  else rightHeld = true;
  startShift(dir);
  shiftPiece(dir);
}

function releaseShift(dir) {
  if (dir < 0) leftHeld = false;
  else rightHeld = false;
  if (shiftDir !== dir) return;
  // Fall back to the other direction if it is still held
  if (dir < 0 && rightHeld) startShift(1);
  else if (dir > 0 && leftHeld) startShift(-1);
  else shiftDir = 0;
}

function clearHeldKeys() {
  leftHeld = rightHeld = false;
  shiftDir = 0;
}

// Called from loop() each frame: DAS charge, then one move per ARR
// (ARR 0 slides straight to the wall).
function updateAutoShift(dt) {
  if (!shiftDir || gameOver) return;
  shiftTimer += Math.max(0, dt);
  if (!shiftCharged) {
    if (shiftTimer < handling.das) return;
    shiftCharged = true;
    shiftTimer -= handling.das;
    if (!shiftPiece(shiftDir)) { shiftTimer = 0; return; }
  }
  if (handling.arr === 0) {
    while (shiftPiece(shiftDir));
    shiftTimer = 0;
    return;
  }
  while (shiftTimer >= handling.arr) {
    shiftTimer -= handling.arr;
    if (!shiftPiece(shiftDir)) { shiftTimer = 0; break; }
  }
}

document.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft') releaseShift(-1);
  else if (e.code === 'ArrowRight') releaseShift(1);
});
window.addEventListener('blur', clearHeldKeys);

// ---- End fine controls ----

// ---- High scores ----
// Top 5 scores plus all-time stats, persisted in localStorage. Every storage
// access is wrapped in try/catch; the in-memory copies keep the feature
// working for the session when storage is unavailable.

const HS_KEY = 'tetris.highscores';
const HS_STATS_KEY = 'tetris.stats';
const HS_MAX = 5;
const HS_NAME_MAX = 12;
const HS_DEFAULT_NAME = 'Anónimo';

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const startScoresEl = document.getElementById('start-scores');
const startStatsEl = document.getElementById('start-stats');
const hsGameOver = document.getElementById('hs-gameover');
const hsNewRecord = document.getElementById('hs-new-record');
const hsForm = document.getElementById('hs-form');
const hsNameInput = document.getElementById('hs-name');
const hsScoresEl = document.getElementById('hs-scores');
const hsStatsEl = document.getElementById('hs-stats');

let started = false;     // false until the first game begins (start screen)
let combo = 0;           // consecutive locks that cleared at least one line
let maxCombo = 0;        // best combo of the current game
let runLines = 0;        // lines of the current game (survives init() resetting `lines`)
let pendingEntry = null; // qualifying result awaiting a name at game over
let runActive = false;   // a game is in progress (stats not yet recorded)
let runSaved = false;    // this game's score has already been saved
let highScores = loadHighScores([]);
let hsStats = loadStats({ bestCombo: 0, maxLines: 0 });

// Returns the parsed value, null when the key is missing or unparsable, or
// undefined when storage itself is unavailable.
function readStorage(key) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return undefined;
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable or full: keep the in-memory copy only
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing to remove
  }
}

function toCount(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Reads storage afresh (another tab may have written); falls back to the
// in-memory copy only when storage is unavailable.
function loadHighScores(fallback) {
  const data = readStorage(HS_KEY);
  if (data === undefined) return fallback;
  if (!Array.isArray(data)) return [];
  return data
    .filter(e => e && typeof e === 'object' && Number.isFinite(e.score))
    .map(e => ({
      name: String(e.name ?? '').trim().slice(0, HS_NAME_MAX) || HS_DEFAULT_NAME,
      score: toCount(e.score),
      lines: toCount(e.lines),
      maxCombo: toCount(e.maxCombo),
      date: String(e.date ?? ''),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, HS_MAX);
}

function loadStats(fallback) {
  const data = readStorage(HS_STATS_KEY);
  if (data === undefined) return fallback;
  if (!data || typeof data !== 'object') return { bestCombo: 0, maxLines: 0 };
  return { bestCombo: toCount(data.bestCombo), maxLines: toCount(data.maxLines) };
}

function qualifiesForHighScores(s) {
  return s > 0 && (highScores.length < HS_MAX || s > highScores[highScores.length - 1].score);
}

// Called from clearLines() on every lock.
function trackCombo(cleared) {
  runLines = lines;
  if (cleared > 0) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  } else {
    combo = 0;
  }
}

// Called from init(): keeps any unsaved result, resets per-game tracking and
// hides the records UI.
function resetHighScoreRun() {
  if (pendingEntry) saveHighScore();      // restarted without pressing Guardar
  if (runActive) recordStats();           // restarted mid-game (e.g. from pause)
  if (document.activeElement) document.activeElement.blur(); // Enter must not re-click a hidden button
  runActive = true;
  runSaved = false;
  started = true;
  combo = 0;
  maxCombo = 0;
  runLines = 0;
  pendingEntry = null;
  hsGameOver.hidden = true;
  startScreen.classList.add('hidden');
}

function renderHighScoreTable(container, highlightIndex) {
  container.replaceChildren();
  if (!highScores.length) {
    const empty = document.createElement('p');
    empty.className = 'hs-empty';
    empty.textContent = 'Sin récords todavía';
    container.appendChild(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'hs-table';
  const head = table.createTHead().insertRow();
  for (const h of ['#', 'Nombre', 'Puntos', 'Líneas', 'Combo']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const body = table.createTBody();
  highScores.forEach((e, i) => {
    const row = body.insertRow();
    if (i === highlightIndex) row.className = 'hs-current';
    for (const v of [i + 1, e.name, e.score.toLocaleString(), e.lines, e.maxCombo]) {
      row.insertCell().textContent = v;
    }
  });
  container.appendChild(table);
}

function renderStats(el) {
  el.textContent = `Mejor combo: ${hsStats.bestCombo} · Máx. líneas: ${hsStats.maxLines}`;
}

function renderAllHighScores() {
  renderHighScoreTable(startScoresEl, -1);
  renderStats(startStatsEl);
  renderHighScoreTable(hsScoresEl, -1);
  renderStats(hsStatsEl);
}

// Shown on page load instead of starting a game; init() leaves it.
function showStartScreen() {
  started = false;
  highScores = loadHighScores(highScores);
  hsStats = loadStats(hsStats);
  drawEmptyBoard();
  renderHighScoreTable(startScoresEl, -1);
  renderStats(startStatsEl);
  startScreen.classList.remove('hidden');
  startBtn.focus();
}

// Empty board in the active skin, used before the first game starts.
function drawEmptyBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground(ctx, canvas.width, canvas.height);
  drawGrid();
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  drawBackground(nextCtx, nextCanvas.width, nextCanvas.height);
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  drawBackground(holdCtx, holdCanvas.width, holdCanvas.height);
}

function handleStartScreenKey(e) {
  // let Enter activate other focused buttons (e.g. Borrar récords)
  if (e.target !== startBtn && e.target.tagName === 'BUTTON') return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    init();
  }
}

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// Merges this game's combo and lines into the all-time stats.
function recordStats() {
  runActive = false;
  hsStats = loadStats(hsStats);
  let changed = false;
  if (maxCombo > hsStats.bestCombo) { hsStats.bestCombo = maxCombo; changed = true; }
  if (runLines > hsStats.maxLines) { hsStats.maxLines = runLines; changed = true; }
  if (changed) writeStorage(HS_STATS_KEY, hsStats);
}

// Shows the name form if the finished game's score enters the top 5.
function offerHighScoreEntry() {
  const qualifies = !runSaved && qualifiesForHighScores(score);
  pendingEntry = qualifies ? { score, lines, maxCombo } : null;
  hsNewRecord.hidden = !qualifies;
  hsForm.hidden = !qualifies;
  hsNameInput.value = '';
  return qualifies;
}

// Called from endGame(): updates all-time stats and shows the records UI.
function showGameOverHighScores() {
  recordStats();
  highScores = loadHighScores(highScores);
  const qualifies = offerHighScoreEntry();
  renderHighScoreTable(hsScoresEl, -1);
  renderStats(hsStatsEl);
  hsGameOver.hidden = false;
  if (qualifies) hsNameInput.focus();
  else restartBtn.focus();
}

function saveHighScore() {
  if (!pendingEntry) return;
  const name = hsNameInput.value.trim().slice(0, HS_NAME_MAX) || HS_DEFAULT_NAME;
  const entry = { name, ...pendingEntry, date: new Date().toISOString() };
  pendingEntry = null;
  runSaved = true;
  highScores = loadHighScores(highScores);
  highScores.push(entry);
  // Array#sort is stable: on a tie the older entry stays ahead
  highScores.sort((a, b) => b.score - a.score);
  highScores = highScores.slice(0, HS_MAX);
  writeStorage(HS_KEY, highScores);
  hsForm.hidden = true;
  renderHighScoreTable(hsScoresEl, highScores.indexOf(entry));
  restartBtn.focus();
}

function clearHighScores() {
  if (!confirm('¿Borrar todos los récords?')) return;
  highScores = [];
  hsStats = { bestCombo: 0, maxLines: 0 };
  removeStorage(HS_KEY);
  removeStorage(HS_STATS_KEY);
  renderAllHighScores();
  // an unqualified score at game over may now fit the emptied table
  if (gameOver && !pendingEntry && offerHighScoreEntry()) hsNameInput.focus();
}

hsForm.addEventListener('submit', e => {
  e.preventDefault();
  saveHighScore();
});
startBtn.addEventListener('click', init);
for (const btn of document.querySelectorAll('.hs-clear-btn')) {
  btn.addEventListener('click', clearHighScores);
}

// ---- End high scores ----

document.addEventListener('keydown', e => {
  if (isTypingTarget(e.target)) return;
  if (!started) { handleStartScreenKey(e); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    // Ignore auto-repeat and browser shortcuts such as Cmd/Ctrl+P
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) togglePause();
    return;
  }
  if (paused) { handlePauseMenuKey(e); return; }
  if (gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
    case 'ArrowRight':
      // Repeat comes from our own DAS/ARR in loop(), not the OS
      e.preventDefault();
      if (!e.repeat) pressShift(e.code === 'ArrowLeft' ? -1 : 1);
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      if (!e.repeat) tryRotate(1);
      break;
    case 'KeyZ':
      if (!e.repeat && !e.ctrlKey && !e.metaKey) tryRotate(-1);
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) holdPiece();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

applySkin(loadSkinPreference());
showStartScreen();
