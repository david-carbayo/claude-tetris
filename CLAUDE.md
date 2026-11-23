# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A falling-block puzzle game in vanilla JavaScript, HTML5 Canvas and CSS. No dependencies, no `package.json`, no build step, no tests, no linter. The README is in Spanish, and so is the user-facing text (`index.html`, overlay strings in `game.js`); code identifiers and comments are in English.

## Running

Open `index.html` directly, or serve the folder statically (preferred):

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. There is nothing to build or test; verify changes by playing in the browser.

## Architecture

Three files: `index.html` (board canvas, side panel with HUD and next-piece canvas, overlay), `style.css` (dark theme), and `game.js`, which holds all logic as top-level functions sharing module-level mutable state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `animId`, …). `init()` resets all of it and is also the restart handler.

Key points that span several functions:

- **Cell values are colour indices.** `PIECES[type]` matrices are filled with their own type number (1–7), which indexes the active skin's `colors` palette (`COLORS` is the Retro palette). `merge()` copies those numbers into `board`, so `0` means empty and any non-zero value is both "occupied" and "which colour to draw". Adding a piece means adding to both arrays with a matching index, and updating the `* 7` in `randomPiece()`.
- **`collide(shape, x, y)` is the single source of truth** for movement, rotation (`tryRotate` with kicks `[0, -1, 1, -2, 2]`), gravity, the ghost piece (`ghostY`) and game-over detection (in `spawn`). Rows with `y < 0` are allowed (above the board).
- **Locking path:** `hardDrop()` and the lock-delay timer (`updateLockDelay()` in `loop()`) end in `lockPiece()` → `merge()` → `clearLines()` → `spawn()`. Gravity and `softDrop()` never lock a grounded piece.
- **Fine controls** (`// ---- Fine controls ----` section): lock delay of `LOCK_DELAY` (500 ms) that runs only while grounded; each successful move/rotation (`onPieceMoved()`) restarts it, up to `MAX_LOCK_RESETS` (15), and reaching a new lowest row (`noteDescent()`) refills the resets. `spawn()` calls `resetLockState()`; anything else that replaces `current` must call it too. `tryRotate(dir)` (1 = clockwise via `↑`/`X`, −1 = anticlockwise via `Z`) tries `ROTATION_KICKS` `[dx, dy]`, horizontal first, then upward floor kicks. Sideways movement uses its own DAS/ARR (`updateAutoShift()` in `loop()`, from keydown/keyup state; `e.repeat` is ignored); held keys are cleared on pause, window blur and `init()`. DAS/ARR are set in the pause menu and stored under `localStorage['tetris.handling']` as `{ das, arr }`. Scoring, level (`gameStartLevel + floor(lines / 10)`) and `dropInterval` (`max(100, 1000 − (level − 1) × 90)`) are recalculated only in `clearLines()`; `init()` snapshots `gameStartLevel = startLevel` and seeds them with the same formula.
- **Game loop:** `requestAnimationFrame`-driven `loop(ts)` accumulates `dt` into `dropAccum` and drops one row per `dropInterval`. Pause stops it via `cancelAnimationFrame(animId)`; resume resets `lastTime` and `dropAccum` before restarting. Because `endGame()` can run inside `loop()` (via `lockPiece()`), cancelling there is not enough: `loop()` checks `gameOver` before scheduling the next frame.
- **Pause menu** (`// ---- Pause menu ----` section in `game.js`, `#pause-menu` in `index.html`, separate from the game-over `#overlay`): `P`/`Escape` call `togglePause()` (no-op during game over) → `openPauseMenu()` / `resumeGame()`. While `paused`, the keydown handler routes every key to `handlePauseMenuKey()` (↑/↓ and Tab move focus, trapped in the menu; ←/→ change the start level, Enter/Space activate the focused button natively) so nothing reaches the game. `startLevel` (1–10) is persisted in `localStorage` under `tetris.startLevel` (all access in try/catch) and applies from the next `init()`. Closing the menu or restarting blurs the focused button so Space/Enter cannot re-trigger it.
- **Rendering** redraws everything every frame: grid, board, ghost (`alpha 0.2`), current piece. `drawBlock()` is shared with the next-piece canvas (`drawNext()`, called from `spawn()`).
- **Skins:** the `// ---- Skins ----` section in `game.js` defines `SKINS` (Retro, Neon, Pastel, Pixel art), each with `colors` (indexed like `PIECES`), `background`, `grid` and its own `drawBlock`. The global `drawBlock()`/`drawGrid()` delegate to `activeSkin`; `draw()` and `drawNext()` fill the skin background. `drawBlock()` wraps each block in `save()`/`restore()` so `shadowBlur` and `globalAlpha` never leak. `applySkin(id)` toggles a `skin-<id>` class on `body` (page styling in `style.css`) and redraws once, so it works while paused or after game over. The choice is stored under `localStorage['tetris-skin']` (every access in try/catch; unknown values fall back to Retro). The `#skin-select` blurs on change and swallows arrow/Space defaults so keys keep reaching the game. A new piece needs a colour in every skin's `colors`.
- **Start screen and high scores** live in the `// ---- High scores ----` section of `game.js`. On load the file calls `showStartScreen()`, not `init()`; while `started` is false the keydown handler only accepts Enter (or the Jugar button) to call `init()`. The keydown handler ignores events whose target is an input, so typing a name never moves pieces. `clearLines()` calls `trackCombo(cleared)` on every lock (combo = consecutive line-clearing locks), `endGame()` calls `showGameOverHighScores()` and `init()` calls `resetHighScoreRun()`. Top 5 entries `{ name, score, lines, maxCombo, date }` are stored under `localStorage['tetris.highscores']` and all-time `{ bestCombo, maxLines }` under `tetris.stats`; every storage access is in try/catch, with in-memory copies as the fallback. Player names are rendered with `textContent` only.
- **Board size coupling:** `COLS × BLOCK` and `ROWS × BLOCK` must match the `<canvas id="board">` `width`/`height` in `index.html` (currently 300 × 600). The next-piece canvas assumes a 4 × 4 grid of 30 px cells (120 × 120).

