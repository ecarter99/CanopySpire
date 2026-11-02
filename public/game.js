import * as THREE from './vendor/three.module.js';
const V3 = THREE.Vector3;

// =====================================================================
// CONFIG
// =====================================================================
const CFG = {
  GRAVITY: 30, WALK: 6, RUN: 10.5, JUMP: 11,
  CLIMB_SPEED: 3.2, CLIMB_DASH: 9,
  GLIDE_FALL: 2.6, GLIDE_SPEED: 9.5,
  STAMINA_MAX: 100, CLIMB_COST: 15, GLIDE_COST: 8, REGEN_DELAY: 1.5, REGEN_RATE: 80,
  THERMAL_LIFT: 34, THERMAL_MAX_VY: 11,
  GRAPPLE_RANGE: 48, GRAPPLE_SPEED: 30,
  NET_HZ: 20, NET_EPS: 0.05,
  HX: 0.35, H: 1.8, STEP: 0.55,
  PICKUP_RESPAWN: 45, CALIBRATIONS: 3,
  PEER_PREFIX: 'canopyspire-proto-v1-', MAX_PLAYERS: 4,
  INTERACT_RANGE: 3.6,
};
const RES = ['energy', 'bio', 'scrap'];
const RES_ICON = { energy: '⚡', bio: '🌱', scrap: '⚙️' };
const RES_NAME = { energy: 'Energy Cells', bio: 'Bio-Materials', scrap: 'Mechanical Scrap' };
const TYPE_COLOR = { WATER: 0x4fc3f7, POWER: 0xffd54f, BRIDGE: 0xff9f43 };
const TYPE_ICON = { WATER: '💧', POWER: '☀️', BRIDGE: '🌉' };
const TIER_NAMES = ['Basal Spires', 'Canopy Mid-Level', 'Apex Crown'];
const TIER_SUB = ['Lower Deck', 'Gardens & Sky-Bridges', 'Wind & Cloud Decks'];
const PLAYER_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b'];

const NODE_DEFS = [
  { id: 'basal_aqueduct', name: 'Basal Aqueduct Pump', type: 'WATER', tier: 0, pos: [6, 0, 44], req: { scrap: 4, bio: 2 },
    desc: 'The dry channel once carried water from the canopy to the lower deck.' },
  { id: 'basal_conduit', name: 'Geothermal Conduit', type: 'POWER', tier: 0, pos: [-44, 0, 28], req: { energy: 3, scrap: 3 },
    desc: 'Re-powers the vent to the west — a thermal updraft will rise to the canopy.' },
  { id: 'canopy_hydro', name: 'Hydroponic Bay', type: 'WATER', tier: 1, pos: [-18, 36, -18], req: { bio: 5, energy: 2 },
    desc: 'Irrigation for the canopy gardens. Its overflow feeds a northern cascade.' },
  { id: 'canopy_bridge', name: 'East Sky-Bridge', type: 'BRIDGE', tier: 1, pos: [26, 36, -5], req: { scrap: 6, energy: 2 },
    desc: 'Rebuild the span to the eastern solar tower terrace.' },
  { id: 'canopy_solar', name: 'Solar Cladding Array', type: 'POWER', tier: 1, pos: [45, 36, 3], req: { energy: 4, scrap: 3 },
    desc: 'Powers the tower vents — a tall thermal will reach the Apex Crown.' },
  { id: 'apex_turbines', name: 'Crown Wind Turbines', type: 'POWER', tier: 2, pos: [0, 78, -9], req: { energy: 5, scrap: 4 },
    desc: 'Spinning them up re-lights the sky-line anchor rings for everyone.' },
  { id: 'apex_cloudgarden', name: 'Cloud-Deck Cascade', type: 'WATER', tier: 2, pos: [0, 78, 9], req: { bio: 5, energy: 3, scrap: 2 },
    desc: 'The crown jewel: a cascade from the clouds down through every tier.' },
];
const NODE_DEF = Object.fromEntries(NODE_DEFS.map(d => [d.id, d]));

// =====================================================================
// UTILS
// =====================================================================
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; }
function approach(c, t, m) { return c < t ? Math.min(t, c + m) : Math.max(t, c - m); }
function approachXZ(v, tx, tz, maxD) { const dx = tx - v.x, dz = tz - v.z, l = Math.hypot(dx, dz); if (l <= maxD || l < 1e-6) { v.x = tx; v.z = tz; } else { v.x += dx / l * maxD; v.z += dz / l * maxD; } }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexStr = n => '#' + n.toString(16).padStart(6, '0');

// ---- Network input sanitizers: every value from another peer passes through these before use ----
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
const STATES = new Set(['IDLE', 'WALK', 'RUN', 'CLIMB', 'GLIDE', 'FALL', 'GRAPPLE']);
const safeColor = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : '#cccccc';
const safeName = n => String(n ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 16) || 'Wanderer';
const safeText = t => String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 160);
const safeNum = (v, lo, hi, d = lo) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const safeInt = (v, lo, hi) => Math.round(safeNum(v, lo, hi));
const safeState = s => STATES.has(s) ? s : 'IDLE';
const safeVec = p => Array.isArray(p) && p.length === 3 ? p.map(v => safeNum(v, -5000, 5000, 0)) : null;
const safeId = id => (typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[\w-]+$/.test(id)) ? id : null;
const isNodeId = id => typeof id === 'string' && Object.hasOwn(NODE_DEF, id);
const safeRes = (r, max = 99) => { const o = {}; if (r && typeof r === 'object') for (const k of RES) { const v = safeInt(r[k], 0, max); if (v) o[k] = v; } return o; };
const isMsg = m => m !== null && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string';

// =====================================================================
// MATERIALS (cel-shaded toon + per-tier "dull → vibrant" colour shift)
// =====================================================================
const GRAD = (() => { const d = new Uint8Array([95, 95, 95, 255, 180, 180, 180, 255, 255, 255, 255, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const matCache = new Map();
function toon(hex, opts = {}) {
  const key = 'v' + hex + JSON.stringify(opts);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const o = { ...opts }; delete o.unique;
  const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: GRAD, ...o });
  if (!opts.unique) matCache.set(key, m);
  return m;
}
const tierMats = [[], [], []];
function tmat(tier, hex) {
  const key = 't' + tier + ':' + hex;
  if (matCache.has(key)) return matCache.get(key);
  const vib = new THREE.Color(hex); const hsl = {}; vib.getHSL(hsl, THREE.SRGBColorSpace);
  const dull = new THREE.Color().setHSL(hsl.h, hsl.s * 0.16, hsl.l * 0.72 + 0.1, THREE.SRGBColorSpace);
  const m = new THREE.MeshToonMaterial({ color: dull.clone(), gradientMap: GRAD });
  m.userData.vib = vib; m.userData.dull = dull;
  tierMats[tier].push(m); matCache.set(key, m);
  return m;
}
const PAL = {
  grass: 0x8ed65a, grassDeep: 0x5fb84a, stone: 0xf3ead6, sand: 0xe9d3a6, terra: 0xe07a4f, teal: 0x3cc9b5,
  wood: 0xa8743f, leaf: 0x4caf50, leaf2: 0x8bd34a, leaf3: 0x2e9e5b, blossom: 0xff8fb1, flower: 0xffd54f,
  brass: 0xd9a441, glass: 0x7fd8e0, slate: 0x7a8a99, soil: 0x7b5233,
};
const BOX = new THREE.BoxGeometry(1, 1, 1);
const facet = g => { g.computeVertexNormals(); return g; }; // non-indexed polyhedra → flat facet normals
const ICO = facet(new THREE.IcosahedronGeometry(1, 0));

function waterTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#4fc3f7'; g.fillRect(0, 0, 64, 256);
  const r = mulberry32(7);
  for (let i = 0; i < 90; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(180,240,255,0.7)'; g.fillRect(r() * 64, r() * 256, 1 + r() * 3, 10 + r() * 50); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const WATER_TEX = waterTexture();

// =====================================================================
// PHYSICS — custom AABB world (axis-aligned, self-contained)
// =====================================================================
class Physics {
  constructor() { this.boxes = []; }
  add(x0, y0, z0, x1, y1, z1, tag) {
    const min = new V3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new V3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const b = { min, max, enabled: true, tag, box3: new THREE.Box3(min, max) };
    this.boxes.push(b); return b;
  }
  ov(p, b) {
    const { HX, H } = CFG;
    return p.x + HX > b.min.x && p.x - HX < b.max.x && p.y + H > b.min.y && p.y < b.max.y && p.z + HX > b.min.z && p.z - HX < b.max.z;
  }
  overlapAt(p) { for (const b of this.boxes) if (b.enabled && this.ov(p, b)) return b; return null; }
  overlapAll(p) { const r = []; for (const b of this.boxes) if (b.enabled && this.ov(p, b)) r.push(b); return r; }
  pointInside(p) { for (const b of this.boxes) if (b.enabled && p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return true; return false; }
  surfaceY(x, z, maxY) {
    let top = null;
    for (const b of this.boxes) if (b.enabled && x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y <= maxY && (top === null || b.max.y > top)) top = b.max.y;
    return top;
  }
  move(p, d, stepUp) {
    const res = { ground: false, ceil: false, hitX: false, hitZ: false };
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)) / 0.25));
    const sx = d.x / n, sy = d.y / n, sz = d.z / n;
    for (let i = 0; i < n; i++) {
      if (sx) { p.x += sx; this.resolveH(p, 'x', sx, res, stepUp); }
      if (sz) { p.z += sz; this.resolveH(p, 'z', sz, res, stepUp); }
      if (sy) { p.y += sy; this.resolveV(p, sy, res); }
    }
    if (d.y <= 0 && !res.ground) { p.y -= 0.03; if (this.overlapAt(p)) res.ground = true; p.y += 0.03; } // resting-contact probe
    return res;
  }
  resolveH(p, ax, s, res, stepUp) {
    for (const b of this.boxes) {
      if (!b.enabled || !this.ov(p, b)) continue;
      const rise = b.max.y - p.y;
      if (stepUp && rise > 0 && rise <= CFG.STEP) { const oy = p.y; p.y = b.max.y + 0.001; if (!this.overlapAt(p)) continue; p.y = oy; }
      p[ax] = s > 0 ? b.min[ax] - CFG.HX - 0.001 : b.max[ax] + CFG.HX + 0.001;
      if (ax === 'x') res.hitX = true; else res.hitZ = true;
    }
  }
  resolveV(p, s, res) {
    for (const b of this.boxes) {
      if (!b.enabled || !this.ov(p, b)) continue;
      if (s < 0) { p.y = b.max.y; res.ground = true; } else { p.y = b.min.y - CFG.H - 0.001; res.ceil = true; }
    }
  }
}

// =====================================================================
// CHARACTER MODEL (low-poly, procedural animation)
// =====================================================================
function makeCharacter(color) {
  const g = new THREE.Group();
  const col = new THREE.Color(color).getHex();
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  add(new THREE.CylinderGeometry(0.3, 0.38, 0.85, 8), toon(col), 0, 0.98, 0);
  add(new THREE.SphereGeometry(0.27, 10, 8), toon(0xffd9b3), 0, 1.6, 0);
  add(new THREE.CylinderGeometry(0.08, 0.45, 0.22, 10), toon(0xe8c872), 0, 1.86, 0);
  add(new THREE.BoxGeometry(0.62, 0.12, 0.42), toon(0xffffff), 0, 1.38, 0); // scarf
  add(new THREE.BoxGeometry(0.42, 0.5, 0.24), toon(0x8d6e63), 0, 1.05, -0.32); // pack
  add(new THREE.SphereGeometry(0.06, 6, 4), toon(0x222222), 0.1, 1.64, 0.24);
  add(new THREE.SphereGeometry(0.06, 6, 4), toon(0x222222), -0.1, 1.64, 0.24);
  const limb = (x, y, w, h, c) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); g.add(pv); const m = add(new THREE.BoxGeometry(w, h, w), toon(c), 0, -h / 2, 0, pv); return pv; };
  const legs = [limb(0.15, 0.58, 0.17, 0.58, 0x455a64), limb(-0.15, 0.58, 0.17, 0.58, 0x455a64)];
  const arms = [limb(0.42, 1.32, 0.13, 0.52, col), limb(-0.42, 1.32, 0.13, 0.52, col)];
  const glider = new THREE.Group(); glider.position.set(0, 2.15, 0.05); g.add(glider);
  const wingShape = new THREE.Shape(); wingShape.moveTo(-1.5, -0.2); wingShape.lineTo(0, 0.55); wingShape.lineTo(1.5, -0.2); wingShape.lineTo(0, -0.05); wingShape.lineTo(-1.5, -0.2);
  const wing = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), toon(0xff7043, { side: THREE.DoubleSide }));
  wing.rotation.x = -Math.PI / 2; wing.castShadow = true; glider.add(wing);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.62), toon(0xfff3e0)); stripe.position.set(0, 0.01, 0.2); glider.add(stripe);
  glider.visible = false;
  return { group: g, legs, arms, glider, t: Math.random() * 10 };
}
function animateCharacter(c, state, dt) {
  c.t += dt;
  const t = c.t; let lL = 0, lR = 0, aL = 0, aR = 0, aLz = 0.08, aRz = -0.08;
  if (state === 'WALK' || state === 'RUN') { const sw = state === 'RUN' ? 0.95 : 0.6, f = state === 'RUN' ? 13 : 9; const s = Math.sin(t * f) * sw; lL = s; lR = -s; aL = -s * 0.8; aR = s * 0.8; }
  else if (state === 'CLIMB') { const s = Math.sin(t * 8) * 0.45; aL = -2.6 + s; aR = -2.6 - s; lL = -0.5 - s; lR = -0.5 + s; }
  else if (state === 'GLIDE') { aL = aR = -2.95; aLz = 0.25; aRz = -0.25; lL = 0.35; lR = 0.25; }
  else if (state === 'FALL') { aL = aR = -1.1; aLz = 0.9; aRz = -0.9; lL = -0.35; lR = 0.3; }
  else if (state === 'GRAPPLE') { aR = -2.9; aL = -0.4; lL = 0.45; lR = -0.25; }
  else { aL = Math.sin(t * 2) * 0.05; aR = -aL; }
  const k = Math.min(1, dt * 16);
  c.legs[0].rotation.x = lerp(c.legs[0].rotation.x, lL, k); c.legs[1].rotation.x = lerp(c.legs[1].rotation.x, lR, k);
  c.arms[0].rotation.x = lerp(c.arms[0].rotation.x, aL, k); c.arms[1].rotation.x = lerp(c.arms[1].rotation.x, aR, k);
  c.arms[0].rotation.z = lerp(c.arms[0].rotation.z, aLz, k); c.arms[1].rotation.z = lerp(c.arms[1].rotation.z, aRz, k);
  c.glider.visible = state === 'GLIDE';
  if (c.glider.visible) c.glider.rotation.z = Math.sin(t * 2.2) * 0.06;
}

// =====================================================================
// WORLD MANAGER — procedural low-poly vertical city
// =====================================================================
class World {
  constructor(scene, phys) {
    this.scene = scene; this.phys = phys; this.rng = mulberry32(1337);
    this.nodes = new Map(); this.thermals = {}; this.anchors = []; this.pickups = []; this.waterfalls = {};
    this.tweens = []; this.bursts = []; this.updaters = [];
    this.vib = [0.12, 0.12, 0.12]; this.vibTarget = [0.12, 0.12, 0.12]; this.vibDirty = true;
    this.plants = [[], [], []]; this.blooms = [[], [], []];
    this.time = 0; this.scanning = false; this.turbineSpeed = 0.15; this.turbineTarget = 0.15; this.rotors = [];
    this.onAllRestored = null;
  }
  // ---- primitives -------------------------------------------------
  block(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const m = new THREE.Mesh(BOX, mat);
    m.scale.set(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = o.cast !== false; m.receiveShadow = true;
    (o.parent || this.scene).add(m);
    const col = o.collide === false ? null : this.phys.add(x0, y0, z0, x1, y1, z1, o.tag);
    return { mesh: m, col };
  }
  tree(x, y, z, tier, s = 1, collide = true) {
    const r = this.rng, g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = r() * 6.28;
    const th = 2.2 * s;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.28 * s, th, 6), tmat(tier, PAL.wood)); trunk.position.y = th / 2; trunk.castShadow = true; g.add(trunk);
    const leafCols = [PAL.leaf, PAL.leaf2, PAL.leaf3];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(ICO, tmat(tier, leafCols[(i + Math.floor(r() * 3)) % 3]));
      const sc = (1.5 - i * 0.33) * s * (0.85 + r() * 0.3); l.scale.set(sc, sc * 0.85, sc);
      l.position.set((r() - 0.5) * 0.6 * s, th + i * 0.75 * s, (r() - 0.5) * 0.6 * s); l.castShadow = true; g.add(l);
    }
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(ICO, toon(r() < 0.5 ? PAL.blossom : PAL.flower));
      const a = r() * 6.28; b.position.set(Math.cos(a) * 1.2 * s, th + r() * 1.2 * s, Math.sin(a) * 1.2 * s);
      b.userData.s = 0.2 * s; b.scale.setScalar(0.001); g.add(b); this.blooms[tier].push(b);
    }
    this.scene.add(g); this.plants[tier].push(g);
    if (collide) this.phys.add(x - 0.25 * s, y, z - 0.25 * s, x + 0.25 * s, y + th, z + 0.25 * s, 'tree');
    return g;
  }
  bush(x, y, z, tier, s = 1) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const l = new THREE.Mesh(ICO, tmat(tier, this.rng() < 0.5 ? PAL.leaf2 : PAL.leaf)); l.scale.set(0.7 * s, 0.55 * s, 0.7 * s); l.position.y = 0.35 * s; l.castShadow = true; g.add(l);
    const b = new THREE.Mesh(ICO, toon(this.rng() < 0.5 ? PAL.blossom : PAL.flower)); b.position.set(0.2 * s, 0.75 * s, 0.1 * s); b.userData.s = 0.18 * s; b.scale.setScalar(0.001); g.add(b);
    this.blooms[tier].push(b); this.plants[tier].push(g); this.scene.add(g); return g;
  }
  flowerPatch(x, y, z, tier, n = 6) {
    for (let i = 0; i < n; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 5), toon([PAL.blossom, PAL.flower, 0xffffff, 0xb39ddb][i % 4]));
      f.position.set(x + (this.rng() - 0.5) * 3, y + 0.2, z + (this.rng() - 0.5) * 3); f.rotation.x = Math.PI;
      f.userData.s = 1; f.scale.setScalar(0.001); this.scene.add(f); this.blooms[tier].push(f);
    }
  }
  house(x, z, w, d, h, y0 = 0, tier = 0) {
    const r = this.rng, wall = [PAL.stone, PAL.sand, 0xf6e7c8][Math.floor(r() * 3)], trim = r() < 0.5 ? PAL.terra : PAL.teal;
    this.block(x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, tmat(tier, wall));
    this.block(x - w / 2 - 0.3, y0 + h, z - d / 2 - 0.3, x + w / 2 + 0.3, y0 + h + 0.4, z + d / 2 + 0.3, tmat(tier, trim));
    const gm = tmat(tier, PAL.glass);
    for (let i = 0; i < Math.floor(w / 3); i++) {
      const wx = x - w / 2 + 1.5 + i * 3;
      for (let fl = 0; fl < Math.floor(h / 3.2); fl++) {
        const wy = y0 + 1.6 + fl * 3.2;
        this.block(wx - 0.5, wy, z + d / 2, wx + 0.5, wy + 1.2, z + d / 2 + 0.08, gm, { collide: false, cast: false });
        this.block(wx - 0.5, wy, z - d / 2 - 0.08, wx + 0.5, wy + 1.2, z - d / 2, gm, { collide: false, cast: false });
      }
    }
    this.block(x - 0.7, y0, z + d / 2, x + 0.7, y0 + 2.2, z + d / 2 + 0.1, tmat(tier, PAL.wood), { collide: false, cast: false });
    this.block(x - w / 4 - 0.8, y0 + h + 0.4, z - 0.8, x - w / 4 + 0.8, y0 + h + 0.9, z + 0.8, tmat(tier, PAL.soil));
    this.bush(x - w / 4, y0 + h + 0.9, z, tier, 1.1);
    if (r() < 0.6) this.tree(x + w / 4, y0 + h + 0.4, z, tier, 0.6, false);
  }
  vines(x, z, y0, y1, nx, nz, tier, w = 2) {
    // hanging vine strips on a wall face (visual only)
    const m = tmat(tier, PAL.leaf3), n = Math.max(2, Math.floor(w / 0.7));
    for (let i = 0; i < n; i++) {
      const len = (y1 - y0) * (0.4 + this.rng() * 0.6);
      const off = (i / (n - 1) - 0.5) * w;
      const px = x + (nz !== 0 ? off : 0) + nx * 0.06, pz = z + (nx !== 0 ? off : 0) + nz * 0.06;
      const sx = nx !== 0 ? 0.1 : 0.3, sz = nz !== 0 ? 0.1 : 0.3;
      this.block(px - sx / 2, y1 - len, pz - sz / 2, px + sx / 2, y1, pz + sz / 2, m, { collide: false, cast: false });
    }
  }
  waterPlane(x0, y, z0, x1, z1, tier) {
    const tex = WATER_TEX.clone(); tex.repeat.set((x1 - x0) / 6, (z1 - z0) / 6); tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.visible = false; this.scene.add(m);
    this.updaters.push(dt => { tex.offset.y += dt * 0.15; tex.offset.x += dt * 0.05; });
    return m;
  }
  waterfall(key, x, yTop, yBot, z, width, rotY) {
    const h = yTop - yBot, g = new THREE.Group(); g.position.set(x, yTop, z); g.rotation.y = rotY;
    const tex = WATER_TEX.clone(); tex.repeat.set(width / 4, h / 14); tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(width, h, 1, 1); geo.translate(0, -h / 2, 0.15);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
    const sheet = new THREE.Mesh(geo, mat); g.add(sheet);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.55, width * 0.75, 0.6, 9), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    foam.position.set(0, -h, 1); g.add(foam);
    g.visible = false; g.scale.y = 0.001; this.scene.add(g);
    this.updaters.push(dt => { tex.offset.y += dt * 1.4; foam.scale.setScalar(1 + Math.sin(this.time * 6 + x) * 0.08); });
    this.waterfalls[key] = g; return g;
  }
  thermal(key, x, z, radius, yMin, yMax) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const N = 170, pos = new Float32Array(N * 3), meta = [];
    for (let i = 0; i < N; i++) { const a = this.rng() * 6.28, r = Math.sqrt(this.rng()) * radius; meta.push({ a, r, y: yMin + this.rng() * (yMax - yMin), sp: 4 + this.rng() * 6 }); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff3d6, size: 0.45, transparent: true, opacity: 0.75, depthWrite: false })); g.add(pts);
    const rings = [];
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.8, 0.07, 4, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      ring.rotation.x = Math.PI / 2; ring.userData.y = yMin + (i / 5) * (yMax - yMin); g.add(ring); rings.push(ring);
    }
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius * 0.7, 0.4, 8), toon(0x6b5b4b));
    const ventGlow = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.45, 8), toon(0xff8a50, { emissive: 0xff5722, emissiveIntensity: 0, unique: true }));
    vent.position.y = yMin + 0.2; ventGlow.position.y = yMin + 0.22; this.scene.add(vent); this.scene.add(ventGlow); vent.position.x = ventGlow.position.x = x; vent.position.z = ventGlow.position.z = z;
    const dormant = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, yMax - yMin, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffcc80, wireframe: true, transparent: true, opacity: 0.25 }));
    dormant.position.y = (yMin + yMax) / 2; g.add(dormant);
    pts.visible = false; rings.forEach(r => r.visible = false);
    this.scene.add(g);
    const th = { key, x, z, radius, yMin, yMax, active: false, group: g, pts, rings, dormant, ventGlow };
    this.updaters.push(dt => {
      dormant.visible = this.scanning && !th.active;
      if (!th.active) return;
      for (let i = 0; i < N; i++) { const m = meta[i]; m.y += m.sp * dt; m.a += dt * 0.8; if (m.y > yMax) m.y = yMin; pos[i * 3] = Math.cos(m.a) * m.r; pos[i * 3 + 1] = m.y; pos[i * 3 + 2] = Math.sin(m.a) * m.r; }
      geo.attributes.position.needsUpdate = true;
      for (const r of rings) { r.userData.y += dt * 7; if (r.userData.y > yMax) r.userData.y = yMin; r.position.y = r.userData.y; r.material.opacity = 0.35 * (1 - (r.userData.y - yMin) / (yMax - yMin)); }
    });
    this.thermals[key] = th; return th;
  }
  anchor(id, x, y, z, exit, group = 'base') {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.16, 6, 16), toon(0xffb300, { emissive: 0xff8f00, emissiveIntensity: 0.3, unique: true }));
    g.add(ring);
    const buoy = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), toon(0x4dd0e1)); buoy.position.y = 1.3; g.add(buoy);
    const leafs = new THREE.Mesh(ICO, toon(PAL.leaf2)); leafs.scale.set(0.5, 0.25, 0.5); leafs.position.y = 1.75; g.add(leafs);
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 5, 4), toon(PAL.leaf3)); vine.position.y = -3.4; g.add(vine);
    this.scene.add(g);
    const a = { id, pos: new V3(x, y, z), exit: new V3(...exit), group, active: group === 'base', mesh: g, ring };
    g.visible = a.active; this.anchors.push(a); return a;
  }
  pickup(type, x, y, z) {
    const geo = type === 'energy' ? PICK_GEO.energy : type === 'bio' ? PICK_GEO.bio : PICK_GEO.scrap;
    const m = new THREE.Mesh(geo, PICK_MAT[type]); m.position.set(x, y, z); m.castShadow = true; this.scene.add(m);
    const p = { id: this.pickups.length, type, pos: new V3(x, y, z), mesh: m, available: true, pending: false, phase: this.rng() * 6.28 };
    this.pickups.push(p); return p;
  }

  // ---- build ---------------------------------------------------------
  build() {
    const r = this.rng, S = this.scene;
    // Sea & island
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), toon(0x3fa9d6)); sea.rotation.x = -Math.PI / 2; sea.position.y = -4; sea.receiveShadow = true; S.add(sea);
    this.block(-110, -9, -110, 110, 0, 110, tmat(0, PAL.grass), { cast: false });
    this.block(-112, -9, -112, 112, -1.5, 112, tmat(0, PAL.sand), { collide: false, cast: false });
    // paving paths
    const pave = tmat(0, PAL.stone);
    this.block(-2, 0, 12, 2, 0.05, 108, pave, { collide: false, cast: false });
    this.block(-108, 0, -2, -12, 0.05, 2, pave, { collide: false, cast: false });
    this.block(12, 0, -2, 108, 0.05, 2, pave, { collide: false, cast: false });

    // ===== TIER 0 — Basal Spires =====
    const t0 = tmat(0, PAL.stone), t0b = tmat(0, PAL.sand);
    this.block(-12, 0, -12, 12, 34, 12, t0b);                     // spire core (under deck)
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {  // deck support columns
      this.block(sx * 24 - 1.5, 0, sz * 24 - 1.5, sx * 24 + 1.5, 34, sz * 24 + 1.5, t0);
      this.vines(sx * 24 + sx * 1.5, sz * 24, 18, 34, sx, 0, 0, 2.5);
    }
    for (const f of [[0, 12.01, 0, 1], [0, -12.01, 0, -1], [12.01, 0, 1, 0], [-12.01, 0, -1, 0]]) {
      // arch doors & vines on core faces
      const [fx, fz, nx, nz] = f;
      if (nz) this.block(-3, 0, fz, 3, 7, fz + nz * 0.15, tmat(0, PAL.teal), { collide: false, cast: false });
      else this.block(fx, 0, -3, fx + nx * 0.15, 7, 3, tmat(0, PAL.teal), { collide: false, cast: false });
      this.vines(fx, fz, 14, 34, nx, nz, 0, 18);
    }
    // Aqueduct channel (dry until restored)
    const chW = tmat(0, PAL.stone);
    this.block(-3.2, 0, 12, -2.6, 0.5, 100, chW); this.block(2.6, 0, 12, 3.2, 0.5, 100, chW);
    this.block(-2.6, 0, 12, 2.6, 0.04, 100, tmat(0, 0xc9a77a), { collide: false, cast: false });
    this.channelWater = this.waterPlane(-2.6, 0.35, 12, 2.6, 100, 0);
    // Geothermal conduit lines
    this.conduitMat = toon(0x8a6d4b, { emissive: 0xffa000, emissiveIntensity: 0, unique: true });
    this.block(-44, 0, 27.6, -6, 0.35, 28.4, this.conduitMat, { collide: false });
    this.block(-6.4, 0, 12, -5.6, 0.35, 28.4, this.conduitMat, { collide: false });
    this.block(-48.4, 0, 8, -47.6, 0.35, 28.4, this.conduitMat, { collide: false });
    // Parkour pillars (west) leading up to canopy deck
    for (let i = 0; i < 8; i++) {
      const z = 22 - i * 7, h = 4.25 * (i + 1);
      this.block(-37, 0, z - 2, -33, h, z + 2, tmat(0, i % 2 ? PAL.stone : PAL.sand));
      this.block(-37.2, h, z - 2.2, -32.8, h + 0.3, z + 2.2, tmat(0, PAL.teal));
      if (i % 3 === 1) this.bush(-35, h + 0.3, z, 0, 0.9);
    }
    // Houses / ruins (rooftop gardens)
    const reserved = [[0, 56, 6], [-48, 8, 9], [-44, 28, 6], [-35, 0, 6], [-35, 20, 6], [-35, -20, 6], [55, 0, 12], [55, 16, 8], [45, 0, 10], [8, 52, 6], [0, 0, 36], [30, 47, 6]];
    const clear = (x, z, rad) => { if (Math.abs(x) < 5.5 + rad) return false; if (Math.abs(z) < 4 + rad && Math.abs(x) > 10) return false; if (Math.abs(x) < 34 && Math.abs(z) < 34) return false; for (const [rx, rz, rr] of reserved) if (Math.hypot(x - rx, z - rz) < rr + rad) return false; return true; };
    let placed = 0, tries = 0; const houses = [];
    while (placed < 16 && tries++ < 600) {
      const a = r() * 6.28, d = 40 + r() * 52, x = Math.cos(a) * d, z = Math.sin(a) * d, w = 6 + Math.floor(r() * 3) * 2, dd = 6 + Math.floor(r() * 3) * 2, h = 4 + Math.floor(r() * 3) * 2.5;
      const rad = Math.max(w, dd) * 0.75;
      if (!clear(x, z, rad) || houses.some(hh => Math.hypot(hh[0] - x, hh[1] - z) < hh[2] + rad + 3)) continue;
      this.house(x, z, w, dd, h); houses.push([x, z, rad]); reserved.push([x, z, rad]); placed++;
    }
    // Trees, flowers & rocks across the basal ground
    tries = 0; let trees = 0;
    while (trees < 46 && tries++ < 800) {
      const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200; if (!clear(x, z, 2.5)) continue;
      this.tree(x, 0, z, 0, 0.9 + r() * 0.8); reserved.push([x, z, 2]); trees++;
      if (r() < 0.4) this.flowerPatch(x + 2, 0, z + 2, 0, 5);
    }
    for (let i = 0; i < 26; i++) {
      const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200; if (!clear(x, z, 1.5)) continue;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + r() * 1.2, 0), tmat(0, PAL.slate)); rock.position.set(x, 0.2, z); rock.rotation.set(r(), r(), r()); rock.castShadow = true; S.add(rock);
    }
    // Basal grapple anchors at the deck rim
    this.anchor('A1', 18, 39, 33, [0, 0, -1]);
    this.anchor('A2', 12, 39, -33, [0, 0, 1]);
    this.anchor('A3', 33, 39, 16, [-1, 0, 0]);
    // Thermal 1 (dormant until conduit restored)
    this.thermal('T1', -48, 8, 5, 0, 54);
    // Waterfall 1 (deck south edge → aqueduct)
    this.waterfall('W1', 0, 35.9, 0, 30.05, 5.6, 0);

    // ===== TIER 1 — Canopy Mid-Level =====
    const t1 = tmat(1, PAL.stone), t1s = tmat(1, PAL.sand);
    this.block(-30, 34, -30, 30, 36, 30, t1);
    this.block(-30.3, 35.6, -30.3, 30.3, 36.2, 30.3, tmat(1, PAL.teal), { collide: false });  // rim trim (visual)
    for (const s of [-1, 1]) { this.vines(s * 30, 0, 26, 35, s, 0, 1, 50); this.vines(0, s * 30, 26, 35, 0, s, 1, 50); }
    // spire above deck (stepped setbacks)
    this.block(-9, 36, -9, 9, 50, 9, t1s);
    this.block(-9.3, 49.6, -9.3, 9.3, 50, 9.3, tmat(1, PAL.terra));
    this.block(-7, 50, -7, 7, 64, 7, t1);
    this.block(-7.3, 63.6, -7.3, 7.3, 64, 7.3, tmat(1, PAL.teal));
    for (const s of [-1, 1]) { this.vines(s * 9, 0, 40, 50, s, 0, 1, 12); this.vines(0, s * 9, 40, 50, 0, s, 1, 12); this.vines(s * 7, 0, 55, 64, s, 0, 1, 9); }
    // deck stream (aqueduct source)
    this.block(-1.8, 36, 9, -1.4, 36.35, 30, tmat(1, PAL.stone)); this.block(1.4, 36, 9, 1.8, 36.35, 30, tmat(1, PAL.stone));
    this.deckStream = this.waterPlane(-1.4, 36.2, 9, 1.4, 30, 1);
    // Hydroponic bay (NW)
    this.hydroWater = [];
    for (const x0 of [-28, -14]) for (const z0 of [-28, -24, -20, -16]) {
      this.block(x0, 36, z0, x0 + 6, 36.5, z0 + 2, tmat(1, PAL.wood));
      this.hydroWater.push(this.waterPlane(x0 + 0.2, 36.52, z0 + 0.2, x0 + 5.8, z0 + 1.8, 1));
      for (let k = 0; k < 3; k++) this.bush(x0 + 1 + k * 2, 36.5, z0 + 1, 1, 0.7);
    }
    this.block(-29, 36, -29, -27.5, 41, -27.5, tmat(1, PAL.brass)); this.block(-8.5, 36, -29, -7, 41, -27.5, tmat(1, PAL.brass));
    this.block(-29, 41, -29, -7, 41.6, -27.5, tmat(1, PAL.glass));
    this.waterfall('W2', -11, 35.9, 0, -30.05, 5, Math.PI);
    // Residential arches & pods
    for (const ax of [-14, 14]) {
      this.block(ax - 3, 36, 20, ax - 2, 44, 21, t1s); this.block(ax + 2, 36, 20, ax + 3, 44, 21, t1s);
      this.block(ax - 3.4, 44, 19.6, ax + 3.4, 45.2, 21.4, tmat(1, PAL.terra));
      this.vines(ax, 21.4, 41, 44, 0, 1, 1, 5);
    }
    this.house(-22, 20, 6, 6, 5, 36, 1); this.house(22, 22, 6, 6, 7.5, 36, 1); this.house(22, -22, 8, 6, 5, 36, 1);
    this.tree(-26, 36, 27, 1, 1.4); this.tree(25, 36, -12, 1, 1.2); this.tree(6, 36, -22, 1, 1.5); this.tree(-24, 36, 2, 1, 1.3); this.tree(14, 36, 12, 1, 1.1); this.tree(-12, 36, 12, 1, 1.0);
    for (const [x, z] of [[-6, 20], [8, 26], [-20, -4], [18, 4], [0, -16], [-25, 12]]) this.flowerPatch(x, 36, z, 1, 6);
    // East solar tower + terrace + broken bridge stubs
    this.block(48, 0, -7, 62, 58, 7, tmat(1, PAL.sand));
    this.block(42, 30, -6, 48, 36, 6, t1);
    this.block(41.8, 35.6, -6.2, 48, 36.2, 6.2, tmat(1, PAL.teal), { collide: false });
    for (let y = 8; y < 56; y += 8) this.block(47.9, y, -5, 48, y + 4, 5, tmat(1, PAL.glass), { collide: false, cast: false });
    this.vines(55, 7, 10, 56, 0, 1, 1, 12); this.vines(62, 0, 14, 56, 1, 0, 1, 12);
    this.block(30, 35, -2, 32, 36, 2, t1); this.block(40, 35, -2, 42, 36, 2, t1);
    this.solarMat = toon(0x3a3f4a, { emissive: 0x1e5bd8, emissiveIntensity: 0, unique: true });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const p = new THREE.Mesh(BOX, this.solarMat); p.scale.set(4, 0.2, 2.5); p.position.set(51.5 + i * 4.3, 59.2, -3 + j * 5.5); p.rotation.x = -0.35; p.castShadow = true; S.add(p);
    }
    this.block(48, 58, -7, 62, 58.4, 7, tmat(1, PAL.terra));
    for (const z of [-7.05, 7.05]) for (let y = 20; y < 50; y += 10) { const p = new THREE.Mesh(BOX, this.solarMat); p.scale.set(10, 6, 0.15); p.position.set(55, y, z); S.add(p); }
    // bridge (built on restore)
    this.bridgeGroup = new THREE.Group(); this.bridgeGroup.position.set(32, 0, 0); this.bridgeGroup.scale.x = 0.001; this.bridgeGroup.visible = false; S.add(this.bridgeGroup);
    this.block(0, 35, -2, 8, 36, 2, tmat(1, PAL.wood), { collide: false, parent: this.bridgeGroup });
    this.block(0, 36, -2.1, 8, 37, -1.9, tmat(1, PAL.brass), { collide: false, parent: this.bridgeGroup });
    this.block(0, 36, 1.9, 8, 37, 2.1, tmat(1, PAL.brass), { collide: false, parent: this.bridgeGroup });
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(ICO, toon(PAL.leaf2)); b.scale.set(0.5, 0.35, 0.3); b.position.set(1 + i * 2, 37, i % 2 ? 2.1 : -2.1); this.bridgeGroup.add(b); }
    this.bridgeCols = [this.phys.add(31.9, 35, -2, 40.1, 36, 2, 'bridge'), this.phys.add(31.9, 36, -2.1, 40.1, 37, -1.9), this.phys.add(31.9, 36, 1.9, 40.1, 37, 2.1)];
    this.bridgeCols.forEach(b => b.enabled = false);
    // Thermal 2 by the tower (to apex)
    this.thermal('T2', 55, 18, 5, 0, 104);
    // sky anchors toward apex
    this.anchor('A4', -20, 52, -20, [0, 0, 0]);
    this.anchor('A5', -17, 66, -4, [0, 0, 0]);
    this.anchor('A6', -16.5, 80, 4, [1, 0, 0]);
    // sky-line anchors (unlocked by apex turbines)
    this.anchor('S1', 30, 24, 46, [0, 0, 0], 'skyline');
    this.anchor('S2', 22, 46, 34, [0, 0, 0], 'skyline');
    this.anchor('S3', 17, 68, 20, [0, 0, 0], 'skyline');
    this.anchor('S4', 16.5, 80, -4, [-1, 0, 0], 'skyline');

    // ===== TIER 2 — Apex Crown =====
    const t2 = tmat(2, PAL.stone);
    this.block(-5.5, 64, -5.5, 5.5, 76, 5.5, tmat(2, PAL.sand));
    this.block(-14, 76, -14, 14, 78, 14, t2);
    this.block(-14.3, 77.6, -14.3, 14.3, 78.2, 14.3, tmat(2, PAL.brass), { collide: false });
    this.block(-4, 78, -4, 4, 92, 4, tmat(2, PAL.stone));
    this.block(-4.4, 91.6, -4.4, 4.4, 92.2, 4.4, tmat(2, PAL.teal));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(4.2, 7, 4), tmat(2, PAL.teal)); cap.position.set(0, 95.5, 0); cap.rotation.y = Math.PI / 4; cap.castShadow = true; S.add(cap);
    this.crownCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), toon(0x9ef0ff, { emissive: 0x4dd0e1, emissiveIntensity: 0.1, unique: true })); this.crownCrystal.position.set(0, 101, 0); S.add(this.crownCrystal);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(BOX, this.solarMat); p.scale.set(7, 5, 0.15); p.position.set(0, 85, s * 4.05); S.add(p); const q = new THREE.Mesh(BOX, this.solarMat); q.scale.set(0.15, 5, 7); q.position.set(s * 4.05, 85, 0); S.add(q); }
    for (const [x, z] of [[11, -11], [-11, -11], [11, 11], [-11, 11]]) {
      this.block(x - 0.4, 78, z - 0.4, x + 0.4, 88, z + 0.4, tmat(2, PAL.stone));
      const hub = new THREE.Group(); hub.position.set(x, 88, z + (z > 0 ? 0.6 : -0.6)); S.add(hub);
      for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(BOX, tmat(2, 0xffffff)); bl.scale.set(0.35, 3.6, 0.1); bl.position.y = 1.8; const piv = new THREE.Group(); piv.rotation.z = b * 2.094; piv.add(bl); hub.add(piv); }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), tmat(2, PAL.terra)); hub.add(nose);
      this.rotors.push(hub);
    }
    // cloud garden (south half of apex)
    for (const [x, z] of [[-9, 12], [9, 12], [-12, 4], [12, 4]]) { this.block(x - 1.5, 78, z - 1, x + 1.5, 78.5, z + 1, tmat(2, PAL.wood)); this.bush(x, 78.5, z, 2, 0.9); }
    this.tree(-11, 78, -4, 2, 1.0); this.tree(11, 78, -4, 2, 1.0);
    this.flowerPatch(-6, 78, 6, 2, 6); this.flowerPatch(6, 78, 6, 2, 6);
    this.apexPond = this.waterPlane(-4, 78.06, 10, 4, 14, 2);
    this.deckPool = this.waterPlane(-5, 36.08, 14, 5, 20, 1);
    this.waterfall('W3', 0, 77.9, 36, 14.05, 6, 0);
    // Rainbow (final reward)
    this.rainbow = new THREE.Group(); this.rainbow.position.set(0, 20, 40); this.rainbow.visible = false; S.add(this.rainbow);
    [0xff5252, 0xffa726, 0xffeb3b, 0x66bb6a, 0x42a5f5, 0xab47bc].forEach((c, i) => {
      const tr = new THREE.Mesh(new THREE.TorusGeometry(60 - i * 1.6, 0.8, 4, 48, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, fog: false })); this.rainbow.add(tr);
    });
    // Thermal 3 decorative over apex once cascade restored? (kept simple: none)

    // ===== Atmosphere: clouds & distant mountains =====
    this.clouds = new THREE.Group(); S.add(this.clouds);
    const cm = toon(0xffffff);
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group(), a = r() * 6.28, d = 90 + r() * 200; c.position.set(Math.cos(a) * d, 55 + r() * 80, Math.sin(a) * d);
      for (let k = 0; k < 4 + Math.floor(r() * 4); k++) { const p = new THREE.Mesh(ICO, cm); const s = 4 + r() * 6; p.scale.set(s, s * 0.6, s); p.position.set((r() - 0.5) * 16, (r() - 0.5) * 3, (r() - 0.5) * 8); c.add(p); }
      this.clouds.add(c);
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * 6.28 + r() * 0.2, d = 420 + r() * 120, h = 60 + r() * 120;
      const m = new THREE.Mesh(new THREE.ConeGeometry(50 + r() * 50, h, 5 + Math.floor(r() * 3)), toon(r() < 0.5 ? 0x6fae8a : 0x7fa0b8)); m.position.set(Math.cos(a) * d, h / 2 - 10, Math.sin(a) * d); S.add(m);
      const snow = new THREE.Mesh(new THREE.ConeGeometry(14, h * 0.22, 5), toon(0xffffff)); snow.position.set(m.position.x, h - 10 - h * 0.11, m.position.z); S.add(snow);
    }

    // ===== Restoration nodes =====
    for (const def of NODE_DEFS) this.makeNode(def);
    // ===== Resource pickups =====
    this.placePickups();
  }

  makeNode(def) {
    const [x, y, z] = def.pos, g = new THREE.Group(); g.position.set(x, y, z); this.scene.add(g);
    const color = TYPE_COLOR[def.type];
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 1.0, 6), tmat(def.tier, PAL.stone)); base.position.y = 0.5; base.castShadow = base.receiveShadow = true; g.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.4, 6), tmat(def.tier, PAL.brass)); post.position.y = 1.7; g.add(post);
    const coreMat = toon(0x8c8c8c, { emissive: 0xff3d00, emissiveIntensity: 0.4, unique: true });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62), coreMat); core.position.y = 3.0; core.castShadow = true; g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.07, 4, 20), toon(0x9e9e9e, { unique: true })); ring.position.y = 3.0; ring.rotation.x = Math.PI / 2; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 90, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    beam.position.y = 48; beam.visible = false; g.add(beam);
    this.phys.add(x - 1.1, y, z - 1.1, x + 1.1, y + 1.0, z + 1.1, 'node');
    const n = { def, id: def.id, group: g, core, coreMat, ring, beam, color, cur: { energy: 0, bio: 0, scrap: 0 }, calib: 0, restored: false };
    this.nodes.set(def.id, n);
  }

  placePickups() {
    const r = mulberry32(4242), P = this.phys;
    const pickType = (w) => { const v = r(); return v < w[0] ? 'energy' : v < w[0] + w[1] ? 'bio' : 'scrap'; };
    const tryPlace = (x, z, maxY, w) => {
      const top = P.surfaceY(x, z, maxY); if (top === null) return false;
      const p = new V3(x, top + 0.9, z); if (P.pointInside(p) || P.pointInside(new V3(x, top + 2, z))) return false;
      for (const q of this.pickups) if (q.pos.distanceTo(p) < 4) return false;
      for (const n of this.nodes.values()) if (n.group.position.distanceTo(p) < 3) return false;
      this.pickup(pickType(w), x, p.y, z); return true;
    };
    let c = 0, t = 0;
    while (c < 26 && t++ < 2000) { const a = r() * 6.28, d = 14 + r() * 80; if (tryPlace(Math.cos(a) * d, Math.sin(a) * d, 30, [0.25, 0.3, 0.45])) c++; }
    c = 0; t = 0;
    while (c < 16 && t++ < 2000) { const x = (r() - 0.5) * 56, z = (r() - 0.5) * 56; if (Math.abs(x) < 10.5 && Math.abs(z) < 10.5) continue; if (tryPlace(x, z, 46, [0.32, 0.4, 0.28])) c++; }
    for (const z of [-2, 3]) tryPlace(44, z, 37, [0.4, 0.2, 0.4]);
    for (const i of [2, 5, 7]) tryPlace(-35, 22 - i * 7, 40, [0.4, 0.3, 0.3]);
    c = 0; t = 0;
    while (c < 9 && t++ < 2000) { const x = (r() - 0.5) * 27, z = (r() - 0.5) * 27; if (Math.abs(x) < 5 && Math.abs(z) < 5) continue; if (tryPlace(x, z, 80, [0.55, 0.2, 0.25])) c++; }
  }

  // ---- state / effects -------------------------------------------
  tween(dur, fn, done) { this.tweens.push({ t: 0, dur, fn, done }); }
  thermalAt(p) {
    for (const k in this.thermals) { const th = this.thermals[k]; if (!th.active) continue; if (p.y + 1 > th.yMin && p.y < th.yMax && Math.hypot(p.x - th.x, p.z - th.z) < th.radius) return th; }
    return null;
  }
  setNodeProgress(id, cur, calib) {
    if (!isNodeId(id)) return; const n = this.nodes.get(id);
    for (const k of RES) n.cur[k] = safeInt(cur && cur[k], 0, n.def.req[k] || 0);
    n.calib = safeInt(calib, 0, CFG.CALIBRATIONS);
  }
  nodeComplete(n) { return RES.every(k => (n.cur[k] || 0) >= (n.def.req[k] || 0)); }
  restoreNode(id, instant = false) {
    const n = this.nodes.get(id); if (!n || n.restored) return;
    n.restored = true; n.calib = CFG.CALIBRATIONS; for (const k of RES) n.cur[k] = n.def.req[k] || 0;
    n.coreMat.color.setHex(n.color); n.coreMat.emissive.setHex(n.color); n.coreMat.emissiveIntensity = 0.8;
    n.ring.material.color.setHex(0xfff59d);
    if (!instant) this.burst(n.group.position.clone().add(new V3(0, 3, 0)), n.color, 220);
    const D = instant ? 0.01 : 1;
    const show = (o, dur) => { o.visible = true; this.tween(dur * D, k => o.scale.y = Math.max(0.001, k)); };
    const fade = (m, to) => { m.visible = true; this.tween(2 * D, k => m.material.opacity = to * k); };
    switch (id) {
      case 'basal_aqueduct': show(this.waterfalls.W1, 2.5); fade(this.channelWater, 0.85); fade(this.deckStream, 0.85); break;
      case 'basal_conduit': this.thermals.T1.active = true; this.thermals.T1.pts.visible = true; this.thermals.T1.rings.forEach(r => r.visible = true); this.tween(2 * D, k => { this.conduitMat.emissiveIntensity = k * 1.3; this.thermals.T1.ventGlow.material.emissiveIntensity = k * 1.5; }); break;
      case 'canopy_hydro': show(this.waterfalls.W2, 2.5); this.hydroWater.forEach(w => fade(w, 0.85)); break;
      case 'canopy_bridge': this.bridgeGroup.visible = true; this.bridgeCols.forEach(b => b.enabled = true); this.tween(2.2 * D, k => this.bridgeGroup.scale.x = Math.max(0.001, k)); break;
      case 'canopy_solar': this.thermals.T2.active = true; this.thermals.T2.pts.visible = true; this.thermals.T2.rings.forEach(r => r.visible = true); this.tween(2 * D, k => { this.solarMat.emissiveIntensity = k * 0.9; this.thermals.T2.ventGlow.material.emissiveIntensity = k * 1.5; }); break;
      case 'apex_turbines': this.turbineTarget = 4; for (const a of this.anchors) if (a.group === 'skyline') { a.active = true; a.mesh.visible = true; } break;
      case 'apex_cloudgarden': show(this.waterfalls.W3, 3); fade(this.apexPond, 0.85); fade(this.deckPool, 0.85); this.rainbow.visible = true; this.rainbow.children.forEach(c => this.tween(4 * D, k => c.material.opacity = 0.4 * k)); this.crownCrystal.material.emissiveIntensity = 1.2; break;
    }
    this.recomputeVibrance();
    if ([...this.nodes.values()].every(n => n.restored) && this.onAllRestored) this.onAllRestored(instant);
  }
  recomputeVibrance() {
    for (let t = 0; t < 3; t++) {
      const list = [...this.nodes.values()].filter(n => n.def.tier === t);
      const f = list.filter(n => n.restored).length / list.length;
      this.vibTarget[t] = 0.12 + 0.88 * f;
    }
    this.vibDirty = true;
  }
  globalProgress() { const a = [...this.nodes.values()]; return a.filter(n => n.restored).length / a.length; }
  burst(pos, color, n = 160) {
    const geo = new THREE.BufferGeometry(), arr = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { arr[i * 3] = pos.x; arr[i * 3 + 1] = pos.y; arr[i * 3 + 2] = pos.z; const a = Math.random() * 6.28, u = Math.random(); vel.push(new V3(Math.cos(a) * (3 + u * 8), 6 + Math.random() * 12, Math.sin(a) * (3 + u * 8))); }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.6, transparent: true, opacity: 1, depthWrite: false }));
    this.scene.add(pts); this.bursts.push({ pts, vel, arr, t: 0, n });
  }
  setPickupAvailable(pid, avail) {
    if (!Number.isInteger(pid)) return; const p = this.pickups[pid]; if (!p) return;
    p.available = avail; p.pending = false; p.mesh.visible = avail;
  }
  update(dt, camera) {
    this.time += dt;
    for (let i = this.tweens.length - 1; i >= 0; i--) { const tw = this.tweens[i]; tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(smooth(0, 1, k)); if (k >= 1) { this.tweens.splice(i, 1); tw.done && tw.done(); } }
    for (const u of this.updaters) u(dt);
    if (this.vibDirty) {
      let still = false;
      for (let t = 0; t < 3; t++) {
        const d = this.vibTarget[t] - this.vib[t];
        if (Math.abs(d) > 0.002) { this.vib[t] += d * Math.min(1, dt * 0.9); still = true; } else this.vib[t] = this.vibTarget[t];
        const v = this.vib[t];
        for (const m of tierMats[t]) m.color.lerpColors(m.userData.dull, m.userData.vib, v);
        for (const g of this.plants[t]) g.scale.setScalar(lerp(0.62, 1, v));
        const bs = smooth(0.3, 0.75, v); for (const b of this.blooms[t]) b.scale.setScalar(Math.max(0.001, b.userData.s * bs));
      }
      this.vibDirty = still;
    }
    for (const n of this.nodes.values()) {
      n.core.rotation.y += dt * (n.restored ? 2 : 0.4);
      n.core.position.y = 3 + Math.sin(this.time * 2 + n.group.position.x) * (n.restored ? 0.2 : 0.05);
      n.ring.rotation.z += dt * (n.restored ? 1.5 : 0.2);
      if (!n.restored) n.coreMat.emissiveIntensity = 0.2 + (Math.sin(this.time * 9 + n.group.position.z) > 0.6 ? 0.6 : 0);
      n.beam.visible = n.restored || this.scanning;
      if (!n.restored) n.beam.material.color.setHex(0xff6e40);
      else n.beam.material.color.setHex(n.color);
    }
    for (const p of this.pickups) if (p.mesh.visible) { p.mesh.rotation.y += dt * 1.5; p.mesh.position.y = p.pos.y + Math.sin(this.time * 2.5 + p.phase) * 0.18; }
    for (const a of this.anchors) if (a.active) a.ring.rotation.y += dt * 0.8;
    this.turbineSpeed = approach(this.turbineSpeed, this.turbineTarget, dt * 1.2);
    for (const h of this.rotors) h.rotation.z += dt * this.turbineSpeed;
    this.crownCrystal.rotation.y += dt * 0.6;
    this.clouds.rotation.y += dt * 0.004;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]; b.t += dt;
      for (let k = 0; k < b.n; k++) { const v = b.vel[k]; v.y -= 12 * dt; v.multiplyScalar(1 - dt * 0.8); b.arr[k * 3] += v.x * dt; b.arr[k * 3 + 1] += v.y * dt; b.arr[k * 3 + 2] += v.z * dt; }
      b.pts.geometry.attributes.position.needsUpdate = true; b.pts.material.opacity = 1 - b.t / 2.6;
      if (b.t > 2.6) { this.scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); this.bursts.splice(i, 1); }
    }
  }
}
const PICK_GEO = { energy: facet(new THREE.OctahedronGeometry(0.42)), bio: facet(new THREE.IcosahedronGeometry(0.38, 0)), scrap: facet(new THREE.DodecahedronGeometry(0.36, 0)) };
const PICK_MAT = {
  energy: toon(0xffe14d, { emissive: 0xffb300, emissiveIntensity: 0.6 }),
  bio: toon(0x7ed957, { emissive: 0x2e7d32, emissiveIntensity: 0.5 }),
  scrap: toon(0xff9e66, { emissive: 0x8d4a1f, emissiveIntensity: 0.4 }),
};

// =====================================================================
// PLAYER CONTROLLER — IDLE / WALK / RUN / CLIMB / GLIDE / FALL (+GRAPPLE)
// =====================================================================
class PlayerController {
  constructor(phys, world) {
    this.phys = phys; this.world = world;
    this.pos = new V3(); this.vel = new V3(); this.yaw = Math.PI; this.state = 'IDLE';
    this.stamina = CFG.STAMINA_MAX; this.exhausted = false; this.grounded = false; this.groundTime = 0; this.coyote = 0;
    this.wallN = new V3(); this.climbCD = 0; this.dash = 0; this.grapple = null; this.target = null;
    this.lastSafe = new V3(); this.safeT = 0; this.inThermal = null; this.staminaUsedT = 99; this.events = [];
  }
  spawn(p) { this.pos.copy(p); this.vel.set(0, 0, 0); this.state = 'FALL'; this.lastSafe.copy(p); this.grapple = null; }
  canUse() { return !this.exhausted && this.stamina > 0.5; }
  drain(a) { this.stamina -= a; this.staminaUsedT = 0; if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; this.events.push('exhausted'); } }
  probeTop(n) { // wall boxes overlapping when nudged against -n; returns highest top or null
    const p = this.pos.clone().addScaledVector(n, -0.2); let top = null;
    for (const b of this.phys.overlapAll(p)) top = top === null ? b.max.y : Math.max(top, b.max.y);
    return top;
  }
  findWall(mx, mz) {
    let ax, sg;
    if (Math.abs(mx) > Math.abs(mz)) { if (Math.abs(mx) < 0.5) return null; ax = 'x'; sg = Math.sign(mx); }
    else { if (Math.abs(mz) < 0.5) return null; ax = 'z'; sg = Math.sign(mz); }
    const n = new V3(); n[ax] = -sg;
    const top = this.probeTop(n);
    if (top === null || top < this.pos.y + 1.1) return null;
    return n;
  }
  startClimb(n) { this.state = 'CLIMB'; this.wallN.copy(n); this.vel.set(0, 0, 0); this.grounded = false; this.grapple = null; this.yaw = Math.atan2(-n.x, -n.z); }
  detach(push) { const n = this.wallN; this.state = 'FALL'; this.vel.set(n.x * push, 0, n.z * push); this.climbCD = 0.5; }
  mantle(n, top) {
    const p = this.pos.clone(); p.y = top + 0.02; p.addScaledVector(n, -0.8);
    if (this.phys.overlapAt(p)) { p.addScaledVector(n, 0.45); if (this.phys.overlapAt(p)) return false; }
    this.pos.copy(p); this.state = 'IDLE'; this.vel.set(-n.x * 2, 0, -n.z * 2); this.grounded = true; this.climbCD = 0.3; return true;
  }
  startGrapple(a) { this.state = 'GRAPPLE'; this.grapple = { a, t: 0, stuck: 0 }; this.grounded = false; this.events.push('grapple'); }

  update(dt, inp, camYaw) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let mx = fx * inp.f + rx * inp.r, mz = fz * inp.f + rz * inp.r; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    const mlen = Math.min(1, ml);
    this.climbCD -= dt; this.staminaUsedT += dt;
    this.inThermal = this.world.thermalAt(this.pos);
    if (inp.grapple && this.target && this.state !== 'GRAPPLE') this.startGrapple(this.target);
    switch (this.state) {
      case 'CLIMB': this.updClimb(dt, inp); break;
      case 'GLIDE': this.updGlide(dt, inp, mx, mz, mlen); break;
      case 'GRAPPLE': this.updGrapple(dt, inp); break;
      default: this.updMove(dt, inp, mx, mz, mlen);
    }
    // stamina regen — full refill begins 1.5 s after standing on flat ground
    if (this.grounded && this.state !== 'CLIMB') {
      this.groundTime += dt;
      if (this.groundTime >= CFG.REGEN_DELAY) { this.stamina = Math.min(CFG.STAMINA_MAX, this.stamina + CFG.REGEN_RATE * dt); if (this.stamina >= CFG.STAMINA_MAX) this.exhausted = false; }
      this.safeT += dt; if (this.safeT > 0.5) { this.safeT = 0; this.lastSafe.copy(this.pos); }
    } else this.groundTime = 0;
    if (this.pos.y < -3.5) { this.pos.copy(this.lastSafe); this.pos.y += 0.3; this.vel.set(0, 0, 0); this.state = 'FALL'; this.grapple = null; this.events.push('respawn'); }
  }
  updMove(dt, inp, mx, mz, mlen) {
    const speed = inp.sprint ? CFG.RUN : CFG.WALK;
    if (this.grounded || mlen > 0.1) approachXZ(this.vel, mx * speed, mz * speed, (this.grounded ? 60 : 16) * dt);
    else { const k = Math.max(0, 1 - 1.2 * dt); this.vel.x *= k; this.vel.z *= k; } // airborne, hands-off: keep momentum
    this.vel.y = Math.max(this.vel.y - CFG.GRAVITY * dt, -50);
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (inp.jump) {
      if (this.coyote > 0) { this.vel.y = CFG.JUMP; this.coyote = 0; this.grounded = false; }
      else if (this.canUse()) { this.state = 'GLIDE'; this.vel.y = Math.max(this.vel.y, -3); this.events.push('glide'); return; }
    }
    if (mlen > 0.1) this.yaw = lerpAngle(this.yaw, Math.atan2(mx, mz), Math.min(1, 14 * dt));
    const res = this.phys.move(this.pos, this.vel.clone().multiplyScalar(dt), this.grounded);
    this.grounded = res.ground && this.vel.y <= 0;
    if (res.ground && this.vel.y < 0) this.vel.y = 0;
    if (res.ceil && this.vel.y > 0) this.vel.y = 0;
    if (res.hitX) this.vel.x = 0; if (res.hitZ) this.vel.z = 0;
    if ((res.hitX || res.hitZ) && mlen > 0.3 && this.climbCD <= 0 && this.canUse()) { const n = this.findWall(mx, mz); if (n) { this.startClimb(n); return; } }
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.state = this.grounded ? (hs > CFG.WALK + 0.5 ? 'RUN' : hs > 0.6 ? 'WALK' : 'IDLE') : 'FALL';
  }
  updClimb(dt, inp) {
    const n = this.wallN;
    if (inp.letGo || !this.canUse()) { this.detach(1.5); return; }
    if (inp.jump) {
      if (inp.f > 0.1 && this.stamina > 15) { this.dash = 0.32; this.drain(18); }
      else { this.vel.set(n.x * 6.5, 8.5, n.z * 6.5); this.state = 'FALL'; this.climbCD = 0.35; return; }
    }
    const rx = n.z, rz = -n.x;
    let up = inp.f * CFG.CLIMB_SPEED; const side = inp.r * CFG.CLIMB_SPEED;
    if (this.dash > 0) { this.dash -= dt; up = CFG.CLIMB_DASH; }
    const d = new V3(rx * side * dt - n.x * 0.03, up * dt, rz * side * dt - n.z * 0.03);
    const res = this.phys.move(this.pos, d, false);
    this.drain(CFG.CLIMB_COST * dt);
    this.yaw = Math.atan2(-n.x, -n.z);
    const top = this.probeTop(n);
    if (top === null) { if (up > 0 && this.pos.y > 0) { /* climbed past lip */ } this.detach(0.5); return; }
    if (up > 0 && this.pos.y + 1.0 >= top && this.mantle(n, top)) return;
    if (up > 0 && res.ceil) { // blocked by a thin overhang (roof lip, ledge trim): try to haul over it
      const q = this.pos.clone(); q.y += 1.2; q.addScaledVector(n, -0.2); let lip = null;
      for (const b of this.phys.overlapAll(q)) lip = lip === null ? b.max.y : Math.max(lip, b.max.y);
      if (lip !== null && lip - this.pos.y <= 3.2 && this.mantle(n, lip)) return;
    }
    if (res.ground && inp.f < 0) { this.state = 'IDLE'; this.grounded = true; this.climbCD = 0.4; }
  }
  updGlide(dt, inp, mx, mz, mlen) {
    if (inp.jump || !this.canUse()) { this.state = 'FALL'; return; }
    let dx, dz; if (mlen > 0.1) { dx = mx / mlen; dz = mz / mlen; } else { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); }
    const sp = this.inThermal ? (mlen > 0.1 ? CFG.GLIDE_SPEED * 0.45 : 0.6) : CFG.GLIDE_SPEED * (mlen > 0.1 ? 1 : 0.6); // hands-off in a thermal = ride the column
    approachXZ(this.vel, dx * sp, dz * sp, 7 * dt);
    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), Math.min(1, 3 * dt));
    const th = this.inThermal;
    if (th) { const k = clamp((th.yMax - this.pos.y) / 10, 0, 1); this.vel.y = Math.min(CFG.THERMAL_MAX_VY * k + 0.3, this.vel.y + CFG.THERMAL_LIFT * dt); }
    else { this.drain(CFG.GLIDE_COST * dt); this.vel.y = this.vel.y > -CFG.GLIDE_FALL ? Math.max(-CFG.GLIDE_FALL, this.vel.y - CFG.GRAVITY * 0.6 * dt) : approach(this.vel.y, -CFG.GLIDE_FALL, 25 * dt); }
    const res = this.phys.move(this.pos, this.vel.clone().multiplyScalar(dt), false);
    if (res.ceil && this.vel.y > 0) this.vel.y = 0;
    if (res.ground) { this.state = 'IDLE'; this.grounded = true; this.vel.y = 0; return; }
    if ((res.hitX || res.hitZ) && mlen > 0.3 && this.climbCD <= 0) { const n = this.findWall(mx, mz); if (n) this.startClimb(n); }
  }
  updGrapple(dt, inp) {
    const g = this.grapple; g.t += dt;
    const to = g.a.pos.clone(); to.y -= 1.3; to.sub(this.pos); const dist = to.length();
    if (inp.jump) { this.state = 'FALL'; this.vel.multiplyScalar(0.5); this.grapple = null; return; }
    if (dist < 1.2 || g.t > 4) {
      const e = g.a.exit; this.vel.set(e.x * 8, 10, e.z * 8); this.state = 'FALL'; this.grapple = null; this.climbCD = 0.2; return;
    }
    to.normalize(); this.vel.copy(to).multiplyScalar(Math.min(CFG.GRAPPLE_SPEED, dist * 6 + 6));
    const before = this.pos.clone();
    this.phys.move(this.pos, this.vel.clone().multiplyScalar(dt), false);
    if (this.pos.distanceTo(before) < this.vel.length() * dt * 0.15) { g.stuck += dt; if (g.stuck > 0.35) { this.state = 'FALL'; this.grapple = null; this.vel.set(0, 0, 0); } } else g.stuck = 0;
    this.yaw = lerpAngle(this.yaw, Math.atan2(to.x, to.z), Math.min(1, 10 * dt));
    this.grounded = false;
  }
}

// =====================================================================
// NETWORK MANAGER — PeerJS star topology; host is authoritative
// =====================================================================
class NetworkManager {
  constructor(game) {
    this.game = game; this.mode = 'offline'; this.selfId = 'solo'; this.peer = null; this.conns = new Map(); this.hostConn = null; this.code = null;
    this.auth = null; this.acc = 0; this.last = { p: new V3(1e9, 0, 0), r: 0, s: '', t: 0 };
  }
  get isAuthority() { return this.mode !== 'client'; }
  initAuthority(fromWorld) {
    this.auth = { nodes: {}, taken: new Set(), timers: new Map(), players: new Map() };
    for (const d of NODE_DEFS) {
      const wn = fromWorld && this.game.world.nodes.get(d.id);
      this.auth.nodes[d.id] = wn ? { cur: { ...wn.cur }, calib: wn.calib, restored: wn.restored } : { cur: { energy: 0, bio: 0, scrap: 0 }, calib: 0, restored: false };
    }
    if (fromWorld) for (const p of this.game.world.pickups) if (!p.available) this.scheduleRespawn(p.id, true);
    this.auth.players.set(this.selfId, this.selfInfo());
  }
  selfInfo() { const pl = this.game.player; return { id: this.selfId, name: this.game.selfName, color: this.game.selfColor, p: [pl.pos.x, pl.pos.y, pl.pos.z], r: pl.yaw, s: pl.state }; }
  genCode() { const A = ROOM_ALPHABET; let s = ''; const rnd = crypto.getRandomValues(new Uint32Array(5)); for (let i = 0; i < 5; i++) s += A[rnd[i] % A.length]; return s; }
  startSolo() { this.mode = 'offline'; this.selfId = 'solo'; this.initAuthority(false); }
  host(attempt = 0) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS failed to load (offline?)'));
      const code = this.genCode(); let opened = false;
      const peer = new window.Peer(CFG.PEER_PREFIX + code, { debug: 1 });
      peer.on('open', id => { opened = true; this.peer = peer; this.mode = 'host'; this.selfId = id; this.code = code; this.initAuthority(false); resolve(code); });
      peer.on('connection', conn => this.onConn(conn));
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
      peer.on('error', e => {
        if (!opened) { peer.destroy(); if (e.type === 'unavailable-id' && attempt < 3) this.host(attempt + 1).then(resolve, reject); else reject(e); }
        else console.warn('peer error', e.type, e);
      });
    });
  }
  join(code) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(new Error('PeerJS failed to load (offline?)'));
      code = String(code).trim().toUpperCase(); if (!ROOM_RE.test(code)) return reject(new Error('Invalid room code.')); let done = false;
      const fail = msg => { if (done) return; done = true; try { peer.destroy(); } catch (_) {} reject(new Error(msg)); };
      const peer = new window.Peer({ debug: 1 });
      const timer = setTimeout(() => fail('Timed out — check the room code.'), 12000);
      peer.on('error', e => fail(e.type === 'peer-unavailable' ? 'Room not found.' : 'Network error: ' + e.type));
      peer.on('connection', c => c.close()); // clients only talk to the host
      peer.on('open', () => {
        const conn = peer.connect(CFG.PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => conn.send({ t: 'HELLO', name: this.game.selfName, color: this.game.selfColor }));
        conn.on('data', m => {
          if (!isMsg(m)) return;
          if (m.t === 'ROOM_FULL') { fail('Room is full (max ' + CFG.MAX_PLAYERS + ').'); return; }
          if (m.t === 'WELCOME' && !done) { if (!safeId(m.id)) { fail('Bad response from host.'); return; } done = true; clearTimeout(timer); this.peer = peer; this.hostConn = conn; this.mode = 'client'; this.selfId = m.id; this.code = code; resolve(code); }
          if (done) this.game.safeApply(m);
        });
        conn.on('close', () => { if (done && this.mode === 'client') this.onHostLost(); });
      });
    });
  }
  onHostLost() {
    this.game.toast('Lost connection to host — continuing solo with current world state.');
    this.mode = 'offline'; this.hostConn = null; this.selfId = 'solo';
    this.game.clearRemotes(); this.initAuthority(true); this.game.refreshRoomInfo();
  }
  onConn(conn) {
    // token buckets: overall messages (moves are 20 Hz) and chat
    const bucket = { all: 80, chat: 5, last: performance.now(), strikes: 0 };
    const allow = isChat => {
      const now = performance.now(), el = (now - bucket.last) / 1000; bucket.last = now;
      bucket.all = Math.min(80, bucket.all + el * 40); bucket.chat = Math.min(5, bucket.chat + el * 1);
      if (bucket.all < 1 || (isChat && bucket.chat < 1)) { if (++bucket.strikes > 400) { console.warn('dropping flooding peer', conn.peer); this.dropPeer(conn.peer); conn.close(); } return false; }
      bucket.all -= 1; if (isChat) bucket.chat -= 1; return true;
    };
    conn.on('data', m => {
      if (!isMsg(m) || !allow(m.t === 'CHAT')) return;
      if (m.t === 'HELLO') {
        if (this.conns.has(conn.peer)) return;
        if (this.conns.size >= CFG.MAX_PLAYERS - 1) { conn.send({ t: 'ROOM_FULL' }); setTimeout(() => conn.close(), 400); return; }
        const id = safeId(conn.peer); if (!id) { conn.close(); return; }
        this.conns.set(id, conn);
        const info = { id, name: safeName(m.name), color: safeColor(m.color), p: [0, 0, 0], r: 0, s: 'IDLE' };
        this.auth.players.set(this.selfId, this.selfInfo());
        conn.send({ t: 'WELCOME', id, players: [...this.auth.players.values()], world: this.snapshot() });
        this.auth.players.set(id, info);
        this.broadcast({ t: 'PLAYER_JOIN', id, name: info.name, color: info.color }, id);
        return;
      }
      if (this.conns.has(conn.peer)) { try { this.hostHandle(conn.peer, m); } catch (e) { console.warn('bad message from', conn.peer, e); } }
    });
    conn.on('close', () => this.dropPeer(conn.peer));
    conn.on('error', () => this.dropPeer(conn.peer));
  }
  dropPeer(id) { if (!this.conns.has(id)) return; this.conns.delete(id); this.auth.players.delete(id); this.broadcast({ t: 'PLAYER_LEAVE', id }); }
  snapshot() { return { nodes: this.auth.nodes, taken: [...this.auth.taken] }; }
  // local intent → authority
  send(m) { if (this.mode === 'client') { if (this.hostConn && this.hostConn.open) this.hostConn.send(m); } else this.hostHandle(this.selfId, m); }
  sendTo(id, m) { if (id === this.selfId) this.game.apply(m); else { const c = this.conns.get(id); if (c && c.open) c.send(m); } }
  broadcast(m, exceptId) {
    if (exceptId !== this.selfId) this.game.apply(m);
    for (const [id, c] of this.conns) if (id !== exceptId && c.open) c.send(m);
  }
  scheduleRespawn(pid, already) {
    if (!already) this.auth.taken.add(pid); else this.auth.taken.add(pid);
    clearTimeout(this.auth.timers.get(pid));
    this.auth.timers.set(pid, setTimeout(() => { if (!this.auth) return; this.auth.taken.delete(pid); this.broadcast({ t: 'PICKUP_RESPAWN', pid }); }, CFG.PICKUP_RESPAWN * 1000));
  }
  hostHandle(from, m) {
    const A = this.auth; if (!A) return;
    switch (m.t) {
      case 'PLAYER_MOVE': {
        const p = safeVec(m.p); if (!p) break; const r = safeNum(m.r, -1e3, 1e3, 0), s = safeState(m.s);
        const pl = A.players.get(from); if (pl) { pl.p = p; pl.r = r; pl.s = s; }
        this.broadcast({ t: 'PLAYER_MOVE', id: from, p, r, s }, from); break;
      }
      case 'NODE_DELIVER': {
        if (!isNodeId(m.node)) break;
        const n = A.nodes[m.node], def = NODE_DEF[m.node];
        const refund = {}; let any = false; const acc = {};
        for (const k of RES) {
          const want = safeInt(m.res && m.res[k], 0, 99); if (!want) continue;
          const take = n.restored ? 0 : clamp(want, 0, (def.req[k] || 0) - n.cur[k]);
          n.cur[k] += take; if (take) { any = true; acc[k] = take; } if (want - take > 0) refund[k] = want - take;
        }
        if (Object.keys(refund).length) this.sendTo(from, { t: 'REFUND', res: refund });
        if (any) this.broadcast({ t: 'NODE_PROGRESS_UPDATE', node: m.node, cur: n.cur, calib: n.calib, by: from, res: acc });
        break;
      }
      case 'NODE_CALIBRATE': {
        if (!isNodeId(m.node)) break;
        const n = A.nodes[m.node], def = NODE_DEF[m.node]; if (n.restored) break;
        if (!RES.every(k => n.cur[k] >= (def.req[k] || 0))) break;
        n.calib++;
        this.broadcast({ t: 'NODE_PROGRESS_UPDATE', node: m.node, cur: n.cur, calib: n.calib, by: from, calibrated: true });
        if (n.calib >= CFG.CALIBRATIONS) { n.restored = true; this.broadcast({ t: 'NODE_RESTORED', node: m.node, by: from }); }
        break;
      }
      case 'PICKUP_TAKE': {
        if (!this.game.validPid(m.pid) || A.taken.has(m.pid)) break;
        this.scheduleRespawn(m.pid);
        this.broadcast({ t: 'PICKUP_TAKEN', pid: m.pid, by: from }); break;
      }
      case 'CHAT': {
        const pl = A.players.get(from) || {}; const text = safeText(m.text); if (!text) break;
        this.broadcast({ t: 'CHAT', id: from, name: pl.name || '?', color: pl.color || '#fff', text }); break;
      }
    }
  }
  tick(dt) {
    if (this.mode === 'offline') return;
    this.acc += dt; this.last.t += dt;
    if (this.acc < 1 / CFG.NET_HZ) return; this.acc = 0;
    const pl = this.game.player, L = this.last;
    const moved = pl.pos.distanceTo(L.p) > CFG.NET_EPS, rot = Math.abs(lerpAngle(L.r, pl.yaw, 1) - L.r) > 0.03, st = pl.state !== L.s;
    if (!(moved || rot || st || L.t > 1)) return;
    L.p.copy(pl.pos); L.r = pl.yaw; L.s = pl.state; L.t = 0;
    this.send({ t: 'PLAYER_MOVE', p: [+pl.pos.x.toFixed(2), +pl.pos.y.toFixed(2), +pl.pos.z.toFixed(2)], r: +pl.yaw.toFixed(3), s: pl.state });
  }
  destroy() { try { this.peer && this.peer.destroy(); } catch (_) {} }
}

// =====================================================================
// GAME / RENDERER SETUP
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2500);
scene.fog = new THREE.Fog(0xcfe8f5, 90, 650);

const SKY = { topDull: new THREE.Color(0x8fa8bd), botDull: new THREE.Color(0xd9d6cc), top: new THREE.Color(0x3d9cff), bot: new THREE.Color(0xc4ecff) };
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: SKY.topDull.clone() }, bottom: { value: SKY.botDull.clone() } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vW; void main(){ float h = normalize(vW - cameraPosition).y; float t = clamp(h*1.4+0.12,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(t,0.75)),1.0); \n#include <colorspace_fragment>\n }',
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 12), skyMat); scene.add(sky);
const hemi = new THREE.HemisphereLight(0xdff6ff, 0x7aa36a, 1.1); scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.35); scene.add(amb);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 420 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun); scene.add(sun.target);
const SUN_DIR = new V3(0.55, 0.75, 0.35).normalize();
const sunSprite = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,245,200,0.9)'); gr.addColorStop(1, 'rgba(255,230,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false, depthWrite: false, transparent: true })); s.scale.setScalar(160); scene.add(s); return s; })();

const phys = new Physics();
const world = new World(scene, phys);
world.build();
const player = new PlayerController(phys, world);
const SPAWN = new V3(8, 0.5, 58);
player.spawn(SPAWN);
const selfModel = makeCharacter('#ff6b6b'); scene.add(selfModel.group);
const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineBasicMaterial({ color: 0x5d4037 })); rope.visible = false; rope.frustumCulled = false; scene.add(rope);

const game = {
  world, player, net: null, selfName: 'Wanderer', selfColor: PLAYER_COLORS[0], remotes: new Map(),
  inventory: { energy: 0, bio: 0, scrap: 0 }, playing: false, scanning: false,
};
game.net = new NetworkManager(game);

// =====================================================================
// UI / HUD
// =====================================================================
const $ = id => document.getElementById(id);
const ui = { panelNode: null, mg: null, chatOpen: false, helpOn: false, region: -1, regionTimer: 0 };
const labelsEl = $('labels');
function mkLabel(cls, html) { const d = document.createElement('div'); d.className = 'lbl ' + cls; d.innerHTML = html; d.style.display = 'none'; labelsEl.appendChild(d); return d; }
const tmpV = new V3();
function toScreen(v) { tmpV.copy(v).project(camera); if (tmpV.z > 1 || tmpV.z < -1) return null; return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight }; }
function place(el, v, on) { const s = on ? toScreen(v) : null; if (!s) { el.style.display = 'none'; return; } el.style.display = 'block'; el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; }

game.toast = (text, big = false) => {
  const d = document.createElement('div'); d.className = 'toast' + (big ? ' big' : ''); d.innerHTML = text; $('toasts').appendChild(d);
  setTimeout(() => d.style.opacity = 0, big ? 4500 : 3500); setTimeout(() => d.remove(), big ? 5200 : 4200);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
};
function playerName(id) { if (typeof id !== 'string') return 'Someone'; if (id === game.net.selfId) return 'You'; const r = game.remotes.get(id); return r ? esc(r.name) : 'Someone'; }
function renderInventory(bump) {
  $('inventory').innerHTML = RES.map(k => `<div class="chip${bump === k ? ' bump' : ''}" title="${RES_NAME[k]}">${RES_ICON[k]} ${game.inventory[k]}</div>`).join('');
  if (bump) setTimeout(() => renderInventory(), 160);
}
function renderObjectives() {
  let h = '<h3>Restoration</h3>';
  for (let t = 2; t >= 0; t--) {
    h += `<div class="tierh">${TIER_NAMES[t]}</div>`;
    for (const d of NODE_DEFS.filter(d => d.tier === t)) {
      const n = world.nodes.get(d.id), tot = RES.reduce((a, k) => a + (d.req[k] || 0), 0) + CFG.CALIBRATIONS;
      const have = RES.reduce((a, k) => a + Math.min(n.cur[k], d.req[k] || 0), 0) + n.calib;
      h += `<div class="obj${n.restored ? ' done' : ''}">${n.restored ? '✅' : TYPE_ICON[d.type]}<span class="nm">${d.name}</span><span class="bar"><i style="width:${(n.restored ? 1 : have / tot) * 100}%;background:${hexStr(TYPE_COLOR[d.type])}"></i></span></div>`;
    }
  }
  const done = [...world.nodes.values()].filter(n => n.restored).length;
  h += `<div id="progressTotal">Spire restored: ${done} / ${NODE_DEFS.length}</div>`;
  $('objectives').innerHTML = h;
}
game.refreshRoomInfo = () => {
  const N = game.net;
  let h = N.mode === 'offline' ? '<div>🌿 Solo session</div>' : `<div>Room code</div><div class="code">${esc(N.code)}</div><div style="font-size:11px;opacity:.75">${N.mode === 'host' ? 'You are hosting' : 'Connected'}</div>`;
  h += `<div class="pl"><span class="dot" style="background:${safeColor(game.selfColor)}"></span>${esc(game.selfName)} (you)</div>`;
  for (const r of game.remotes.values()) h += `<div class="pl"><span class="dot" style="background:${safeColor(r.color)}"></span>${esc(r.name)}</div>`;
  $('roomInfo').innerHTML = h;
};
function renderNodePanel() {
  const id = ui.panelNode; if (!id) { $('nodePanel').classList.add('hidden'); return; }
  const n = world.nodes.get(id), d = n.def, c = hexStr(n.color);
  let h = `<div class="np-title" style="--c:${c}">${TYPE_ICON[d.type]} ${d.name}</div><div class="np-sub">${TIER_NAMES[d.tier]} · ${d.type} node</div><div class="np-desc">${d.desc}</div>`;
  if (n.restored) h += '<div class="np-done">✓ Restored — thank you!</div>';
  else {
    h += '<div><b>Stage 1 — Deliver materials</b></div>';
    RES.forEach((k, i) => {
      const need = d.req[k] || 0; if (!need) return;
      const have = n.cur[k];
      h += `<div class="np-res"><span class="key">${i + 1}</span>${RES_ICON[k]} ${RES_NAME[k]} <b>${have}/${need}</b> <span style="opacity:.7">(you carry ${game.inventory[k]})</span><div class="bar"><i style="width:${have / need * 100}%;background:${c}"></i></div></div>`;
    });
    const ready = world.nodeComplete(n);
    h += `<div class="np-stage"><b>Stage 2 — Calibrate</b> ${n.calib}/${CFG.CALIBRATIONS}<br>${ready ? '<span class="key">R</span> Run calibration (anyone can help!)' : '<span style="opacity:.7">Deliver all materials to unlock.</span>'}</div>`;
  }
  h += '<div class="np-foot"><span class="key">E</span> Close</div>';
  $('nodePanel').innerHTML = h; $('nodePanel').classList.remove('hidden');
}
function showRegion(t) {
  $('region').innerHTML = `${TIER_NAMES[t]}<small>${TIER_SUB[t]}</small>`; $('region').classList.add('show');
  clearTimeout(ui.regionTimer); ui.regionTimer = setTimeout(() => $('region').classList.remove('show'), 3000);
}
$('help').innerHTML = `<b>Controls</b><br><span class="key">WASD</span> move  <span class="key">Shift</span> sprint<br><span class="key">Space</span> jump · again in air = glider<br>Walk into a wall to <b>climb</b> (uses stamina)<br>On wall: <span class="key">Space</span> leap off, <span class="key">W</span>+<span class="key">Space</span> dash up, <span class="key">X</span> let go<br><span class="key">F</span>/<span class="key">RMB</span> grapple to a gold ring<br><span class="key">Q</span> scanner (nodes, resources, thermals)<br><span class="key">E</span> inspect node · <span class="key">1</span><span class="key">2</span><span class="key">3</span> deliver · <span class="key">R</span> calibrate<br><span class="key">Enter</span> chat · <span class="key">H</span> toggle help<br><br><i>Glide into rising thermals to gain height. Restore nodes to bring water, light and greenery back — and to open new routes for everyone.</i>`;
const EMOJIS = ['👋', '👍', '🙌', '🎉', '❓', '⚡', '🌱', '⚙️', '💧', '🌉', '🪂', '❤️'];
$('emojis').innerHTML = EMOJIS.map(e => `<span>${e}</span>`).join('');
$('emojis').addEventListener('mousedown', e => { if (e.target.tagName === 'SPAN') { e.preventDefault(); game.net.send({ t: 'CHAT', text: e.target.textContent }); } });
function chatLine(name, color, text, sys) {
  const d = document.createElement('div');
  d.innerHTML = sys ? `<i style="opacity:.85">${text}</i>` : `<b style="color:${safeColor(color)}">${esc(name)}:</b> ${esc(text)}`; // sys text is built locally from escaped parts only
  $('chatLog').appendChild(d); setTimeout(() => d.classList.add('old'), 9000);
  while ($('chatLog').children.length > 30) $('chatLog').firstChild.remove();
}
function openChat() { ui.chatOpen = true; keys.clear(); $('chat').classList.add('open'); $('chatInputRow').classList.remove('hidden'); $('chatHint').classList.add('hidden'); document.exitPointerLock(); $('chatInput').focus(); }
function closeChat(send) {
  const v = $('chatInput').value.trim(); if (send && v) game.net.send({ t: 'CHAT', text: v });
  $('chatInput').value = ''; ui.chatOpen = false; $('chat').classList.remove('open'); $('chatInputRow').classList.add('hidden'); $('chatHint').classList.remove('hidden'); $('chatInput').blur(); lockPointer();
}
$('chatInput').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') closeChat(true); else if (e.key === 'Escape') closeChat(false); });

// Scanner labels
const nodeLabels = new Map(); for (const n of world.nodes.values()) nodeLabels.set(n.id, mkLabel('node', ''));
const pickLabels = world.pickups.map(p => mkLabel('pick', RES_ICON[p.type]));
const thermLabels = Object.values(world.thermals).map(th => ({ th, el: mkLabel('therm', '') }));
const anchorLabels = world.anchors.map(a => ({ a, el: mkLabel('anch', '◎') }));

// =====================================================================
// REMOTE PLAYERS
// =====================================================================
game.addRemote = (id, name, color, p, r, s) => {
  id = safeId(id); if (!id || id === game.net.selfId || game.remotes.has(id) || game.remotes.size >= CFG.MAX_PLAYERS - 1) return;
  name = safeName(name); color = safeColor(color); p = safeVec(p); r = safeNum(r, -1e3, 1e3, 0); s = safeState(s);
  const model = makeCharacter(color); scene.add(model.group);
  const rp = { id, name, color, model, pos: new V3(...(p || [0, -100, 0])), target: new V3(...(p || [0, -100, 0])), yaw: r || 0, tYaw: r || 0, state: s || 'IDLE', label: mkLabel('name', `<span style="color:${color}">●</span> ${esc(name)}`) };
  game.remotes.set(id, rp); game.refreshRoomInfo();
};
game.removeRemote = id => { const r = game.remotes.get(id); if (!r) return; scene.remove(r.model.group); r.label.remove(); game.remotes.delete(id); game.refreshRoomInfo(); };
game.clearRemotes = () => { for (const id of [...game.remotes.keys()]) game.removeRemote(id); };

// =====================================================================
// APPLY AUTHORITATIVE EVENTS (same path for host, client, and solo)
// =====================================================================
game.validPid = pid => Number.isInteger(pid) && pid >= 0 && pid < world.pickups.length;
game.safeApply = m => { try { game.apply(m); } catch (e) { console.warn('ignored malformed message', m && m.t, e); } };
game.apply = m => {
  if (!isMsg(m)) return;
  switch (m.t) {
    case 'WELCOME': {
      const id = safeId(m.id); if (!id) break; game.net.selfId = id;
      const wn = (m.world && m.world.nodes) || {};
      for (const d of NODE_DEFS) { const s = Object.hasOwn(wn, d.id) ? wn[d.id] : null; if (!s) continue; world.setNodeProgress(d.id, s.cur, s.calib); if (s.restored === true) world.restoreNode(d.id, true); }
      for (const pid of Array.isArray(m.world && m.world.taken) ? m.world.taken : []) if (game.validPid(pid)) world.setPickupAvailable(pid, false);
      for (const p of Array.isArray(m.players) ? m.players.slice(0, CFG.MAX_PLAYERS) : []) if (p && p.id !== id) game.addRemote(p.id, p.name, p.color, p.p, p.r, p.s);
      renderObjectives(); break;
    }
    case 'PLAYER_JOIN': { if (!safeId(m.id) || game.remotes.has(m.id)) break; const nm = safeName(m.name); game.addRemote(m.id, nm, m.color); chatLine('', '', `${esc(nm)} joined the spire`, true); game.toast(`👋 ${esc(nm)} joined`); break; }
    case 'PLAYER_LEAVE': { const r = game.remotes.get(m.id); if (r) chatLine('', '', `${esc(r.name)} left`, true); game.removeRemote(m.id); break; }
    case 'PLAYER_MOVE': { const r = game.remotes.get(m.id), p = safeVec(m.p); if (!r || !p) break; r.target.set(p[0], p[1], p[2]); if (r.pos.y < -50) r.pos.copy(r.target); r.tYaw = safeNum(m.r, -1e3, 1e3, r.tYaw); r.state = safeState(m.s); break; }
    case 'NODE_PROGRESS_UPDATE': {
      if (!isNodeId(m.node)) break;
      world.setNodeProgress(m.node, m.cur, m.calib); const res = safeRes(m.res); const calib = world.nodes.get(m.node).calib; renderObjectives(); if (ui.panelNode === m.node) renderNodePanel();
      const nm = NODE_DEF[m.node].name;
      if (Object.keys(res).length) game.toast(`${playerName(m.by)} delivered ${Object.entries(res).map(([k, v]) => v + RES_ICON[k]).join(' ')} → ${nm}`);
      if (m.calibrated === true) game.toast(`🔧 ${playerName(m.by)} calibrated ${nm} (${calib}/${CFG.CALIBRATIONS})`);
      break;
    }
    case 'NODE_RESTORED': {
      if (!isNodeId(m.node)) break; const def = NODE_DEF[m.node];
      world.restoreNode(m.node); renderObjectives(); if (ui.panelNode === m.node) renderNodePanel();
      game.toast(`${TYPE_ICON[def.type]} ${def.name} restored!`, true);
      chatLine('', '', `✨ ${playerName(m.by)} completed the ${def.name}.`, true);
      break;
    }
    case 'PICKUP_TAKEN': {
      if (!game.validPid(m.pid)) break;
      const wasAvail = world.pickups[m.pid].available || world.pickups[m.pid].pending;
      world.setPickupAvailable(m.pid, false);
      if (m.by === game.net.selfId && wasAvail) { const p = world.pickups[m.pid]; game.inventory[p.type]++; renderInventory(p.type); if (ui.panelNode) renderNodePanel(); }
      break;
    }
    case 'PICKUP_RESPAWN': if (game.validPid(m.pid)) world.setPickupAvailable(m.pid, true); break;
    case 'REFUND': { const res = safeRes(m.res); for (const k of RES) game.inventory[k] += res[k] || 0; renderInventory(); if (ui.panelNode) renderNodePanel(); break; }
    case 'CHAT': { const text = safeText(m.text); if (text) chatLine(safeName(m.name), safeColor(m.color), text); break; }
  }
};
world.onAllRestored = instant => {
  if (instant) return;
  setTimeout(() => { game.toast('🌈 The Spire blooms again! Every district is restored.', true); for (let i = 0; i < 8; i++) setTimeout(() => world.burst(new V3((Math.random() - 0.5) * 40, 40 + Math.random() * 50, (Math.random() - 0.5) * 40), [0xff8fb1, 0xffd54f, 0x4fc3f7, 0x7ed957][i % 4], 200), i * 300); }, 2500);
};

// =====================================================================
// INPUT
// =====================================================================
const keys = new Set(), pressed = new Set();
const cam = { yaw: 0, pitch: 0.3, dist: 7.5, cur: 7.5, target: new V3() };
function lockPointer() { if (!game.playing) return; const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); }
addEventListener('keydown', e => {
  if (!game.playing || ui.chatOpen) return;
  if (e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (['Space', 'Tab', 'KeyQ', 'KeyF'].includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('mousedown', e => {
  if (!game.playing) return;
  if (document.pointerLockElement !== renderer.domElement) { lockPointer(); return; }
  if (e.button === 2) pressed.add('Grapple');
});
$('resume').addEventListener('click', () => lockPointer());
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  cam.yaw -= e.movementX * 0.0025; cam.pitch = clamp(cam.pitch + e.movementY * 0.0025, -0.55, 1.35);
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  $('resume').classList.toggle('hidden', locked || !game.playing || ui.chatOpen);
});
addEventListener('wheel', e => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 0.8, 3.5, 14); });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
addEventListener('beforeunload', () => game.net.destroy());

function readInput() {
  const k = c => keys.has(c), p = c => pressed.has(c);
  const busy = !!ui.mg;
  const inp = {
    f: busy ? 0 : (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
    r: busy ? 0 : (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
    sprint: k('ShiftLeft') || k('ShiftRight'),
    jump: !busy && p('Space'), letGo: p('KeyX') || p('ControlLeft'),
    grapple: p('KeyF') || p('Grapple'),
  };
  return inp;
}

// =====================================================================
// GAMEPLAY GLUE: interaction, pickups, minigame, grapple targeting
// =====================================================================
function nearestNode() {
  let best = null, bd = CFG.INTERACT_RANGE;
  for (const n of world.nodes.values()) { const p = n.group.position; const dy = player.pos.y - p.y; if (dy < -1.5 || dy > 3) continue; const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z); if (d < bd) { bd = d; best = n; } }
  return best;
}
function deliver(k) {
  const n = world.nodes.get(ui.panelNode); if (!n || n.restored) return;
  const need = (n.def.req[k] || 0) - n.cur[k], amt = Math.min(need, game.inventory[k]);
  if (amt <= 0) { game.toast(need <= 0 ? `${RES_ICON[k]} already complete here` : `You have no ${RES_ICON[k]} ${RES_NAME[k]}`); return; }
  game.inventory[k] -= amt; renderInventory();
  game.net.send({ t: 'NODE_DELIVER', node: n.id, res: { [k]: amt } });
}
function openMinigame(n) { ui.mg = { node: n.id, t: Math.random() * 6, zone: 0.15 + Math.random() * 0.6, w: 0.17, lock: 0, speed: 2.2 + n.calib * 0.5 }; $('minigame').classList.remove('hidden'); $('mgZone').style.left = ui.mg.zone * 100 + '%'; $('mgZone').style.width = ui.mg.w * 100 + '%'; $('mgInfo').textContent = `${n.def.name} — ${n.calib}/${CFG.CALIBRATIONS} calibrated · Esc/E to cancel`; }
function closeMinigame() { ui.mg = null; $('minigame').classList.add('hidden'); $('minigame').classList.remove('miss'); }
function updateMinigame(dt) {
  const mg = ui.mg; if (!mg) return;
  const n = world.nodes.get(mg.node);
  if (n.restored || !ui.panelNode) { closeMinigame(); return; }
  mg.t += dt * mg.speed; mg.lock -= dt;
  const x = (Math.sin(mg.t) + 1) / 2; $('mgMarker').style.left = x * 100 + '%';
  if (mg.lock <= 0) $('minigame').classList.remove('miss');
  if ((pressed.has('Space') || pressed.has('KeyR')) && mg.lock <= 0) {
    if (x >= mg.zone && x <= mg.zone + mg.w) { game.net.send({ t: 'NODE_CALIBRATE', node: mg.node }); closeMinigame(); }
    else { mg.lock = 0.7; $('minigame').classList.add('miss'); }
  }
  if (pressed.has('KeyE')) { closeMinigame(); pressed.delete('KeyE'); }
}
function updateInteraction() {
  const near = nearestNode();
  if (ui.panelNode) {
    const n = world.nodes.get(ui.panelNode), p = n.group.position;
    if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > 5.5 || Math.abs(player.pos.y - p.y) > 4) { ui.panelNode = null; closeMinigame(); renderNodePanel(); }
  }
  if (!ui.mg) {
    if (pressed.has('KeyE')) {
      if (ui.panelNode) { ui.panelNode = null; renderNodePanel(); }
      else if (near) { ui.panelNode = near.id; renderNodePanel(); }
    }
    if (ui.panelNode) {
      if (pressed.has('Digit1')) deliver('energy'); if (pressed.has('Digit2')) deliver('bio'); if (pressed.has('Digit3')) deliver('scrap');
      const n = world.nodes.get(ui.panelNode);
      if (pressed.has('KeyR') && !n.restored) { if (world.nodeComplete(n)) openMinigame(n); else game.toast('Deliver all materials first.'); }
    }
  }
  const pr = $('prompt');
  if (!ui.panelNode && near) { pr.innerHTML = near.restored ? `${TYPE_ICON[near.def.type]} ${near.def.name} — <b style="color:#b9f6ca">Restored</b>` : `<span class="key">E</span> Inspect ${near.def.name}`; pr.classList.remove('hidden'); }
  else pr.classList.add('hidden');
  // pickups
  const c = player.pos.clone(); c.y += 0.9;
  for (const p of world.pickups) if (p.available && !p.pending && p.pos.distanceToSquared(c) < 2.4 * 2.4) { p.pending = true; p.mesh.visible = false; game.net.send({ t: 'PICKUP_TAKE', pid: p.id }); }
}
function updateGrappleTarget() {
  const fwd = new V3(); camera.getWorldDirection(fwd);
  let best = null, bd = 0.93;
  for (const a of world.anchors) {
    if (!a.active || a.pos.distanceTo(player.pos) > CFG.GRAPPLE_RANGE) continue;
    const v = a.pos.clone().sub(camera.position).normalize(); const d = v.dot(fwd); if (d > bd) { bd = d; best = a; }
  }
  if (player.target && player.target !== best) player.target.mesh.scale.setScalar(1);
  player.target = best; if (best) best.mesh.scale.setScalar(1.3 + Math.sin(world.time * 8) * 0.08);
  $('crosshair').classList.toggle('lock', !!best);
}

// =====================================================================
// CAMERA
// =====================================================================
const ray = new THREE.Ray(), hitP = new V3();
function updateCamera(dt) {
  const tgt = player.pos.clone(); tgt.y += 1.7;
  cam.target.lerp(tgt, Math.min(1, dt * 18)); if (cam.target.distanceTo(tgt) > 6) cam.target.copy(tgt);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const dir = new V3(Math.sin(cam.yaw) * cp, sp, Math.cos(cam.yaw) * cp);
  let want = cam.dist + (player.state === 'GLIDE' ? 2.5 : 0);
  ray.set(cam.target, dir);
  for (const b of phys.boxes) {
    if (!b.enabled || b.box3.containsPoint(cam.target)) continue;
    if (ray.intersectBox(b.box3, hitP)) { const d = hitP.distanceTo(cam.target); if (d < want) want = Math.max(0.6, d - 0.35); }
  }
  cam.cur = want < cam.cur ? want : lerp(cam.cur, want, Math.min(1, dt * 3));
  camera.position.copy(cam.target).addScaledVector(dir, cam.cur);
  camera.lookAt(cam.target);
  const fov = player.state === 'GLIDE' || player.state === 'GRAPPLE' ? 78 : 70;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = lerp(camera.fov, fov, Math.min(1, dt * 4)); camera.updateProjectionMatrix(); }
}

// =====================================================================
// HUD UPDATE (per frame)
// =====================================================================
const stamArc = $('stamArc'), CIRC = 2 * Math.PI * 22; stamArc.setAttribute('stroke-dasharray', CIRC);
function updateHUD() {
  // stamina wheel near the character
  const s = toScreen(player.pos.clone().add(new V3(0, 1.2, 0)));
  const st = $('stamina');
  if (s) { st.style.left = (s.x + 70) + 'px'; st.style.top = (s.y - 30) + 'px'; }
  const f = player.stamina / CFG.STAMINA_MAX;
  stamArc.setAttribute('stroke-dashoffset', CIRC * (1 - f));
  stamArc.setAttribute('stroke', player.exhausted ? '#ff5252' : f < 0.3 ? '#ffb74d' : '#7CFC9A');
  st.style.opacity = (f < 0.999 || player.state === 'CLIMB' || player.state === 'GLIDE') ? 1 : 0;
  // region banner
  const t = player.pos.y > 74 ? 2 : player.pos.y > 30 ? 1 : 0;
  if (t !== ui.region && player.grounded) { ui.region = t; showRegion(t); }
  // scanner + labels
  const scan = game.scanning;
  for (const n of world.nodes.values()) {
    const el = nodeLabels.get(n.id), d = n.def;
    if (scan) {
      const need = RES.filter(k => d.req[k]).map(k => `${RES_ICON[k]}${n.cur[k]}/${d.req[k]}`).join(' ');
      el.style.setProperty('--c', n.restored ? '#b9f6ca' : hexStr(n.color));
      el.innerHTML = `<b>${TYPE_ICON[d.type]} ${d.name}</b><br>${n.restored ? 'RESTORED ✓' : `BROKEN · ${need} · 🔧${n.calib}/${CFG.CALIBRATIONS}`}<br><span style="opacity:.7">${Math.round(n.group.position.distanceTo(player.pos))}m</span>`;
    }
    place(el, n.group.position.clone().add(new V3(0, 4.5, 0)), scan);
  }
  world.pickups.forEach((p, i) => place(pickLabels[i], p.pos.clone().add(new V3(0, 1, 0)), scan && p.mesh.visible && p.pos.distanceTo(player.pos) < 70));
  for (const { th, el } of thermLabels) { el.textContent = th.active ? '⇧ THERMAL ⇧' : '⇡ dormant thermal'; place(el, new V3(th.x, Math.min(th.yMax, Math.max(th.yMin + 3, player.pos.y + 4)), th.z), scan); }
  for (const { a, el } of anchorLabels) { el.textContent = a.active ? '◎ anchor' : '◌ dormant sky-line'; place(el, a.pos.clone().add(new V3(0, 2.4, 0)), scan && a.pos.distanceTo(player.pos) < 90 && (a.active || a.group === 'skyline')); if (scan && !a.active) a.mesh.visible = true; else a.mesh.visible = a.active; }
  // remote name tags
  for (const r of game.remotes.values()) place(r.label, r.pos.clone().add(new V3(0, 2.5, 0)), r.pos.y > -50 && r.pos.distanceTo(camera.position) < 140);
  $('stateTag').textContent = `${player.state}${player.inThermal ? ' · THERMAL' : ''}${player.exhausted ? ' · EXHAUSTED' : ''} · ${player.pos.x.toFixed(0)}, ${player.pos.y.toFixed(0)}, ${player.pos.z.toFixed(0)}`;
}

// =====================================================================
// MAIN LOOP
// =====================================================================
let last = performance.now(), menuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(dt);
  renderer.render(scene, camera);
}
function simulate(dt) {
  world.scanning = game.scanning;
  world.update(dt, camera);
  if (game.playing) {
    if (pressed.has('KeyQ')) { game.scanning = !game.scanning; document.body.classList.toggle('scanning', game.scanning); }
    if (pressed.has('KeyH')) { ui.helpOn = !ui.helpOn; $('help').classList.toggle('hidden', !ui.helpOn); }
    if (pressed.has('Escape') && ui.mg) closeMinigame();
    updateMinigame(dt);
    const inp = readInput();
    player.update(dt, inp, cam.yaw);
    for (const ev of player.events.splice(0)) if (ev === 'respawn') game.toast('🍃 The wind spirits carried you back to safety.'); else if (ev === 'exhausted') game.toast('😮‍💨 Out of stamina! Rest on flat ground.');
    updateInteraction();
    updateCamera(dt);
    updateGrappleTarget();
    game.net.tick(dt);
    selfModel.group.position.copy(player.pos); selfModel.group.rotation.y = player.yaw;
    animateCharacter(selfModel, player.state, dt);
    rope.visible = player.state === 'GRAPPLE' && !!player.grapple;
    if (rope.visible) { const a = rope.geometry.attributes.position; a.setXYZ(0, player.pos.x, player.pos.y + 1.5, player.pos.z); a.setXYZ(1, player.grapple.a.pos.x, player.grapple.a.pos.y - 0.9, player.grapple.a.pos.z); a.needsUpdate = true; }
    updateHUD();
  } else {
    menuT += dt * 0.06;
    camera.position.set(Math.sin(menuT) * 95, 58 + Math.sin(menuT * 2) * 6, Math.cos(menuT) * 95);
    camera.lookAt(0, 40, 0);
  }
  pressed.clear();
  for (const r of game.remotes.values()) {
    r.pos.lerp(r.target, Math.min(1, dt * 12)); r.yaw = lerpAngle(r.yaw, r.tYaw, Math.min(1, dt * 12));
    r.model.group.position.copy(r.pos); r.model.group.rotation.y = r.yaw; animateCharacter(r.model, r.state, dt);
  }
  // sky / light respond to global restoration progress
  const gp = (world.vib[0] + world.vib[1] + world.vib[2]) / 3;
  skyMat.uniforms.top.value.lerpColors(SKY.topDull, SKY.top, gp); skyMat.uniforms.bottom.value.lerpColors(SKY.botDull, SKY.bot, gp);
  scene.fog.color.copy(skyMat.uniforms.bottom.value);
  hemi.intensity = 0.85 + gp * 0.5; sun.intensity = 2.0 + gp * 1.0;
  const focus = game.playing ? player.pos : new V3(0, 40, 0);
  sun.position.copy(focus).addScaledVector(SUN_DIR, 200); sun.target.position.copy(focus);
  sky.position.copy(camera.position); sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 900);
}
requestAnimationFrame(frame);

// =====================================================================
// MENU / SESSION START
// =====================================================================
let saved = {}; try { saved = JSON.parse(localStorage.getItem('canopy-spire') || '{}') || {}; } catch (_) {}
$('nameInput').value = typeof saved.name === 'string' ? safeName(saved.name) : '';
let chosenColor = PLAYER_COLORS.includes(saved.color) ? saved.color : PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
function renderSwatches() { $('swatches').innerHTML = PLAYER_COLORS.map(c => `<div class="sw${c === chosenColor ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join(''); }
renderSwatches();
$('swatches').addEventListener('click', e => { if (PLAYER_COLORS.includes(e.target.dataset.c)) { chosenColor = e.target.dataset.c; renderSwatches(); } });
if (!window.Peer) { $('btnHost').disabled = $('btnJoin').disabled = true; $('menuStatus').textContent = 'PeerJS could not load — multiplayer unavailable, solo still works.'; }
function setBusy(b) { for (const id of ['btnHost', 'btnJoin', 'btnSolo']) $(id).disabled = b || (id !== 'btnSolo' && !window.Peer); }
function beginPlay() {
  game.selfName = safeName($('nameInput').value); game.selfColor = safeColor(chosenColor);
  localStorage.setItem('canopy-spire', JSON.stringify({ name: game.selfName, color: game.selfColor }));
  scene.remove(selfModel.group); const nm = makeCharacter(game.selfColor); Object.assign(selfModel, nm); scene.add(selfModel.group);
}
function enterGame() {
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  game.playing = true; game.refreshRoomInfo(); renderObjectives(); renderInventory();
  cam.yaw = 0; cam.pitch = 0.25; cam.target.copy(player.pos);
  ui.helpOn = true; $('help').classList.remove('hidden'); setTimeout(() => { ui.helpOn = false; $('help').classList.add('hidden'); }, 14000);
  if (game.net.mode === 'host') { chatLine('', '', `Room <b>${game.net.code}</b> is open — share the code with up to ${CFG.MAX_PLAYERS - 1} friends.`, true); }
  chatLine('', '', 'Scan (Q) for broken nodes and resources. Restore all 7 to bring the Spire back to life.', true);
  lockPointer();
}
$('btnSolo').onclick = () => { beginPlay(); game.net.startSolo(); enterGame(); };
$('btnHost').onclick = async () => {
  beginPlay(); setBusy(true); $('menuStatus').textContent = 'Opening room…';
  try { const code = await game.net.host(); enterGame(); game.toast(`Room code: <b>${code}</b>`, true); }
  catch (e) { $('menuStatus').textContent = 'Could not host: ' + (e.type || e.message); setBusy(false); }
};
$('btnJoin').onclick = async () => {
  const code = $('codeInput').value.trim().toUpperCase(); if (!ROOM_RE.test(code)) { $('menuStatus').textContent = 'Enter the 5-character room code.'; return; }
  beginPlay(); setBusy(true); $('menuStatus').textContent = 'Joining ' + code + '…';
  try { await game.net.join(code); enterGame(); }
  catch (e) { $('menuStatus').textContent = e.message; setBusy(false); }
};
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
const qs = new URLSearchParams(location.search);
if (qs.get('room') && ROOM_RE.test(qs.get('room').toUpperCase())) $('codeInput').value = qs.get('room').toUpperCase();
if (qs.has('solo')) $('btnSolo').click();
game.cam = cam; game.simulate = simulate; game.keys = keys; game.pressed = pressed; window.__game = game; // debug handle (console tinkering / automated tests)
