// Night Ledger — the autopilot: reads cones like a player does, plans a route
// through the dark, waits out a sweeping cone, and only throws a coin when
// the way is truly blocked. It plays every heist to completion for ?autopilot
// and for the win screenshot, and it never cheats: it only uses the same
// step() input a keyboard player gets.
import { TILE, COLS, ROWS, CONE_FOV, CONE_RANGE, CAMERA_RANGE, CAMERA_HALF, LIT_THRESHOLD } from './config.js';
import { LEVELS } from './levels.js';
import { World, losClear, tileCenter, inBounds } from './world.js';

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function tileKey(tx, ty) { return ty * COLS + tx; }

export class Autopilot {
  constructor(world) {
    this.w = world;
    this.path = [];
    this.target = null;
    this.targetLockUntil = 0;
    this.replanIn = 0;
    this.waitUntil = 0;
    this.coinCooldown = 0;
    this.movingTime = 0;
    this.moveCheckPos = null;
    this.blocked = new Map();
    this.waitingForCone = 0;
  }

  /** Public step: runs the planner, then watches for real stuckness — moving
   *  without progressing — and only then spends a coin or blocks the step.
   *  Deliberate waiting (a cone, a laser, a thrown coin) never counts. */
  step(dt) {
    const w = this.w;
    const p = w.player;
    const input = this.stepInner(dt);
    if (input.moveX !== 0 || input.moveY !== 0) {
      if (this.moveCheckPos === null) this.moveCheckPos = { x: p.x, y: p.y };
      this.movingTime += dt;
    }
    if (this.movingTime > 2.5) {
      const movedTotal = Math.hypot(p.x - this.moveCheckPos.x, p.y - this.moveCheckPos.y);
      this.movingTime = 0;
      this.moveCheckPos = { x: p.x, y: p.y };
      if (movedTotal < 15 && this.path.length > 0) {
        const blockedTile = this.path[0];
        this.path = [];
        if (w.gadgets.coin > 0 && this.coinCooldown <= 0) {
          const lure = this.lureTile();
          if (lure) {
            this.coinCooldown = 5;
            this.waitUntil = w.time + 2.2;
            return { moveX: 0, moveY: 0, gait: 'sneak', action: { type: 'coin', x: tileCenter(lure[0]), y: tileCenter(lure[1]) } };
          }
        }
        if (blockedTile) this.blocked.set(tileKey(blockedTile[0], blockedTile[1]), { penalty: 50, until: w.time + 8 });
        this.replanIn = 0;
      }
    }
    return input;
  }

  stepInner(dt) {
    const w = this.w;
    const p = w.player;
    if (w.complete || w.failed) return { moveX: 0, moveY: 0, gait: 'walk', action: null };
    this.coinCooldown = Math.max(0, this.coinCooldown - dt);

    // A chasing guard means run for the darkest far corner, fast.
    const chaser = w.guards.find((g) => g.state === 'chase');
    if (chaser) {
      const safe = this.safestTile();
      if (safe) return this.followPathTo(safe[0], safe[1], dt, 'sprint');
      return { moveX: 0, moveY: 0, gait: 'sprint', action: null };
    }

    // A guard growing suspicious while it can see us: back off to cover.
    const threat = w.guards.find((g) => g.suspicion > 0.4 && (g.state === 'suspicious' || g.state === 'investigate'));
    if (threat && this.nearestGuardDist() < 280) {
      const hide = this.hideTile(threat);
      if (hide) {
        const input = this.followPathTo(hide[0], hide[1], dt, 'sneak');
        if (threat.suspicion < 0.2) this.target = null;
        return input;
      }
    }

    if (w.time < this.waitUntil) return { moveX: 0, moveY: 0, gait: 'sneak', action: null };

    // Pick a target and stick with it: nearest loot, then the prize, then the hatch.
    if (!this.target || w.time > this.targetLockUntil || this.targetDone()) {
      this.target = this.pickTarget();
      this.targetLockUntil = w.time + 6;
      this.path = [];
    }
    if (!this.target) return { moveX: 0, moveY: 0, gait: 'walk', action: null };

    this.replanIn -= dt;
    if (this.replanIn <= 0 || this.path.length === 0) {
      this.replanIn = 0.4;
      this.path = this.findPath(this.target[0], this.target[1]) || [];
    }
    if (this.path.length === 0) return { moveX: 0, moveY: 0, gait: 'walk', action: null };

    // A laser lit across the next step: wait for the dark beat.
    const next = this.path[0];
    const laser = this.laserOnTile(next[0], next[1]);
    if (laser && laser.on) return { moveX: 0, moveY: 0, gait: 'sneak', action: null };

    // A cone parked on the next step: wait it out while we are still safe.
    const nextDanger = this.baseDangerAt(next[0], next[1]);
    const hereDanger = this.baseDangerAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (nextDanger > 15 && hereDanger < 5) {
      this.waitingForCone += dt;
      if (this.waitingForCone < 5) return { moveX: 0, moveY: 0, gait: 'sneak', action: null };
      // Patience spent: spend a coin to pull the guard away instead.
      if (w.gadgets.coin > 0 && this.coinCooldown <= 0) {
        const lure = this.lureTile();
        if (lure) {
          this.coinCooldown = 5;
          this.waitUntil = w.time + 2.2;
          this.waitingForCone = 0;
          return { moveX: 0, moveY: 0, gait: 'sneak', action: { type: 'coin', x: tileCenter(lure[0]), y: tileCenter(lure[1]) } };
        }
      }
      // No coin to spend: avoid this step for a while and go around it.
      this.blocked.set(tileKey(next[0], next[1]), { penalty: 50, until: w.time + 8 });
      this.path = [];
      this.waitingForCone = 0;
      this.replanIn = 0;
      return { moveX: 0, moveY: 0, gait: 'sneak', action: null };
    }
    this.waitingForCone = 0;

    const wx = tileCenter(next[0]);
    const wy = tileCenter(next[1]);
    const dx = wx - p.x;
    const dy = wy - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) { this.path.shift(); return this.stepInner(dt); }
    const near = this.nearestGuardDist();
    const lit = w.lightAtPx(p.x, p.y) >= LIT_THRESHOLD;
    const gait = near < 300 || lit ? 'sneak' : 'walk';
    return { moveX: dx / dist, moveY: dy / dist, gait, action: null };
  }

  targetDone() {
    const t = this.target;
    if (!t) return true;
    const desc = t[2];
    if (desc.kind === 'loot') return desc.ref.got;
    if (desc.kind === 'prize') return this.w.prizeGot;
    return this.w.complete;
  }

  pickTarget() {
    const w = this.w;
    const p = w.player;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor(p.y / TILE);
    const dists = this.bfsDistances(ptx, pty);
    let best = null;
    let bestD = Infinity;
    for (const loot of w.loots) {
      if (loot.got) continue;
      const d = dists.get(tileKey(loot.tx, loot.ty));
      if (d !== undefined && d < bestD) { bestD = d; best = { kind: 'loot', ref: loot }; }
    }
    if (best) return [best.ref.tx, best.ref.ty, best];
    if (!w.prizeGot) return [w.prize.tx, w.prize.ty, { kind: 'prize', ref: w.prize }];
    return [w.exit.tx, w.exit.ty, { kind: 'exit', ref: w.exit }];
  }

  bfsDistances(sx, sy) {
    const w = this.w;
    const dists = new Map();
    const q = [[sx, sy]];
    dists.set(tileKey(sx, sy), 0);
    while (q.length) {
      const [x, y] = q.shift();
      const d = dists.get(tileKey(x, y));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny) || dists.has(tileKey(nx, ny))) continue;
        if (w.isSolidAt(nx, ny)) continue;
        dists.set(tileKey(nx, ny), d + 1);
        q.push([nx, ny]);
      }
    }
    return dists;
  }

  followPathTo(tx, ty, dt, gait) {
    this.replanIn -= dt;
    if (this.replanIn <= 0 || this.path.length === 0) {
      this.replanIn = 0.4;
      this.path = this.findPath(tx, ty) || [];
    }
    if (this.path.length === 0) return { moveX: 0, moveY: 0, gait, action: null };
    const next = this.path[0];
    const wx = tileCenter(next[0]);
    const wy = tileCenter(next[1]);
    const p = this.w.player;
    const dx = wx - p.x;
    const dy = wy - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) { this.path.shift(); return { moveX: 0, moveY: 0, gait, action: null }; }
    return { moveX: dx / dist, moveY: dy / dist, gait, action: null };
  }

  nearestGuardDist() {
    const p = this.w.player;
    let best = Infinity;
    for (const g of this.w.guards) best = Math.min(best, Math.hypot(g.x - p.x, g.y - p.y));
    return best;
  }

  /** The walkable tile farthest from every guard, preferring grass and dark. */
  safestTile() {
    const w = this.w;
    const ptx = Math.floor(w.player.x / TILE);
    const pty = Math.floor(w.player.y / TILE);
    const dists = this.bfsDistances(ptx, pty);
    let best = null;
    let bestScore = -Infinity;
    for (const [key, d] of dists) {
      if (d > 22) continue;
      const tx = key % COLS;
      const ty = Math.floor(key / COLS);
      let minG = Infinity;
      for (const g of w.guards) minG = Math.min(minG, Math.hypot(tileCenter(tx) - g.x, tileCenter(ty) - g.y));
      let score = minG + (w.tileAt(tx, ty) === ',' ? 60 : 0) + (w.lightMap[ty * COLS + tx] < LIT_THRESHOLD ? 30 : 0);
      if (score > bestScore) { bestScore = score; best = [tx, ty]; }
    }
    return best;
  }

  hideTile(threat) {
    const w = this.w;
    const ptx = Math.floor(w.player.x / TILE);
    const pty = Math.floor(w.player.y / TILE);
    const dists = this.bfsDistances(ptx, pty);
    let best = null;
    let bestScore = -Infinity;
    for (const [key, d] of dists) {
      if (d > 14) continue;
      const tx = key % COLS;
      const ty = Math.floor(key / COLS);
      const dg = Math.hypot(tileCenter(tx) - threat.x, tileCenter(ty) - threat.y);
      if (dg < 220) continue;
      let score = dg + (w.tileAt(tx, ty) === ',' ? 80 : 0) + (w.lightMap[ty * COLS + tx] < LIT_THRESHOLD ? 40 : 0);
      if (score > bestScore) { bestScore = score; best = [tx, ty]; }
    }
    return best;
  }

  /** A floor tile on the far side of the nearest guard, to throw a coin at. */
  lureTile() {
    const w = this.w;
    const p = w.player;
    let guard = null;
    let bestD = Infinity;
    for (const g of w.guards) {
      const d = Math.hypot(g.x - p.x, g.y - p.y);
      if (d < bestD) { bestD = d; guard = g; }
    }
    if (!guard) return null;
    const gx = Math.floor(guard.x / TILE);
    const gy = Math.floor(guard.y / TILE);
    const px = Math.floor(p.x / TILE);
    const py = Math.floor(p.y / TILE);
    const dx = Math.sign(gx - px) || 1;
    const dy = Math.sign(gy - py) || 0;
    // A coin only flies 330px — only offer tiles the thief can actually reach.
    const inRange = (tx, ty) => Math.hypot(tileCenter(tx) - p.x, tileCenter(ty) - p.y) <= 300;
    for (let step = 6; step >= 3; step -= 1) {
      const tx = gx + dx * step;
      const ty = gy + dy * step;
      if (inBounds(tx, ty) && !w.isSolidAt(tx, ty) && inRange(tx, ty)) return [tx, ty];
      if (inBounds(gx - dx * step, gy) && !w.isSolidAt(gx - dx * step, gy) && inRange(gx - dx * step, gy)) return [gx - dx * step, gy];
    }
    return null;
  }

  laserOnTile(tx, ty) {
    for (const l of this.w.lasers) {
      for (const [lx, ly] of l.tiles) if (lx === tx && ly === ty) return l;
    }
    return null;
  }

  /** Live danger of a tile (cones, lasers, lamps) — without detour penalties. */
  baseDangerAt(tx, ty) {
    const w = this.w;
    if (!inBounds(tx, ty) || w.isSolidAt(tx, ty)) return 999;
    const cx = tileCenter(tx);
    const cy = tileCenter(ty);
    let danger = 1;
    const laser = this.laserOnTile(tx, ty);
    if (laser) danger += laser.on ? 60 : 8;
    for (const g of w.guards) {
      const dx = cx - g.x;
      const dy = cy - g.y;
      const dist = Math.hypot(dx, dy);
      if (dist < CONE_RANGE && Math.abs(angleDiff(Math.atan2(dy, dx), g.angle)) < CONE_FOV / 2 && losClear(w.grid, g.x, g.y, cx, cy)) danger += 30;
      if (dist < 90) danger += 15;
    }
    for (const c of w.cameras) {
      const dx = cx - c.x;
      const dy = cy - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < CAMERA_RANGE && Math.abs(angleDiff(Math.atan2(dy, dx), c.angle)) < CAMERA_HALF && losClear(w.grid, c.x, c.y, cx, cy)) danger += 25;
    }
    if (w.lightMap[ty * COLS + tx] >= LIT_THRESHOLD) danger += 3;
    if (w.tileAt(tx, ty) === '~') danger += 1;
    if (w.tileAt(tx, ty) === ',') danger -= 0.3;
    return danger;
  }

  /** Planning danger: live danger plus temporary detour penalties. */
  dangerAt(tx, ty) {
    let danger = this.baseDangerAt(tx, ty);
    const block = this.blocked.get(tileKey(tx, ty));
    if (block) {
      if (this.w.time < block.until) danger += block.penalty;
      else this.blocked.delete(tileKey(tx, ty));
    }
    return danger;
  }

  /** A* over the tile grid; danger is a cost, never a wall, so a way always exists. */
  findPath(tx, ty) {
    const w = this.w;
    const sx = Math.floor(w.player.x / TILE);
    const sy = Math.floor(w.player.y / TILE);
    if (sx === tx && sy === ty) return [];
    const open = [[0, sx, sy]];
    const came = new Map();
    const cost = new Map([[tileKey(sx, sy), 0]]);
    const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    const seen = new Set();
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [, x, y] = open.shift();
      const k = tileKey(x, y);
      if (seen.has(k)) continue;
      seen.add(k);
      if (x === tx && y === ty) {
        const path = [];
        let cur = k;
        while (cur !== tileKey(sx, sy)) {
          path.unshift([cur % COLS, Math.floor(cur / COLS)]);
          cur = came.get(cur);
        }
        return path;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny) || w.isSolidAt(nx, ny)) continue;
        const nk = tileKey(nx, ny);
        const nc = (cost.get(k) || 0) + this.dangerAt(nx, ny);
        if (nc < (cost.get(nk) ?? Infinity)) {
          cost.set(nk, nc);
          came.set(nk, k);
          open.push([nc + h(nx, ny), nx, ny]);
        }
      }
    }
    return null;
  }
}

/** Play all five heists with the autopilot, synchronously, and report each. */
export function runAutopilotAll() {
  const results = [];
  for (let i = 0; i < LEVELS.length; i += 1) {
    const world = new World(i);
    const pilot = new Autopilot(world);
    const dt = 1 / 30;
    let steps = 0;
    while (!world.complete && !world.failed && steps < 30 * 400) {
      world.step(dt, pilot.step(dt));
      steps += 1;
    }
    results.push({
      level: i,
      name: world.def.name,
      prize: world.def.prize,
      time: Math.round(world.time * 10) / 10,
      par: world.def.par,
      rank: world.rank,
      spotted: world.spotted,
      strikes: world.strikes,
      loot: `${world.lootGot}/${world.lootTotal}`,
      score: world.score,
      complete: world.complete,
      failed: world.failed,
    });
  }
  return results;
}
