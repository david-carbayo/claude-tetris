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

- **Cell values are colour indices.** `PIECES[type]` matrices are filled with their own type number (1–7), which indexes `COLORS`. `merge()` copies those numbers into `board`, so `0` means empty and any non-zero value is both "occupied" and "which colour to draw". Adding a piece means adding to both arrays with a matching index, and updating the `* 7` in `randomPiece()`.
- **`collide(shape, x, y)` is the single source of truth** for movement, rotation (`tryRotate` with kicks `[0, -1, 1, -2, 2]`), gravity, the ghost piece (`ghostY`) and game-over detection (in `spawn`). Rows with `y < 0` are allowed (above the board).
- **Locking path:** gravity in `loop()`, `softDrop()` and `hardDrop()` all end in `lockPiece()` → `merge()` → `clearLines()` → `spawn()`. Scoring, level and `dropInterval` (`max(100, 1000 − (level − 1) × 90)`) are recalculated only in `clearLines()`.
- **Game loop:** `requestAnimationFrame`-driven `loop(ts)` accumulates `dt` into `dropAccum` and drops one row per `dropInterval`. Pause stops it via `cancelAnimationFrame(animId)`; resume resets `lastTime` before restarting. Because `endGame()` can run inside `loop()` (via `lockPiece()`), cancelling there is not enough: `loop()` checks `gameOver` before scheduling the next frame.
- **Rendering** redraws everything every frame: grid, board, ghost (`alpha 0.2`), current piece. `drawBlock()` is shared with the next-piece canvas (`drawNext()`, called from `spawn()`).
- **Start screen and high scores** live in the `// ---- High scores ----` section of `game.js`. On load the file calls `showStartScreen()`, not `init()`; while `started` is false the keydown handler only accepts Enter (or the Jugar button) to call `init()`. The keydown handler ignores events whose target is an input, so typing a name never moves pieces. `clearLines()` calls `trackCombo(cleared)` on every lock (combo = consecutive line-clearing locks), `endGame()` calls `showGameOverHighScores()` and `init()` calls `resetHighScoreRun()`. Top 5 entries `{ name, score, lines, maxCombo, date }` are stored under `localStorage['tetris.highscores']` and all-time `{ bestCombo, maxLines }` under `tetris.stats`; every storage access is in try/catch, with in-memory copies as the fallback. Player names are rendered with `textContent` only.
- **Board size coupling:** `COLS × BLOCK` and `ROWS × BLOCK` must match the `<canvas id="board">` `width`/`height` in `index.html` (currently 300 × 600). The next-piece canvas assumes a 4 × 4 grid of 30 px cells (120 × 120).

