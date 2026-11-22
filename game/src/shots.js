// Night Ledger — the four screenshots, staged from the real running game.
// Each shot is a live simulation frame, never a drawing: the cover shows the
// thief crouched in the dark while a cone stops short, the alert shot catches
// a chase, the lure shot shows a guard walking toward a thrown coin, and the
// win shot is the campaign report after the autopilot clears all five heists.
import { World } from './world.js';
import { Autopilot, runAutopilotAll } from './autopilot.js';
import { drawWorld, drawCampaign } from './render.js';
import { VIEW_W, VIEW_H, TILE } from './config.js';

function makeCtx() {
  const canvas = document.createElement('canvas');
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  return { canvas, ctx: canvas.getContext('2d') };
}

/** Step a world forward with a scripted player until a condition holds. */
function simulate(world, inputFn, stopFn, maxSeconds) {
  const dt = 1 / 30;
  let steps = 0;
  while (steps < maxSeconds * 30 && !world.complete && !world.failed && !(stopFn && stopFn(world))) {
    world.step(dt, inputFn(world, steps));
    steps += 1;
  }
  return steps;
}

export function stageShot(kind) {
  const { canvas, ctx } = makeCtx();
  if (kind === 'win') {
    const results = runAutopilotAll();
    ctx.fillStyle = '#10141f';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawCampaign(ctx, results);
    return canvas;
  }

  const world = new World(0);
  if (kind === 'cover') {
    // Let the night settle: guards patrol for 20s while Rook waits at the door.
    simulate(world, () => ({ moveX: 0, moveY: 0, gait: 'sneak', action: null }), null, 20);
    // The pose: Rook crouched in the tall grass at (21,3), Dunstan pacing the
    // lit floor at (14,3) facing right — his cone runs out of reach 28px short.
    world.player.x = 21 * TILE + 20;
    world.player.y = 3 * TILE + 20;
    world.player.gait = 'sneak';
    world.player.hidden = true;
    const dunstan = world.guards[0];
    dunstan.x = 14 * TILE + 20;
    dunstan.y = 3 * TILE + 20;
    dunstan.angle = 0;
    dunstan.state = 'patrol';
    dunstan.suspicion = 0.1;
    world.notes = [
      { x: world.player.x, y: world.player.y, lx: 700, ly: 260, text: 'ROOK, SNEAKING IN THE GRASS — HIDDEN' },
      { x: dunstan.x, y: dunstan.y, lx: 320, ly: 460, text: 'DUNSTAN’S CONE STOPS SHORT OF THE GRASS' },
      { x: 27 * TILE + 20, y: 2 * TILE + 20, lx: 1040, ly: 300, text: 'LOOT — EVERY PIECE COUNTS' },
    ];
    drawWorld(ctx, world, 0, true);
    return canvas;
  }

  if (kind === 'spotted') {
    // Rook stands in the lamplight in front of Ferro, whose cone is already
    // on him (suspicion 0.95, grace spent), so the chase begins within a few
    // frames. The frame is drawn the moment the chase starts, before Ferro
    // can close the gap.
    const ferro = world.guards[1];
    ferro.suspicion = 0.95;
    ferro.grace = 1;
    world.player.x = 27 * TILE + 20;
    world.player.y = 10 * TILE + 20;
    world.player.gait = 'walk';
    simulate(world, () => ({ moveX: 0, moveY: 0, gait: 'walk', action: null }), (w) => w.guards.some((g) => g.state === 'chase'), 5);
    world.notes = [
      { x: world.player.x, y: world.player.y, lx: 640, ly: 240, text: 'CAUGHT IN THE LAMPLIGHT — CHASE!' },
      { x: ferro.x, y: ferro.y, lx: 320, ly: 580, text: 'FERRO’S CONE TURNS RED' },
    ];
    drawWorld(ctx, world, 0, true);
    return canvas;
  }

  // lure: Rook throws a coin across the hall; Ferro leaves his post to look.
  const ferro = world.guards[1];
  world.player.x = 20 * TILE + 20;
  world.player.y = 10 * TILE + 20;
  world.player.gait = 'sneak';
  world.step(1 / 30, { moveX: 0, moveY: 0, gait: 'sneak', action: { type: 'coin', x: 27 * TILE + 20, y: 10 * TILE + 20 } });
  simulate(world, () => ({ moveX: 0, moveY: 0, gait: 'sneak', action: null }), null, 5);
  world.notes = [
    { x: 27 * TILE + 20, y: 10 * TILE + 20, lx: 1020, ly: 260, text: 'A THROWN COIN — FERRO GOES TO LOOK' },
    { x: world.player.x, y: world.player.y, lx: 420, ly: 580, text: 'ROOK SLIPS PAST IN THE DARK' },
  ];
  drawWorld(ctx, world, 0, true);
  return canvas;
}
