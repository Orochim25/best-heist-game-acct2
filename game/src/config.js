// Night Ledger — shared constants: board, movement, sight and sound.
// One screen per heist: a 32x18 tile floor under an 80px HUD bar.
export const TILE = 40;
export const COLS = 32;
export const ROWS = 18;
export const HUD_H = 80;
export const VIEW_W = COLS * TILE; // 1280
export const VIEW_H = HUD_H + ROWS * TILE; // 800

// Gaits: sneak is near-silent, walk is the middle road, sprint is fast and loud.
export const GAITS = {
  sneak: { speed: 58, noise: 0, vis: 0.55, label: 'SNEAK' },
  walk: { speed: 118, noise: 92, vis: 1.0, label: 'WALK' },
  sprint: { speed: 196, noise: 175, vis: 1.25, label: 'SPRINT' },
};

// Guard sight: a raycast cone, a close range no shadow can hide, and a
// suspicion meter that fills while the thief is seen and drains in the dark.
export const CONE_FOV = (70 * Math.PI) / 180;
export const CONE_RANGE = 252;
export const CONE_NEAR = 96;
export const CONE_RAYS = 26;
export const SUSPICION_FILL = 0.82; // per second at full visibility
export const SUSPICION_DECAY = 0.2;
export const SUSPICION_INVESTIGATE = 0.55;
export const SUSPICION_GRACE = 0.9; // seconds of sight before the meter moves

// Light: lit floor exposes, shadow shelters. Grass hides unless a guard is
// almost on top of the thief.
export const LIT_THRESHOLD = 0.3;
export const LAMP_RADIUS = 170;
export const GRASS_HIDE_DIST = 46;

// Cameras sweep their own cone; lasers blink and punish a crossing.
export const CAMERA_RANGE = 190;
export const CAMERA_HALF = (22 * Math.PI) / 180;
export const MAX_STRIKES = 3;

// Palette: cold stone floor, warm amber lamplight, oxblood guards, teal thief.
export const COLORS = {
  floor: '#283044',
  floorAlt: '#252c3e',
  wall: '#161b28',
  wallTop: '#232a3d',
  grass: '#2f5d3a',
  grassTuft: '#3d8a4c',
  water: '#1d3a4d',
  crate: '#4a3626',
  crateEdge: '#6b4d33',
  pillar: '#3a4358',
  lampGlow: '#ffd27a',
  lampCore: '#ffe9a8',
  loot: '#ffd166',
  prize: '#ff5d8f',
  exit: '#39d98a',
  exitLocked: '#5a6b7a',
  player: '#6ff0dd',
  playerDark: '#1d5f6b',
  guard: '#8f2f2a',
  guardCoat: '#b0483f',
  conePatrol: 'rgba(255, 210, 122, 0.16)',
  coneSuspicious: 'rgba(255, 214, 64, 0.22)',
  coneInvestigate: 'rgba(255, 154, 46, 0.26)',
  coneChase: 'rgba(231, 76, 60, 0.32)',
  camera: '#c9a227',
  laser: '#ff2e4d',
  hud: '#10141f',
  hudLine: '#2a3247',
  text: '#e8e4d8',
  textDim: '#9aa3b5',
  alarm: '#e74c3c',
};

export const RANKS = ['GHOST', 'SHADOW', 'CUTPURSE', 'RUCKUS'];

/** Rank a finished heist: unseen + under par is GHOST, unseen over par is
 *  SHADOW, seen once under par is CUTPURSE, anything worse is RUCKUS. */
export function rankHeist(time, par, spotted) {
  if (spotted === 0 && time <= par) return 'GHOST';
  if (spotted === 0) return 'SHADOW';
  if (spotted === 1 && time <= par) return 'CUTPURSE';
  return 'RUCKUS';
}

// Deterministic RNG so every staged shot and autopilot run repeats exactly.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
