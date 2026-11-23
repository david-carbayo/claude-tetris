'use strict';

// ---- Audio and visual effects ----
// Loaded before game.js. Everything here is reached through a few hooks in
// game.js: playSound() for actions, fxOnLock() from clearLines(), fxTick(dt)
// from loop(), fxVisibleBoard()/fxIsFlashing()/fxDrawOverlay() from draw(),
// and fxReset() from init(). Game state (board, combo, level, activeSkinId…)
// is read at call time, after game.js has defined it.
//
// Effect timing uses fxClock, which only advances inside loop(), so every
// animation freezes while the game is paused.

const FX_FLASH_MS = 200;   // line-clear flash before the rows above fall
const FX_FLOAT_MS = 1000;  // floating points / combo text
const FX_LEVEL_MS = 2500;  // «NIVEL X» notice
const FX_AUDIO_KEY = 'tetris.audio';

const FX_SKIN_STYLE = {
  retro:  { flash: '#ffffff', text: '#ffd54f', stroke: 'rgba(0,0,0,0.75)', font: 'system-ui, -apple-system, sans-serif' },
  neon:   { flash: '#00f0ff', text: '#39ff14', stroke: 'rgba(0,0,0,0.9)',  font: 'system-ui, -apple-system, sans-serif', glow: true },
  pastel: { flash: '#b58cff', text: '#7a52c7', stroke: 'rgba(255,255,255,0.9)', font: 'system-ui, -apple-system, sans-serif' },
  pixel:  { flash: '#fcfcfc', text: '#f8d800', stroke: '#000000', font: '"Courier New", Courier, monospace' },
};

const fxReducedMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

let fxClock = 0;
let fxFlash = null;       // { rows: [{ y, cells }] sorted by y, start }
let fxTexts = [];         // [{ text, sub, y, start }]
let fxLevelNotice = null; // { level, start }
let fxSkipLockSound = false;

function fxReducedMotion() {
  return !!(fxReducedMotionQuery && fxReducedMotionQuery.matches);
}

function fxStyle() {
  return FX_SKIN_STYLE[activeSkinId] || FX_SKIN_STYLE.retro;
}

// Called from init(): drop every pending effect.
function fxReset() {
  fxClock = 0;
  fxFlash = null;
  fxTexts = [];
  fxLevelNotice = null;
  fxSkipLockSound = false;
}

// Called from loop() with the frame delta; never runs while paused.
function fxTick(dt) {
  fxClock += dt;
  if (fxFlash && fxClock - fxFlash.start >= FX_FLASH_MS) fxFlash = null;
  fxTexts = fxTexts.filter(t => fxClock - t.start < FX_FLOAT_MS);
  if (fxLevelNotice && fxClock - fxLevelNotice.start >= FX_LEVEL_MS) fxLevelNotice = null;
}

// Called from hardDrop() before the piece locks.
function fxHardDrop() {
  playSound('hardDrop');
  fxSkipLockSound = true;
}

// Called from clearLines() on every lock, after scoring and trackCombo().
// clearedRows holds the removed rows with their original indices; board has
// already been compacted, so collide() is correct for the next piece.
function fxOnLock(clearedRows, points, leveledUp) {
  // A new lock ends any running flash: the visible board would be stale.
  fxFlash = null;
  const n = clearedRows.length;
  if (!n) {
    if (!fxSkipLockSound) playSound('lock');
    fxSkipLockSound = false;
    return;
  }
  fxSkipLockSound = false;
  playSound(`clear${Math.min(n, 4)}`);
  const rows = clearedRows.slice().sort((a, b) => a.y - b.y);
  if (!fxReducedMotion()) fxFlash = { rows, start: fxClock };
  const midY = (rows[0].y + rows[rows.length - 1].y + 1) / 2 * BLOCK;
  // Replace any previous text: they would overlap at the same height
  fxTexts = [{
    text: `+${points.toLocaleString()}`,
    sub: combo >= 2 ? `COMBO x${combo}` : '',
    y: midY,
    start: fxClock,
  }];
  if (leveledUp) {
    playSound('levelUp', 0.25);
    fxLevelNotice = { level, start: fxClock };
  }
}

function fxIsFlashing() {
  return !!fxFlash;
}

// The board as it should look: during the flash the cleared rows are put
// back in place (and the rows above them not yet fallen).
function fxVisibleBoard() {
  if (!fxFlash) return board;
  const rows = board.slice(fxFlash.rows.length);
  for (const row of fxFlash.rows) rows.splice(row.y, 0, row.cells);
  return rows;
}

function fxText(context, text, x, y, size, alpha, style) {
  context.font = `800 ${size}px ${style.font}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.globalAlpha = alpha;
  context.lineJoin = 'round';
  context.lineWidth = Math.max(3, size / 6);
  context.strokeStyle = style.stroke;
  context.strokeText(text, x, y);
  if (style.glow) {
    context.shadowColor = style.text;
    context.shadowBlur = size / 2;
  }
  context.fillStyle = style.text;
  context.fillText(text, x, y);
  context.shadowBlur = 0;
}

// Called at the end of draw(): flash, floating texts and level-up notice.
function fxDrawOverlay(context) {
  const style = fxStyle();
  const reduced = fxReducedMotion();
  const width = COLS * BLOCK;
  context.save();

  if (fxFlash && !reduced) {
    const t = (fxClock - fxFlash.start) / FX_FLASH_MS;
    // Two bright pulses over the flash duration
    context.globalAlpha = 0.85 * (0.5 + 0.5 * Math.cos(t * Math.PI * 4));
    context.fillStyle = style.flash;
    if (style.glow) {
      context.shadowColor = style.flash;
      context.shadowBlur = 16;
    }
    for (const row of fxFlash.rows) context.fillRect(0, row.y * BLOCK, width, BLOCK);
    context.shadowBlur = 0;
  }

  for (const t of fxTexts) {
    const p = (fxClock - t.start) / FX_FLOAT_MS;
    const rise = reduced ? 0 : 40 * p;
    const alpha = reduced ? 1 : Math.min(1, (1 - p) * 2.5);
    const y = Math.min(Math.max(t.y - rise, 30), ROWS * BLOCK - 40);
    fxText(context, t.text, width / 2, y, 24, alpha, style);
    if (t.sub) fxText(context, t.sub, width / 2, y + 24, 14, alpha, style);
  }

  if (fxLevelNotice) {
    const elapsed = fxClock - fxLevelNotice.start;
    let alpha = 1, scale = 1;
    if (!reduced) {
      scale = elapsed < 200 ? 0.6 + 0.4 * (elapsed / 200) : 1;
      alpha = Math.min(1, (FX_LEVEL_MS - elapsed) / 500);
    }
    const cy = ROWS * BLOCK * 0.35;
    context.translate(width / 2, cy);
    context.scale(scale, scale);
    fxText(context, `NIVEL ${fxLevelNotice.level}`, 0, 0, 40, alpha, style);
  }

  context.restore();
}

// ---- Sound ----
// Synthesised with the Web Audio API. The AudioContext is created (or
// resumed) on the first user gesture to satisfy autoplay policies; until
// then playSound() is silent.

// Each sound is a list of notes: { at (s), type, freq, to (end freq), dur, vol }
// or { at, noise: true, dur, vol } for a filtered noise burst.
const FX_SOUNDS = {
  move:     [{ type: 'square', freq: 320, dur: 0.035, vol: 0.05 }],
  rotate:   [{ type: 'triangle', freq: 520, to: 820, dur: 0.07, vol: 0.14 }],
  hardDrop: [
    { type: 'sine', freq: 190, to: 45, dur: 0.18, vol: 0.45 },
    { noise: true, dur: 0.09, vol: 0.2 },
  ],
  lock:     [{ type: 'square', freq: 150, to: 95, dur: 0.06, vol: 0.08 }],
  clear1:   [{ type: 'triangle', freq: 523, dur: 0.16, vol: 0.25 }],
  clear2:   [
    { type: 'triangle', freq: 523, dur: 0.12, vol: 0.25 },
    { at: 0.08, type: 'triangle', freq: 659, dur: 0.16, vol: 0.25 },
  ],
  clear3:   [
    { type: 'triangle', freq: 523, dur: 0.1, vol: 0.25 },
    { at: 0.07, type: 'triangle', freq: 659, dur: 0.1, vol: 0.25 },
    { at: 0.14, type: 'triangle', freq: 784, dur: 0.18, vol: 0.25 },
  ],
  clear4:   [
    { type: 'square', freq: 523, dur: 0.09, vol: 0.12 },
    { at: 0.07, type: 'square', freq: 659, dur: 0.09, vol: 0.12 },
    { at: 0.14, type: 'square', freq: 784, dur: 0.09, vol: 0.12 },
    { at: 0.21, type: 'square', freq: 1047, dur: 0.3, vol: 0.14 },
    { at: 0.21, type: 'triangle', freq: 1047, to: 2093, dur: 0.35, vol: 0.12 },
  ],
  levelUp:  [
    { type: 'square', freq: 392, dur: 0.08, vol: 0.1 },
    { at: 0.08, type: 'square', freq: 523, dur: 0.08, vol: 0.1 },
    { at: 0.16, type: 'square', freq: 659, dur: 0.08, vol: 0.1 },
    { at: 0.24, type: 'square', freq: 784, dur: 0.08, vol: 0.1 },
    { at: 0.32, type: 'triangle', freq: 1047, dur: 0.35, vol: 0.2 },
  ],
  gameOver: [
    { type: 'sawtooth', freq: 392, dur: 0.22, vol: 0.12 },
    { at: 0.22, type: 'sawtooth', freq: 330, dur: 0.22, vol: 0.12 },
    { at: 0.44, type: 'sawtooth', freq: 262, dur: 0.22, vol: 0.12 },
    { at: 0.66, type: 'sawtooth', freq: 196, to: 98, dur: 0.7, vol: 0.14 },
  ],
};

let audioCtx = null;
let audioMaster = null;
let audioNoise = null;
let audioSettings = loadAudioSettings();

function loadAudioSettings() {
  const fallback = { volume: 0.6, muted: false };
  try {
    const data = JSON.parse(localStorage.getItem(FX_AUDIO_KEY));
    if (!data || typeof data !== 'object') return fallback;
    const volume = Number(data.volume);
    return {
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback.volume,
      muted: data.muted === true,
    };
  } catch {
    return fallback; // storage unavailable or unparsable
  }
}

function saveAudioSettings() {
  try {
    localStorage.setItem(FX_AUDIO_KEY, JSON.stringify(audioSettings));
  } catch {
    // storage unavailable: keep the in-memory settings
  }
}

function applyAudioVolume() {
  if (!audioMaster) return;
  const gain = audioSettings.muted ? 0 : audioSettings.volume;
  audioMaster.gain.setValueAtTime(gain, audioCtx.currentTime);
}

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioCtx = new AC();
      audioMaster = audioCtx.createGain();
      audioMaster.connect(audioCtx.destination);
      applyAudioVolume();
    } catch {
      audioCtx = null;
      return;
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function audioNoiseBuffer() {
  if (!audioNoise) {
    const len = Math.floor(audioCtx.sampleRate * 0.2);
    audioNoise = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = audioNoise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return audioNoise;
}

function playNote(note, t0) {
  const start = t0 + (note.at || 0);
  const end = start + note.dur;
  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(note.vol, start + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(audioMaster);
  let src;
  if (note.noise) {
    src = audioCtx.createBufferSource();
    src.buffer = audioNoiseBuffer();
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    src.connect(filter).connect(env);
  } else {
    src = audioCtx.createOscillator();
    src.type = note.type;
    src.frequency.setValueAtTime(note.freq, start);
    if (note.to) src.frequency.exponentialRampToValueAtTime(note.to, end);
    src.connect(env);
  }
  src.start(start);
  src.stop(end + 0.02);
}

// Plays a named sound from FX_SOUNDS, optionally delayed (seconds).
function playSound(name, delay = 0) {
  const notes = FX_SOUNDS[name];
  if (!notes || !audioCtx || audioSettings.muted || audioSettings.volume <= 0) return;
  try {
    const t0 = audioCtx.currentTime + 0.01 + delay;
    for (const note of notes) playNote(note, t0);
  } catch {
    // never let audio break the game
  }
}

// ---- Sound controls (side panel, pause menu, key M) ----

const muteBtn = document.getElementById('mute-btn');
const volumeInput = document.getElementById('volume');
const fxPauseMuteBtn = document.getElementById('pause-mute');

function renderAudioControls() {
  const { muted, volume } = audioSettings;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.title = muted ? 'Activar sonido (M)' : 'Silenciar (M)';
  volumeInput.value = String(Math.round(volume * 100));
  fxPauseMuteBtn.textContent = muted ? 'Sonido: silenciado' : 'Sonido: activado';
  fxPauseMuteBtn.setAttribute('aria-pressed', String(muted));
}

function toggleMute() {
  audioSettings.muted = !audioSettings.muted;
  saveAudioSettings();
  applyAudioVolume();
  renderAudioControls();
}

function setVolume(percent) {
  audioSettings.volume = Math.min(1, Math.max(0, Number(percent) / 100 || 0));
  if (audioSettings.volume > 0) audioSettings.muted = false;
  saveAudioSettings();
  applyAudioVolume();
  renderAudioControls();
}

// Any gesture may create or resume the AudioContext. Capture phase so it is
// ready before game.js handles the same key.
document.addEventListener('pointerdown', ensureAudio, true);
document.addEventListener('keydown', ensureAudio, true);

document.addEventListener('keydown', e => {
  if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
  toggleMute();
});

muteBtn.addEventListener('click', () => {
  toggleMute();
  muteBtn.blur(); // Space must keep reaching the game
});
fxPauseMuteBtn.addEventListener('click', toggleMute);
volumeInput.addEventListener('input', () => setVolume(volumeInput.value));
// Give the keyboard back to the game once the slider is released
volumeInput.addEventListener('change', () => volumeInput.blur());

renderAudioControls();

// ---- End audio and visual effects ----
