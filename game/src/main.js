// Night Ledger — boot, screens, input wiring, autopilot and screenshot modes.
// The game is one canvas, one loop: title → heist → results → next heist →
// the campaign ledger. ?autopilot=1 plays all five and reports; ?shot=X
// stages one of the four screenshots from the live simulation.
import { LEVELS, ledgerTotals } from './levels.js';
import { World } from './world.js';
import { Autopilot, runAutopilotAll } from './autopilot.js';
import { drawWorld, drawTitle, drawResults, drawCampaign, drawPaused } from './render.js';
import { stageShot } from './shots.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { VIEW_W, VIEW_H, HUD_H } from './config.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d');

const input = new Input(canvas);
const audio = new AudioEngine();
const totals = ledgerTotals();
const GADGET_ORDER = ['coin', 'smoke', 'douse', 'cricket'];
let selectedGadget = 0;
let state = 'title';
let levelIndex = 0;
let world = null;
let pilot = null;
let results = [];
let unlocked = 1;
try { unlocked = Math.max(1, parseInt(localStorage.getItem('night-ledger-unlocked') || '1', 10)); } catch (e) { /* fresh start */ }

function startHeist(i) {
  levelIndex = i;
  world = new World(i);
  pilot = new Autopilot(world);
  state = 'playing';
  selectedGadget = 0;
}

function finishHeist() {
  const r = { name: world.def.name, time: world.time, rank: world.failed ? null : world.rank, score: world.score, loot: `${world.lootGot}/${world.lootTotal}` };
  results.push(r);
  if (!world.failed) {
    unlocked = Math.max(unlocked, Math.min(5, levelIndex + 2));
    try { localStorage.setItem('night-ledger-unlocked', String(unlocked)); } catch (e) { /* ignore */ }
  }
  state = world.failed ? 'failed' : 'results';
}

function nextScreen() {
  if (state === 'results') {
    if (levelIndex >= LEVELS.length - 1) state = 'campaign';
    else startHeist(levelIndex + 1);
  } else if (state === 'failed') {
    startHeist(levelIndex);
  } else if (state === 'campaign' || state === 'title') {
    results = [];
    startHeist(0);
  }
}

function gadgetAction(kind) {
  if (!world) return null;
  if (kind === 'coin') {
    const px = world.player.x + Math.cos(world.player.angle) * 220;
    const py = world.player.y + Math.sin(world.player.angle) * 220;
    return { type: 'coin', x: px, y: py };
  }
  return { type: kind };
}

function handleKeys() {
  if (input.wasPressed('m') || input.wasPressed('M')) {
    audio.setMuted(!audio.muted);
  }
  if (state === 'title') {
    if (input.wasPressed('Enter')) { results = []; startHeist(Math.min(unlocked, 5) - 1); }
    return;
  }
  if (state === 'paused') {
    if (input.wasPressed('p') || input.wasPressed('P') || input.wasPressed('Escape')) state = 'playing';
    if (input.wasPressed('r') || input.wasPressed('R')) startHeist(levelIndex);
    if (input.wasPressed('t') || input.wasPressed('T')) state = 'title';
    return;
  }
  if (state === 'results' || state === 'failed' || state === 'campaign') {
    if (input.wasPressed('Enter')) nextScreen();
    if (input.wasPressed('r') || input.wasPressed('R')) startHeist(levelIndex);
    if (input.wasPressed('t') || input.wasPressed('T')) state = 'title';
    return;
  }
  // playing
  if (input.wasPressed('p') || input.wasPressed('P') || input.wasPressed('Escape')) { state = 'paused'; return; }
  for (let i = 0; i < 4; i += 1) {
    if (input.wasPressed(String(i + 1))) selectedGadget = i;
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  handleKeys();
  if (state === 'playing' && world) {
    const move = input.move();
    const gait = input.gait();
    let action = null;
    const kind = GADGET_ORDER[selectedGadget];
    if (input.wasPressed('q') || input.wasPressed('Q')) action = gadgetAction(kind);
    if (input.mouse.clicked) {
      const mx = input.mouse.x;
      const my = input.mouse.y - HUD_H;
      if (my >= 0) action = kind === 'coin' ? { type: 'coin', x: mx, y: my } : { type: kind };
    }
    const eventsBefore = world.events.length;
    world.step(dt, { moveX: move.x, moveY: move.y, gait, action });
    const fresh = world.events.slice(eventsBefore);
    audio.ensure();
    audio.drainEvents(fresh);
    const maxSusp = Math.max(0, ...world.guards.map((g) => g.suspicion), ...world.cameras.map((c) => c.exposure));
    audio.tension(Math.max(maxSusp, world.alarm), dt);
    drawWorld(ctx, world, levelIndex, audio.muted);
    if (world.complete || world.failed) finishHeist();
  } else if (state === 'title') {
    drawTitle(ctx, totals, unlocked);
  } else if (state === 'results' || state === 'failed') {
    drawWorld(ctx, world, levelIndex, audio.muted);
    drawResults(ctx, world, levelIndex, results.reduce((s, r) => s + r.score, 0));
  } else if (state === 'campaign') {
    drawCampaign(ctx, results);
  } else if (state === 'paused') {
    drawWorld(ctx, world, levelIndex, audio.muted);
    drawPaused(ctx);
  }
  input.endFrame();
  requestAnimationFrame(loop);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') state = 'paused';
});

// ---- headless modes: autopilot proof and screenshot staging ----
const shot = params.get('shot');
if (shot) {
  const staged = stageShot(shot);
  ctx.drawImage(staged, 0, 0);
  window.__shotReady = true;
} else if (params.get('autopilot') === '1') {
  const res = runAutopilotAll();
  ctx.fillStyle = '#10141f';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawCampaign(ctx, res);
  window.__autopilotDone = res;
  console.log(JSON.stringify(res));
} else {
  requestAnimationFrame(loop);
}
