// Night Ledger — the simulation: one heist, its guards, cones, light, gadgets.
// Pure rules, no drawing: render.js draws what this file decides.
import {
  TILE, COLS, ROWS, GAITS, CONE_FOV, CONE_RANGE, CONE_NEAR, CONE_RAYS,
  SUSPICION_FILL, SUSPICION_DECAY, SUSPICION_INVESTIGATE, SUSPICION_GRACE,
  LIT_THRESHOLD, LAMP_RADIUS, GRASS_HIDE_DIST, CAMERA_RANGE, CAMERA_HALF,
  MAX_STRIKES, rankHeist, mulberry32,
} from './config.js';
import { LEVELS } from './levels.js';

const SOLID = new Set(['#', 'C', 'P']);
export const tileCenter = (tx) => tx * TILE + TILE / 2;
export const inBounds = (tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS;

/** DDA raycast: distance from (x, y) along `angle` to the first solid tile. */
export function rayHit(grid, x, y, angle, maxDist) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tx = Math.floor(x / TILE);
  let ty = Math.floor(y / TILE);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(TILE / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(TILE / dy);
  let tMaxX = dx === 0 ? Infinity : (dx > 0 ? (tx + 1) * TILE - x : x - tx * TILE) / Math.abs(dx);
  let tMaxY = dy === 0 ? Infinity : (dy > 0 ? (ty + 1) * TILE - y : y - ty * TILE) / Math.abs(dy);
  let t = 0;
  for (let i = 0; i < 64; i += 1) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t > maxDist) return maxDist;
    if (!inBounds(tx, ty)) return t;
    if (SOLID.has(grid[ty][tx])) return t;
  }
  return maxDist;
}

/** Line of sight between two points: true when no solid tile blocks the way. */
export function losClear(grid, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return true;
  const steps = Math.max(1, Math.ceil(dist / 8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const tx = Math.floor((x0 + dx * t) / TILE);
    const ty = Math.floor((y0 + dy * t) / TILE);
    if (!inBounds(tx, ty)) return false;
    if (SOLID.has(grid[ty][tx])) return false;
  }
  return true;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A guard: named, patrolling waypoints, running a suspicion meter. */
export class Guard {
  constructor(def, rng) {
    this.name = def.name;
    this.waypoints = def.waypoints;
    this.x = tileCenter(def.waypoints[0][0]);
    this.y = tileCenter(def.waypoints[0][1]);
    this.wp = 1 % def.waypoints.length;
    this.angle = 0;
    this.state = 'patrol';
    this.suspicion = 0;
    this.grace = 0;
    this.pause = 1 + rng() * 1.4;
    this.scanPhase = rng() * Math.PI * 2;
    this.lastSeen = { x: this.x, y: this.y };
    this.loseSight = 0;
    this.searchTime = 0;
    this.spottedFlag = false;
    this.speed = 55;
  }
}

/** A sweeping security camera with its own exposure meter. */
export class Camera {
  constructor(def, rng) {
    this.x = tileCenter(def.tx);
    this.y = tileCenter(def.ty);
    this.baseAngle = def.angle;
    this.sweep = def.sweep;
    this.speed = def.speed;
    this.phase = (rng ? rng() : Math.random()) * Math.PI * 2;
    this.angle = def.angle;
    this.exposure = 0;
    this.tripped = false;
  }
}

/** A blinking laser beam: cross it while lit and the alarm jumps. */
export class Laser {
  constructor(def) {
    this.def = def;
    this.tiles = [];
    for (let i = 0; i < def.len; i += 1) {
      this.tiles.push(def.dir === 'h' ? [def.tx + i, def.ty] : [def.tx, def.ty + i]);
    }
    this.on = false;
    this.cooldown = 0;
  }
}

export class World {
  constructor(levelIndex) {
    this.levelIndex = levelIndex;
    this.def = LEVELS[levelIndex];
    this.rng = mulberry32(1234 + levelIndex * 777);
    this.reset();
  }

  reset() {
    const def = this.def;
    this.grid = def.map.map((row) => row.split(''));
    this.time = 0;
    this.strikes = 0;
    this.spotted = 0;
    this.alarm = 0;
    this.lootGot = 0;
    this.lootTotal = 0;
    this.score = 0;
    this.prizeGot = false;
    this.exitOpen = false;
    this.complete = false;
    this.failed = false;
    this.rank = null;
    this.events = [];
    this.noises = [];
    this.coins = [];
    this.smokes = [];
    this.crickets = [];
    this.lamps = [];
    this.loots = [];
    this.guards = [];
    this.cameras = [];
    this.lasers = [];
    this.notes = null;
    let lootIndex = 0;
    for (let ty = 0; ty < ROWS; ty += 1) {
      for (let tx = 0; tx < COLS; tx += 1) {
        const ch = this.grid[ty][tx];
        const cx = tileCenter(tx);
        const cy = tileCenter(ty);
        if (ch === '@') { this.start = { x: cx, y: cy }; this.grid[ty][tx] = '.'; }
        else if (ch === 'L') { this.lamps.push({ tx, ty, x: cx, y: cy, lit: true, darkUntil: 0 }); }
        else if (ch === 'T') {
          const value = 100 + ((lootIndex * 37) % 300);
          lootIndex += 1;
          this.loots.push({ tx, ty, x: cx, y: cy, value, got: false });
          this.lootTotal += 1;
        } else if (ch === '*') { this.prize = { tx, ty, x: cx, y: cy, got: false }; }
        else if (ch === 'E') { this.exit = { tx, ty, x: cx, y: cy }; }
      }
    }
    this.player = {
      x: this.start.x, y: this.start.y, r: 13, gait: 'walk',
      angle: 0, moving: false, hidden: false, inWater: false,
    };
    this.gadgets = { coin: 3, smoke: 2, douse: 2, cricket: 1 };
    this.selected = 0;
    this.gadgetNames = ['coin', 'smoke', 'douse', 'cricket'];
    for (const g of def.guards) this.guards.push(new Guard(g, this.rng));
    for (const c of def.cameras) this.cameras.push(new Camera(c, this.rng));
    for (const l of def.lasers) this.lasers.push(new Laser(l));
    this.computeLight();
  }

  tileAt(tx, ty) {
    if (!inBounds(tx, ty)) return '#';
    return this.grid[ty][tx];
  }

  isSolidAt(tx, ty) {
    return SOLID.has(this.tileAt(tx, ty));
  }

  isSolidPx(x, y) {
    return this.isSolidAt(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /** Light level 0..1 at a pixel, from the precomputed lamp map. */
  lightAtPx(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (!inBounds(tx, ty)) return 0;
    return this.lightMap[ty * COLS + tx];
  }

  computeLight() {
    this.lightMap = new Float32Array(COLS * ROWS);
    for (const lamp of this.lamps) {
      if (!lamp.lit) continue;
      const r = Math.ceil(LAMP_RADIUS / TILE);
      for (let ty = lamp.ty - r; ty <= lamp.ty + r; ty += 1) {
        for (let tx = lamp.tx - r; tx <= lamp.tx + r; tx += 1) {
          if (!inBounds(tx, ty)) continue;
          const dx = tileCenter(tx) - lamp.x;
          const dy = tileCenter(ty) - lamp.y;
          const dist = Math.hypot(dx, dy);
          if (dist > LAMP_RADIUS) continue;
          if (!losClear(this.grid, lamp.x, lamp.y, tileCenter(tx), tileCenter(ty))) continue;
          const v = 1 - dist / LAMP_RADIUS;
          const i = ty * COLS + tx;
          if (v > this.lightMap[i]) this.lightMap[i] = v;
        }
      }
    }
  }

  /** Vision-cone polygon (for drawing): raycast fan from an eye. */
  conePolygon(x, y, angle, fov, range) {
    const pts = [{ x, y }];
    for (let i = 0; i <= CONE_RAYS; i += 1) {
      const a = angle - fov / 2 + (fov * i) / CONE_RAYS;
      const d = rayHit(this.grid, x, y, a, range);
      pts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d });
    }
    return pts;
  }

  /** How well `eye` (guard/camera) sees the player, 0..1. */
  visibility(eyeX, eyeY, eyeAngle, fov, range, isCamera) {
    const p = this.player;
    const dx = p.x - eyeX;
    const dy = p.y - eyeY;
    const dist = Math.hypot(dx, dy);
    if (dist > range) return 0;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(ang, eyeAngle)) > fov / 2) return 0;
    if (!losClear(this.grid, eyeX, eyeY, p.x, p.y)) return 0;
    if (this.smokeBetween(eyeX, eyeY, p.x, p.y)) return 0;
    const light = this.lightAtPx(p.x, p.y);
    const near = dist < CONE_NEAR;
    if (this.playerOnGrass() && dist > GRASS_HIDE_DIST && !near) return 0;
    let vis = 1 - ((dist - CONE_NEAR) / Math.max(1, range - CONE_NEAR)) * 0.5;
    if (!near) vis *= light >= LIT_THRESHOLD ? 1 : 0.45;
    vis *= GAITS[p.gait].vis;
    if (isCamera) vis *= 1.1;
    return Math.max(0, Math.min(1, vis));
  }

  playerOnGrass() {
    const tx = Math.floor(this.player.x / TILE);
    const ty = Math.floor(this.player.y / TILE);
    return this.tileAt(tx, ty) === ',';
  }

  smokeBetween(x0, y0, x1, y1) {
    for (const s of this.smokes) {
      if (this.time > s.until) continue;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((s.x - x0) * dx + (s.y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      if (Math.hypot(s.x - px, s.y - py) < s.r) return true;
    }
    return false;
  }

  nearestGuardDist() {
    let best = Infinity;
    for (const g of this.guards) best = Math.min(best, Math.hypot(g.x - this.player.x, g.y - this.player.y));
    return best;
  }
}

// ---- step / update (appended to World) ----

World.prototype.step = function step(dt, input) {
  if (this.complete || this.failed) return;
  this.time += dt;
  const p = this.player;
  const gait = GAITS[input.gait] || GAITS.walk;
  p.gait = input.gait || 'walk';

  // Move the thief, axis by axis so walls slide instead of sticking.
  const tx0 = Math.floor(p.x / TILE);
  const ty0 = Math.floor(p.y / TILE);
  p.inWater = this.tileAt(tx0, ty0) === '~';
  let speed = gait.speed * (p.inWater ? 0.6 : 1);
  const mx = input.moveX || 0;
  const my = input.moveY || 0;
  const len = Math.hypot(mx, my);
  p.moving = len > 0.05;
  if (p.moving) {
    const nx = mx / len;
    const ny = my / len;
    p.angle = Math.atan2(ny, nx);
    this.moveCircle(p, nx * speed * dt, 0);
    this.moveCircle(p, 0, ny * speed * dt);
  }

  // Footsteps are noise: guards inside the radius come to look.
  this.noiseTimer = (this.noiseTimer || 0) - dt;
  if (p.moving && gait.noise > 0 && this.noiseTimer <= 0) {
    this.noiseTimer = 0.5;
    this.makeNoise(p.x, p.y, gait.noise);
  }

  // Gadget use.
  if (input.action) this.useGadget(input.action);

  // Lamps snuffed by a douse relight after 20 seconds.
  for (const lamp of this.lamps) {
    if (!lamp.lit && this.time >= lamp.darkUntil) { lamp.lit = true; this.computeLight(); }
  }

  // Thrown coins arc, land, ring, and pull guards off their posts.
  for (const c of this.coins) {
    if (c.landed) continue;
    c.t += dt;
    if (c.t >= c.dur) {
      c.landed = true;
      c.landTime = this.time;
      this.makeNoise(c.x1, c.y1, 240);
      this.events.push({ type: 'coin-land', x: c.x1, y: c.y1, t: this.time });
    }
  }
  this.coins = this.coins.filter((c) => !c.landed || this.time - c.landTime < 6);
  this.crickets = this.crickets.filter((k) => this.time < k.until);
  for (const k of this.crickets) {
    k.tick -= dt;
    if (k.tick <= 0) { k.tick = 0.8; this.makeNoise(k.x, k.y, 200); }
  }
  this.smokes = this.smokes.filter((s) => this.time < s.until);
  this.noises = this.noises.filter((n) => this.time < n.until);

  // Hidden in the grass, in the dark, far from every guard.
  p.hidden = this.playerOnGrass() && this.nearestGuardDist() > GRASS_HIDE_DIST;

  for (const g of this.guards) this.updateGuard(g, dt);
  for (const c of this.cameras) this.updateCamera(c, dt);
  for (const l of this.lasers) this.updateLaser(l, dt);

  // Alarm rises while chased or watched, falls in the quiet.
  const chased = this.guards.some((g) => g.state === 'chase');
  const watched = this.cameras.some((c) => c.exposure > 0.5);
  if (chased) this.alarm += 0.25 * dt;
  else if (watched) this.alarm += 0.4 * dt;
  else this.alarm = Math.max(0, this.alarm - 0.1 * dt);
  if (this.alarm >= 1) this.strike('alarm');

  // Loot and the named prize, picked up by walking over them.
  for (const loot of this.loots) {
    if (!loot.got && Math.hypot(loot.x - p.x, loot.y - p.y) < 22) {
      loot.got = true;
      this.lootGot += 1;
      this.score += loot.value;
      this.events.push({ type: 'loot', x: loot.x, y: loot.y, value: loot.value, t: this.time });
    }
  }
  if (this.prize && !this.prize.got && Math.hypot(this.prize.x - p.x, this.prize.y - p.y) < 24) {
    this.prize.got = true;
    this.prizeGot = true;
    this.exitOpen = true;
    this.score += 1000 + this.levelIndex * 250;
    this.events.push({ type: 'prize', x: this.prize.x, y: this.prize.y, t: this.time });
  }
  if (this.exitOpen && Math.hypot(this.exit.x - p.x, this.exit.y - p.y) < 26) {
    this.complete = true;
    this.rank = rankHeist(this.time, this.def.par, this.spotted);
    this.events.push({ type: 'escape', x: this.exit.x, y: this.exit.y, t: this.time });
  }
};

World.prototype.moveCircle = function moveCircle(e, dx, dy) {
  const nx = e.x + dx;
  const ny = e.y + dy;
  const r = e.r || 13;
  const x0 = Math.floor((nx - r) / TILE);
  const x1 = Math.floor((nx + r) / TILE);
  const y0 = Math.floor((ny - r) / TILE);
  const y1 = Math.floor((ny + r) / TILE);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (!this.isSolidAt(tx, ty)) continue;
      const cx = Math.max(tx * TILE, Math.min(nx, tx * TILE + TILE));
      const cy = Math.max(ty * TILE, Math.min(ny, ty * TILE + TILE));
      if ((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) < r * r) return;
    }
  }
  e.x = nx;
  e.y = ny;
};

World.prototype.makeNoise = function makeNoise(x, y, radius) {
  this.noises.push({ x, y, radius, until: this.time + 1.2 });
  for (const g of this.guards) {
    if (g.state === 'chase') continue;
    const d = Math.hypot(g.x - x, g.y - y);
    if (d < radius) {
      g.lastSeen = { x, y };
      if (g.state === 'patrol' || g.state === 'return') { g.state = 'investigate'; g.suspicion = Math.max(g.suspicion, SUSPICION_INVESTIGATE); }
    }
  }
};

World.prototype.useGadget = function useGadget(action) {
  const p = this.player;
  const kind = action.type;
  if (!this.gadgets[kind] || this.gadgets[kind] <= 0) return;
  if (kind === 'coin') {
    const tx = Math.max(0, Math.min(COLS * TILE - 1, action.x));
    const ty = Math.max(0, Math.min(ROWS * TILE - 1, action.y));
    const dist = Math.hypot(tx - p.x, ty - p.y);
    if (dist > 330) return;
    this.gadgets.coin -= 1;
    this.coins.push({ x0: p.x, y0: p.y, x1: tx, y1: ty, t: 0, dur: 0.45, landed: false });
    this.events.push({ type: 'coin-throw', x: tx, y: ty, t: this.time });
  } else if (kind === 'smoke') {
    this.gadgets.smoke -= 1;
    this.smokes.push({ x: p.x, y: p.y, r: 90, until: this.time + 4 });
    this.events.push({ type: 'smoke', x: p.x, y: p.y, t: this.time });
  } else if (kind === 'douse') {
    let best = null;
    let bestD = 200;
    for (const lamp of this.lamps) {
      if (!lamp.lit) continue;
      const d = Math.hypot(lamp.x - p.x, lamp.y - p.y);
      if (d < bestD) { bestD = d; best = lamp; }
    }
    if (!best) return;
    this.gadgets.douse -= 1;
    best.lit = false;
    best.darkUntil = this.time + 20;
    this.computeLight();
    this.events.push({ type: 'douse', x: best.x, y: best.y, t: this.time });
  } else if (kind === 'cricket') {
    this.gadgets.cricket -= 1;
    this.crickets.push({ x: p.x, y: p.y, until: this.time + 10, tick: 0 });
    this.events.push({ type: 'cricket', x: p.x, y: p.y, t: this.time });
  }
};

World.prototype.updateGuard = function updateGuard(g, dt) {
  const p = this.player;
  const vis = this.visibility(g.x, g.y, g.angle, CONE_FOV, CONE_RANGE, false);
  if (vis > 0.05) {
    g.grace += dt;
    if (g.grace >= SUSPICION_GRACE) {
      g.suspicion = Math.min(1, g.suspicion + vis * SUSPICION_FILL * dt);
      g.lastSeen = { x: p.x, y: p.y };
      g.loseSight = 0;
    }
  } else {
    g.grace = 0;
    g.suspicion = Math.max(0, g.suspicion - SUSPICION_DECAY * dt);
    g.loseSight += dt;
  }
  if (g.suspicion >= 1 && !g.spottedFlag) {
    g.spottedFlag = true;
    this.spotted += 1;
    this.events.push({ type: 'spotted', x: p.x, y: p.y, t: this.time });
  }
  if (g.suspicion < 0.9) g.spottedFlag = false;

  const distP = Math.hypot(p.x - g.x, p.y - g.y);
  if (g.state === 'chase' && distP < 26) { this.strike('caught'); return; }

  if (g.suspicion >= 1) g.state = 'chase';
  else if (g.state === 'chase' && g.loseSight > 2) { g.state = 'investigate'; }
  else if (g.state === 'patrol' && g.suspicion >= SUSPICION_INVESTIGATE) g.state = 'suspicious';
  else if (g.state === 'suspicious' && g.suspicion < SUSPICION_INVESTIGATE) g.state = 'patrol';

  if (g.state === 'patrol') {
    const wp = g.waypoints[g.wp];
    const wx = tileCenter(wp[0]);
    const wy = tileCenter(wp[1]);
    if (g.pause > 0) {
      g.pause -= dt;
      g.scanPhase += dt * 1.4;
      g.angle += Math.sin(g.scanPhase) * 0.02;
    } else if (this.moveToward(g, wx, wy, 55, dt)) {
      g.wp = (g.wp + 1) % g.waypoints.length;
      g.pause = 1.2 + this.rng() * 1.4;
    }
  } else if (g.state === 'suspicious') {
    g.angle = Math.atan2(p.y - g.y, p.x - g.x);
    g.stareTime = (g.stareTime || 0) + dt;
    if (g.stareTime > 1) { g.state = 'investigate'; g.stareTime = 0; }
  } else if (g.state === 'investigate') {
    if (this.moveToward(g, g.lastSeen.x, g.lastSeen.y, 78, dt)) {
      g.state = 'search';
      g.searchTime = 5;
    }
  } else if (g.state === 'search') {
    g.searchTime -= dt;
    g.angle += dt * 1.8;
    if (g.searchTime <= 0 || g.suspicion < 0.3) g.state = 'return';
  } else if (g.state === 'return') {
    let best = 0;
    let bestD = Infinity;
    g.waypoints.forEach((wp, i) => {
      const d = Math.hypot(tileCenter(wp[0]) - g.x, tileCenter(wp[1]) - g.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    const wp = g.waypoints[best];
    if (this.moveToward(g, tileCenter(wp[0]), tileCenter(wp[1]), 70, dt)) {
      g.wp = (best + 1) % g.waypoints.length;
      g.state = 'patrol';
      g.pause = 1;
    }
  } else if (g.state === 'chase') {
    this.moveToward(g, p.x, p.y, 138, dt);
  }
};

World.prototype.moveToward = function moveToward(e, tx, ty, speed, dt) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 6) return true;
  const step = Math.min(dist, speed * dt);
  const nx = dx / dist;
  const ny = dy / dist;
  e.angle = Math.atan2(ny, nx);
  this.moveCircle(e, nx * step, 0);
  this.moveCircle(e, 0, ny * step);
  return false;
};

World.prototype.updateCamera = function updateCamera(c, dt) {
  c.angle = c.baseAngle + Math.sin(this.time * c.speed + c.phase) * c.sweep;
  const vis = this.visibility(c.x, c.y, c.angle, CAMERA_HALF * 2, CAMERA_RANGE, true);
  if (vis > 0.05) c.exposure = Math.min(1, c.exposure + vis * 0.9 * dt);
  else c.exposure = Math.max(0, c.exposure - 0.25 * dt);
  if (c.exposure >= 1 && !c.tripped) {
    c.tripped = true;
    this.spotted += 1;
    this.events.push({ type: 'camera', x: this.player.x, y: this.player.y, t: this.time });
    this.strike('camera');
  }
  if (c.exposure < 0.5) c.tripped = false;
};

World.prototype.updateLaser = function updateLaser(l, dt) {
  const def = l.def;
  l.on = ((this.time + def.phase) % def.period) < def.onTime;
  l.cooldown = Math.max(0, l.cooldown - dt);
  if (!l.on || l.cooldown > 0) return;
  const p = this.player;
  for (const [tx, ty] of l.tiles) {
    const cx = tileCenter(tx);
    const cy = tileCenter(ty);
    let hit = false;
    if (def.dir === 'h') hit = Math.abs(p.y - cy) < 14 && p.x > cx - TILE / 2 && p.x < cx + TILE / 2;
    else hit = Math.abs(p.x - cx) < 14 && p.y > cy - TILE / 2 && p.y < cy + TILE / 2;
    if (hit) {
      l.cooldown = 2;
      this.alarm = Math.min(1, this.alarm + 0.5);
      for (const g of this.guards) {
        g.lastSeen = { x: p.x, y: p.y };
        if (g.state === 'patrol' || g.state === 'return') g.state = 'investigate';
      }
      this.events.push({ type: 'laser', x: p.x, y: p.y, t: this.time });
      return;
    }
  }
};

World.prototype.strike = function strike(cause) {
  if (this.complete || this.failed) return;
  this.strikes += 1;
  this.alarm = 0;
  this.events.push({ type: 'strike', cause, strikes: this.strikes, t: this.time });
  if (this.strikes >= MAX_STRIKES) {
    this.failed = true;
    return;
  }
  const p = this.player;
  p.x = this.start.x;
  p.y = this.start.y;
  for (const g of this.guards) {
    g.x = tileCenter(g.waypoints[0][0]);
    g.y = tileCenter(g.waypoints[0][1]);
    g.wp = 1 % g.waypoints.length;
    g.state = 'patrol';
    g.suspicion = 0;
    g.pause = 1;
  }
  for (const c of this.cameras) c.exposure = 0;
  this.smokes = [];
  this.coins = [];
};
