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
    level = Math.floor(lines / 10) + 1;
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
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

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  showGameOverHighScores();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
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
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  resetHighScoreRun();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  renderHighScoreTable(startScoresEl, -1);
  renderStats(startStatsEl);
  startScreen.classList.remove('hidden');
  startBtn.focus();
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
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

showStartScreen();
