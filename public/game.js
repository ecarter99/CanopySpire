import * as THREE from './vendor/three.module.js';
import { OutlineEffect } from './vendor/OutlineEffect.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import * as SkeletonUtils from './vendor/SkeletonUtils.js';
import RAPIER from './vendor/rapier3d-compat.mjs';
import { EffectComposer } from './vendor/EffectComposer.js';
import { Pass } from './vendor/Pass.js';
import { ShaderPass } from './vendor/ShaderPass.js';
import { UnrealBloomPass } from './vendor/UnrealBloomPass.js';
import { OutputPass } from './vendor/OutputPass.js';
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
  GRAPPLE_RANGE: 48, GRAPPLE_SPEED: 30, BOUNCE: 21,
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
const STATES = new Set(['IDLE', 'WALK', 'RUN', 'CLIMB', 'GLIDE', 'FALL', 'GRAPPLE', 'ZIP']);
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
// ---- Feature sites (shared by world building, gameplay and HUD) ----
const ZIPLINES = [ // sky-lines always run downhill from a to b
  { id: 'Z1', a: [28.5, 38.8, -28.5], b: [72, 7.5, -72], needs: null },
  { id: 'Z2', a: [-20, 38.8, -29.5], b: [-42, 7.5, -90], needs: null },
  { id: 'Z3', a: [13.5, 81, -13.5], b: [54, 61, -2], needs: 'apex_turbines' },
  { id: 'Z4', a: [-13.5, 81, 13.5], b: [-76, 7.5, 76], needs: 'apex_turbines' },
];
const BOUNCE_PADS = [ // [x, y, z, tier that must have a restored node (null = always)]
  [14, 0, 50, null], [-24, 0, 44, 0], [40, 0, 28, 0], [-20, 0, -45, 0], [-4, 36, -22, 1], [20, 36, 16, 1], [0, 78, -12.5, 2], [2016, 102, 9, null],
];
const RELICS = [
  { id: 'r1', p: [14, 8.6, 50], hint: 'Floating high above a bounce bloom by the south path' },
  { id: 'r2', p: [-35, 35.4, -27], hint: 'Atop the tallest western pillar' },
  { id: 'r3', p: [0, 1.2, 27.5], hint: 'Behind the great waterfall' },
  { id: 'r4', p: [-106, 1.2, 0], hint: 'Where the western road meets the sea' },
  { id: 'r5', p: [-20, 54.6, -20], hint: 'Just above a sky anchor over the gardens' },
  { id: 'r6', p: [55, 96, 18], hint: 'High in the tower thermal' },
  { id: 'r7', p: [60.6, 59.6, 5.6], hint: 'On the solar tower roof' },
  { id: 'r8', p: [8, 51.2, 8], hint: 'On the spire’s first setback ledge' },
  { id: 'r9', p: [4.8, 92.6, 0], hint: 'At the very top of the crown' },
  { id: 'r10', p: [11, 89.4, -11], hint: 'On top of a wind turbine' },
  { id: 'r11', zipEnd: 'Z4', hint: 'At the far end of the longest sky-line' },
  { id: 'r12', p: [-18, 42.6, -28.25], hint: 'On the hydroponic bay’s glass roof' },
];
const COURSES = [
  { id: 'drop', name: 'Canopy Drop', color: 0xffb300, needs: null, face: 'path',
    rings: [[24, 37.8, 32.5], [25, 36.9, 41.5], [27, 34.4, 50.5], [25, 31.7, 60], [19.5, 28.9, 68.5], [13, 26.1, 76.5], [10, 23.5, 85.5], [13, 20.9, 94.5], [19, 18.3, 102]] }, // tuned to the glide slope (~2.6 m drop per 9.5 m)
  { id: 'spiral', name: 'Thermal Spiral', color: 0xff7043, needs: 'basal_conduit', face: 'up',
    rings: [0, 1, 2, 3, 4].map(i => [-48 + Math.cos(i * Math.PI / 2) * 3, 6 + i * 10, 8 + Math.sin(i * Math.PI / 2) * 3]) },
];
const PLAZAS = { chimes: [-70, 0, 30], vault: [57, 0, -38], portals: [30, 0, -80, 22] };
const KEEPERS = [
  { id: 'mossa', name: 'Keeper Mossa', pos: [-8, 0, 60], face: Math.PI / 2, look: { o: 3, a: 1, s: 4, h: 5, hat: 3, g: 3 } },
  { id: 'brindle', name: 'Keeper Brindle', pos: [54, 0, -30], face: Math.PI, look: { o: 5, a: 7, s: 2, h: 4, hat: 6, g: 0 } },
  { id: 'aster', name: 'Keeper Aster', pos: [22, 0, -70], face: 0, look: { o: 4, a: 5, s: 1, h: 6, hat: 4, g: 4 } },
  { id: 'pip', name: 'Pip the Tinker', pos: [16, 0, 66], face: -Math.PI / 2, look: { o: 9, a: 6, s: 0, h: 4, hat: 6, g: 7 } },
  { id: 'fennel', name: 'Old Fennel', pos: [8, 36, -13], face: Math.PI, look: { o: 3, a: 0, s: 2, h: 5, hat: 1, g: 3 } },
  { id: 'juniper', name: 'Juniper the Courier', pos: [34, 0, -6], face: -Math.PI / 2, look: { o: 1, a: 1, s: 3, h: 2, hat: 2, g: 1 } },
  { id: 'skerry', name: 'Captain Skerry', pos: [8, 0, -2372], face: Math.PI, look: { o: 8, a: 0, s: 2, h: 5, hat: 0, g: 0 } },
  { id: 'luma', name: 'Luma the Moth-Scholar', pos: [1994, 0, 2236], face: Math.PI, look: { o: 4, a: 5, s: 5, h: 6, hat: 4, g: 4 } },
];
const REALMS = {
  sky: { c: [2000, 100, 0], spawn: [2000, 100.6, 35], name: 'Sky Archipelago', sub: 'Trial of Winds', r: 200, killY: 60 },
  grotto: { c: [-2000, 0, 0], spawn: [-2000, 0.6, 23], name: 'Crystal Grotto', sub: 'Trial of Light', r: 200, killY: -10 },
  lagoon: { c: [0, 0, -2400], spawn: [0, 0.6, -2365], name: 'Tidepool Lagoon', sub: 'Shells, sea-wind & a sunken temple', r: 200, killY: -3.5 },
  bloomwood: { c: [2000, 0, 2200], spawn: [2000, 0.6, 2240], name: 'Moonlit Bloomwood', sub: 'Where it is always night', r: 200, killY: -10 },
  thornwood: { c: [-2000, 200, 2200], spawn: [-2000, 200.6, 2228], name: 'Thornwood Hollow', sub: 'Home of the Thornheart', r: 200, killY: 160 },
};
const FEATURE_RESERVED = (() => { // keep houses & trees out of zipline corridors, pads and ring courses
  const r = [];
  for (const z of ZIPLINES) for (let t = 0.4; t <= 1.0001; t += 0.08) r.push([lerp(z.a[0], z.b[0], t), lerp(z.a[2], z.b[2], t), 6]);
  for (const p of BOUNCE_PADS) if (p[1] === 0) r.push([p[0], p[2], 3.5]);
  for (const q of COURSES[0].rings.slice(2)) r.push([q[0], q[2], 7]);
  r.push([-106, 0, 4]);
  for (const p of Object.values(PLAZAS)) r.push([p[0], p[2], p[3] || 14]);
  r.push([39, -9, 6], [8, 96, 5]); // sprout sites
  for (const k of KEEPERS) r.push([k.pos[0], k.pos[2], 3]);
  return r;
})();
const isMsg = m => m !== null && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string';

// =====================================================================
// MATERIALS & TEXTURES (cel-shaded toon + per-tier "dull → vibrant" colour shift)
// =====================================================================
const GRAD = (() => { // painterly ramp: soft, slightly banded light falloff (linear filtering between 6 steps)
  const v = [92, 112, 160, 210, 242, 255], d = new Uint8Array(v.flatMap(x => [x, x, x, 255]));
  const t = new THREE.DataTexture(d, v.length, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
})();
// Warm rim light on every toon material: edges facing away from the camera catch the key light's colour
// (scaled by the sun, so it fades at night and goes golden at sunset).
THREE.ShaderLib.toon.fragmentShader = THREE.ShaderLib.toon.fragmentShader.replace('#include <opaque_fragment>', `
  #if NUM_DIR_LIGHTS > 0
  { vec3 vd = normalize( vViewPosition ); float rim = pow( 1.0 - clamp( dot( normal, vd ), 0.0, 1.0 ), 3.0 );
    float side = 0.35 + 0.65 * clamp( dot( normal, directionalLights[ 0 ].direction ) + 0.6, 0.0, 1.0 );
    outgoingLight += rim * side * directionalLights[ 0 ].color * ( 0.12 + 0.18 * diffuseColor.rgb ); }
  #endif
  #include <opaque_fragment>`);
const noOutline = m => { m.userData.outlineParameters = { visible: false }; return m; };
// Procedural, tileable greyscale detail textures (tinted by material colour). `world` = metres per tile.
function canvasTex(world, size, draw, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  draw(g, size, mulberry32(seed));
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.userData.world = world; return t;
}
const shade = v => `rgb(${v | 0},${v | 0},${v | 0})`;
function speckle(g, S, r, n, a) { for (let i = 0; i < n; i++) { g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 1.4})`; const s = 1 + r() * 2.5; g.fillRect(r() * S, r() * S, s, s); } }
function blotches(g, S, r, n, a, rmin, rmax) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rad = rmin + r() * (rmax - rmin), dark = r() < 0.55;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { // wrap so tiles stay seamless
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
}
const TEX = {
  stone: canvasTex(4, 512, (g, S, r) => { // ashlar blocks 2m x 1m
    g.fillStyle = shade(190); g.fillRect(0, 0, S, S);
    const rows = 4, bh = S / rows, n = 2, bw = S / n;
    for (let row = 0; row < rows; row++) {
      const off = (row % 2) * 0.5, tones = [226 + r() * 28, 226 + r() * 28];
      for (let i = -1; i <= n; i++) {
        const x = (i + off) * bw, tone = tones[((i % n) + n) % n];
        g.fillStyle = shade(tone); g.fillRect(x + 5, row * bh + 5, bw - 10, bh - 10);
        g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 5, row * bh + 5, bw - 10, 6);
        g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + 5, row * bh + bh - 11, bw - 10, 6);
      }
    }
    speckle(g, S, r, 3000, 0.05);
  }, 11),
  plaster: canvasTex(6, 512, (g, S, r) => { g.fillStyle = shade(242); g.fillRect(0, 0, S, S); blotches(g, S, r, 60, 0.06, 20, 110); speckle(g, S, r, 3500, 0.035); }, 12),
  wood: canvasTex(3, 512, (g, S, r) => {
    const rows = 6, ph = S / rows;
    for (let i = 0; i < rows; i++) {
      g.fillStyle = shade(205 + r() * 40); g.fillRect(0, i * ph, S, ph);
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) { const y = i * ph + 6 + r() * (ph - 12); g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + k) * 2.5); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, i * ph, S, 3); const ex = r() * S; g.fillRect(ex, i * ph, 3, ph);
    }
  }, 13),
  grass: canvasTex(12, 512, (g, S, r) => { g.fillStyle = shade(228); g.fillRect(0, 0, S, S); blotches(g, S, r, 140, 0.13, 15, 70); speckle(g, S, r, 6000, 0.06); }, 14),
  tile: canvasTex(4, 512, (g, S, r) => { // paving, 1m tiles
    g.fillStyle = shade(186); g.fillRect(0, 0, S, S); const n = 4, ts = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = shade(222 + r() * 30); g.fillRect(i * ts + 4, j * ts + 4, ts - 8, ts - 8); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(i * ts + 4, j * ts + 4, ts - 8, 4); }
    speckle(g, S, r, 2500, 0.05);
  }, 15),
  roof: canvasTex(2, 256, (g, S, r) => { // scalloped clay tiles
    g.fillStyle = shade(150); g.fillRect(0, 0, S, S); const rows = 6, rh = S / rows, cols = 4, cw = S / cols;
    for (let row = rows; row >= -1; row--) for (let c = -1; c <= cols; c++) {
      const x = c * cw + (row % 2 ? cw / 2 : 0), y = row * rh;
      g.fillStyle = shade(212 + r() * 36); g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + cw - 2, y); g.lineTo(x + cw - 2, y + rh * 0.55); g.arc(x + cw / 2, y + rh * 0.55, cw / 2 - 2, 0, Math.PI); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 2, y, cw - 4, 3);
    }
  }, 16),
  stripes: canvasTex(1.2, 128, (g, S) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? shade(255) : shade(178); g.fillRect(i * S / 4, 0, S / 4, S); } }, 17),
};

// ---------- Canopy Spire emblem (spire rising from two unfurling leaves, halo at the top) on a pointed teal banner ----------
const EMBLEM_TEX = (() => {
  const W = 256, H = 640, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const body = () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 548); g.lineTo(W / 2, 636); g.lineTo(0, 548); g.closePath(); };
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#3a8f92'); grad.addColorStop(1, '#25666d');
  body(); g.fillStyle = grad; g.fill();
  g.save(); body(); g.clip();                                                    // woven cloth: faint vertical threads
  for (let x = 0; x < W; x += 3) { g.fillStyle = `rgba(255,255,255,${0.02 + 0.03 * ((x * 7) % 5) / 5})`; g.fillRect(x, 0, 1, H); }
  g.restore();
  const cream = '#efe1bd';
  g.strokeStyle = cream; g.globalAlpha = 0.55; g.lineWidth = 3; g.setLineDash([9, 7]);   // stitched border
  g.beginPath(); g.moveTo(16, 0); g.lineTo(16, 540); g.lineTo(W / 2, 612); g.lineTo(W - 16, 540); g.lineTo(W - 16, 0); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1; g.fillStyle = cream; g.fillRect(0, 34, W, 7);    // hanging hem
  g.fillStyle = cream; g.strokeStyle = cream;
  g.lineWidth = 7; g.beginPath(); g.ellipse(W / 2, 150, 34, 10, 0, 0, Math.PI * 2); g.stroke();   // halo
  g.beginPath(); g.moveTo(W / 2, 128); g.lineTo(W / 2 + 15, 230); g.lineTo(W / 2 + 22, 392); g.lineTo(W / 2 - 22, 392); g.lineTo(W / 2 - 15, 230); g.closePath(); g.fill();   // spire
  g.fillStyle = '#2f7f84'; for (const y of [215, 262, 309, 350]) g.fillRect(W / 2 - 4, y, 8, 16);                          // windows
  g.fillStyle = cream;
  for (const s of [-1, 1]) {                                                                         // leaves curling outwards
    g.beginPath(); g.moveTo(W / 2 + s * 6, 418); g.quadraticCurveTo(W / 2 + s * 92, 432, W / 2 + s * 98, 318); g.quadraticCurveTo(W / 2 + s * 40, 336, W / 2 + s * 6, 418); g.fill();
    g.strokeStyle = '#2f7f84'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2 + s * 12, 410); g.quadraticCurveTo(W / 2 + s * 60, 392, W / 2 + s * 92, 326); g.stroke(); g.strokeStyle = cream;
  }
  g.lineWidth = 6; g.beginPath(); g.moveTo(W / 2, 392); g.lineTo(W / 2, 470); g.stroke();
  g.beginPath(); g.moveTo(W / 2, 478); g.lineTo(W / 2 + 12, 494); g.lineTo(W / 2, 510); g.lineTo(W / 2 - 12, 494); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
})();
const BANNER_U = { uTime: { value: 0 } };
const bannerMat = (() => { // cloth that sways in the wind (amplitude grows towards the free bottom edge)
  const m = new THREE.MeshToonMaterial({ map: EMBLEM_TEX, side: THREE.DoubleSide, alphaTest: 0.5, gradientMap: GRAD });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = BANNER_U.uTime;
    sh.vertexShader = 'uniform float uTime; attribute float aSway; attribute float aPhase;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed += normal * (sin(uTime * 1.5 + aPhase + position.y * 0.8) * 0.16 + sin(uTime * 3.1 + aPhase * 1.7 + position.x * 1.9 + position.z * 1.9) * 0.05) * aSway;
      transformed.y += abs(sin(uTime * 1.5 + aPhase)) * 0.04 * aSway;`);
  };
  m.userData.outlineParameters = { visible: false }; return m;
})();
const matCache = new Map();
function toon(hex, opts = {}) {
  const key = 'v' + hex + JSON.stringify(opts, (k, v) => (v && v.isTexture) ? v.uuid : v);
  if (!opts.unique && matCache.has(key)) return matCache.get(key);
  const o = { ...opts }; delete o.unique; delete o.noOutline;
  const m = new THREE.MeshToonMaterial({ color: hex, gradientMap: GRAD, ...o });
  if (opts.noOutline) noOutline(m);
  if (!opts.unique) matCache.set(key, m);
  return m;
}
const tierMats = [[], [], [], []]; // index 3 = portal realms (always vibrant)
function tmat(tier, hex, tex) {
  const key = 't' + tier + ':' + hex + ':' + (tex ? tex.uuid : '');
  if (matCache.has(key)) return matCache.get(key);
  const vib = new THREE.Color(hex); const hsl = {}; vib.getHSL(hsl, THREE.SRGBColorSpace);
  const dull = new THREE.Color().setHSL(hsl.h, hsl.s * 0.16, hsl.l * 0.72 + 0.1, THREE.SRGBColorSpace);
  const m = new THREE.MeshToonMaterial({ color: dull.clone(), gradientMap: GRAD, map: tex || null });
  m.userData.vib = vib; m.userData.dull = dull;
  if (tier >= 3) m.color.copy(vib); tierMats[tier].push(m); matCache.set(key, m);
  return m;
}
const PAL = {
  grass: 0x9ad65f, grassDeep: 0x5fb84a, stone: 0xf3ead6, sand: 0xf0dcb4, terra: 0xe07a4f, teal: 0x3cc9b5,
  wood: 0xb07d4a, leaf: 0x4caf50, leaf2: 0x8bd34a, leaf3: 0x2e9e5b, blossom: 0xff8fb1, flower: 0xffd54f,
  brass: 0xd9a441, glass: 0x8fdde6, slate: 0x8a99a6, soil: 0x7b5233, metal: 0x4f6360,
};
const facet = g => { g.computeVertexNormals(); return g; }; // non-indexed polyhedra → flat facet normals
const ICO = facet(new THREE.IcosahedronGeometry(1, 0));
const ICO1 = new THREE.IcosahedronGeometry(1, 1);       // smooth-shaded blobs (foliage, clouds)
const nonIdx = g => g.index ? g.toNonIndexed() : g;
const mergeNI = list => mergeGeometries(list.map(nonIdx), false);
function scaleUV(g, su, sv = su) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
// Rounded/bevelled box whose UVs are in world units so detail textures tile at a consistent scale.
function boxGeo(w, h, d, world, radius = 0.14) {
  const r = Math.min(radius, Math.min(w, h, d) * 0.3);
  const g = r >= 0.03 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (world) {
    const uv = g.attributes.uv, per = uv.count / 6, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) { const [su, sv] = dims[f]; for (let i = f * per; i < (f + 1) * per; i++) uv.setXY(i, uv.getX(i) * su / world, uv.getY(i) * sv / world); }
  }
  return g;
}
function cylGeo(rt, rb, h, seg = 12, tex, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  if (tex) scaleUV(g, Math.PI * (rt + rb) / tex.userData.world, h / tex.userData.world);
  return g;
}
function rockGeo(rad, seed) {
  const g = new THREE.DodecahedronGeometry(rad, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { // jitter by position hash so shared corners stay welded
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453, n = (h - Math.floor(h)) * 0.28 + 0.86;
    p.setXYZ(i, x * n, y * n * 0.75, z * n);
  }
  g.computeVertexNormals(); return g;
}
function waterTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, '#46b6ec'); gr.addColorStop(0.5, '#5ccdf7'); gr.addColorStop(1, '#46b6ec'); g.fillStyle = gr; g.fillRect(0, 0, 128, 512);
  const r = mulberry32(7);
  for (let i = 0; i < 220; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(190,245,255,0.65)'; g.fillRect(r() * 128, r() * 512, 1 + r() * 3, 14 + r() * 70); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const WATER_TEX = waterTexture();
const DOT_TEX = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
// Shared animated uniforms: grass wind + height, flower "bloom" growth per tier.
const GRASS_U = { time: { value: 0 }, vib: [{ value: 0.12 }, { value: 0.12 }, { value: 0.12 }] };
const BLOOM_U = [{ value: 0 }, { value: 0 }, { value: 0 }, { value: 1 }];
function grassMat(tier, hex) {
  const vib = new THREE.Color(hex), hsl = {}; vib.getHSL(hsl, THREE.SRGBColorSpace);
  const dull = new THREE.Color().setHSL(hsl.h * 0.6 + 0.03, hsl.s * 0.35, hsl.l * 0.78 + 0.08, THREE.SRGBColorSpace);
  const m = new THREE.MeshToonMaterial({ color: tier < 0 ? vib.clone() : dull.clone(), gradientMap: GRAD, side: THREE.DoubleSide });
  m.userData.vib = vib; m.userData.dull = dull; if (tier >= 0) tierMats[tier].push(m); noOutline(m);
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = GRASS_U.time; sh.uniforms.uVib = tier < 0 ? { value: 1 } : GRASS_U.vib[tier];
    sh.vertexShader = 'uniform float uTime; uniform float uVib; varying float vH;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vH = position.y;
      transformed.y *= mix(0.45, 1.0, uVib);
      vec3 ip = vec3(0.0);
      #ifdef USE_INSTANCING
        ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #endif
      float sway = sin(uTime * 1.7 + ip.x * 0.32 + ip.z * 0.21) * 0.6 + sin(uTime * 3.3 + ip.x * 0.9 - ip.z * 0.4) * 0.25;
      transformed.x += sway * 0.22 * position.y * position.y;
      transformed.z += sway * 0.1 * position.y * position.y;`);
    sh.fragmentShader = 'varying float vH;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.62, 1.1, clamp(vH, 0.0, 1.0));');
  };
  m.customProgramCacheKey = () => 'grass-v1';
  return m;
}
const GRASS_T = 64; // side of the player-following grass tile (m)
GRASS_U.cam = { value: new THREE.Vector3() };
function followGrassMat(hex, maskTex) {
  const m = grassMat(0, hex);
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = GRASS_U.time; sh.uniforms.uVib = GRASS_U.vib[0]; sh.uniforms.uCam = GRASS_U.cam; sh.uniforms.uMask = { value: maskTex };
    sh.vertexShader = `uniform float uTime; uniform float uVib; uniform vec3 uCam; uniform sampler2D uMask; attribute vec4 aOff; varying float vH;\n` + sh.vertexShader.replace('#include <begin_vertex>', `
      vH = position.y;
      vec2 wxz = uCam.xz + mod(aOff.xy - uCam.xz, ${GRASS_T.toFixed(1)}) - ${(GRASS_T * 0.5).toFixed(1)};
      float msk = texture2D(uMask, (wxz + 110.0) / 220.0).r;
      float fade = 1.0 - smoothstep(${(GRASS_T * 0.3).toFixed(1)}, ${(GRASS_T * 0.5).toFixed(1)}, length(wxz - uCam.xz));
      float sc = aOff.w * msk * fade;
      vec3 p = position * sc; p.y *= mix(0.45, 1.0, uVib) * (0.7 + 0.6 * msk);
      float c = cos(aOff.z), sn = sin(aOff.z);
      p = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
      float sway = sin(uTime * 1.7 + wxz.x * 0.32 + wxz.y * 0.21) * 0.6 + sin(uTime * 3.3 + wxz.x * 0.9 - wxz.y * 0.4) * 0.25;
      p.x += sway * 0.2 * vH * vH * sc; p.z += sway * 0.09 * vH * vH * sc;
      vec3 transformed = vec3(wxz.x, 0.0, wxz.y) + p;`);
    sh.fragmentShader = 'varying float vH;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.62, 1.1, clamp(vH, 0.0, 1.0));');
  };
  m.customProgramCacheKey = () => 'follow-grass-v1';
  return m;
}
function bloomMat(tier) {
  const m = new THREE.MeshToonMaterial({ gradientMap: GRAD, vertexColors: true, side: THREE.DoubleSide }); noOutline(m);
  m.onBeforeCompile = sh => {
    sh.uniforms.uBloom = BLOOM_U[tier];
    sh.vertexShader = 'uniform float uBloom; attribute vec3 aCenter;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = aCenter + (transformed - aCenter) * uBloom;');
  };
  m.customProgramCacheKey = () => 'bloom-v1';
  return m;
}
// One grass tuft = 3 tapered, slightly curved blades (normals up for soft, even lighting).
const TUFT_GEO = (() => {
  const blades = [];
  for (let b = 0; b < 4; b++) {
    const w = 0.065, h = 0.6 + (b % 2) * 0.2 + b * 0.04, g = new THREE.BufferGeometry();
    const pos = [-w, 0, 0, w, 0, 0, -w * 0.7, h * 0.5, 0.05, w * 0.7, h * 0.5, 0.05, 0, h, 0.16];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1], 2));
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    g.rotateY(b * 1.57 + 0.3); g.translate(Math.cos(b * 1.57) * 0.09, 0, Math.sin(b * 1.57) * 0.09); blades.push(g.toNonIndexed());
  }
  return mergeGeometries(blades, false);
})();
// =====================================================================
// PHYSICS — custom AABB world (axis-aligned, self-contained)
// =====================================================================
class Physics {
  // Static AABBs drive the player controller; each one is mirrored as a fixed Rapier collider so
  // dynamic bodies (crates, seed-stones) collide with the same world. `dynBoxes` are moving AABB
  // proxies of those bodies, so players can stand on, bump into and push them.
  constructor() { this.boxes = []; this.dynBoxes = []; this.rw = new RAPIER.World({ x: 0, y: -CFG.GRAVITY, z: 0 }); }
  add(x0, y0, z0, x1, y1, z1, tag) {
    const min = new V3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const max = new V3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    const b = { min, max, enabled: true, tag, box3: new THREE.Box3(min, max) };
    const hx = Math.max(0.005, (max.x - min.x) / 2), hy = Math.max(0.005, (max.y - min.y) / 2), hz = Math.max(0.005, (max.z - min.z) / 2);
    b.col = this.rw.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(min.x + hx, min.y + hy, min.z + hz)); b.colOn = true;
    this.boxes.push(b); return b;
  }
  addDyn(tag) { const min = new V3(), max = new V3(); const b = { min, max, enabled: true, tag, box3: new THREE.Box3(min, max), dyn: null }; this.boxes.push(b); this.dynBoxes.push(b); return b; }
  syncColliders() { for (const b of this.boxes) if (b.col && b.colOn !== b.enabled) { b.colOn = b.enabled; b.col.setEnabled(b.enabled); } } // `enabled` is toggled directly all over the game
  ov(p, b) {
    const { HX, H } = CFG;
    return p.x + HX > b.min.x && p.x - HX < b.max.x && p.y + H > b.min.y && p.y < b.max.y && p.z + HX > b.min.z && p.z - HX < b.max.z;
  }
  overlapAt(p) { for (const b of this.boxes) if (b.enabled && this.ov(p, b)) return b; return null; }
  overlapAll(p) { const r = []; for (const b of this.boxes) if (b.enabled && this.ov(p, b)) r.push(b); return r; }
  pointInside(p) { for (const b of this.boxes) if (b.enabled && p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return true; return false; }
  surfaceBox(x, z, maxY) {
    let best = null;
    for (const b of this.boxes) if (b.enabled && x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y <= maxY && (!best || b.max.y > best.max.y)) best = b;
    return best;
  }
  surfaceY(x, z, maxY) {
    let top = null;
    for (const b of this.boxes) if (b.enabled && x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y <= maxY && (top === null || b.max.y > top)) top = b.max.y;
    return top;
  }
  move(p, d, stepUp) {
    const res = { ground: false, ceil: false, hitX: false, hitZ: false, dyn: null };
    for (const b of this.dynBoxes) b.skip = b.enabled && this.ov(p, b); // already inside a moving body: let the player walk out instead of popping
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
      if (!b.enabled || b.skip || !this.ov(p, b)) continue;
      const rise = b.max.y - p.y;
      if (stepUp && rise > 0 && rise <= CFG.STEP) { const oy = p.y; p.y = b.max.y + 0.001; if (!this.overlapAt(p)) continue; p.y = oy; }
      p[ax] = s > 0 ? b.min[ax] - CFG.HX - 0.001 : b.max[ax] + CFG.HX + 0.001;
      if (ax === 'x') res.hitX = true; else res.hitZ = true;
      if (b.dyn) res.dyn = b.dyn;
    }
  }
  resolveV(p, s, res) {
    for (const b of this.boxes) {
      if (!b.enabled || b.skip || !this.ov(p, b)) continue;
      if (s < 0) { p.y = b.max.y; res.ground = true; res.groundBox = b; } else { p.y = b.min.y - CFG.H - 0.001; res.ceil = true; }
    }
  }
}

// =====================================================================
// CHARACTER MODEL + CUSTOMIZATION (procedural, same rig for self & remotes)
// =====================================================================
const LOOK_OPTS = {
  outfit: ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#20c997', '#f06595', '#5c7cfa', '#868e96'],
  accent: ['#ffffff', '#ffe066', '#ff8787', '#74c0fc', '#8ce99a', '#e599f7', '#ffa94d', '#343a40'],
  skin: ['#ffe3cc', '#f6cba8', '#e2ac84', '#c68863', '#8d5a3b', '#5c3a24'],
  hair: ['#2b1d14', '#5a3825', '#a0522d', '#e8c872', '#d9480f', '#f1f3f5', '#7048e8', '#2f9e44'],
  hat: ['None', 'Straw hat', 'Cap', 'Flower crown', 'Hood', 'Beanie', 'Goggles', 'Leaf crown', 'Sprout', 'Keeper circlet', 'Captain hat'],
  glider: ['#ff7043', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#f8f9fa', '#e64980', '#343a40', 'rainbow', 'gold', 'starlight', 'heartwood'],
};
const LOOK_KEYS = [['o', 'outfit', 'Outfit'], ['a', 'accent', 'Accent'], ['s', 'skin', 'Skin'], ['h', 'hair', 'Hair'], ['hat', 'hat', 'Hat'], ['g', 'glider', 'Glider']];
const DEFAULT_LOOK = { o: 0, a: 0, s: 1, h: 1, hat: 1, g: 0 };
function safeLook(l) {
  const r = { ...DEFAULT_LOOK };
  if (l && typeof l === 'object') for (const [k, arr] of LOOK_KEYS) { const v = l[k]; if (Number.isInteger(v) && v >= 0 && v < LOOK_OPTS[arr].length) r[k] = v; }
  return r;
}
const lookColor = l => LOOK_OPTS.outfit[safeLook(l).o];
function makeCharacterAsset(lookIn) {
  const L = safeLook(lookIn), gl = ASSETS.character, model = SkeletonUtils.clone(gl.scene), g = new THREE.Group(); g.add(model);
  const col = { Outfit: LOOK_OPTS.outfit[L.o], Accent: LOOK_OPTS.accent[L.a], Skin: LOOK_OPTS.skin[L.s], Hair: LOOK_OPTS.hair[L.h], Pants: '#6b6447', Boots: '#4f3522', Brown: '#6e4a2c' };
  const gv = LOOK_OPTS.glider[L.g], ds = { side: THREE.DoubleSide };
  model.traverse(o => {
    if (!o.isMesh) return;
    const n = o.material.name; let m;
    if (n === 'GliderCanopy') {
      if (gv === 'rainbow') { o.geometry = o.geometry.clone(); const p = o.geometry.attributes.position, c = new Float32Array(p.count * 3), cc = new THREE.Color(); for (let i = 0; i < p.count; i++) { cc.setHSL((p.getX(i) / 1.35 + 1) / 2 * 0.8, 0.85, 0.6, THREE.SRGBColorSpace); c.set([cc.r, cc.g, cc.b], i * 3); } o.geometry.setAttribute('color', new THREE.BufferAttribute(c, 3)); m = toon(0xffffff, { ...ds, vertexColors: true }); }
      else if (gv === 'gold') m = toon(0xffcf40, { ...ds, emissive: 0x8a6000, emissiveIntensity: 0.35 });
      else if (gv === 'starlight') m = toon(0x26346e, { ...ds, emissive: 0x5b6fe0, emissiveIntensity: 0.45 });
      else if (gv === 'heartwood') m = toon(0x7a5232, { ...ds, map: TEX.wood });
      else m = toon(new THREE.Color(gv).getHex(), ds);
    } else if (n === 'GliderStripe') m = toon(new THREE.Color(col.Accent).getHex(), ds);
    else if (n === 'Glow') m = toon(0x9ff8ff, { emissive: 0x3fd8e8, emissiveIntensity: 1.1 }); // wrist compass
    else m = toon(col[n] ? new THREE.Color(col[n]).getHex() : o.material.color.getHex());
    if (n === 'Hair' || n === 'Brow' || n === 'Iris' || n === 'Eye' || n === 'White') { m = m.clone(); m.userData.outlineParameters = { thickness: n === 'Hair' ? 0.0011 : 0.0004, alpha: 0.6 }; } // finer ink on hair & face
    o.material = m; o.castShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false;
  });
  const hatName = 'Hat_' + LOOK_OPTS.hat[L.hat].replace(/ /g, '_');
  model.traverse(o => { if (o.name.startsWith('Hat_') && !(o.parent && o.parent.name.startsWith('Hat_'))) o.visible = o.name === hatName; }); // toggle whole hats, not their sub-meshes
  const glider = model.getObjectByName('Glider'); glider.visible = false;
  const handR = model.getObjectByName('hand_R'), handL = model.getObjectByName('hand_L');
  const mixer = new THREE.AnimationMixer(model), actions = {}; for (const c of gl.animations) actions[c.name] = mixer.clipAction(c);
  actions.Idle.play();
  const springs = [['pack', 0.009, 0.006, 70, 0.35, 0.35], ['hair', 0.012, 0.01, 55, 0.3, 0.5], ['hood', 0.008, 0.006, 80, 0.4, 0.3]] // bone, kFwd, kSide, stiffness, damping, limit
    .map(([n, kf, ks, k, d, lim]) => ({ b: model.getObjectByName(n), kf, ks, k, d, lim, x: 0, vx: 0, z: 0, vz: 0, prev: null, vel: new V3() })).filter(sp => sp.b);
  return { group: g, root: model, legs: [], arms: [handR, handL], handBone: handR, glider, mixer, actions, cur: 'Idle', t: Math.random() * 10,
    springs, lean: { x: 0, z: 0 }, prevP: null, vel: new V3(), squash: 0, prevState: 'IDLE' };
}
const CLIP_FOR = { IDLE: 'Idle', WALK: 'Walk', RUN: 'Run', CLIMB: 'Climb', GLIDE: 'Glide', FALL: 'Fall', GRAPPLE: 'Grapple', ZIP: 'Zip' }, EMOTE_CLIP = [null, 'Wave', 'Cheer', 'Dance', 'Sit'];
function animateAsset(c, state, dt, emote) {
  let clip = CLIP_FOR[state] || 'Idle';
  if (state === 'IDLE' && emote) clip = EMOTE_CLIP[emote];
  else if (state === 'IDLE' && c.holding) clip = 'Hold';
  if (c.showGlider) clip = 'Glide';
  if (clip !== c.cur && c.actions[clip]) { const next = c.actions[clip], prev = c.actions[c.cur]; next.reset().fadeIn(0.18).play(); if (prev) prev.fadeOut(0.18); c.cur = clip; }
  c.mixer.update(dt); c.glider.visible = state === 'GLIDE' || c.showGlider === true;
  if (dt > 0) bodyLanguage(c, state, dt);
}
// Procedural layer on top of the clips: lean into turns/acceleration, bank while gliding, squash on landing,
// and damped springs on hair / hood / pack so they swing with the character's real motion.
const _bl = { v: new V3(), a: new V3(), w: new V3() };
function bodyLanguage(c, state, dt) {
  dt = Math.min(dt, 0.05);
  const P = c.group.position;
  if (!c.prevP) c.prevP = P.clone();
  const v = _bl.v.copy(P).sub(c.prevP).divideScalar(dt); c.prevP.copy(P);
  if (v.lengthSq() > 40 * 40) v.copy(c.vel);                       // teleport / respawn: ignore
  const a = _bl.a.copy(v).sub(c.vel).divideScalar(dt); c.vel.lerp(v, Math.min(1, dt * 10));
  const yaw = c.group.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw);   // model faces +Z; its right is −X
  const aF = a.x * fx + a.z * fz, aR = -a.x * fz + a.z * fx, sp = Math.hypot(c.vel.x, c.vel.z);
  // lean: forward into acceleration, sideways into turns (centripetal), stronger when banking a glider
  const moving = state === 'WALK' || state === 'RUN', glide = state === 'GLIDE';
  const tx = moving ? clamp(aF * 0.012, -0.12, 0.16) : glide ? 0.05 : 0;
  const tz = moving ? clamp(aR * 0.01 * Math.min(1, sp / 6), -0.2, 0.2) : glide ? clamp(aR * 0.03, -0.45, 0.45) : 0;
  const k = Math.min(1, dt * 7); c.lean.x = lerp(c.lean.x, tx, k); c.lean.z = lerp(c.lean.z, tz, k);
  c.root.rotation.x = c.lean.x; c.root.rotation.z = c.lean.z;
  // squash & stretch on landing (subtle)
  const was = c.prevState; c.prevState = state;
  if ((was === 'FALL' || was === 'GLIDE') && (state === 'IDLE' || moving) && c.vel.y < -5) c.squash = Math.min(1, -c.vel.y / 22);
  c.squash = Math.max(0, c.squash - dt * 4);
  const q = Math.sin(c.squash * Math.PI) * 0.09; c.root.scale.set(1 + q * 0.6, 1 - q, 1 + q * 0.6);
  // springs (the clips key these bones to rest, so offsets are added after the mixer)
  for (const S of c.springs) {
    S.b.getWorldPosition(_bl.w);
    if (!S.prev) S.prev = _bl.w.clone();
    const bv = _bl.v.copy(_bl.w).sub(S.prev).divideScalar(dt); S.prev.copy(_bl.w);
    if (bv.lengthSq() > 40 * 40) bv.copy(S.vel);
    const ba = _bl.a.copy(bv).sub(S.vel).divideScalar(dt); S.vel.copy(bv);
    const bF = ba.x * fx + ba.z * fz, bR = -ba.x * fz + ba.z * fx;
    const gx = clamp(bF * S.kf + Math.max(0, -ba.y) * S.kf * 0.4, -S.lim, S.lim), gz = clamp(-bR * S.ks, -S.lim, S.lim);
    const damp = 2 * Math.sqrt(S.k) * S.d;
    S.vx += (S.k * (gx - S.x) - damp * S.vx) * dt; S.x += S.vx * dt;
    S.vz += (S.k * (gz - S.z) - damp * S.vz) * dt; S.z += S.vz * dt;
    S.x = clamp(S.x, -S.lim * 1.5, S.lim * 1.5); S.z = clamp(S.z, -S.lim * 1.5, S.lim * 1.5);
    S.b.rotation.x += S.x; S.b.rotation.z += S.z;
  }
}
function makeCharacter(lookIn) {
  if (ASSETS.character) return makeCharacterAsset(lookIn);
  const L = safeLook(lookIn), hx = (k, i) => new THREE.Color(LOOK_OPTS[k][i]).getHex();
  const outfit = hx('outfit', L.o), accent = hx('accent', L.a), skin = hx('skin', L.s), hair = hx('hair', L.h), gv = LOOK_OPTS.glider[L.g];
  const g = new THREE.Group(), root = new THREE.Group(); g.add(root);
  const add = (geo, mat, x, y, z, parent = root, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m; };
  const mOut = toon(outfit), mAcc = toon(accent), mSkin = toon(skin), mHair = toon(hair), mDark = toon(0x2b2f36), mBrown = toon(0x7a5232), mPants = toon(0x3d4a5c);
  // torso & tunic
  add(new THREE.CapsuleGeometry(0.26, 0.4, 6, 16), mOut, 0, 1.03, 0);
  add(new THREE.CylinderGeometry(0.27, 0.36, 0.32, 16), mOut, 0, 0.78, 0);
  add(new THREE.TorusGeometry(0.275, 0.045, 6, 20), mBrown, 0, 0.88, 0, g, Math.PI / 2);
  add(new THREE.SphereGeometry(0.05, 8, 6), toon(PAL.brass), 0, 0.88, 0.29);
  // scarf
  add(new THREE.TorusGeometry(0.19, 0.075, 8, 18), mAcc, 0, 1.36, 0, g, Math.PI / 2);
  add(new RoundedBoxGeometry(0.12, 0.32, 0.05, 2, 0.02), mAcc, 0.1, 1.2, -0.2, g, 0.25, 0, 0.15);
  // head & face
  add(new THREE.SphereGeometry(0.26, 24, 18), mSkin, 0, 1.63, 0);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.042, 10, 8), mDark, s * 0.09, 1.66, 0.225);
    add(new THREE.SphereGeometry(0.014, 6, 4), toon(0xffffff), s * 0.08, 1.675, 0.262);
    add(new THREE.CircleGeometry(0.038, 12), toon(0xff9aa8, { side: THREE.DoubleSide }), s * 0.155, 1.585, 0.205, g, 0, s * 0.62, 0);
  }
  add(new THREE.SphereGeometry(0.03, 8, 6), toon(new THREE.Color(skin).multiplyScalar(0.92).getHex()), 0, 1.6, 0.255);
  // hair cap + fringe
  add(new THREE.SphereGeometry(0.275, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), mHair, 0, 1.655, -0.02, g, -0.32);
  add(new THREE.SphereGeometry(0.1, 10, 8), mHair, -0.1, 1.82, 0.16, g, 0, 0, 0.4).scale.set(1.2, 0.55, 0.7);
  add(new THREE.SphereGeometry(0.1, 10, 8), mHair, 0.09, 1.83, 0.17, g, 0, 0, -0.3).scale.set(1.1, 0.5, 0.7);
  // hat
  const hat = LOOK_OPTS.hat[L.hat];
  if (hat === 'Straw hat') {
    const straw = toon(0xe8c872);
    add(new THREE.CylinderGeometry(0.5, 0.52, 0.035, 28), straw, 0, 1.83, 0);
    add(new THREE.CylinderGeometry(0.2, 0.25, 0.2, 20), straw, 0, 1.93, 0);
    add(new THREE.TorusGeometry(0.235, 0.03, 6, 20), mAcc, 0, 1.87, 0, g, Math.PI / 2);
  } else if (hat === 'Cap') {
    add(new THREE.SphereGeometry(0.285, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mAcc, 0, 1.7, 0);
    add(new RoundedBoxGeometry(0.34, 0.03, 0.2, 2, 0.012), mAcc, 0, 1.71, 0.3, g, -0.12);
    add(new THREE.SphereGeometry(0.035, 8, 6), mOut, 0, 1.98, 0);
  } else if (hat === 'Flower crown') {
    add(new THREE.TorusGeometry(0.235, 0.03, 6, 22), toon(PAL.leaf), 0, 1.84, 0, g, Math.PI / 2 - 0.12);
    const fc = [0xff8fb1, 0xffd54f, 0xffffff, 0xb197fc];
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add(new THREE.SphereGeometry(0.055, 8, 6), toon(fc[i % 4]), Math.cos(a) * 0.235, 1.84 + Math.sin(a) * 0.028, Math.sin(a) * 0.235); }
  } else if (hat === 'Hood') {
    add(new THREE.SphereGeometry(0.31, 22, 16, Math.PI * 0.12, Math.PI * 1.76, 0, Math.PI * 0.7), mAcc, 0, 1.64, -0.02, g, 0, Math.PI, 0);
    add(new THREE.TorusGeometry(0.255, 0.04, 6, 20, Math.PI * 1.25), mAcc, 0, 1.63, 0.13, g, 0, 0, -Math.PI * 0.125);
  } else if (hat === 'Beanie') {
    add(new THREE.SphereGeometry(0.29, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mAcc, 0, 1.68, 0);
    add(new THREE.TorusGeometry(0.27, 0.05, 6, 22), mAcc, 0, 1.73, 0, g, Math.PI / 2);
    add(new THREE.SphereGeometry(0.08, 10, 8), toon(0xffffff), 0, 1.98, 0);
  } else if (hat === 'Leaf crown') {
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; add(ICO1, toon(i % 2 ? PAL.leaf : PAL.leaf2), Math.cos(a) * 0.25, 1.86, Math.sin(a) * 0.25, root, 0.5, -a, 0).scale.set(0.11, 0.035, 0.07); }
    add(new THREE.SphereGeometry(0.05, 8, 6), toon(0xffe066, { emissive: 0xffc107, emissiveIntensity: 0.4 }), 0, 1.9, 0.24);
  } else if (hat === 'Sprout') {
    add(new THREE.CylinderGeometry(0.018, 0.022, 0.22, 6), toon(PAL.leaf3), 0, 1.98, 0);
    for (const s of [-1, 1]) add(ICO1, toon(PAL.leaf2), s * 0.09, 2.09, 0, root, 0, 0, s * 0.5).scale.set(0.1, 0.03, 0.06);
  } else if (hat === 'Captain hat') {
    add(new THREE.CylinderGeometry(0.42, 0.44, 0.04, 3), toon(0x2b2f3a), 0, 1.84, 0, root, 0, Math.PI / 6);
    add(new THREE.CylinderGeometry(0.2, 0.25, 0.22, 16), toon(0x2b2f3a), 0, 1.95, 0);
    add(new THREE.TorusGeometry(0.235, 0.025, 6, 20), toon(PAL.brass), 0, 1.88, 0, root, Math.PI / 2);
  } else if (hat === 'Keeper circlet') {
    add(new THREE.TorusGeometry(0.255, 0.035, 8, 28), toon(0xffcf40, { emissive: 0x8a6000, emissiveIntensity: 0.3 }), 0, 1.76, 0, root, Math.PI / 2 - 0.2);
    add(facet(new THREE.OctahedronGeometry(0.07)), toon(0x9be7ff, { emissive: 0x4dd0e1, emissiveIntensity: 0.8 }), 0, 1.79, 0.26);
  } else if (hat === 'Goggles') {
    add(new THREE.TorusGeometry(0.265, 0.03, 6, 24), mDark, 0, 1.76, 0, g, Math.PI / 2 - 0.25);
    for (const s of [-1, 1]) { add(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 16), toon(PAL.brass), s * 0.1, 1.82, 0.22, g, Math.PI / 2 - 0.4); add(new THREE.CircleGeometry(0.058, 16), toon(0x7fe0e8, { emissive: 0x2aa8b8, emissiveIntensity: 0.3 }), s * 0.1, 1.835, 0.255, g, -0.4); }
  }
  // backpack + bedroll
  add(new RoundedBoxGeometry(0.42, 0.46, 0.22, 2, 0.06), mBrown, 0, 1.06, -0.3);
  add(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 14), mAcc, 0, 1.36, -0.32, g, 0, 0, Math.PI / 2);
  // limbs (pivot groups — animated)
  const limb = (x, y, build) => { const pv = new THREE.Group(); pv.position.set(x, y, 0); root.add(pv); build(pv); return pv; };
  const legs = [-1, 1].map(s => limb(s * 0.13, 0.62, pv => {
    add(new THREE.CapsuleGeometry(0.095, 0.3, 4, 12), mPants, 0, -0.24, 0, pv);
    add(new RoundedBoxGeometry(0.19, 0.16, 0.3, 2, 0.06), mBrown, 0, -0.53, 0.04, pv);
  }));
  const arms = [-1, 1].map(s => limb(s * 0.37, 1.3, pv => {
    add(new THREE.CapsuleGeometry(0.08, 0.28, 4, 12), mOut, 0, -0.2, 0, pv);
    add(new THREE.SphereGeometry(0.08, 12, 10), mSkin, 0, -0.45, 0, pv);
  }));
  // paraglider: curved canopy + edge trims + struts
  const glider = new THREE.Group(); root.add(glider);
  const canopy = new THREE.CylinderGeometry(1.35, 1.35, 1.0, 28, 1, true, -1.0, 2.0); canopy.rotateX(-Math.PI / 2); canopy.translate(0, 1.0, 0);
  let canopyMat;
  if (gv === 'rainbow') { const pos = canopy.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(); for (let i = 0; i < pos.count; i++) { c.setHSL(((pos.getX(i) / 1.35) + 1) / 2 * 0.8, 0.85, 0.6, THREE.SRGBColorSpace); col.set([c.r, c.g, c.b], i * 3); } canopy.setAttribute('color', new THREE.BufferAttribute(col, 3)); canopyMat = toon(0xffffff, { side: THREE.DoubleSide, vertexColors: true }); }
  else if (gv === 'heartwood') canopyMat = toon(0x7a5232, { side: THREE.DoubleSide, map: TEX.wood });
  else if (gv === 'starlight') canopyMat = toon(0x26346e, { side: THREE.DoubleSide, emissive: 0x5b6fe0, emissiveIntensity: 0.45 });
  else if (gv === 'gold') canopyMat = toon(0xffcf40, { side: THREE.DoubleSide, emissive: 0x8a6000, emissiveIntensity: 0.35 });
  else canopyMat = toon(new THREE.Color(gv).getHex(), { side: THREE.DoubleSide });
  add(canopy, canopyMat, 0, 0, 0, glider);
  for (const z of [-0.5, 0.5]) { const t = new THREE.TorusGeometry(1.36, 0.035, 6, 28, 2.0); t.rotateZ(Math.PI / 2 - 1.0); t.translate(0, 1.0, z); add(t, mAcc, 0, 0, 0, glider); }
  const stripe = new THREE.CylinderGeometry(1.365, 1.365, 0.18, 28, 1, true, -1.0, 2.0); stripe.rotateX(-Math.PI / 2); stripe.translate(0, 1.0, 0); add(stripe, toon(accent, { side: THREE.DoubleSide }), 0, 0, 0, glider);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6), mBrown, s * 0.45, 1.95, 0, glider, 0, 0, -s * 0.5);
  glider.visible = false;
  return { group: g, root, legs, arms, glider, t: Math.random() * 10 };
}
function animateCharacter(c, state, dt, emote = 0) {
  if (c.mixer) return animateAsset(c, state, dt, emote);
  c.t += dt;
  const t = c.t; let lL = 0, lR = 0, aL = 0, aR = 0, aLz = 0.08, aRz = -0.08;
  if (state === 'WALK' || state === 'RUN') { const sw = state === 'RUN' ? 0.95 : 0.6, f = state === 'RUN' ? 13 : 9; const s = Math.sin(t * f) * sw; lL = s; lR = -s; aL = -s * 0.8; aR = s * 0.8; }
  else if (state === 'CLIMB') { const s = Math.sin(t * 8) * 0.45; aL = -2.6 + s; aR = -2.6 - s; lL = -0.5 - s; lR = -0.5 + s; }
  else if (state === 'GLIDE') { aL = aR = -2.95; aLz = 0.25; aRz = -0.25; lL = 0.35; lR = 0.25; }
  else if (state === 'FALL') { aL = aR = -1.1; aLz = 0.9; aRz = -0.9; lL = -0.35; lR = 0.3; }
  else if (state === 'GRAPPLE') { aR = -2.9; aL = -0.4; lL = 0.45; lR = -0.25; }
  else if (state === 'ZIP') { aL = aR = -3.0; aLz = 0.15; aRz = -0.15; lL = 0.5; lR = 0.3 + Math.sin(t * 3) * 0.1; }
  else { aL = Math.sin(t * 2) * 0.05; aR = -aL; }
  let ry = 0, ty = 0;
  if (state === 'IDLE' && emote === 1) { aR = -2.7; aRz = -0.4 + Math.sin(t * 10) * 0.45; }
  else if (state === 'IDLE' && emote === 2) { aL = aR = -3.0; aLz = 0.35; aRz = -0.35; ty = Math.abs(Math.sin(t * 7)) * 0.18; }
  else if (state === 'IDLE' && emote === 3) { const b = Math.sin(t * 6); ry = b * 0.55; ty = Math.abs(Math.sin(t * 12)) * 0.08; aL = -1.6 - b * 1.2; aR = -1.6 + b * 1.2; aLz = 0.6; aRz = -0.6; lL = b * 0.4; lR = -b * 0.4; }
  else if (state === 'IDLE' && emote === 4) { ty = -0.42; lL = lR = -1.45; aL = aR = -0.35; }
  const k = Math.min(1, dt * 16);
  if (c.root) { c.root.rotation.y = lerp(c.root.rotation.y, ry, k); c.root.position.y = lerp(c.root.position.y, ty, k); }
  c.legs[0].rotation.x = lerp(c.legs[0].rotation.x, lL, k); c.legs[1].rotation.x = lerp(c.legs[1].rotation.x, lR, k);
  c.arms[0].rotation.x = lerp(c.arms[0].rotation.x, aL, k); c.arms[1].rotation.x = lerp(c.arms[1].rotation.x, aR, k);
  c.arms[0].rotation.z = lerp(c.arms[0].rotation.z, aLz, k); c.arms[1].rotation.z = lerp(c.arms[1].rotation.z, aRz, k);
  c.glider.visible = state === 'GLIDE' || c.showGlider === true;
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
    this.plants = [[], [], []]; this.flowerSpots = []; this.bloomGeos = [[], [], [], []]; this.statics = new Map(); this.grassMeshes = [];
    this.time = 0; this.scanning = false; this.turbineSpeed = 0.15; this.turbineTarget = 0.15; this.rotors = [];
    this.onAllRestored = null;
    this.solarMat = toon(0x3a4256, { emissive: 0x1e5bd8, emissiveIntensity: 0, unique: true });
    this.lampMat = toon(0xfff1c1, { emissive: 0xffc46b, emissiveIntensity: 0.25, unique: true });
  }
  // ---- static batching: everything that never moves is merged into one mesh per material ----
  addStatic(geo, mat, cast = true) {
    geo = nonIdx(geo);
    const key = mat.uuid + (cast ? '|c' : '|n');
    let b = this.statics.get(key); if (!b) this.statics.set(key, b = { mat, cast, geos: [] });
    b.geos.push(geo);
  }
  put(geo, mat, x, y, z, o = {}) {
    geo = geo.index ? geo.toNonIndexed() : geo.clone();
    if (o.sx || o.sy || o.sz) geo.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    if (o.rx) geo.rotateX(o.rx); if (o.rz) geo.rotateZ(o.rz); if (o.ry) geo.rotateY(o.ry);
    geo.translate(x, y, z); this.addStatic(geo, mat, o.cast !== false); return geo;
  }
  addBloom(geo, tier, cx, cy, cz, color) { // geo is local to its growth centre
    geo = nonIdx(geo); geo.translate(cx, cy, cz);
    const n = geo.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3), ctr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; ctr[i * 3] = cx; ctr[i * 3 + 1] = cy; ctr[i * 3 + 2] = cz; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color', 'aCenter'].includes(k)) geo.deleteAttribute(k);
    this.bloomGeos[tier].push(geo);
  }
  finalizeStatics() {
    const keep = ['position', 'normal', 'uv'];
    for (const b of this.statics.values()) {
      for (const g of b.geos) for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      const merged = mergeGeometries(b.geos, false); if (!merged) { console.warn('static merge failed'); continue; }
      const m = new THREE.Mesh(merged, b.mat); m.castShadow = b.cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); this.scene.add(m);
      for (const g of b.geos) g.dispose();
    }
    this.statics.clear();
    for (let t = 0; t < this.bloomGeos.length; t++) {
      if (!this.bloomGeos[t].length) continue;
      const m = new THREE.Mesh(mergeGeometries(this.bloomGeos[t], false), bloomMat(t)); m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m);
      this.bloomGeos[t] = [];
    }
  }
  // ---- primitives -------------------------------------------------
  block(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    const geo = boxGeo(w, h, d, mat.map ? mat.map.userData.world : 0, o.r ?? 0.14);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    let mesh = null;
    if (o.parent || o.dynamic) { mesh = new THREE.Mesh(geo, mat); mesh.position.set(cx, cy, cz); mesh.castShadow = o.cast !== false; mesh.receiveShadow = true; (o.parent || this.scene).add(mesh); }
    else { geo.translate(cx, cy, cz); this.addStatic(geo, mat, o.cast !== false); }
    const col = o.collide === false ? null : this.phys.add(x0, y0, z0, x1, y1, z1, o.tag);
    return { mesh, col };
  }
  // local-space builder for things attached to a wall face (normal nx,nz)
  facer(px, py, pz, nx, nz) {
    const ry = Math.atan2(nx, nz), c = Math.cos(ry), s = Math.sin(ry);
    return {
      put: (geo, mat, lx, ly, lz, cast = false) => { geo = nonIdx(geo); geo.translate(lx, ly, lz); geo.rotateY(ry); geo.translate(px, py, pz); this.addStatic(geo, mat, cast); },
      world: (lx, ly, lz) => [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c],
    };
  }
  win(px, py, pz, nx, nz, tier, o = {}) {
    const w = o.w ?? 1.0, h = o.h ?? 1.3, F = this.facer(px, py, pz, nx, nz);
    const glass = toon(o.dark ? 0x2d3f45 : 0x9fe3ea, { emissive: o.dark ? 0x000000 : 0x2a7f8a, emissiveIntensity: o.dark ? 0 : 0.12 });
    const frame = tmat(tier, o.frame ?? 0xfff8e8);
    if (o.round) {
      F.put(new THREE.CircleGeometry(w / 2, 20), glass, 0, 0, 0.03);
      F.put(new THREE.TorusGeometry(w / 2, 0.08, 6, 24), frame, 0, 0, 0.05);
      F.put(new THREE.BoxGeometry(0.05, w * 0.95, 0.05), frame, 0, 0, 0.06); F.put(new THREE.BoxGeometry(w * 0.95, 0.05, 0.05), frame, 0, 0, 0.06);
      return;
    }
    const sh = new THREE.Shape(); sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2);
    if (o.arched) { sh.lineTo(w / 2, h / 2 - w / 2); sh.absarc(0, h / 2 - w / 2, w / 2, 0, Math.PI, false); } else { sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); }
    sh.lineTo(-w / 2, -h / 2);
    F.put(new THREE.ShapeGeometry(sh, 10), glass, 0, 0, 0.03);
    if (!o.dark) { F.put(new THREE.BoxGeometry(0.05, h * 0.92, 0.05), frame, 0, -0.03, 0.06); F.put(new THREE.BoxGeometry(w * 0.96, 0.05, 0.05), frame, 0, o.arched ? h / 2 - w / 2 : 0, 0.06); }
    const ft = 0.1, sideH = o.arched ? h - w / 2 : h, sideY = o.arched ? -w / 4 : 0;
    F.put(new THREE.BoxGeometry(ft, sideH, 0.14), frame, -w / 2 - ft / 2, sideY, 0.05); F.put(new THREE.BoxGeometry(ft, sideH, 0.14), frame, w / 2 + ft / 2, sideY, 0.05);
    if (o.arched) F.put(new THREE.TorusGeometry(w / 2 + ft / 2, ft / 2, 4, 14, Math.PI), frame, 0, h / 2 - w / 2, 0.05);
    else F.put(new THREE.BoxGeometry(w + ft * 2, ft, 0.14), frame, 0, h / 2 + ft / 2, 0.05);
    F.put(boxGeo(w + 0.36, 0.08, 0.3, 0, 0.03), frame, 0, -h / 2 - 0.08, 0.12, true);
    if (o.shutters) { const sm = tmat(tier, o.shutters, TEX.wood); F.put(boxGeo(w * 0.5, sideH, 0.06, 3, 0.02), sm, -w * 0.82, sideY, 0.05); F.put(boxGeo(w * 0.5, sideH, 0.06, 3, 0.02), sm, w * 0.82, sideY, 0.05); }
    if (o.flowers) {
      F.put(boxGeo(w + 0.2, 0.26, 0.3, 3, 0.04), tmat(tier, PAL.wood, TEX.wood), 0, -h / 2 - 0.3, 0.2, true);
      for (let i = 0; i < 4; i++) { const [x, y, z] = F.world(-w / 2 + 0.1 + i * (w - 0.2) / 3, -h / 2 - 0.18, 0.2); this.flower(x, y, z, tier, [PAL.blossom, PAL.flower, 0xffffff, 0xb197fc][i % 4], 0.8); }
    }
  }
  door(px, y0, pz, nx, nz, tier, trimCol) {
    const F = this.facer(px, y0, pz, nx, nz), wood = tmat(tier, 0x9a6a3e, TEX.wood), frame = tmat(tier, 0xfff8e8);
    const sh = new THREE.Shape(); sh.moveTo(-0.6, 0); sh.lineTo(0.6, 0); sh.lineTo(0.6, 1.7); sh.absarc(0, 1.7, 0.6, 0, Math.PI, false); sh.lineTo(-0.6, 0);
    F.put(scaleUV(new THREE.ShapeGeometry(sh, 10), 1 / 3), wood, 0, 0, 0.03);
    F.put(new THREE.TorusGeometry(0.67, 0.07, 4, 14, Math.PI), frame, 0, 1.7, 0.06);
    F.put(new THREE.BoxGeometry(0.12, 1.7, 0.14), frame, -0.67, 0.85, 0.06); F.put(new THREE.BoxGeometry(0.12, 1.7, 0.14), frame, 0.67, 0.85, 0.06);
    F.put(new THREE.SphereGeometry(0.05, 8, 6), tmat(tier, PAL.brass), 0.36, 1.0, 0.08);
    F.put(boxGeo(1.8, 0.12, 0.7, 4, 0.04), tmat(tier, 0xd9d2c3, TEX.stone), 0, 0.06, 0.35);
    const aw = boxGeo(2.4, 0.07, 1.25, TEX.stripes.userData.world, 0.02); aw.rotateX(0.4); F.put(aw, tmat(tier, trimCol, TEX.stripes), 0, 3.05, 0.55, true);
    for (const s of [-1, 1]) F.put(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 5), tmat(tier, PAL.metal), s * 1.1, 2.75, 0.95);
  }
  flower(x, y, z, tier, color, s = 1) {
    const stem = new THREE.CylinderGeometry(0.018 * s, 0.024 * s, 0.36 * s, 3, 1, true); stem.translate(0, 0.18 * s, 0); this.addBloom(stem, tier, x, y, z, 0x4caf50);
    const pet = new THREE.CircleGeometry(0.13 * s, 6); pet.rotateX(-Math.PI / 2); pet.translate(0, 0.37 * s, 0); this.addBloom(pet, tier, x, y, z, color);
    const ctr = new THREE.OctahedronGeometry(0.05 * s); ctr.translate(0, 0.39 * s, 0); this.addBloom(ctr, tier, x, y, z, 0xffc107);
  }
  flowerPatch(x, y, z, tier, n = 8) {
    this.flowerSpots.push([x, y, z, tier]);
    const cols = [PAL.blossom, PAL.flower, 0xffffff, 0xb197fc, 0xff7043];
    for (let i = 0; i < n; i++) this.flower(x + (this.rng() - 0.5) * 3.2, y, z + (this.rng() - 0.5) * 3.2, tier, cols[Math.floor(this.rng() * cols.length)], 0.9 + this.rng() * 0.4);
  }
  tree(x, y, z, tier, s = 1, collide = true, kind) {
    const r = this.rng, g = new THREE.Group(); g.position.set(x, y, z); const rot = r() * 6.28; g.rotation.y = rot;
    kind = kind ?? ['round', 'round', 'pine', 'tall', 'blossom'][Math.floor(r() * 5)];
    const th = (kind === 'pine' ? 1.5 : kind === 'tall' ? 2.4 : 2.2) * s, trunkG = [], leafG = [];
    const tg = cylGeo(0.13 * s, 0.28 * s, th, 9, TEX.wood); tg.translate(0, th / 2, 0); trunkG.push(tg);
    const rf = cylGeo(0.28 * s, 0.42 * s, 0.32 * s, 9); rf.translate(0, 0.16 * s, 0); trunkG.push(rf);
    if (kind === 'round' || kind === 'blossom') {
      for (const [a, len] of [[0.8, 1.0], [-0.9, 0.8]]) { const br = cylGeo(0.05 * s, 0.09 * s, len * s, 6); br.rotateZ(a); br.translate(-Math.sin(a) * 0.35 * s, th * 0.72, 0); trunkG.push(br); }
      for (let i = 0; i < 6; i++) {
        const a = i / 5 * 6.28 + r(), rad = i === 0 ? 0 : 0.78 * s, sc = (i === 0 ? 1.4 : 0.9 + r() * 0.35) * s, lg = ICO1.clone();
        lg.scale(sc, sc * 0.82, sc); lg.translate(Math.cos(a) * rad, th + 0.55 * s + (i === 0 ? 0.45 * s : r() * 0.55 * s), Math.sin(a) * rad); leafG.push(lg);
      }
    } else if (kind === 'pine') {
      for (let i = 0; i < 4; i++) { const cg = new THREE.ConeGeometry((1.4 - i * 0.29) * s, 1.55 * s, 12); cg.translate(0, th + i * 0.78 * s + 0.45 * s, 0); leafG.push(cg); }
    } else {
      const lg = ICO1.clone(); lg.scale(0.95 * s, 2.3 * s, 0.95 * s); lg.translate(0, th + 1.45 * s, 0); leafG.push(lg);
      const lg2 = ICO1.clone(); lg2.scale(0.7 * s, 1.35 * s, 0.7 * s); lg2.translate(0.38 * s, th + 0.75 * s, 0.22 * s); leafG.push(lg2);
    }
    const leafCol = kind === 'blossom' ? 0xf4a6c6 : kind === 'pine' ? 0x2f8f5b : [PAL.leaf, PAL.leaf2, 0x5cb85c][Math.floor(r() * 3)];
    const variants = { round: 3, blossom: 2, pine: 2, tall: 2 }, src = assetNode('trees', `Tree_${kind}_${Math.floor(r() * variants[kind])}`);
    if (src) { const inst = toonize(src.clone(), n => n === 'Bark' ? tmat(tier, 0x8d5e3a) : tmat(tier, leafCol)); inst.position.set(0, 0, 0); inst.rotation.set(0, 0, 0); inst.scale.setScalar(s); g.add(inst); }
    else {
      const trunk = new THREE.Mesh(mergeNI(trunkG), tmat(tier, 0x8d5e3a, TEX.wood)); trunk.castShadow = trunk.receiveShadow = true; g.add(trunk);
      const leaves = new THREE.Mesh(mergeNI(leafG), tmat(tier, leafCol)); leaves.castShadow = leaves.receiveShadow = true; g.add(leaves);
    }
    if (kind === 'round' || kind === 'blossom') for (let i = 0; i < 7; i++) {
      const a = r() * 6.28, rr = 1.05 * s + r() * 0.4 * s, ly = th + 0.45 * s + r() * 1.1 * s, lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
      const b = ICO.clone(); b.scale(0.15 * s, 0.15 * s, 0.15 * s);
      this.addBloom(b, tier, x + lx * Math.cos(rot) + lz * Math.sin(rot), y + ly, z - lx * Math.sin(rot) + lz * Math.cos(rot), kind === 'blossom' ? 0xffffff : [PAL.blossom, PAL.flower, 0xff7043][Math.floor(r() * 3)]);
    }
    this.scene.add(g); this.plants[tier].push(g);
    if (collide) this.phys.add(x - 0.25 * s, y, z - 0.25 * s, x + 0.25 * s, y + th, z + 0.25 * s, 'tree');
    return g;
  }
  bush(x, y, z, tier, s = 1) {
    const g = new THREE.Group(); g.position.set(x, y, z); const parts = [];
    for (let i = 0; i < 3; i++) { const b = ICO1.clone(), sc = (0.55 - i * 0.08) * s; b.scale(sc * 1.15, sc * 0.85, sc * 1.15); b.translate((i - 1) * 0.3 * s, 0.32 * s + (i === 1 ? 0.12 * s : 0), (this.rng() - 0.5) * 0.3 * s); parts.push(b); }
    const l = new THREE.Mesh(mergeNI(parts), tmat(tier, this.rng() < 0.5 ? PAL.leaf2 : PAL.leaf)); l.castShadow = true; l.receiveShadow = true; g.add(l);
    for (let i = 0; i < 2; i++) { const b = ICO.clone(); b.scale(0.13 * s, 0.13 * s, 0.13 * s); this.addBloom(b, tier, x + (this.rng() - 0.5) * 0.6 * s, y + 0.62 * s, z + (this.rng() - 0.5) * 0.5 * s, this.rng() < 0.5 ? PAL.blossom : PAL.flower); }
    this.plants[tier].push(g); this.scene.add(g); return g;
  }
  lamp(x, y, z, tier) {
    if (putAsset(assetNode('props', 'LampPost'), propMat(tier), x, y, z)) { this.phys.add(x - 0.12, y, z - 0.12, x + 0.12, y + 3.2, z + 0.12, 'lamp'); return; }
    const metal = tmat(tier, PAL.metal);
    this.put(cylGeo(0.07, 0.1, 3.2, 10), metal, x, y + 1.6, z);
    this.put(cylGeo(0.2, 0.24, 0.3, 10), metal, x, y + 0.15, z);
    this.put(new THREE.SphereGeometry(0.25, 14, 10), this.lampMat, x, y + 3.36, z, { cast: false });
    this.put(new THREE.ConeGeometry(0.36, 0.32, 10), metal, x, y + 3.7, z);
    this.put(new THREE.TorusGeometry(0.22, 0.03, 4, 14), metal, x, y + 3.2, z, { rx: Math.PI / 2 });
    this.phys.add(x - 0.12, y, z - 0.12, x + 0.12, y + 3.2, z + 0.12, 'lamp');
  }
  bench(x, y, z, alongX, tier) {
    if (putAsset(assetNode('props', 'Bench'), propMat(tier), x, y, z, alongX ? 0 : Math.PI / 2)) { const [w, d] = alongX ? [2.2, 0.6] : [0.6, 2.2]; this.phys.add(x - w / 2, y + 0.42, z - d / 2, x + w / 2, y + 0.52, z + d / 2); return; }
    const wood = tmat(tier, PAL.wood, TEX.wood), metal = tmat(tier, PAL.metal), L = 2.2, D = 0.6;
    const [w, d] = alongX ? [L, D] : [D, L];
    this.block(x - w / 2, y + 0.42, z - d / 2, x + w / 2, y + 0.52, z + d / 2, wood, { r: 0.04 });
    for (const s of [-1, 1]) this.block(alongX ? x + s * (L / 2 - 0.15) - 0.05 : x - 0.25, y, alongX ? z - 0.25 : z + s * (L / 2 - 0.15) - 0.05, alongX ? x + s * (L / 2 - 0.15) + 0.05 : x + 0.25, y + 0.42, alongX ? z + 0.25 : z + s * (L / 2 - 0.15) + 0.05, metal, { collide: false, r: 0.02 });
    if (alongX) this.block(x - w / 2, y + 0.55, z - d / 2 - 0.05, x + w / 2, y + 1.0, z - d / 2 + 0.05, wood, { collide: false, r: 0.03 });
    else this.block(x - w / 2 - 0.05, y + 0.55, z - d / 2, x - w / 2 + 0.05, y + 1.0, z + d / 2, wood, { collide: false, r: 0.03 });
  }
  rim(x0, z0, x1, z1, y0, y1, w, mat) { // decorative edge band (visual only)
    this.block(x0, y0, z0, x1, y1, z0 + w, mat, { collide: false, r: 0.1 }); this.block(x0, y0, z1 - w, x1, y1, z1, mat, { collide: false, r: 0.1 });
    this.block(x0, y0, z0 + w, x0 + w, y1, z1 - w, mat, { collide: false, r: 0.1 }); this.block(x1 - w, y0, z0 + w, x1, y1, z1 - w, mat, { collide: false, r: 0.1 });
  }
  pilasters(x0, z0, x1, z1, y0, y1, mat) { for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) this.block(x - 0.45, y0, z - 0.45, x + 0.45, y1, z + 0.45, mat, { collide: false, r: 0.12 }); }
  cornice(x0, z0, x1, z1, y, out, hgt, mat) { this.block(x0 - out, y, z0 - out, x1 + out, y + hgt, z1 + out, mat, { collide: false, r: Math.min(0.12, hgt * 0.4) }); }
  house(x, z, w, d, h, y0 = 0, tier = 0, style) {
    const r = this.rng;
    style = style ?? ['garden', 'gable', 'dome', 'tower', 'gable', 'garden'][Math.floor(r() * 6)];
    const wallCol = [0xf6ead2, 0xf3e3c3, 0xfaf3e6, 0xe6f0e0, 0xf5e1d6][Math.floor(r() * 5)];
    const trimCol = [PAL.terra, PAL.teal, 0x6c9bd2, 0xe8a33d, 0x8bbf6a][Math.floor(r() * 5)];
    const roofCol = [0xd9704a, 0x5d7fa3, 0x6fa86a, 0xc9573f][Math.floor(r() * 4)];
    const wall = tmat(tier, wallCol, TEX.plaster), trim = tmat(tier, trimCol), stone = tmat(tier, 0xd9d2c3, TEX.stone);
    const X0 = x - w / 2, X1 = x + w / 2, Z0 = z - d / 2, Z1 = z + d / 2, top = y0 + h;
    this.block(X0, y0, Z0, X1, top, Z1, wall, { r: 0.18 });
    this.block(X0 - 0.12, y0, Z0 - 0.12, X1 + 0.12, y0 + 0.6, Z1 + 0.12, stone, { collide: false, r: 0.08 });
    this.pilasters(X0 + 0.25, Z0 + 0.25, X1 - 0.25, Z1 - 0.25, y0 + 0.6, top, tmat(tier, 0xfffaf0, TEX.stone));
    const floors = Math.max(1, Math.floor((h - 0.6) / 3.0)), arched = r() < 0.5, shut = r() < 0.55 ? trimCol : null;
    for (let f = 0; f < floors; f++) {
      const wy = y0 + 1.95 + f * 3.0; if (wy + 0.75 > top - 0.25) break;
      for (const [nx, nz, len, fx, fz] of [[0, 1, w, x, Z1], [0, -1, w, x, Z0], [1, 0, d, X1, z], [-1, 0, d, X0, z]]) {
        const cols = Math.max(1, Math.floor((len - 1.2) / 2.6));
        for (let c = 0; c < cols; c++) {
          const off = (c - (cols - 1) / 2) * ((len - 1.2) / cols);
          if (f === 0 && nz === 1 && Math.abs(off) < 1.4) continue;
          this.win(nz ? x + off : fx, wy, nz ? fz : z + off, nx, nz, tier, { arched, shutters: shut, flowers: f === 0 && r() < 0.4, w: 0.9, h: 1.25 });
        }
      }
    }
    this.door(x, y0, Z1, 0, 1, tier, trimCol);
    { const dr = mulberry32(((Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663) ^ (tier * 83492791)) >>> 0);
      const aw = boxGeo(2.6, 0.07, 1.15, 0, 0.02); aw.rotateX(0.38); scaleUV(aw, 1 / TEX.stripes.userData.world);
      this.put(aw, tmat(tier, [0xd9704a, 0x3a8f92, 0xe8a33d, 0x6c9bd2][Math.floor(dr() * 4)], TEX.stripes), x, y0 + 3.05, Z1 + 0.55, { cast: true });
      for (const s of [-1, 1]) this.put(cylGeo(0.025, 0.025, 0.7, 5), tmat(tier, PAL.brass), x + s * 1.2, y0 + 2.75, Z1 + 0.6, { rx: 0.9 });
      if (dr() < 0.65) { const sd = dr() < 0.5 ? -1 : 1; this.vines(sd < 0 ? X0 : X1, z, y0 + 0.8, top, sd, 0, tier, d * (0.45 + dr() * 0.4), dr); }
      if (dr() < 0.5) this.vines(x - w * 0.3, Z1, y0 + 2, top, 0, 1, tier, 1.2, dr); }
    if (style === 'garden') {
      this.block(X0 - 0.3, top, Z0 - 0.3, X1 + 0.3, top + 0.4, Z1 + 0.3, trim, { r: 0.12 });
      const rt = top + 0.4;
      this.block(x - w / 4 - 0.8, rt, z - 0.8, x - w / 4 + 0.8, rt + 0.5, z + 0.8, tmat(tier, PAL.wood, TEX.wood), { collide: false, r: 0.06 });
      this.bush(x - w / 4, rt + 0.5, z, tier, 1.1);
      if (r() < 0.5) { // pergola
        const wood = tmat(tier, PAL.wood, TEX.wood), px = x + w / 4;
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.put(cylGeo(0.07, 0.07, 2.2, 6), wood, px + ox * 1.1, rt + 1.1, z + oz * 1.1);
        for (let i = -2; i <= 2; i++) this.put(boxGeo(2.6, 0.1, 0.12, 0, 0.02), wood, px, rt + 2.25, z + i * 0.5);
        for (let i = 0; i < 6; i++) this.put(ICO1, tmat(tier, PAL.leaf3), px + (r() - 0.5) * 2.2, rt + 2.35, z + (r() - 0.5) * 2.2, { sx: 0.45, sy: 0.25, sz: 0.45 });
      } else this.tree(x + w / 4, rt, z, tier, 0.6, false, 'round');
      const sp = boxGeo(1.6, 0.08, 1.1, 0, 0.03); sp.rotateX(-0.45); this.put(sp, this.solarMat, x - w / 4, rt + 0.55, Z0 + 0.9);
    } else if (style === 'gable') {
      const W = w + 0.9, D = d + 0.9, R = Math.min(w, d) * 0.45, roofMat = tmat(tier, roofCol, TEX.roof);
      const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(0, R); sh.lineTo(W / 2, 0); sh.lineTo(-W / 2, 0);
      const rg = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false }); rg.translate(0, 0, -D / 2); scaleUV(rg, 1 / TEX.roof.userData.world);
      this.put(rg, roofMat, x, top, z);
      const gs = new THREE.Shape(); gs.moveTo(-w / 2, 0); gs.lineTo(0, R * w / W); gs.lineTo(w / 2, 0); gs.lineTo(-w / 2, 0);
      this.put(scaleUV(new THREE.ShapeGeometry(gs), 1 / 6), wall, x, top, Z1 - 0.02); this.put(scaleUV(new THREE.ShapeGeometry(gs), 1 / 6), wall, x, top, Z0 + 0.02, { ry: Math.PI });
      this.win(x, top + R * 0.33, Z1, 0, 1, tier, { round: true, w: 0.75 });
      this.put(new THREE.BoxGeometry(W + 0.1, 0.16, 0.2), trim, x, top + 0.03, Z1 + 0.42); this.put(new THREE.BoxGeometry(W + 0.1, 0.16, 0.2), trim, x, top + 0.03, Z0 - 0.42);
      this.block(x + w * 0.22 - 0.35, top + R * 0.3, z - 0.35, x + w * 0.22 + 0.35, top + R + 0.9, z + 0.35, stone, { collide: false, r: 0.06 });
      this.phys.add(x - w * 0.3, top, Z0, x + w * 0.3, top + R * 0.45, Z1, 'roof');
      this.phys.add(x - w * 0.12, top, Z0, x + w * 0.12, top + R * 0.8, Z1, 'roof');
    } else if (style === 'dome') {
      this.block(X0 - 0.25, top, Z0 - 0.25, X1 + 0.25, top + 0.35, Z1 + 0.25, trim, { r: 0.12 });
      const R = Math.min(w, d) / 2 * 0.9, domeMat = tmat(tier, [0x7fd8e0, 0x5fb3a1, 0xf6f1e7][Math.floor(r() * 3)]);
      this.put(new THREE.SphereGeometry(R, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat, x, top + 0.35, z, { sy: 0.8 });
      for (let i = 0; i < 4; i++) this.put(new THREE.TorusGeometry(R + 0.02, 0.06, 4, 20, Math.PI), tmat(tier, PAL.brass), x, top + 0.35, z, { sy: 0.8, ry: i * Math.PI / 4 });
      this.put(new THREE.SphereGeometry(0.22, 12, 8), tmat(tier, PAL.brass), x, top + 0.35 + R * 0.8 + 0.1, z);
      this.put(new THREE.ConeGeometry(0.06, 0.8, 6), tmat(tier, PAL.brass), x, top + 0.35 + R * 0.8 + 0.6, z);
      this.phys.add(x - R * 0.62, top + 0.35, z - R * 0.62, x + R * 0.62, top + 0.35 + R * 0.44, z + R * 0.62, 'roof');
      this.phys.add(x - R * 0.32, top + 0.35, z - R * 0.32, x + R * 0.32, top + 0.35 + R * 0.7, z + R * 0.32, 'roof');
    } else { // tower: flat roof terrace + corner turret
      this.block(X0 - 0.3, top, Z0 - 0.3, X1 + 0.3, top + 0.4, Z1 + 0.3, trim, { r: 0.12 });
      const tx = X1, tz = Z0, tr = 1.25, th = h + 3.6;
      this.put(cylGeo(tr, tr, th, 18, TEX.plaster), wall, tx, y0 + th / 2, tz);
      this.put(cylGeo(tr + 0.12, tr + 0.12, 0.3, 18), trim, tx, y0 + th - 0.15, tz);
      this.put(scaleUV(new THREE.ConeGeometry(tr + 0.4, 2.6, 18), 2, 1), tmat(tier, roofCol, TEX.roof), tx, y0 + th + 1.3, tz);
      this.phys.add(tx - tr * 0.72, y0, tz - tr * 0.72, tx + tr * 0.72, y0 + th + 2.6, tz + tr * 0.72, 'roof');
      this.win(tx + tr, y0 + th - 1.6, tz, 1, 0, tier, { arched: true, w: 0.6, h: 1.1 });
      this.win(tx, y0 + th - 1.6, tz - tr, 0, -1, tier, { arched: true, w: 0.6, h: 1.1 });
      this.bench(x - w / 4, top + 0.4, z + d / 4, true, tier);
      this.block(x - 0.6, top + 0.4, z - 0.6, x + 0.6, top + 0.9, z + 0.6, tmat(tier, PAL.wood, TEX.wood), { collide: false, r: 0.05 }); this.bush(x, top + 0.9, z, tier, 0.9);
    }
  }
  // A banner hanging from (x, y, z): its face points along (nx, nz). All banners are merged into one swaying mesh.
  banner(x, y, z, nx, nz, w = 1.1, h = 2.6) {
    const g = new THREE.PlaneGeometry(w, h, 2, 10); g.translate(0, -h / 2, 0); g.rotateY(Math.atan2(nx, nz)); g.translate(x, y, z);
    const uv = g.attributes.uv, n = uv.count, sway = new Float32Array(n), ph = new Float32Array(n).fill((x * 0.37 + z * 0.61) % 6.28);
    for (let i = 0; i < n; i++) sway[i] = (1 - uv.getY(i)) * Math.min(1.4, h / 2.6);
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    (this.bannerGeos ||= []).push(g.toNonIndexed());
  }
  bannerPole(x, z, side, tier = 0) { // wooden pole with a brass-capped crossbar; the banner hangs on the road side
    if (this.phys.pointInside(new V3(x, 1, z)) || this.phys.pointInside(new V3(x, 4, z))) return;
    const wood = tmat(tier, 0x7a5232, TEX.wood), brass = tmat(tier, PAL.brass);
    this.put(cylGeo(0.07, 0.09, 5.4, 8, TEX.wood), wood, x, 2.7, z); this.put(new THREE.SphereGeometry(0.12, 10, 8), brass, x, 5.45, z);
    this.put(cylGeo(0.04, 0.04, 1.5, 6), wood, x + side[0] * 0.7, 4.95, z + side[1] * 0.7, side[0] ? { rz: Math.PI / 2 } : { rx: Math.PI / 2 });
    this.phys.add(x - 0.1, 0, z - 0.1, x + 0.1, 5.4, z + 0.1, 'post');
    this.banner(x + side[0] * 0.75, 4.92, z + side[1] * 0.75, side[1] ? 1 : 0, side[0] ? 1 : 0, 1.05, 2.5);
  }
  dressBanners() {
    // avenues: poles alternating sides, every 16 m
    for (let k = 0, z = 22; z <= 100; z += 16, k++) { const s = k % 2 ? 1 : -1; this.bannerPole(s * 4.3, z, [-s, 0]); }
    for (let k = 0, x = 22; x <= 100; x += 16, k++) { const s = k % 2 ? 1 : -1; this.bannerPole(x, s * 3.4, [0, -s]); this.bannerPole(-x, -s * 3.4, [0, s]); }
    // long banners hanging from the canopy deck's lip (seen from all over the island)
    for (const s of [-1, 1]) for (const o of [-14, 14]) { this.banner(o, 34.6, s * 30.6, 0, s, 2.2, 7.5); this.banner(s * 30.6, 34.6, o, s, 0, 2.2, 7.5); }
    // portal plaza
    const pp = PLAZAS.portals; for (const dx of [-9, 9]) this.bannerPole(pp[0] + dx, pp[2] + 8, [0, 1]);
    if (!this.bannerGeos) return;
    const m = new THREE.Mesh(mergeGeometries(this.bannerGeos, false), bannerMat); m.castShadow = true; this.scene.add(m); this.bannerMesh = m;
  }
  haloRings() { // glowing rings floating around the Apex Crown; brighter as the spire is restored
    const mk = (R, r, col) => { const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, 128), noOutline(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, fog: false }))); this.scene.add(m); return m; };
    this.halo = [mk(9.5, 0.22, 0xcffaff), mk(11.2, 0.09, 0xffe6a8)];
    this.halo[0].position.set(0, 99.2, 0); this.halo[1].position.set(0, 98.4, 0);
  }
  vines(x, z, y0, y1, nx, nz, tier, w = 2, rng = this.rng) {
    const m = tmat(tier, PAL.leaf3), leaf = tmat(tier, PAL.leaf), n = Math.max(2, Math.floor(w / 0.8));
    for (let i = 0; i < n; i++) {
      const len = (y1 - y0) * (0.35 + rng() * 0.65), off = (i / (n - 1) - 0.5) * w;
      const px = x + (nz !== 0 ? off : 0) + nx * 0.07, pz = z + (nx !== 0 ? off : 0) + nz * 0.07;
      this.put(new THREE.BoxGeometry(nx !== 0 ? 0.06 : 0.12, len, nz !== 0 ? 0.06 : 0.12), m, px, y1 - len / 2, pz, { cast: false });
      for (let k = 0.6; k < len; k += 1.1 + rng() * 0.6) this.put(ICO, leaf, px + nx * 0.12, y1 - k, pz + nz * 0.12, { sx: 0.26, sy: 0.2, sz: 0.26, ry: rng() * 3, cast: false });
    }
  }
  waterPlane(x0, y, z0, x1, z1, tier) {
    const tex = WATER_TEX.clone(); tex.repeat.set((x1 - x0) / 6, (z1 - z0) / 6); tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), noOutline(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.visible = false; this.scene.add(m);
    this.updaters.push(dt => { tex.offset.y += dt * 0.15; tex.offset.x += dt * 0.05; });
    return m;
  }
  waterfall(key, x, yTop, yBot, z, width, rotY) {
    const h = yTop - yBot, g = new THREE.Group(); g.position.set(x, yTop, z); g.rotation.y = rotY;
    const tex = WATER_TEX.clone(); tex.repeat.set(width / 4, h / 14); tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(width, h, 6, 1); const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.cos(p.getX(i) / width * Math.PI) * 0.35); // gentle curve
    geo.translate(0, -h / 2, 0.15);
    const sheet = new THREE.Mesh(geo, noOutline(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }))); g.add(sheet);
    const foamMat = noOutline(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
    const foam = new THREE.Mesh(new THREE.SphereGeometry(width * 0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), foamMat); foam.scale.y = 0.35; foam.position.set(0, -h, 1); g.add(foam);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, width, 10), foamMat); lip.rotation.z = Math.PI / 2; lip.position.set(0, -0.1, 0.3); g.add(lip);
    g.visible = false; g.scale.y = 0.001; this.scene.add(g);
    this.updaters.push(dt => { tex.offset.y += dt * 1.4; foam.scale.set(1 + Math.sin(this.time * 6 + x) * 0.07, 0.35 + Math.sin(this.time * 9 + x) * 0.04, 1 + Math.cos(this.time * 5 + x) * 0.07); });
    this.waterfalls[key] = g; return g;
  }
  thermal(key, x, z, radius, yMin, yMax) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const N = 220, pos = new Float32Array(N * 3), meta = [];
    for (let i = 0; i < N; i++) { const a = this.rng() * 6.28, r = Math.sqrt(this.rng()) * radius; meta.push({ a, r, y: yMin + this.rng() * (yMax - yMin), sp: 4 + this.rng() * 6 }); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff3d6, size: 0.4, map: DOT_TEX, transparent: true, opacity: 0.8, depthWrite: false })); g.add(pts);
    const rings = [];
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.8, 0.06, 6, 40), noOutline(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false })));
      ring.rotation.x = Math.PI / 2; ring.userData.y = yMin + (i / 6) * (yMax - yMin); g.add(ring); rings.push(ring);
    }
    const metal = tmat(0, PAL.metal);
    this.put(cylGeo(radius * 0.62, radius * 0.75, 0.5, 20, TEX.stone), tmat(0, 0x8a7b6b, TEX.stone), x, yMin + 0.25, z);
    for (let i = 0; i < 8; i++) this.put(boxGeo(radius * 1.1, 0.08, 0.12, 0, 0.02), metal, x, yMin + 0.52, z, { ry: i * Math.PI / 8 });
    const ventGlow = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 0.45, 20), toon(0xff8a50, { emissive: 0xff5722, emissiveIntensity: 0, unique: true }));
    ventGlow.position.set(x, yMin + 0.3, z); this.scene.add(ventGlow);
    const dormant = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, yMax - yMin, 16, 1, true), noOutline(new THREE.MeshBasicMaterial({ color: 0xffcc80, wireframe: true, transparent: true, opacity: 0.25 })));
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
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.15, 10, 28), toon(0xffb300, { emissive: 0xff8f00, emissiveIntensity: 0.3, unique: true }));
    g.add(ring);
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), toon(0x4dd0e1)); buoy.scale.y = 0.8; buoy.position.y = 1.35; g.add(buoy);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 20), toon(PAL.brass)); band.rotation.x = Math.PI / 2; band.position.y = 1.35; g.add(band);
    const leafs = new THREE.Mesh(ICO1, toon(PAL.leaf2)); leafs.scale.set(0.45, 0.22, 0.45); leafs.position.y = 1.75; g.add(leafs);
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5, 5), toon(PAL.leaf3)); vine.position.y = -3.4; g.add(vine);
    this.scene.add(g);
    const a = { id, pos: new V3(x, y, z), exit: new V3(...exit), group, active: group === 'base', mesh: g, ring };
    g.visible = a.active; this.anchors.push(a); return a;
  }
  pickup(type, x, y, z) {
    const m = new THREE.Mesh(PICK_GEO[type], PICK_MAT[type]); m.position.set(x, y, z); m.castShadow = true; this.scene.add(m);
    const p = { id: this.pickups.length, type, pos: new V3(x, y, z), mesh: m, available: true, pending: false, phase: this.rng() * 6.28 };
    this.pickups.push(p); return p;
  }
  // ---- grass fields (instanced, wind-animated, height follows district vibrance) ----
  grassField(tier, color, maxCount, sampler) {
    const mesh = new THREE.InstancedMesh(TUFT_GEO, grassMat(tier, color), maxCount), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V3(), p = new V3();
    let n = 0, tries = 0;
    while (n < maxCount && tries++ < maxCount * 6) {
      const s = sampler(); if (!s) continue;
      e.set(0, this.rng() * 6.28, 0); q.setFromEuler(e); const k = 0.45 + this.rng() * 0.45; sc.set(k, k * (0.7 + this.rng() * 0.6), k); p.set(s[0], s[1], s[2]);
      mesh.setMatrixAt(n++, m4.compose(p, q, sc));
    }
    mesh.count = n; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.instanceMatrix.needsUpdate = true; this.scene.add(mesh);
    this.grassMeshes.push({ mesh, max: n });
  }
  followGrassField(maxCount, maskTex) {
    const r = this.rng, geo = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'uv']) geo.setAttribute(k, TUFT_GEO.attributes[k]);
    const off = new Float32Array(maxCount * 4);
    for (let i = 0; i < maxCount; i++) { off[i * 4] = r() * GRASS_T; off[i * 4 + 1] = r() * GRASS_T; off[i * 4 + 2] = r() * 6.28; off[i * 4 + 3] = 0.42 + r() * 0.4; }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4)); geo.instanceCount = maxCount;
    const mesh = new THREE.Mesh(geo, followGrassMat(0x7cc34e, maskTex)); mesh.frustumCulled = false; mesh.receiveShadow = true; this.scene.add(mesh);
    this.grassMeshes.push({ follow: true, mesh, geo, max: maxCount });
  }
  grassMask(low, noise) { // 2D coverage map of the island: 0 on paths / channel / building footprints, patchy elsewhere
    const N = 512, s = 220 / N, M = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -110 + (i + 0.5) * s, z = -110 + (j + 0.5) * s;
      M[j * N + i] = (Math.abs(x) > 108.8 || Math.abs(z) > 108.8) ? 0 : Math.round(clamp(0.62 + noise(x, z) * 0.42, 0.08, 1) * 255);
    }
    const carve = (x0, z0, x1, z1) => {
      const i0 = Math.max(0, Math.floor((x0 + 110) / s)), i1 = Math.min(N - 1, Math.ceil((x1 + 110) / s)), j0 = Math.max(0, Math.floor((z0 + 110) / s)), j1 = Math.min(N - 1, Math.ceil((z1 + 110) / s));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) M[j * N + i] = 0;
    };
    carve(-3.5, 11.5, 3.5, 110); carve(-110, -2.3, -11.5, 2.3); carve(11.5, -2.3, 110, 2.3);
    for (const p of Object.values(PLAZAS)) { const h = p[3] || 12; carve(p[0] - h, p[2] - h, p[0] + h, p[2] + h); }
    for (const b of low) carve(b.min.x - 0.15, b.min.z - 0.15, b.max.x + 0.15, b.max.z + 0.15);
    const tex = new THREE.DataTexture(M, N, N, THREE.RedFormat, THREE.UnsignedByteType); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true; return tex;
  }
  setGrassDensity(f) {
    f = clamp(f, 0, 1);
    for (const g of this.grassMeshes) { const n = Math.floor(g.max * f); if (g.follow) g.geo.instanceCount = n; else g.mesh.count = n; g.mesh.visible = n > 0; }
  }
  // ---- build ---------------------------------------------------------
  build() {
    const r = this.rng, S = this.scene;
    // Sea & island
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), toon(0x3fa9d6, { noOutline: true })); sea.rotation.x = -Math.PI / 2; sea.position.y = -4; sea.receiveShadow = true; S.add(sea);
    const shore = new THREE.Mesh(new THREE.RingGeometry(150, 175, 64), noOutline(new THREE.MeshBasicMaterial({ color: 0xbfe8f5, transparent: true, opacity: 0.45, depthWrite: false }))); shore.rotation.x = -Math.PI / 2; shore.position.y = -3.95; S.add(shore);
    this.block(-110, -9, -110, 110, 0, 110, tmat(0, PAL.grass, TEX.grass), { cast: false, r: 0.9 });
    this.block(-113, -9, -113, 113, -1.4, 113, tmat(0, PAL.sand, TEX.plaster), { collide: false, cast: false, r: 1.2 });
    for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 118 + r() * 6; this.put(rockGeo(1.5 + r() * 2.5, i), tmat(0, PAL.slate), Math.cos(a) * d, -2 + r(), Math.sin(a) * d, { ry: r() * 6 }); }
    // paving paths
    const pave = tmat(0, 0xe9e1cf, TEX.tile);
    this.block(-2, 0, 12, 2, 0.06, 108, pave, { collide: false, cast: false });
    this.block(-108, 0, -2, -12, 0.06, 2, pave, { collide: false, cast: false });
    this.block(12, 0, -2, 108, 0.06, 2, pave, { collide: false, cast: false });

    // ===== TIER 0 — Basal Spires =====
    const t0 = tmat(0, PAL.stone, TEX.stone), t0b = tmat(0, PAL.sand, TEX.plaster), t0trim = tmat(0, 0xfffaf0, TEX.stone);
    this.block(-12, 0, -12, 12, 34, 12, t0b, { r: 0.3 });                     // spire core (under deck)
    this.pilasters(-11.9, -11.9, 11.9, 11.9, 0, 34, t0trim);
    this.cornice(-12, -12, 12, 12, 0, 0.35, 1.2, t0);
    this.cornice(-12, -12, 12, 12, 16, 0.2, 0.4, t0trim);
    for (const s of [-1, 1]) for (const [axis, f] of [['x', s * 12], ['z', s * 12]]) {
      const nx = axis === 'x' ? s : 0, nz = axis === 'z' ? s : 0;
      for (const y of [11, 21.5]) for (const off of [-7, 0, 7]) this.win(axis === 'x' ? f : off, y, axis === 'x' ? off : f, nx, nz, 0, { arched: true, w: 1.5, h: 2.6 });
      for (const off of [-7, 7]) this.win(axis === 'x' ? f : off, 28.5, axis === 'x' ? off : f, nx, nz, 0, { round: true, w: 1.3 });
      // grand arched doorway (visual)
      const F = this.facer(axis === 'x' ? f : 0, 0, axis === 'x' ? 0 : f, nx, nz), sh = new THREE.Shape();
      sh.moveTo(-2.6, 0); sh.lineTo(2.6, 0); sh.lineTo(2.6, 4.4); sh.absarc(0, 4.4, 2.6, 0, Math.PI, false); sh.lineTo(-2.6, 0);
      F.put(new THREE.ShapeGeometry(sh, 16), toon(0x24363a), 0, 0, 0.03);
      F.put(new THREE.TorusGeometry(2.8, 0.25, 8, 24, Math.PI), tmat(0, PAL.teal), 0, 4.4, 0.12, true);
      for (const sx of [-1, 1]) F.put(boxGeo(0.5, 4.4, 0.4, 0, 0.08), tmat(0, PAL.teal), sx * 2.8, 2.2, 0.12, true);
      F.put(boxGeo(0.7, 0.9, 0.3, 0, 0.08), t0trim, 0, 7.4, 0.15, true);
      this.vines(axis === 'x' ? f : 0, axis === 'x' ? 0 : f, 14, 34, nx, nz, 0, 18);
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {  // deck support columns
      const cx = sx * 24, cz = sz * 24;
      this.block(cx - 1.5, 0, cz - 1.5, cx + 1.5, 34, cz + 1.5, t0, { r: 0.35 });
      this.block(cx - 1.95, 0, cz - 1.95, cx + 1.95, 1.2, cz + 1.95, t0trim, { collide: false, r: 0.2 });
      this.block(cx - 2.0, 32.6, cz - 2.0, cx + 2.0, 34, cz + 2.0, t0trim, { collide: false, r: 0.2 });
      for (const y of [11, 22]) this.cornice(cx - 1.5, cz - 1.5, cx + 1.5, cz + 1.5, y, 0.15, 0.35, t0trim);
      this.vines(cx + sx * 1.5, cz, 18, 34, sx, 0, 0, 2.5);
    }
    // Aqueduct channel (dry until restored)
    const chW = tmat(0, PAL.stone, TEX.stone);
    this.block(-3.2, 0, 12, -2.6, 0.5, 100, chW, { r: 0.08 }); this.block(2.6, 0, 12, 3.2, 0.5, 100, chW, { r: 0.08 });
    this.block(-2.6, 0, 12, 2.6, 0.04, 100, tmat(0, 0xc9a77a, TEX.tile), { collide: false, cast: false });
    this.channelWater = this.waterPlane(-2.6, 0.35, 12, 2.6, 100, 0);
    // Geothermal conduit pipes
    this.conduitMat = toon(0x8a6d4b, { emissive: 0xffa000, emissiveIntensity: 0, unique: true });
    const pipe = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0); this.put(cylGeo(0.3, 0.3, len, 12), this.conduitMat, (x0 + x1) / 2, 0.3, (z0 + z1) / 2, { rx: Math.PI / 2, ry: Math.atan2(x1 - x0, z1 - z0) }); for (let t = 0; t <= len; t += 4) this.put(cylGeo(0.38, 0.38, 0.2, 12), tmat(0, PAL.brass), x0 + (x1 - x0) * t / len, 0.3, z0 + (z1 - z0) * t / len, { rx: Math.PI / 2, ry: Math.atan2(x1 - x0, z1 - z0) }); };
    pipe(-44, 28, -6, 28); pipe(-6, 28, -6, 12); pipe(-48, 28, -48, 10);
    // Parkour pillars (west) leading up to canopy deck
    for (let i = 0; i < 8; i++) {
      const z = 22 - i * 7, h = 4.25 * (i + 1);
      this.block(-37, 0, z - 2, -33, h, z + 2, tmat(0, i % 2 ? PAL.stone : PAL.sand, i % 2 ? TEX.stone : TEX.plaster), { r: 0.22 });
      this.block(-37.2, h, z - 2.2, -32.8, h + 0.3, z + 2.2, tmat(0, PAL.teal), { r: 0.1 });
      this.block(-37.3, 0, z - 2.3, -32.7, 0.6, z + 2.3, t0trim, { collide: false, r: 0.1 });
      if (i % 3 === 1) this.bush(-35, h + 0.3, z, 0, 0.9);
      if (i > 1) this.vines(-33, z, Math.max(0, h - 6), h, 1, 0, 0, 2.5);
    }
    // Houses (four styles)
    const reserved = [[0, 56, 6], [-48, 8, 9], [-44, 28, 6], [-35, 0, 6], [-35, 20, 6], [-35, -20, 6], [55, 0, 12], [55, 16, 8], [45, 0, 10], [8, 52, 6], [0, 0, 36], [30, 47, 6]].concat(FEATURE_RESERVED);
    const clear = (x, z, rad) => { if (Math.abs(x) < 5.5 + rad) return false; if (Math.abs(z) < 4 + rad && Math.abs(x) > 10) return false; if (Math.abs(x) < 34 && Math.abs(z) < 34) return false; for (const [rx, rz, rr] of reserved) if (Math.hypot(x - rx, z - rz) < rr + rad) return false; return true; };
    let placed = 0, tries = 0; const houses = [];
    while (placed < 16 && tries++ < 600) {
      const a = r() * 6.28, d = 40 + r() * 52, x = Math.cos(a) * d, z = Math.sin(a) * d, w = 6 + Math.floor(r() * 3) * 2, dd = 6 + Math.floor(r() * 3) * 2, h = 4 + Math.floor(r() * 3) * 2.5;
      const rad = Math.max(w, dd) * 0.75 + 1.5;
      if (!clear(x, z, rad) || houses.some(hh => Math.hypot(hh[0] - x, hh[1] - z) < hh[2] + rad + 3)) continue;
      this.house(x, z, w, dd, h); houses.push([x, z, rad]); reserved.push([x, z, rad]); placed++;
    }
    // Trees, flowers & rocks
    tries = 0; let trees = 0;
    while (trees < 50 && tries++ < 900) {
      const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200; if (!clear(x, z, 2.5)) continue;
      this.tree(x, 0, z, 0, 0.9 + r() * 0.8); reserved.push([x, z, 2]); trees++;
      if (r() < 0.45) this.flowerPatch(x + 2, 0, z + 2, 0, 9);
    }
    for (let i = 0; i < 34; i++) {
      const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200; if (!clear(x, z, 1.5)) continue;
      this.put(rockGeo(0.7 + r() * 1.3, i + 100), tmat(0, PAL.slate), x, 0.15, z, { ry: r() * 6 });
    }
    // Lamps along the paths
    for (let t = 16; t < 106; t += 13) {
      this.lamp(4.2, 0, t, 0);
      if (t < 40 || t > 66) this.lamp(t, 0, 3.4, 0);
      if (!(t > 29 && t < 41) && !(t > 41 && t < 55)) this.lamp(-t, 0, -3.4, 0);
    }
    this.anchor('A1', 18, 39, 33, [0, 0, -1]);
    this.anchor('A2', 12, 39, -33, [0, 0, 1]);
    this.anchor('A3', 33, 39, 16, [-1, 0, 0]);
    this.thermal('T1', -48, 8, 5, 0, 54);
    this.waterfall('W1', 0, 35.9, 0, 30.05, 5.6, 0);

    // ===== TIER 1 — Canopy Mid-Level =====
    const t1 = tmat(1, 0xefe6d2, TEX.tile), t1s = tmat(1, PAL.sand, TEX.plaster), t1st = tmat(1, PAL.stone, TEX.stone), t1trim = tmat(1, 0xfffaf0, TEX.stone);
    this.block(-30, 34, -30, 30, 36, 30, t1, { r: 0.25 });
    this.rim(-30.3, -30.3, 30.3, 30.3, 35.4, 36.15, 0.7, tmat(1, PAL.teal));
    for (const s of [-1, 1]) for (let t = -27; t <= 27; t += 4.5) { // corbels under the deck rim
      this.block(s * 30 - (s > 0 ? 0.9 : -0.9) - 0.45, 32.6, t - 0.45, s * 30 - (s > 0 ? 0.9 : -0.9) + 0.45, 34, t + 0.45, t1st, { collide: false, r: 0.1 });
      this.block(t - 0.45, 32.6, s * 30 - (s > 0 ? 0.9 : -0.9) - 0.45, t + 0.45, 34, s * 30 - (s > 0 ? 0.9 : -0.9) + 0.45, t1st, { collide: false, r: 0.1 });
    }
    for (const s of [-1, 1]) { this.vines(s * 30, 0, 26, 35, s, 0, 1, 50); this.vines(0, s * 30, 26, 35, 0, s, 1, 50); }
    // spire above deck (stepped setbacks)
    this.block(-9, 36, -9, 9, 50, 9, t1s, { r: 0.25 });
    this.block(-9.3, 49.6, -9.3, 9.3, 50, 9.3, tmat(1, PAL.terra), { r: 0.12 });
    this.pilasters(-8.95, -8.95, 8.95, 8.95, 36, 49.6, t1trim);
    this.block(-7, 50, -7, 7, 64, 7, t1st, { r: 0.25 });
    this.block(-7.3, 63.6, -7.3, 7.3, 64, 7.3, tmat(1, PAL.teal), { r: 0.12 });
    for (const s of [-1, 1]) {
      for (const off of [-5, 0, 5]) { this.win(s * 9, 42, off, s, 0, 1, { arched: true, w: 1.3, h: 2.6 }); this.win(off, 42, s * 9, 0, s, 1, { arched: true, w: 1.3, h: 2.6 }); }
      for (const off of [-3.5, 3.5]) { this.win(s * 7, 57, off, s, 0, 1, { round: true, w: 1.4 }); this.win(off, 57, s * 7, 0, s, 1, { round: true, w: 1.4 }); }
      this.vines(s * 9, 0, 40, 49.6, s, 0, 1, 12); this.vines(0, s * 9, 40, 49.6, 0, s, 1, 12); this.vines(s * 7, 0, 55, 63.6, s, 0, 1, 9);
    }
    // deck stream (aqueduct source)
    this.block(-1.8, 36, 9, -1.4, 36.35, 30, t1st, { r: 0.05 }); this.block(1.4, 36, 9, 1.8, 36.35, 30, t1st, { r: 0.05 });
    this.deckStream = this.waterPlane(-1.4, 36.2, 9, 1.4, 30, 1);
    // Hydroponic bay (NW)
    this.hydroWater = [];
    const pw = tmat(1, PAL.wood, TEX.wood);
    for (const x0 of [-28, -14]) for (const z0 of [-28, -24, -20, -16]) {
      this.block(x0, 36, z0, x0 + 6, 36.5, z0 + 2, pw, { r: 0.06 });
      this.hydroWater.push(this.waterPlane(x0 + 0.2, 36.52, z0 + 0.2, x0 + 5.8, z0 + 1.8, 1));
      for (let k = 0; k < 3; k++) this.bush(x0 + 1 + k * 2, 36.5, z0 + 1, 1, 0.7);
    }
    this.block(-29, 36, -29, -27.5, 41, -27.5, tmat(1, PAL.brass), { r: 0.1 }); this.block(-8.5, 36, -29, -7, 41, -27.5, tmat(1, PAL.brass), { r: 0.1 });
    this.block(-29, 41, -29, -7, 41.6, -27.5, tmat(1, PAL.glass), { r: 0.1 });
    for (let x = -27; x <= -9; x += 3) this.put(cylGeo(0.05, 0.05, 5, 6), tmat(1, PAL.brass), x, 38.5, -28.25);
    this.waterfall('W2', -11, 35.9, 0, -30.05, 5, Math.PI);
    // Residential arches
    for (const ax of [-14, 14]) {
      this.block(ax - 3, 36, 20, ax - 2, 44, 21, t1s, { r: 0.12 }); this.block(ax + 2, 36, 20, ax + 3, 44, 21, t1s, { r: 0.12 });
      this.block(ax - 3.4, 44, 19.6, ax + 3.4, 45.2, 21.4, tmat(1, PAL.terra), { r: 0.15 });
      this.put(new THREE.TorusGeometry(2.0, 0.22, 8, 20, Math.PI), t1trim, ax, 42, 20.5);
      this.put(ICO1, tmat(1, PAL.leaf), ax - 2.5, 45.4, 20.5, { sx: 0.8, sy: 0.45, sz: 0.8 }); this.put(ICO1, tmat(1, PAL.leaf2), ax + 2.3, 45.3, 20.5, { sx: 0.7, sy: 0.4, sz: 0.7 });
      this.vines(ax, 21.4, 41, 44, 0, 1, 1, 5);
    }
    this.house(-22, 20, 6, 6, 5, 36, 1, 'garden'); this.house(22, 22, 6, 6, 7.5, 36, 1, 'dome'); this.house(22, -22, 8, 6, 5, 36, 1, 'gable');
    this.tree(-26, 36, 27, 1, 1.4, true, 'round'); this.tree(25, 36, -12, 1, 1.2, true, 'blossom'); this.tree(6, 36, -22, 1, 1.5, true, 'round');
    this.tree(-24, 36, 2, 1, 1.3, true, 'tall'); this.tree(14, 36, 12, 1, 1.1, true, 'blossom'); this.tree(-12, 36, 12, 1, 1.0, true, 'round');
    for (const [x, z] of [[-6, 20], [8, 26], [-20, -4], [18, 4], [0, -16], [-25, 12]]) this.flowerPatch(x, 36, z, 1, 10);
    for (const [x, z] of [[-8, 27], [8, 27], [-27, 8], [27, 10], [27, -14], [4, -27]]) this.lamp(x, 36, z, 1);
    this.bench(-8, 36, 24.5, true, 1); this.bench(8, 36, 24.5, true, 1); this.bench(-26, 36, -6, false, 1);
    // East solar tower + terrace + broken bridge stubs
    this.block(48, 0, -7, 62, 58, 7, tmat(1, PAL.sand, TEX.plaster), { r: 0.3 });
    this.pilasters(48.1, -6.9, 61.9, 6.9, 0, 58, t1trim);
    for (const y of [23.6, 44.6]) this.cornice(48, -7, 62, 7, y, 0.25, 0.5, t1trim);
    for (let y = 6; y < 56; y += 7) for (const off of [-3.5, 0, 3.5]) { if (y > 28 && y < 38) continue; this.win(48, y, off, -1, 0, 1, { arched: true, w: 1.1, h: 2.0 }); }
    this.block(42, 30, -6, 48, 36, 6, t1, { r: 0.2 });
    this.rim(41.8, -6.2, 48, 6.2, 35.4, 36.15, 0.5, tmat(1, PAL.teal));
    for (const z of [-5, 5]) this.block(42.2, 28.6, z - 0.4, 43.2, 30, z + 0.4, t1st, { collide: false, r: 0.08 });
    this.vines(55, 7, 10, 56, 0, 1, 1, 12); this.vines(62, 0, 14, 56, 1, 0, 1, 12);
    this.block(30, 35, -2, 32, 36, 2, t1, { r: 0.1 }); this.block(40, 35, -2, 42, 36, 2, t1, { r: 0.1 });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const p = boxGeo(4, 0.2, 2.5, 0, 0.05); p.rotateX(-0.35); this.put(p, this.solarMat, 51.5 + i * 4.3, 59.3, -3 + j * 5.5); this.put(cylGeo(0.08, 0.08, 1.1, 6), tmat(1, PAL.metal), 51.5 + i * 4.3, 58.8, -3 + j * 5.5); }
    this.block(48, 58, -7, 62, 58.4, 7, tmat(1, PAL.terra), { r: 0.1 });
    for (const z of [-7.05, 7.05]) for (let y = 20; y < 50; y += 10) this.put(boxGeo(10, 6, 0.15, 0, 0.05), this.solarMat, 55, y, z);
    // bridge (built on restore): plank deck, arches, rope rails, lanterns
    this.bridgeGroup = new THREE.Group(); this.bridgeGroup.position.set(32, 0, 0); this.bridgeGroup.scale.x = 0.001; this.bridgeGroup.visible = false; S.add(this.bridgeGroup);
    const BG = this.bridgeGroup, addB = (geo, mat, x, y, z, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.castShadow = m.receiveShadow = true; BG.add(m); return m; };
    this.block(0, 35, -2, 8, 36, 2, tmat(1, PAL.wood, TEX.wood), { collide: false, parent: BG, r: 0.08 });
    for (const z of [-1.5, 1.5]) addB(new THREE.TorusGeometry(4, 0.22, 8, 24, Math.PI), tmat(1, PAL.brass), 4, 31, z);
    for (const z of [-2, 2]) {
      for (let x = 0; x <= 8; x += 2) addB(cylGeo(0.08, 0.1, 1.1, 8), tmat(1, PAL.wood, TEX.wood), x, 36.55, z);
      addB(cylGeo(0.04, 0.04, 8, 6), tmat(1, 0xd8c39a), 4, 36.95, z, 0, Math.PI / 2);
    }
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(ICO1, toon(PAL.leaf2)); b.scale.set(0.5, 0.32, 0.3); b.position.set(1 + i * 2, 37.05, i % 2 ? 2.1 : -2.1); BG.add(b); }
    addB(new THREE.SphereGeometry(0.22, 12, 8), this.lampMat, 4, 37.3, 2); addB(new THREE.SphereGeometry(0.22, 12, 8), this.lampMat, 4, 37.3, -2);
    this.bridgeCols = [this.phys.add(31.9, 35, -2, 40.1, 36, 2, 'bridge'), this.phys.add(31.9, 36, -2.1, 40.1, 37, -1.9), this.phys.add(31.9, 36, 1.9, 40.1, 37, 2.1)];
    this.bridgeCols.forEach(b => b.enabled = false);
    this.thermal('T2', 55, 18, 5, 0, 104);
    this.anchor('A4', -20, 52, -20, [0, 0, 0]);
    this.anchor('A5', -17, 66, -4, [0, 0, 0]);
    this.anchor('A6', -16.5, 80, 4, [1, 0, 0]);
    this.anchor('S1', 30, 24, 46, [0, 0, 0], 'skyline');
    this.anchor('S2', 22, 46, 34, [0, 0, 0], 'skyline');
    this.anchor('S3', 17, 68, 20, [0, 0, 0], 'skyline');
    this.anchor('S4', 16.5, 80, -4, [-1, 0, 0], 'skyline');

    // ===== TIER 2 — Apex Crown =====
    const t2 = tmat(2, 0xefe6d2, TEX.tile), t2s = tmat(2, PAL.sand, TEX.plaster), t2st = tmat(2, PAL.stone, TEX.stone), t2trim = tmat(2, 0xfffaf0, TEX.stone);
    this.block(-5.5, 64, -5.5, 5.5, 76, 5.5, t2s, { r: 0.2 });
    for (const s of [-1, 1]) { this.win(s * 5.5, 69, 0, s, 0, 2, { arched: true, w: 1.2, h: 2.4 }); this.win(0, 69, s * 5.5, 0, s, 2, { arched: true, w: 1.2, h: 2.4 }); }
    this.block(-14, 76, -14, 14, 78, 14, t2, { r: 0.25 });
    this.rim(-14.3, -14.3, 14.3, 14.3, 77.4, 78.15, 0.6, tmat(2, PAL.brass));
    for (const s of [-1, 1]) for (let t = -12; t <= 12; t += 4) { this.block(s * 13.1 - 0.4, 74.8, t - 0.4, s * 13.1 + 0.4, 76, t + 0.4, t2st, { collide: false, r: 0.08 }); this.block(t - 0.4, 74.8, s * 13.1 - 0.4, t + 0.4, 76, s * 13.1 + 0.4, t2st, { collide: false, r: 0.08 }); }
    this.block(-4, 78, -4, 4, 92, 4, t2st, { r: 0.25 });
    this.pilasters(-3.95, -3.95, 3.95, 3.95, 78, 91.6, t2trim);
    this.block(-4.4, 91.6, -4.4, 4.4, 92.2, 4.4, tmat(2, PAL.teal), { r: 0.1 });
    for (const s of [-1, 1]) { this.win(s * 4, 85, 0, s, 0, 2, { arched: true, w: 2.0, h: 4.2, dark: true }); this.win(0, 85, s * 4, 0, s, 2, { arched: true, w: 2.0, h: 4.2, dark: true }); }
    const capMat = tmat(2, 0x4fb8a0, TEX.roof);
    this.put(scaleUV(new THREE.ConeGeometry(4.4, 7.5, 8), 4, 2), capMat, 0, 95.95, 0, { ry: Math.PI / 8 });
    this.put(new THREE.TorusGeometry(4.2, 0.18, 6, 8), tmat(2, PAL.brass), 0, 92.35, 0, { rx: Math.PI / 2, ry: Math.PI / 8 });
    this.put(cylGeo(0.12, 0.2, 3, 8), tmat(2, PAL.brass), 0, 100.5, 0);
    this.crownCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), toon(0x9ef0ff, { emissive: 0x4dd0e1, emissiveIntensity: 0.1, unique: true })); this.crownCrystal.position.set(0, 102.6, 0); S.add(this.crownCrystal);
    for (const s of [-1, 1]) { this.put(boxGeo(5.5, 3.2, 0.15, 0, 0.05), this.solarMat, 0, 80.8, s * 4.05); this.put(boxGeo(0.15, 3.2, 5.5, 0, 0.05), this.solarMat, s * 4.05, 80.8, 0); }
    // wind turbines: tapered towers, nacelles, shaped blades
    const bladeShape = new THREE.Shape(); bladeShape.moveTo(-0.14, 0); bladeShape.quadraticCurveTo(-0.34, 1.2, -0.06, 3.7); bladeShape.lineTo(0.06, 3.7); bladeShape.quadraticCurveTo(0.2, 1.0, 0.14, 0); bladeShape.lineTo(-0.14, 0);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 6 });
    for (const [x, z] of [[11, -11], [-11, -11], [11, 11], [-11, 11]]) {
      this.phys.add(x - 0.4, 78, z - 0.4, x + 0.4, 88, z + 0.4);
      this.put(cylGeo(0.22, 0.5, 10, 14), tmat(2, 0xfafafa), x, 83, z);
      this.put(cylGeo(0.7, 0.75, 0.4, 14), t2trim, x, 78.2, z);
      const dir = z > 0 ? 1 : -1;
      this.put(new THREE.CapsuleGeometry(0.32, 0.9, 4, 12), tmat(2, 0xfafafa), x, 88.1, z - dir * 0.15, { rx: Math.PI / 2 });
      const hub = new THREE.Group(); hub.position.set(x, 88.1, z + dir * 0.6); S.add(hub);
      for (let b = 0; b < 3; b++) { const piv = new THREE.Group(); piv.rotation.z = b * 2.094; const bl = new THREE.Mesh(bladeGeo, tmat(2, 0xffffff)); bl.position.set(0, 0.2, -0.03); bl.castShadow = true; piv.add(bl); hub.add(piv); }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), tmat(2, PAL.terra)); nose.scale.z = 1.4; hub.add(nose);
      if (dir < 0) hub.rotation.y = Math.PI;
      this.rotors.push(hub);
    }
    // cloud garden (south half of apex)
    for (const [x, z] of [[-9, 12], [9, 12], [-12, 4], [12, 4]]) { this.block(x - 1.5, 78, z - 1, x + 1.5, 78.5, z + 1, tmat(2, PAL.wood, TEX.wood), { r: 0.06 }); this.bush(x, 78.5, z, 2, 0.9); }
    this.tree(-11, 78, -4, 2, 1.0, true, 'blossom'); this.tree(11, 78, -4, 2, 1.0, true, 'round');
    this.flowerPatch(-6, 78, 6, 2, 10); this.flowerPatch(6, 78, 6, 2, 10);
    this.lamp(-6, 78, -12, 2); this.lamp(6, 78, -12, 2);
    this.bench(-6, 78, 12.5, true, 2); this.bench(6, 78, 12.5, true, 2);
    this.apexPond = this.waterPlane(-4, 78.06, 10, 4, 14, 2);
    this.deckPool = this.waterPlane(-5, 36.08, 14, 5, 20, 1);
    this.waterfall('W3', 0, 77.9, 36, 14.05, 6, 0);
    // Rainbow (final reward)
    this.rainbow = new THREE.Group(); this.rainbow.position.set(0, 20, 40); this.rainbow.visible = false; S.add(this.rainbow);
    [0xff5252, 0xffa726, 0xffeb3b, 0x66bb6a, 0x42a5f5, 0xab47bc].forEach((c, i) => {
      const tr = new THREE.Mesh(new THREE.TorusGeometry(60 - i * 1.6, 0.8, 6, 64, Math.PI), noOutline(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, fog: false }))); this.rainbow.add(tr);
    });

    // ===== Atmosphere: soft clouds & distant mountains =====
    const cloudParts = [];
    for (let i = 0; i < 30; i++) {
      const a = r() * 6.28, d = 90 + r() * 220, cx = Math.cos(a) * d, cy = 55 + r() * 85, cz = Math.sin(a) * d;
      for (let k = 0; k < 5 + Math.floor(r() * 5); k++) { const s = 4 + r() * 7, p = ICO1.clone(); p.scale(s, s * 0.6, s); p.translate(cx + (r() - 0.5) * 18, cy + (r() - 0.5) * 3, cz + (r() - 0.5) * 9); cloudParts.push(p); }
    }
    this.clouds = new THREE.Mesh(mergeNI(cloudParts), toon(0xffffff, { noOutline: true, emissive: 0xffffff, emissiveIntensity: 0.15 })); S.add(this.clouds);
    const mtnA = toon(0x6fae8a, { noOutline: true }), mtnB = toon(0x7fa0b8, { noOutline: true }), snowM = toon(0xffffff, { noOutline: true });
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * 6.28 + r() * 0.2, d = 420 + r() * 130, h = 60 + r() * 130, rad = 50 + r() * 55, mx = Math.cos(a) * d, mz = Math.sin(a) * d;
      this.put(new THREE.ConeGeometry(rad, h, 9 + Math.floor(r() * 4)), r() < 0.5 ? mtnA : mtnB, mx, h / 2 - 10, mz, { ry: r() * 6, cast: false });
      this.put(new THREE.ConeGeometry(rad * 0.27, h * 0.27, 10), snowM, mx, h - 10 - h * 0.135 + 0.5, mz, { cast: false });
    }

    // ===== Restoration nodes, pickups, ground cover =====
    for (const def of NODE_DEFS) this.makeNode(def);
    this.placePickups();
    this.groundCover();
    this.dressBanners(); this.haloRings();
    this.finalizeStatics();
  }
  groundCover() {
    const P = this.phys, r = this.rng, low = P.boxes.filter(b => b.min.y < 1 && b.max.y > 0.05), deckB = P.boxes.filter(b => b.max.y > 35.5 && b.min.y < 37.5), apexB = P.boxes.filter(b => b.max.y > 77.5 && b.min.y < 79.5);
    const inside = (list, x, y, z) => { for (const b of list) if (x > b.min.x - 0.2 && x < b.max.x + 0.2 && z > b.min.z - 0.2 && z < b.max.z + 0.2 && y > b.min.y && y < b.max.y) return true; return false; };
    const noise = (x, z) => Math.sin(x * 0.075) * Math.cos(z * 0.068) + Math.sin((x + z) * 0.13) * 0.5 + Math.sin(x * 0.31 - z * 0.27) * 0.25;
    const ground = () => {
      const x = (r() - 0.5) * 214, z = (r() - 0.5) * 214;
      if ((Math.abs(x) < 3.6 && z > 11) || (Math.abs(z) < 2.4 && Math.abs(x) > 11)) return null;
      if (noise(x, z) < -0.35 && r() < 0.75) return null;
      if (inside(low, x, 0.2, z)) return null;
      return [x, 0, z];
    };
    const DECK_GARDENS = [[-26, 27, 4.5], [25, -12, 3.5], [6, -22, 4.5], [-24, 2, 4], [14, 12, 3.5], [-12, 12, 3.5], [-6, 20, 3], [8, 26, 3], [-20, -4, 3], [18, 4, 3], [0, -16, 3], [-25, 12, 3]];
    const deck = () => {
      const x = (r() - 0.5) * 58, z = (r() - 0.5) * 58;
      if (Math.abs(x) < 10 && Math.abs(z) < 10) return null;
      if (x < -6.5 && z < -12.5) return null;
      if (Math.abs(x) < 2.2 && z > 8) return null;
      if (!DECK_GARDENS.some(([gx, gz, gr]) => Math.hypot(x - gx, z - gz) < gr * (0.75 + 0.25 * Math.sin(Math.atan2(z - gz, x - gx) * 3 + gx)))) return null;
      if (inside(deckB, x, 36.2, z)) return null;
      return [x, 36, z];
    };
    const apex = () => {
      const x = (r() - 0.5) * 27, z = (r() - 0.5) * 27;
      if (Math.abs(x) < 4.8 && Math.abs(z) < 4.8) return null;
      if (inside(apexB, x, 78.2, z)) return null;
      return [x, 78, z];
    };
    this.followGrassField(48000, this.grassMask(low, noise));
    this.grassField(1, 0x84c95a, 7000, deck);
    this.grassField(2, 0x8fd16a, 3500, apex);
    const cols = [PAL.blossom, PAL.flower, 0xffffff, 0xb197fc, 0xff7043, 0x74c0fc];
    for (let i = 0, n = 0; i < 6000 && n < 1100; i++) { const s = ground(); if (!s || noise(s[0] * 1.7, s[2] * 1.7) < 0.35) continue; this.flower(s[0], 0, s[2], 0, cols[Math.floor(r() * cols.length)], 0.8 + r() * 0.5); n++; }
    for (let i = 0, n = 0; i < 3000 && n < 160; i++) { const s = deck(); if (!s) continue; this.flower(s[0], 36, s[2], 1, cols[Math.floor(r() * cols.length)], 0.9); n++; }
    // drifting pollen motes (more visible as the lower deck blooms)
    const N = 500, pos = new Float32Array(N * 3), seed = [];
    for (let i = 0; i < N; i++) { const x = (r() - 0.5) * 200, z = (r() - 0.5) * 200, y = 0.5 + r() * 7; seed.push([x, y, z, r() * 6.28]); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.pollen = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff6c8, size: 0.22, map: DOT_TEX, transparent: true, opacity: 0, depthWrite: false })); this.pollen.frustumCulled = false; this.scene.add(this.pollen);
    this.updaters.push(() => {
      const t = this.time; this.pollen.material.opacity = Math.max(0, this.vib[0] - 0.2) * 0.9; if (this.pollen.material.opacity <= 0) return;
      for (let i = 0; i < N; i++) { const [x, y, z, ph] = seed[i]; pos[i * 3] = x + Math.sin(t * 0.3 + ph) * 3; pos[i * 3 + 1] = y + Math.sin(t * 0.7 + ph * 2) * 0.6; pos[i * 3 + 2] = z + Math.cos(t * 0.25 + ph) * 3; }
      geo.attributes.position.needsUpdate = true;
    });
  }

  makeNode(def) {
    const [x, y, z] = def.pos, g = new THREE.Group(); g.position.set(x, y, z); this.scene.add(g);
    const color = TYPE_COLOR[def.type];
    const base = new THREE.Mesh(cylGeo(1.15, 1.45, 1.0, 16, TEX.stone), tmat(def.tier, PAL.stone, TEX.stone)); const bring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 6, 24), tmat(def.tier, PAL.brass)); bring.rotation.x = Math.PI / 2; bring.position.y = 0.95; g.add(bring); base.position.y = 0.5; base.castShadow = base.receiveShadow = true; g.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.4, 12), tmat(def.tier, PAL.brass)); post.position.y = 1.7; g.add(post);
    const coreMat = toon(0x8c8c8c, { emissive: 0xff3d00, emissiveIntensity: 0.4, unique: true });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62), coreMat); core.position.y = 3.0; core.castShadow = true; g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.07, 8, 32), toon(0x9e9e9e, { unique: true })); ring.position.y = 3.0; ring.rotation.x = Math.PI / 2; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 90, 8, 1, true), noOutline(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    beam.position.y = 48; beam.visible = false; g.add(beam);
    this.phys.add(x - 1.1, y, z - 1.1, x + 1.1, y + 1.0, z + 1.1, 'node');
    const n = { def, id: def.id, group: g, core, coreMat, ring, beam, color, cur: { energy: 0, bio: 0, scrap: 0 }, calib: 0, restored: false };
    this.nodes.set(def.id, n);
  }

  placePickups() {
    const r = mulberry32(4242), P = this.phys;
    const pickType = (w) => { const v = r(); return v < w[0] ? 'energy' : v < w[0] + w[1] ? 'bio' : 'scrap'; };
    const tryPlace = (x, z, maxY, w) => {
      const sb = P.surfaceBox(x, z, maxY); if (!sb || sb.tag === 'roof' || sb.tag === 'lamp') return false; const top = sb.max.y;
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
    this.time += dt; BANNER_U.uTime.value = this.time;
    if (this.halo) { const g = 0.45 + 0.55 * (this.vib[2] ?? 0); this.halo[0].rotation.set(Math.PI / 2 + Math.sin(this.time * 0.2) * 0.06, 0, this.time * 0.15); this.halo[1].rotation.set(Math.PI / 2 - 0.08, Math.sin(this.time * 0.17) * 0.05, -this.time * 0.1); this.halo[0].material.opacity = 0.35 + 0.6 * g; this.halo[1].material.opacity = 0.25 + 0.5 * g; } GRASS_U.time.value = this.time; GRASS_U.cam.value.copy(this.grassFocus || camera.position);
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
        BLOOM_U[t].value = smooth(0.3, 0.75, v); GRASS_U.vib[t].value = v;
      }
      this.vibDirty = still;
      this.lampMat.emissiveIntensity = 0.25 + 0.9 * (this.vib[0] + this.vib[1] + this.vib[2]) / 3;
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
const PICK_GEO = {
  energy: (() => { const g = facet(new THREE.OctahedronGeometry(0.4)); g.scale(1, 1.45, 1); return g; })(),
  bio: (() => { const a = ICO1.clone(); a.scale(0.33, 0.4, 0.33); const l = new THREE.ConeGeometry(0.12, 0.3, 8); l.translate(0, 0.45, 0); return mergeNI([a, l]); })(),
  scrap: (() => { const parts = [new THREE.TorusGeometry(0.27, 0.1, 8, 20)]; for (let i = 0; i < 8; i++) { const t = new THREE.BoxGeometry(0.13, 0.14, 0.14); t.translate(0.4, 0, 0); t.rotateZ(i * Math.PI / 4); parts.push(t); } return mergeNI(parts); })(),
};
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
    if (this.phys.overlapAll(this.pos.clone().addScaledVector(n, -0.2)).some(b => b.tag === 'noclimb')) return null;
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
  bounceCheck(res) {
    if (!res.groundBox || res.groundBox.tag !== 'bounce') return false;
    this.vel.y = CFG.BOUNCE; this.grounded = false; this.state = 'FALL'; this.coyote = 0; this.events.push('bounce'); if (this.onBounce) this.onBounce(res.groundBox); return true;
  }
  startZip(z) { this.state = 'ZIP'; this.zip = { z, s: 0, v: Math.max(7, Math.hypot(this.vel.x, this.vel.z) * 0.6) }; this.grapple = null; this.grounded = false; this.events.push('zip'); }
  updZip(dt, inp) {
    const Z = this.zip.z, slope = (Z.a.y - Z.b.y) / Z.len, end = Z.len - 0.6;
    this.zip.v = clamp(this.zip.v + (CFG.GRAVITY * 0.5 * slope - 0.01 * this.zip.v * this.zip.v) * dt, 6, 24);
    this.zip.s = Math.min(end, this.zip.s + this.zip.v * dt);
    this.pos.copy(Z.a).addScaledVector(Z.dir, this.zip.s); this.pos.y -= 1.95;
    this.vel.copy(Z.dir).multiplyScalar(this.zip.v); this.yaw = Math.atan2(Z.dir.x, Z.dir.z);
    if (this.zip.s >= end || inp.jump || inp.letGo) { this.state = 'FALL'; this.vel.multiplyScalar(0.75); this.vel.y = Math.max(this.vel.y, 2.5); this.zip = null; this.climbCD = 0.3; }
  }
  startGrapple(a) { this.zip = null; this.state = 'GRAPPLE'; this.grapple = { a, t: 0, stuck: 0 }; this.grounded = false; this.events.push('grapple'); }

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
      case 'ZIP': this.updZip(dt, inp); break;
      default: this.updMove(dt, inp, mx, mz, mlen);
    }
    // stamina regen — full refill begins 1.5 s after standing on flat ground
    if (this.grounded && this.state !== 'CLIMB') {
      this.groundTime += dt;
      if (this.groundTime >= CFG.REGEN_DELAY) { this.stamina = Math.min(CFG.STAMINA_MAX, this.stamina + CFG.REGEN_RATE * dt); if (this.stamina >= CFG.STAMINA_MAX) this.exhausted = false; }
      this.safeT += dt; if (this.safeT > 0.5) { this.safeT = 0; this.lastSafe.copy(this.pos); }
    } else this.groundTime = 0;
    if (this.pos.y < (this.killY ? this.killY() : -3.5)) { this.pos.copy(this.lastSafe); this.pos.y += 0.3; this.vel.set(0, 0, 0); this.state = 'FALL'; this.grapple = null; this.zip = null; this.events.push('respawn'); }
  }
  updMove(dt, inp, mx, mz, mlen) {
    const speed = inp.sprint ? CFG.RUN : CFG.WALK;
    if (this.grounded || mlen > 0.1) approachXZ(this.vel, mx * speed, mz * speed, (this.grounded ? 60 : 16) * dt);
    else { const k = Math.max(0, 1 - 1.2 * dt); this.vel.x *= k; this.vel.z *= k; } // airborne, hands-off: keep momentum
    this.vel.y = Math.max(this.vel.y - CFG.GRAVITY * dt, -50);
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (inp.jump) {
      if (this.coyote > 0) { this.vel.y = CFG.JUMP; this.coyote = 0; this.grounded = false; this.events.push('jump'); }
      else if (this.canUse()) { this.state = 'GLIDE'; this.vel.y = Math.max(this.vel.y, -3); this.events.push('glide'); return; }
    }
    if (mlen > 0.1) this.yaw = lerpAngle(this.yaw, Math.atan2(mx, mz), Math.min(1, 14 * dt));
    const res = this.phys.move(this.pos, this.vel.clone().multiplyScalar(dt), this.grounded);
    this.grounded = res.ground && this.vel.y <= 0;
    if (this.grounded && this.bounceCheck(res)) return;
    if (res.ground && this.vel.y < 0) this.vel.y = 0;
    if (res.ceil && this.vel.y > 0) this.vel.y = 0;
    if (res.dyn && mlen > 0.3 && this.onPush) this.onPush(res.dyn, mx, mz); // walked into a crate / seed-stone
    if (res.hitX) this.vel.x = 0; if (res.hitZ) this.vel.z = 0;
    if ((res.hitX || res.hitZ) && !res.dyn && mlen > 0.3 && this.climbCD <= 0 && this.canUse()) { const n = this.findWall(mx, mz); if (n) { this.startClimb(n); return; } } // movable things get pushed, not climbed
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
    if (res.ground) { if (this.bounceCheck(res)) return; this.state = 'IDLE'; this.grounded = true; this.vel.y = 0; return; }
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
    this.auth.puzzles = JSON.parse(JSON.stringify(this.game.puzzles)); delete this.auth.puzzles.chimes.hit;
    if (!['idle', 'done'].includes(this.auth.puzzles.chimes.phase)) this.auth.puzzles.chimes.phase = this.auth.puzzles.chimes.solved ? 'done' : 'idle';
    for (const st of this.auth.puzzles.plates.stones) if (st.c && st.c !== this.selfId) st.c = null;
    this.auth.env = JSON.parse(JSON.stringify(this.game.env)); this.auth.env.wheel = false; delete this.auth.env.ev;
    this.auth.boss = { ...defaultBoss(), phase: this.game.boss.phase === 4 ? 4 : 0 }; this.anchT = [0, 0, 0];
    if (this.game.boss.phase !== this.auth.boss.phase) applyBoss(this.auth.boss);
  }
  selfInfo() { const pl = this.game.player; return { id: this.selfId, name: this.game.selfName, color: this.game.selfColor, look: this.game.selfLook, p: [pl.pos.x, pl.pos.y, pl.pos.z], r: pl.yaw, s: pl.state }; }
  genCode() { const A = ROOM_ALPHABET; let s = ''; const rnd = crypto.getRandomValues(new Uint32Array(5)); for (let i = 0; i < 5; i++) s += A[rnd[i] % A.length]; return s; }
  startSolo() { this.mode = 'offline'; this.selfId = 'solo'; this.initAuthority(true); }
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
        conn.on('open', () => conn.send({ t: 'HELLO', name: this.game.selfName, color: this.game.selfColor, look: this.game.selfLook }));
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
    this.game.toast('Lost connection to host — continuing solo in their spire (this session isn’t saved).');
    this.mode = 'offline'; this.hostConn = null; this.selfId = 'solo';
    this.game.clearRemotes(); this.initAuthority(true); dynBecomeAuthority(); this.game.refreshRoomInfo();
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
        const look = safeLook(m.look); const info = { id, name: safeName(m.name), color: lookColor(look), look, p: [0, 0, 0], r: 0, s: 'IDLE' };
        this.auth.players.set(this.selfId, this.selfInfo());
        conn.send({ t: 'WELCOME', id, players: [...this.auth.players.values()], world: this.snapshot(), tod: this.game.tod });
        this.auth.players.set(id, info);
        this.broadcast({ t: 'PLAYER_JOIN', id, name: info.name, color: info.color, look: info.look }, id);
        return;
      }
      if (this.conns.has(conn.peer)) { try { this.hostHandle(conn.peer, m); } catch (e) { console.warn('bad message from', conn.peer, e); } }
    });
    conn.on('close', () => this.dropPeer(conn.peer));
    conn.on('error', () => this.dropPeer(conn.peer));
  }
  dropPeer(id) { if (!this.conns.has(id)) return; this.conns.delete(id); puzzleDropCarrier(this, id); this.auth.players.delete(id); this.broadcast({ t: 'PLAYER_LEAVE', id }); }
  snapshot() { return { nodes: this.auth.nodes, taken: [...this.auth.taken], puzzles: this.auth.puzzles, env: this.auth.env, boss: this.auth.boss, bodies: dynSnapshot() }; }
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
        const p = safeVec(m.p); if (!p) break; const r = safeNum(m.r, -1e3, 1e3, 0), s = safeState(m.s), e = safeInt(m.e, 0, 4), k = safeInt(m.k, 0, 5), u = m.u === true;
        const pl = A.players.get(from); if (pl) { pl.p = p; pl.r = r; pl.s = s; pl.k = k; pl.u = u; }
        this.broadcast({ t: 'PLAYER_MOVE', id: from, p, r, s, e, k, u }, from); break;
      }
      case 'PUZZLE': puzzleHost(this, from, m); break;
      case 'BODY_PUSH': dynHostPush(this, from, m); break;
      case 'ENV': envHost(this, from, m); break;
      case 'BOSS': bossHost(this, from, m); break;
      case 'PING': {
        const p = safeVec(m.p), now = performance.now(); if (!p) break;
        A.pingT = A.pingT || new Map(); if (now - (A.pingT.get(from) || 0) < 700) break; A.pingT.set(from, now);
        this.broadcast({ t: 'PING', id: from, p }); break;
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
    const moved = pl.pos.distanceTo(L.p) > CFG.NET_EPS, rot = Math.abs(lerpAngle(L.r, pl.yaw, 1) - L.r) > 0.03, st = pl.state !== L.s || (pl.emote || 0) !== L.e || this.game.tool !== L.k || pl.toolUse !== L.u;
    if (!(moved || rot || st || L.t > 1)) return;
    L.p.copy(pl.pos); L.r = pl.yaw; L.s = pl.state; L.e = pl.emote || 0; L.k = this.game.tool; L.u = pl.toolUse; L.t = 0;
    this.send({ t: 'PLAYER_MOVE', p: [+pl.pos.x.toFixed(2), +pl.pos.y.toFixed(2), +pl.pos.z.toFixed(2)], r: +pl.yaw.toFixed(3), s: pl.state, e: L.e, k: L.k, u: L.u });
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
const outlineFx = new OutlineEffect(renderer, { defaultThickness: 0.0022, defaultColor: [0.075, 0.058, 0.045], defaultAlpha: 0.72, defaultKeepAlive: true }); // thin warm-brown ink
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2500);
// ---------- post-processing: scene (+ink outlines) → bloom → painterly grade → sRGB output ----------
class ScenePass extends Pass { // like RenderPass, but goes through the OutlineEffect when ink lines are on
  constructor() { super(); this.needsSwap = false; this.outline = true; }
  render(r, writeBuffer, readBuffer) { r.setRenderTarget(this.renderToScreen ? null : readBuffer); r.clear(); (this.outline ? outlineFx : r).render(scene, camera); }
}
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uWarm: { value: 0.5 }, uNight: { value: 0 }, uVig: { value: 0.22 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uWarm, uNight, uVig; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;                       // linear HDR
      c = c / (1.0 + max(c - 0.75, 0.0) * 0.9);                      // soft highlight shoulder (keeps bloom from clipping)
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 p = sqrt(max(c, 0.0));                                    // ~perceptual space for the contrast curve
      p = clamp(mix(p, p * p * (3.0 - 2.0 * p), 0.38), 0.0, 4.0);    // painterly S-curve: deeper shadows, richer mids
      c = p * p; l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.24 - 0.2 * uNight);                      // saturation lift (less at night)
      vec3 shadowTint = mix(vec3(0.93, 0.99, 1.07), vec3(0.85, 0.9, 1.15), uNight);   // cool teal/blue shadows
      vec3 lightTint = mix(vec3(0.99, 1.0, 1.0), vec3(1.06, 0.99, 0.92), uWarm);              // golden highlights
      c *= mix(shadowTint, lightTint, smoothstep(0.02, 0.5, l));
      c += vec3(0.005, 0.004, 0.002) * (1.0 - uNight);              // barely-lifted blacks (painted, not crushed)
      vec2 q = vUv - 0.5; c *= 1.0 - uVig * dot(q, q) * 2.2;          // soft vignette
      gl_FragColor = vec4(c, 1.0);
    }`,
};
const composer = new EffectComposer(renderer);
const scenePass = new ScenePass(), bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 0.82), gradePass = new ShaderPass(GradeShader);
composer.addPass(scenePass); composer.addPass(bloomPass); composer.addPass(gradePass); composer.addPass(new OutputPass());
scene.fog = new THREE.Fog(0xe8e4d4, 70, 560); // warm aerial haze; colour follows the sky horizon

const SKY = { topDull: new THREE.Color(0x8ea6bf), botDull: new THREE.Color(0xe2dccb), top: new THREE.Color(0x4f9fe8), bot: new THREE.Color(0xf6e8c8) };
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: SKY.topDull.clone() }, bottom: { value: SKY.botDull.clone() }, sunDir: { value: new V3(0.5, 0.6, 0.3).normalize() }, glow: { value: new THREE.Color(0xffd9a0) }, glowK: { value: 1 } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
  // painted sky: zenith → mid blue → warm cream horizon band, plus a broad golden glow around the sun
  fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 glow; uniform float glowK; varying vec3 vW;
    void main(){ vec3 d = normalize(vW - cameraPosition); float h = d.y;
      float t = clamp(h * 1.25 + 0.06, 0.0, 1.0);
      vec3 mid = mix(bottom, top, 0.55);
      vec3 col = mix(bottom, mid, smoothstep(0.0, 0.35, t)); col = mix(col, top, smoothstep(0.3, 1.0, t));
      float sd = max(dot(d, normalize(sunDir)), 0.0);
      col += glow * glowK * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.35) * (1.0 - smoothstep(0.2, 0.9, h));
      col = mix(col, bottom * 1.02, (1.0 - smoothstep(-0.02, 0.12, h)) * 0.6);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
noOutline(skyMat);
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), skyMat); scene.add(sky);
const hemi = new THREE.HemisphereLight(0xd6ecff, 0x8c9a62, 1.1); scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.35); scene.add(amb);
const sun = new THREE.DirectionalLight(0xffe6c0, 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 420 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun); scene.add(sun.target);
const SUN_DIR = new V3(0.55, 0.75, 0.35).normalize();
const sunSprite = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,245,200,0.9)'); gr.addColorStop(1, 'rgba(255,230,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false, depthWrite: false, transparent: true })); s.scale.setScalar(160); scene.add(s); return s; })();

// ---------- Blender-authored assets (art/blender → public/assets/*.glb); everything falls back to procedural if missing ----------
async function loadAssets() {
  const loader = new GLTFLoader(), A = {}, status = document.getElementById('menuStatus');
  if (status) status.textContent = 'Loading 3D models…';
  await Promise.all(['character', 'thornheart', 'trees', 'props'].map(n => loader.loadAsync(`assets/${n}.glb`).then(g => { A[n] = g; }).catch(e => console.warn(`[assets] ${n}.glb unavailable, using procedural fallback`, e))));
  if (status && status.textContent === 'Loading 3D models…') status.textContent = '';
  return A;
}
const ASSETS = await loadAssets();
await RAPIER.init(); // WASM rigid-body physics for dynamic world objects (crates, seed-stones)
const assetNode = (key, name) => ASSETS[key] ? ASSETS[key].scene.getObjectByName(name) : null;
// Bake a Blender prop into the static batch at a placement, with materials chosen by role name.
function putAsset(obj, matFor, x, y, z, ry = 0, s = 1) {
  if (!obj) return false;
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert(), place = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), ry), new V3(s, s, s));
  obj.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(place.clone().multiply(inv.clone().multiply(o.matrixWorld)));
    world.addStatic(g, matFor(o.material.name, o.material));
  });
  return true;
}
const PROP_COL = { Stone: PAL.stone, Trim: PAL.teal, Metal: PAL.metal, Wood: PAL.wood, Brass: PAL.brass, Leaves: PAL.leaf, Rock: 0x9aa7b0, Bird: 0x7ec8e3, Beak: 0xffb74d, Eye: 0x222222 };
const propMat = tier => (name, src) => name === 'Glow' ? world.lampMat : (tier == null ? toon(PROP_COL[name] ?? src.color.getHex()) : tmat(tier, PROP_COL[name] ?? src.color.getHex()));
// Re-material a live (non-batched) asset instance.
function toonize(root, pick) { root.traverse(o => { if (!o.isMesh) return; o.material = pick(o.material.name, o.material) || toon(o.material.color.getHex()); o.castShadow = true; o.receiveShadow = true; }); return root; }

const phys = new Physics();
const world = new World(scene, phys);
world.build();
const player = new PlayerController(phys, world);
const SPAWN = new V3(8, 0.5, 58);
player.spawn(SPAWN);
const selfModel = makeCharacter(DEFAULT_LOOK); scene.add(selfModel.group);
const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineBasicMaterial({ color: 0x5d4037 })); rope.visible = false; rope.frustumCulled = false; scene.add(rope);

const game = {
  world, player, net: null, selfName: 'Wanderer', selfColor: LOOK_OPTS.outfit[0], selfLook: { ...DEFAULT_LOOK }, remotes: new Map(),
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
  const relicChip = `<div class="chip" title="Seed Relics found">🌰 ${relicsFound()}/${relics.length}</div>`;
  $('inventory').innerHTML = RES.map(k => `<div class="chip${bump === k ? ' bump' : ''}" title="${RES_NAME[k]}">${RES_ICON[k]} ${game.inventory[k]}</div>`).join('') + relicChip;
  if (bump) setTimeout(() => renderInventory(), 160);
}
function renderObjectives() {
  let h = '<h3>Restoration</h3>';
  for (let t = 2; t >= 0; t--) {
    h += `<div class="tierh">${TIER_NAMES[t]}</div>`;
    for (const d of NODE_DEFS.filter(d => d.tier === t)) {
      const n = world.nodes.get(d.id), tot = RES.reduce((a, k) => a + (d.req[k] || 0), 0) + CFG.CALIBRATIONS;
      const have = RES.reduce((a, k) => a + Math.min(n.cur[k], d.req[k] || 0), 0) + n.calib;
      h += `<div class="obj${n.restored ? ' done' : ''}">${n.restored ? '✅' : TYPE_ICON[d.type]}<span class="nm">${game.tracked === d.id ? '📍 ' : ''}${d.name}</span><span class="bar"><i style="width:${(n.restored ? 1 : have / tot) * 100}%;background:${hexStr(TYPE_COLOR[d.type])}"></i></span></div>`;
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
function showRegionText(name, sub) { $('region').innerHTML = `${esc(name)}<small>${esc(sub)}</small>`; $('region').classList.add('show'); clearTimeout(ui.regionTimer); ui.regionTimer = setTimeout(() => $('region').classList.remove('show'), 3500); }
function showRegion(t) {
  $('region').innerHTML = `${TIER_NAMES[t]}<small>${TIER_SUB[t]}</small>`; $('region').classList.add('show');
  clearTimeout(ui.regionTimer); ui.regionTimer = setTimeout(() => $('region').classList.remove('show'), 3000);
}
$('help').innerHTML = `<b>Controls</b><br><span class="key">WASD</span> move  <span class="key">Shift</span> sprint<br><span class="key">Space</span> jump · again in air = glider<br>Walk into a wall to <b>climb</b> (uses stamina)<br>On wall: <span class="key">Space</span> leap off, <span class="key">W</span>+<span class="key">Space</span> dash up, <span class="key">X</span> let go<br><span class="key">F</span>/<span class="key">RMB</span> grapple to a gold ring<br><span class="key">Q</span> scanner (nodes, resources, thermals)<br><span class="key">E</span> inspect node · <span class="key">1</span><span class="key">2</span><span class="key">3</span> deliver · <span class="key">R</span> calibrate<br><span class="key">T</span> track next node · <span class="key">G</span>/<span class="key">MMB</span> ping<br><span class="key">B</span> then <span class="key">1</span>–<span class="key">4</span> emote · <span class="key">E</span> ride sky-lines<br><span class="key">J</span> quest log · talk to the Keepers (E)<br><span class="key">I</span> backpack & crafting · <span class="key">1</span>–<span class="key">5</span> tools · <span class="key">LMB</span>/<span class="key">V</span> use<br><span class="key">Enter</span> chat · <span class="key">H</span> toggle help<br><span class="key">Esc</span> game menu (resume / leave)<br><br><i>Glide into rising thermals to gain height. Restore nodes to bring water, light and greenery back — and to open new routes for everyone.</i>`;
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

// Graphics quality presets (render resolution, shadow detail, ink outlines, grass density)
const GFX = {
  low: { pr: () => Math.min(1, devicePixelRatio), shadow: 1024, outline: false, grass: 0.18, post: false, bloom: false },
  medium: { pr: () => Math.min(1.5, devicePixelRatio), shadow: 2048, outline: true, grass: 0.4, post: true, bloom: false },
  high: { pr: () => Math.min(2, Math.max(1.25, devicePixelRatio)), shadow: 4096, outline: true, grass: 0.65, post: true, bloom: true },
  ultra: { pr: () => Math.min(3, Math.max(2, devicePixelRatio * 1.5)), shadow: 4096, outline: true, grass: 1, post: true, bloom: true },
};
let gfxKey = 'high'; try { const g = localStorage.getItem('canopy-spire-gfx'); if (Object.hasOwn(GFX, g)) gfxKey = g; } catch (_) {}
function applyGfx(k) {
  if (!Object.hasOwn(GFX, k)) k = 'high'; gfxKey = k; const q = GFX[k];
  renderer.setPixelRatio(q.pr()); renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(q.pr()); composer.setSize(innerWidth, innerHeight); bloomPass.enabled = q.bloom; scenePass.outline = q.outline;
  if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  world.setGrassDensity(q.grass);
  try { localStorage.setItem('canopy-spire-gfx', k); } catch (_) {}
  for (const id of ['gfxSel', 'gfxSelPause']) $(id).value = k;
}
for (const id of ['gfxSel', 'gfxSelPause']) $(id).addEventListener('change', e => applyGfx(e.target.value));
applyGfx(gfxKey);
let fpsAvg = 60;

// Scanner labels
const nodeLabels = new Map(); for (const n of world.nodes.values()) nodeLabels.set(n.id, mkLabel('node', ''));
const pickLabels = world.pickups.map(p => mkLabel('pick', RES_ICON[p.type]));
const thermLabels = Object.values(world.thermals).map(th => ({ th, el: mkLabel('therm', '') }));
const anchorLabels = world.anchors.map(a => ({ a, el: mkLabel('anch', '◎') }));

// =====================================================================
// REMOTE PLAYERS
// =====================================================================
game.addRemote = (id, name, color, p, r, s, look) => {
  id = safeId(id); if (!id || id === game.net.selfId || game.remotes.has(id) || game.remotes.size >= CFG.MAX_PLAYERS - 1) return;
  name = safeName(name); look = safeLook(look); color = lookColor(look); p = safeVec(p); r = safeNum(r, -1e3, 1e3, 0); s = safeState(s);
  const model = makeCharacter(look); scene.add(model.group);
  const rp = { id, name, color, look, model, pos: new V3(...(p || [0, -100, 0])), target: new V3(...(p || [0, -100, 0])), yaw: r || 0, tYaw: r || 0, state: s || 'IDLE', label: mkLabel('name', `<span style="color:${color}">●</span> ${esc(name)}`) };
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
      const id = safeId(m.id); if (!id) break; game.net.selfId = id; game.tod = safeNum(m.tod, 0, 0.9999, game.tod);
      const wn = (m.world && m.world.nodes) || {};
      for (const d of NODE_DEFS) { const s = Object.hasOwn(wn, d.id) ? wn[d.id] : null; if (!s) continue; world.setNodeProgress(d.id, s.cur, s.calib); if (s.restored === true) world.restoreNode(d.id, true); }
      if (m.world && m.world.puzzles && typeof m.world.puzzles === 'object') applyPuzzleAll(m.world.puzzles);
      if (m.world && m.world.env) applyEnv(m.world.env);
      if (m.world && m.world.boss) applyBoss(m.world.boss);
      if (m.world && Array.isArray(m.world.bodies)) dynApply(m.world.bodies, true);
      for (const pid of Array.isArray(m.world && m.world.taken) ? m.world.taken : []) if (game.validPid(pid)) world.setPickupAvailable(pid, false);
      for (const p of Array.isArray(m.players) ? m.players.slice(0, CFG.MAX_PLAYERS) : []) if (p && p.id !== id) game.addRemote(p.id, p.name, p.color, p.p, p.r, p.s, p.look);
      renderObjectives(); break;
    }
    case 'PLAYER_JOIN': { if (!safeId(m.id) || game.remotes.has(m.id)) break; const nm = safeName(m.name); game.addRemote(m.id, nm, m.color, undefined, undefined, undefined, m.look); chatLine('', '', `${esc(nm)} joined the spire`, true); game.toast(`👋 ${esc(nm)} joined`); break; }
    case 'PLAYER_LEAVE': { const r = game.remotes.get(m.id); if (r) chatLine('', '', `${esc(r.name)} left`, true); game.removeRemote(m.id); break; }
    case 'PLAYER_MOVE': { const r = game.remotes.get(m.id), p = safeVec(m.p); if (!r || !p) break; r.target.set(p[0], p[1], p[2]); if (r.pos.y < -50) r.pos.copy(r.target); r.tYaw = safeNum(m.r, -1e3, 1e3, r.tYaw); r.state = safeState(m.s); r.emote = safeInt(m.e, 0, 4); r.tool = safeInt(m.k, 0, 5); r.use = m.u === true; break; }
    case 'PING': { const p = safeVec(m.p); if (typeof m.id === 'string' && p) showPing(m.id, new V3(p[0], p[1], p[2])); break; }
    case 'NODE_PROGRESS_UPDATE': {
      if (!isNodeId(m.node)) break;
      world.setNodeProgress(m.node, m.cur, m.calib); const res = safeRes(m.res); const calib = world.nodes.get(m.node).calib; renderObjectives(); if (ui.panelNode === m.node) renderNodePanel();
      const nm = NODE_DEF[m.node].name;
      if (Object.keys(res).length) game.toast(`${playerName(m.by)} delivered ${Object.entries(res).map(([k, v]) => v + RES_ICON[k]).join(' ')} → ${nm}`);
      if (m.by === game.net.selfId && Object.keys(res).length) sfx.play('deliver');
      if (m.calibrated === true) sfx.play('calib');
      if (m.calibrated === true) game.toast(`🔧 ${playerName(m.by)} calibrated ${nm} (${calib}/${CFG.CALIBRATIONS})`);
      break;
    }
    case 'NODE_RESTORED': {
      if (!isNodeId(m.node)) break; const def = NODE_DEF[m.node];
      world.restoreNode(m.node); sfx.play('restore'); renderObjectives(); if (ui.panelNode === m.node) renderNodePanel();
      game.toast(`${TYPE_ICON[def.type]} ${def.name} restored!`, true);
      chatLine('', '', `✨ ${playerName(m.by)} completed the ${def.name}.`, true);
      break;
    }
    case 'PICKUP_TAKEN': {
      if (!game.validPid(m.pid)) break;
      const wasAvail = world.pickups[m.pid].available || world.pickups[m.pid].pending;
      world.setPickupAvailable(m.pid, false);
      if (m.by === game.net.selfId && wasAvail) { const p = world.pickups[m.pid]; game.inventory[p.type]++; sfx.play('pickup', p.type); renderInventory(p.type); if (ui.panelNode) renderNodePanel(); }
      break;
    }
    case 'ENV_STATE': applyEnv(m.s); break;
    case 'BOSS_STATE': applyBoss(m.s); break;
    case 'BOSS_WAVE': onBossWave(); break;
    case 'PUZZLE_STATE': if (typeof m.id === 'string') applyPuzzleState(m.id, m.s); break;
    case 'BODIES': if (!game.net.isAuthority && Array.isArray(m.b)) dynApply(m.b, false); break;
    case 'PICKUP_RESPAWN': if (game.validPid(m.pid)) world.setPickupAvailable(m.pid, true); break;
    case 'REFUND': { const res = safeRes(m.res); for (const k of RES) game.inventory[k] += res[k] || 0; renderInventory(); if (ui.panelNode) renderNodePanel(); break; }
    case 'CHAT': { const text = safeText(m.text); if (text) { chatLine(safeName(m.name), safeColor(m.color), text); sfx.play('chat'); } break; }
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
  if (['Space', 'Tab', 'KeyQ', 'KeyF', 'KeyI'].includes(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('mousedown', e => {
  if (!game.playing) return;
  if (document.pointerLockElement !== renderer.domElement) { lockPointer(); return; }
  if (e.button === 2) pressed.add('Grapple');
  if (e.button === 0) pressed.add('Use');
  if (e.button === 1) { e.preventDefault(); pressed.add('Ping'); }
});
$('btnResume').addEventListener('click', () => lockPointer());
$('pause').addEventListener('click', e => { if (e.target === $('pause')) lockPointer(); });
$('btnInvite').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '?room=' + game.net.code;
  try { await navigator.clipboard.writeText(url); $('btnInvite').textContent = '✓ Copied!'; } catch (_) { $('btnInvite').textContent = url; }
  setTimeout(() => $('btnInvite').textContent = 'Copy invite link', 2500);
});
$('btnLeave').addEventListener('click', () => {
  if (game.net.mode === 'host' && game.net.conns.size > 0 && !confirm('You are hosting — leaving closes the room for everyone. Leave?')) return;
  saveGame(); game.net.destroy(); game.playing = false;
  location.href = location.pathname; // clean return to the home screen (drops ?solo / ?room)
});
function renderPauseInfo() {
  const N = game.net, done = [...world.nodes.values()].filter(n => n.restored).length;
  let h = N.mode === 'offline' ? '<b>Solo session</b>' : N.mode === 'host' ? `<b>Hosting room ${esc(N.code)}</b> · ${game.remotes.size} friend(s) here` : `<b>In room ${esc(N.code)}</b> (guest)`;
  h += `<br>Spire restored: <b>${done}/${NODE_DEFS.length}</b><br>`;
  h += game.ownsWorld ? '💾 Progress saves automatically in this browser.' : '👥 This is the host’s spire — progress is saved on their side.';
  if (N.mode !== 'offline') h += '<br><span style="font-size:12px">The world keeps running while this menu is open.</span>';
  $('pauseInfo').innerHTML = h;
  $('btnInvite').classList.toggle('hidden', N.mode === 'offline');
}
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  cam.yaw -= e.movementX * 0.0025; cam.pitch = clamp(cam.pitch + e.movementY * 0.0025, -0.55, 1.35);
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked && ui.bagOpen) { ui.bagOpen = false; $('bag').classList.add('hidden'); }
  const show = !locked && game.playing && !ui.chatOpen && !ui.bagOpen;
  if (show) { renderPauseInfo(); keys.clear(); saveGame(); }
  $('pause').classList.toggle('hidden', !show);
});
addEventListener('wheel', e => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 0.8, 3.5, 14); });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
addEventListener('beforeunload', () => game.net.destroy());
addEventListener('pagehide', () => saveGame());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

function readInput() {
  const k = c => keys.has(c), p = c => pressed.has(c);
  const busy = !!ui.mg || dlg.open || ui.bagOpen;
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
  game.inventory[k] -= amt; renderInventory(); saveSoon();
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
    else { mg.lock = 0.7; $('minigame').classList.add('miss'); sfx.play('miss'); }
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
      else if (myStone()) dropStone();
      else if (near && !(nearestInteract() || {}).prio) { ui.panelNode = near.id; renderNodePanel(); }
      else { const it = nearestInteract(); if (it && it.act) it.act(); }
    }
    if (ui.panelNode) {
      if (pressed.has('Digit1')) deliver('energy'); if (pressed.has('Digit2')) deliver('bio'); if (pressed.has('Digit3')) deliver('scrap');
      const n = world.nodes.get(ui.panelNode);
      if (pressed.has('KeyR') && !n.restored) { if (world.nodeComplete(n)) openMinigame(n); else game.toast('Deliver all materials first.'); }
    }
  }
  const pr = $('prompt');
  if (!ui.panelNode && near) { pr.innerHTML = near.restored ? `${TYPE_ICON[near.def.type]} ${near.def.name} — <b style="color:#b9f6ca">Restored</b>` : `<span class="key">E</span> Inspect ${near.def.name}`; pr.classList.remove('hidden'); }
  else { const it = !ui.panelNode && !dlg.open && (myStone() ? { label: () => '<span class="key">E</span> Set down the seed-stone' } : nearestInteract()); if (it) { pr.innerHTML = it.label(); pr.classList.remove('hidden'); } else pr.classList.add('hidden'); }
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
  if (game.realm === 'main' && t !== ui.region && player.grounded) { ui.region = t; showRegion(t); }
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
  $('stateTag').textContent = `${Math.round(fpsAvg)} fps · ${player.state}${player.inThermal ? ' · THERMAL' : ''}${player.exhausted ? ' · EXHAUSTED' : ''} · ${player.pos.x.toFixed(0)}, ${player.pos.y.toFixed(0)}, ${player.pos.z.toFixed(0)}`;
}

// =====================================================================
// FEATURE PACK — sound & music, compass & tracking, pings, emotes,
// sky-lines, bounce blooms, day/night, wildlife, seed relics, ring courses
// =====================================================================
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

// ---------- 1. Procedural sound & generative music (Web Audio, no files) ----------
class SoundFX {
  constructor() { this.ctx = null; this.vol = clamp(Number(store.get('canopy-spire-vol', 0.7)) || 0, 0, 1); this.noteT = 1; this.padT = 3; this.chirpT = 4; this.cricketT = 1; this.stepT = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.5; this.mus.connect(this.master);
    const dl = c.createDelay(1.0), fb = c.createGain(), lp = c.createBiquadFilter(); dl.delayTime.value = 0.36; fb.gain.value = 0.38; lp.frequency.value = 2400;
    this.mus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = buf;
    this.wind = this.bed(380, 0.5); this.water = this.bed(1100, 0.35, 'bandpass'); this.rush = this.bed(900, 1.1, 'bandpass');
  }
  bed(freq, q, type = 'lowpass') { const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { g, f }; }
  setVolume(v) { this.vol = clamp(v, 0, 1); if (this.master) this.master.gain.setTargetAtTime(this.vol, this.ctx.currentTime, 0.05); store.set('canopy-spire-vol', this.vol); }
  tone(freq, dur = 0.2, o = {}) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain(), v = o.vol ?? 0.15;
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t); if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || this.sfx); osc.start(t); osc.stop(t + dur + 0.05);
  }
  noise(dur = 0.15, o = {}) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + (o.delay || 0), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.freq || 1000, t); if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + dur); f.Q.value = o.q ?? 1;
    g.gain.setValueAtTime(o.vol ?? 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  arp(notes, step = 0.07, o = {}) { notes.forEach((n, i) => this.tone(n, o.dur || 0.35, { ...o, delay: (o.delay || 0) + i * step })); }
  play(name, arg) {
    if (!this.ctx) return;
    switch (name) {
      case 'step': this.noise(0.07, { freq: 260 + Math.random() * 220, type: 'lowpass', vol: 0.09 }); break;
      case 'climb': this.noise(0.09, { freq: 1400, q: 0.7, vol: 0.05 }); break;
      case 'jump': this.tone(330, 0.16, { type: 'triangle', slide: 620, vol: 0.09 }); break;
      case 'land': this.noise(0.18, { freq: 160, type: 'lowpass', vol: Math.min(0.35, 0.12 + (arg || 0) * 0.01) }); break;
      case 'glide': this.noise(0.55, { freq: 380, slide: 2000, q: 0.6, vol: 0.14 }); this.tone(520, 0.12, { type: 'triangle', vol: 0.05 }); break;
      case 'grapple': this.tone(1100, 0.28, { type: 'sawtooth', slide: 240, vol: 0.035 }); this.tone(1900, 0.06, { type: 'square', vol: 0.03, delay: 0.28 }); break;
      case 'zip': this.noise(0.4, { freq: 2600, q: 2, vol: 0.06 }); this.tone(1500, 0.08, { type: 'square', vol: 0.025 }); break;
      case 'bounce': this.tone(180, 0.38, { slide: 880, vol: 0.18 }); this.tone(360, 0.3, { slide: 1300, type: 'triangle', vol: 0.06, delay: 0.03 }); break;
      case 'pickup': {
        const k = arg === 'energy' ? [880, 1319, 1760] : arg === 'bio' ? [523, 659, 784] : [1175, 1568];
        this.arp(k, 0.055, { type: arg === 'scrap' ? 'square' : arg === 'bio' ? 'triangle' : 'sine', vol: arg === 'scrap' ? 0.035 : 0.09, dur: 0.25 }); break;
      }
      case 'deliver': this.tone(196, 0.3, { type: 'triangle', vol: 0.18 }); this.tone(392, 0.3, { vol: 0.1, delay: 0.08 }); break;
      case 'calib': this.arp([523, 659, 784, 1047], 0.06, { type: 'triangle', vol: 0.1 }); break;
      case 'miss': this.tone(140, 0.25, { type: 'square', vol: 0.05 }); break;
      case 'restore': this.arp([392, 523, 659, 784, 1047, 1319], 0.11, { dur: 1.6, vol: 0.1, type: 'triangle' }); this.noise(1.8, { freq: 6000, q: 0.5, vol: 0.05, delay: 0.3 }); break;
      case 'ping': this.tone(1047, 0.12, { vol: 0.09 }); this.tone(1568, 0.2, { vol: 0.09, delay: 0.1 }); break;
      case 'chat': this.tone(740, 0.08, { vol: 0.04 }); break;
      case 'relic': this.arp([784, 988, 1175, 1568, 1976, 2349], 0.08, { dur: 0.9, vol: 0.08 }); this.noise(1.2, { freq: 7000, q: 0.4, vol: 0.04 }); break;
      case 'ring': this.tone(440 * Math.pow(2, (arg || 0) / 12 * 2), 0.3, { type: 'triangle', vol: 0.12 }); break;
      case 'finish': this.arp([523, 659, 784, 1047, 784, 1047, 1319], 0.09, { dur: 0.6, type: 'triangle', vol: 0.11 }); break;
      case 'fail': this.tone(330, 0.35, { slide: 160, type: 'triangle', vol: 0.09 }); break;
      case 'exhausted': this.tone(240, 0.45, { slide: 120, type: 'triangle', vol: 0.08 }); break;
      case 'emote': this.tone(660, 0.12, { type: 'triangle', vol: 0.06 }); this.tone(880, 0.14, { type: 'triangle', vol: 0.06, delay: 0.09 }); break;
      case 'ui': this.tone(900, 0.05, { vol: 0.03 }); break;
      case 'portal': this.noise(0.9, { freq: 300, slide: 3200, q: 0.6, vol: 0.18 }); this.arp([392, 523, 784, 1047], 0.06, { dur: 0.5, vol: 0.07 }); break;
      case 'quest': this.arp([523, 659, 784], 0.09, { type: 'triangle', dur: 0.5, vol: 0.1 }); break;
      case 'plate': this.tone(150, 0.25, { type: 'triangle', vol: 0.15 }); this.noise(0.15, { freq: 200, type: 'lowpass', vol: 0.15 }); break;
      case 'door': this.noise(2.2, { freq: 120, type: 'lowpass', vol: 0.3 }); this.tone(80, 2, { type: 'sawtooth', vol: 0.03 }); break;
      case 'rotate': this.noise(0.2, { freq: 900, q: 3, vol: 0.08 }); this.tone(600, 0.08, { type: 'square', vol: 0.02 }); break;
      case 'water': this.noise(0.5, { freq: 2600, q: 0.8, vol: 0.12 }); this.noise(0.3, { freq: 900, q: 2, vol: 0.06, delay: 0.1 }); break;
      case 'lantern': this.tone(1200, 0.06, { type: 'square', vol: 0.03 }); this.tone(700, 0.25, { type: 'triangle', vol: 0.06, delay: 0.04 }); break;
      case 'horn': this.tone(196, 0.9, { type: 'sawtooth', vol: 0.06, attack: 0.08 }); this.tone(294, 0.9, { type: 'sawtooth', vol: 0.04, attack: 0.08 }); this.noise(0.8, { freq: 500, slide: 1500, vol: 0.1 }); break;
      case 'plant': this.tone(300, 0.15, { slide: 600, type: 'triangle', vol: 0.1 }); this.noise(0.2, { freq: 300, type: 'lowpass', vol: 0.1 }); break;
      case 'craft': this.tone(1400, 0.06, { type: 'square', vol: 0.03 }); this.tone(1000, 0.06, { type: 'square', vol: 0.03, delay: 0.08 }); this.arp([523, 784, 1047], 0.07, { type: 'triangle', vol: 0.08, delay: 0.16 }); break;
      case 'roar': this.noise(1.4, { freq: 140, q: 0.7, type: 'lowpass', vol: 0.35 }); this.tone(70, 1.4, { type: 'sawtooth', vol: 0.06, slide: 55 }); break;
      case 'wave': this.noise(0.8, { freq: 400, slide: 160, q: 0.8, vol: 0.14 }); break;
      case 'hit': this.noise(0.25, { freq: 900, q: 1.5, vol: 0.2 }); this.tone(220, 0.25, { slide: 110, type: 'square', vol: 0.05 }); break;
      case 'dialog': this.tone(880 + Math.random() * 120, 0.05, { type: 'triangle', vol: 0.04 }); break;
    }
  }
  // ambience + music: called every frame with a summary of the scene
  update(dt, s) {
    if (!this.ctx) return; const now = this.ctx.currentTime;
    this.wind.g.gain.setTargetAtTime(0.015 + clamp(s.alt / 110, 0, 1) * 0.11 + (s.speed > 12 ? 0.04 : 0), now, 0.4);
    this.wind.f.frequency.setTargetAtTime(300 + clamp(s.alt / 100, 0, 1) * 500, now, 0.5);
    this.rush.g.gain.setTargetAtTime(s.gliding || s.zipping ? 0.02 + s.speed * 0.006 : 0, now, 0.15);
    this.water.g.gain.setTargetAtTime(s.water * 0.16, now, 0.4);
    // wildlife ambience
    this.chirpT -= dt; this.cricketT -= dt;
    if (s.day > 0.5 && s.vib > 0.35 && this.chirpT <= 0) { this.chirpT = 1.5 + Math.random() * 4 / s.vib; const f = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.tone(f * (1 + Math.random() * 0.15), 0.07, { slide: f * 1.35, vol: 0.022, delay: i * 0.11 }); }
    if (s.day < 0.4 && this.cricketT <= 0) { this.cricketT = 0.35 + Math.random() * 0.5; for (let i = 0; i < 3; i++) this.noise(0.03, { freq: 4800, q: 8, vol: 0.02, delay: i * 0.06 }); }
    // generative pentatonic music — density & register grow with restoration
    if (!s.playing) return;
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3, 784.0, 880.0];
    this.noteT -= dt; this.padT -= dt;
    if (this.noteT <= 0) {
      this.noteT = lerp(2.6, 1.0, s.progress) * (0.6 + Math.random() * 0.8) * (s.day < 0.4 ? 1.5 : 1);
      const top = 5 + Math.round(s.progress * 5), n = scale[Math.floor(Math.random() * top)] * (s.day < 0.4 ? 0.5 : 1);
      this.tone(n, 2.4, { type: 'triangle', vol: 0.035 + s.progress * 0.02, attack: 0.04, bus: this.mus });
      if (s.progress > 0.4 && Math.random() < 0.35) this.tone(n * 1.5, 1.8, { type: 'sine', vol: 0.02, attack: 0.05, delay: 0.25, bus: this.mus });
    }
    if (this.padT <= 0) {
      this.padT = 7 + Math.random() * 4; const roots = [130.8, 146.8, 174.6, 196.0], r = roots[Math.floor(Math.random() * roots.length)];
      for (const m of [1, 1.25, 1.5]) this.tone(r * m, 6, { type: 'sine', vol: 0.018 + s.progress * 0.012, attack: 1.5, bus: this.mus });
    }
  }
}
const sfx = new SoundFX();

// ---------- 5. Sky-lines (ziplines) ----------
const zips = ZIPLINES.map(z => {
  const a = new V3(...z.a), b = new V3(...z.b), dir = b.clone().sub(a), len = dir.length(); dir.normalize();
  const hdir = new V3(dir.x, 0, dir.z).normalize();
  return { ...z, a, b, dir, hdir, len, active: !z.needs, cable: null, posts: [] };
});
(() => {
  const wood = tmat(1, PAL.wood, TEX.wood), metal = toon(PAL.metal), cableMat = toon(0x3b3b3b);
  for (const z of zips) {
    for (const [pt, sgn] of [[z.a, -1], [z.b, 1]]) {
      const px = pt.x + z.hdir.x * 0.8 * sgn, pz = pt.z + z.hdir.z * 0.8 * sgn, base = phys.surfaceY(px, pz, pt.y) ?? 0, h = pt.y + 0.5 - base;
      const pole = new THREE.Mesh(cylGeo(0.14, 0.2, h, 10, TEX.wood), wood); pole.position.set(px, base + h / 2, pz); pole.castShadow = true; scene.add(pole);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 6, 16), metal); wheel.position.set(px, pt.y + 0.1, pz); wheel.rotation.y = Math.atan2(z.hdir.x, z.hdir.z) + Math.PI / 2; scene.add(wheel);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), toon(0x4dd0e1, { side: THREE.DoubleSide })); flag.position.set(px + 0.35, pt.y + 0.9, pz); scene.add(flag);
      phys.add(px - 0.15, base, pz - 0.15, px + 0.15, base + h, pz + 0.15, 'post');
      z.posts.push({ x: px, z: pz, top: base + h, flag });
    }
    const cg = new THREE.CylinderGeometry(0.035, 0.035, z.len, 6); cg.rotateX(Math.PI / 2);
    z.cable = new THREE.Mesh(cg, cableMat); z.cable.position.copy(z.a).add(z.b).multiplyScalar(0.5); z.cable.lookAt(z.b); z.cable.visible = z.active; scene.add(z.cable);
    for (const p of z.posts) p.flag.material = toon(z.active ? 0x4dd0e1 : 0x9e9e9e, { side: THREE.DoubleSide });
  }
})();
function refreshZips() {
  for (const z of zips) { const on = !z.needs || world.nodes.get(z.needs).restored; if (on === z.active) continue; z.active = on; z.cable.visible = on; for (const p of z.posts) p.flag.material = toon(on ? 0x4dd0e1 : 0x9e9e9e, { side: THREE.DoubleSide }); if (on && game.playing) game.toast('🚡 New sky-lines are running from the Apex Crown!'); }
}
function nearestZip() {
  let best = null, bd = 3.2; const hp = player.pos.clone(); hp.y += 1.95;
  for (const z of zips) { const d = hp.distanceTo(z.a); if (d < bd) { bd = d; best = z; } }
  return best;
}

// ---------- 6. Bounce blooms ----------
const pads = BOUNCE_PADS.map(([x, y, z, tier]) => {
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  const stem = new THREE.Mesh(cylGeo(0.35, 0.5, 0.55, 12), tmat(Math.max(0, tier ?? 0), PAL.leaf3)); stem.position.y = 0.27; g.add(stem);
  const cap = new THREE.Group(); cap.position.y = 0.55; g.add(cap);
  const disc = new THREE.Mesh(new THREE.SphereGeometry(1.25, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xff7eb3)); disc.scale.y = 0.28; disc.castShadow = true; cap.add(disc);
  for (let i = 0; i < 10; i++) { const p = new THREE.Mesh(ICO1, toon(i % 2 ? 0xffb3d1 : 0xff5c9a)); const a = i / 10 * Math.PI * 2; p.scale.set(0.55, 0.12, 0.3); p.position.set(Math.cos(a) * 1.3, 0.05, Math.sin(a) * 1.3); p.rotation.y = -a; cap.add(p); }
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8), toon(0xffe066, { emissive: 0xffc107, emissiveIntensity: 0.3 })); dot.position.y = 0.3; dot.scale.y = 0.5; cap.add(dot);
  const col = phys.add(x - 1.25, y, z - 1.25, x + 1.25, y + 0.7, z + 1.25, 'bounce');
  for (const p of world.pickups) if (Math.hypot(p.pos.x - x, p.pos.z - z) < 1.6 && Math.abs(p.pos.y - y) < 2) { p.pos.y = y + 1.6; p.mesh.position.y = p.pos.y; }
  return { g, cap, col, tier, active: true, squash: 0 };
});
function refreshPads() {
  for (const p of pads) { const on = p.tier === null || world.vibTarget[p.tier] > 0.2; if (on === p.active) continue; p.active = on; p.col.enabled = on; p.g.visible = on; if (on && game.playing) { world.burst(p.g.position.clone().add(new V3(0, 1, 0)), 0xff7eb3, 80); } }
}

// ---------- 7. Day / night ----------
game.tod = 0.33; // 0 midnight · 0.25 sunrise · 0.5 noon · 0.75 sunset
const DAY_LEN = 720; // seconds for a full cycle at day speed (nights pass twice as fast)
const NIGHT = { top: new THREE.Color(0x0c1a3d), bot: new THREE.Color(0x24375f), sunset: new THREE.Color(0xff9a62) };
const stars = (() => {
  const N = 1400, p = new Float32Array(N * 3), r = mulberry32(99);
  for (let i = 0; i < N; i++) { const u = r() * 2 - 1, th = r() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, s = Math.sqrt(1 - y * y); p[i * 3] = Math.cos(th) * s * 1000; p[i * 3 + 1] = y * 1000; p[i * 3 + 2] = Math.sin(th) * s * 1000; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, map: DOT_TEX, transparent: true, opacity: 0, depthWrite: false, fog: false })); m.frustumCulled = false; scene.add(m); return m;
})();
const moon = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(245,248,255,1)'); gr.addColorStop(0.42, 'rgba(230,238,255,0.95)'); gr.addColorStop(0.5, 'rgba(200,215,255,0.25)'); gr.addColorStop(1, 'rgba(200,215,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false, transparent: true })); s.scale.setScalar(90); scene.add(s); return s; })();
const fireflies = (() => {
  const N = 260, pos = new Float32Array(N * 3), seed = [], r = mulberry32(5);
  for (let i = 0; i < N; i++) seed.push([(r() - 0.5) * 200, 0.6 + r() * 3, (r() - 0.5) * 200, r() * 6.28]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd4ff7a, size: 0.35, map: DOT_TEX, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); m.frustumCulled = false; scene.add(m);
  return { m, g, pos, seed, N };
})();
const winGlass = toon(0x9fe3ea, { emissive: 0x2a7f8a, emissiveIntensity: 0.12 }); // same cached material the windows use
const WIN_DAY = new THREE.Color(0x2a7f8a), WIN_NIGHT = new THREE.Color(0xffb85c);
const dayState = { day: 1, sunDir: new V3() };
const GROTTO_SKY = new THREE.Color(0x6a4fb0), GROTTO_FOG = new THREE.Color(0x8a6fc0), THORN_SKY = new THREE.Color(0x5a2a4a), THORN_FOG = new THREE.Color(0x8a5a7a), BLOOM_SKY = new THREE.Color(0x1a1050), BLOOM_FOG = new THREE.Color(0x2a2a60);
function updateDayNight(dt, gp) {
  const nightish = Math.sin((game.tod - 0.25) * Math.PI * 2) < 0;
  game.tod = (game.tod + dt / DAY_LEN * (nightish ? 2 : 1)) % 1;
  const phi = ((game.realm === 'bloomwood' ? 0.02 : game.tod) - 0.25) * Math.PI * 2, sh = Math.sin(phi);
  const sunDir = dayState.sunDir.set(Math.cos(phi) * 0.85, sh, 0.45).normalize();
  const day = smooth(-0.1, 0.18, sh); dayState.day = day;
  const sunset = clamp(1 - Math.abs(sh) * 4, 0, 1) * smooth(-0.15, 0.05, sh);
  // sky & fog
  const top = skyMat.uniforms.top.value, bot = skyMat.uniforms.bottom.value;
  top.lerpColors(SKY.topDull, SKY.top, gp).lerp(NIGHT.top, 1 - day);
  bot.lerpColors(SKY.botDull, SKY.bot, gp).lerp(NIGHT.bot, 1 - day).lerp(NIGHT.sunset, sunset * 0.55);
  if (game.realm === 'grotto') { top.lerp(GROTTO_SKY, 0.45); bot.lerp(GROTTO_FOG, 0.5); }
  if (game.realm === 'thornwood' && game.boss.phase !== 4) { top.lerp(THORN_SKY, 0.5); bot.lerp(THORN_FOG, 0.5); }
  if (game.realm === 'bloomwood') { top.lerp(BLOOM_SKY, 0.4); bot.lerp(BLOOM_FOG, 0.5); }
  scene.fog.color.copy(bot).lerp(top, 0.12);
  skyMat.uniforms.sunDir.value.copy(sunDir); skyMat.uniforms.glowK.value = smooth(-0.12, 0.08, sh) * (1 + sunset * 1.4);
  skyMat.uniforms.glow.value.setHex(0xffd9a0).lerp(NIGHT.sunset, sunset * 0.7);
  // lights: sun by day, moon by night
  const moonDir = sunDir.clone().multiplyScalar(-1); moonDir.y = Math.abs(moonDir.y) + 0.25; moonDir.normalize();
  const lightDir = day > 0.5 ? sunDir : moonDir;
  sun.color.setHex(day > 0.5 ? 0xffe6c0 : 0x9fb6ff).lerp(NIGHT.sunset, sunset * 0.5);
  sun.intensity = day > 0.5 ? (2.0 + gp) * smooth(0.5, 1, day) : 0.55 * smooth(0.5, 0, day);
  hemi.intensity = lerp(0.32, 0.85 + gp * 0.5, day); amb.intensity = lerp(0.22, 0.35, day);
  const focus = game.playing ? player.pos : new V3(0, 40, 0);
  sun.position.copy(focus).addScaledVector(lightDir, 200); sun.target.position.copy(focus);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 900); sunSprite.material.opacity = smooth(-0.08, 0.05, sh);
  moon.position.copy(camera.position).addScaledVector(moonDir, 900); moon.material.opacity = 1 - day;
  stars.position.copy(camera.position); stars.material.opacity = (1 - day) * 0.95;
  // night lights
  world.lampMat.emissiveIntensity = 0.25 + 0.9 * gp * 0.4 + (1 - day) * 1.6;
  winGlass.emissive.lerpColors(WIN_DAY, WIN_NIGHT, 1 - day); winGlass.emissiveIntensity = lerp(0.12, 0.75, 1 - day);
  // fireflies (only where the lower deck has bloomed)
  const ff = fireflies, op = (1 - day) * clamp(world.vib[0] * 1.3 - 0.15, 0, 1);
  ff.m.material.opacity = op;
  if (op > 0.01) { const t = world.time; for (let i = 0; i < ff.N; i++) { const [x, y, z, ph] = ff.seed[i]; ff.pos[i * 3] = x + Math.sin(t * 0.4 + ph) * 2.5; ff.pos[i * 3 + 1] = y + Math.sin(t * 0.9 + ph * 3) * 0.5; ff.pos[i * 3 + 2] = z + Math.cos(t * 0.33 + ph) * 2.5; } ff.g.attributes.position.needsUpdate = true; ff.m.material.size = 0.3 + Math.sin(t * 6) * 0.05; }
}

// ---------- 8. Wildlife: butterflies by the flowerbeds, birds circling the spire ----------
const wildlife = (() => {
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.bezierCurveTo(0.05, 0.22, 0.32, 0.26, 0.3, 0.06); wing.bezierCurveTo(0.33, -0.1, 0.1, -0.2, 0, 0);
  const wl = new THREE.ShapeGeometry(wing, 6), wr = wl.clone(); wr.scale(-1, 1, 1);
  const bm = noOutline(new THREE.MeshToonMaterial({ gradientMap: GRAD, side: THREE.DoubleSide }));
  const NB = 42, L = new THREE.InstancedMesh(wl, bm, NB), R = new THREE.InstancedMesh(wr, bm, NB);
  const cols = [0xffd54f, 0xff8fb1, 0x81d4fa, 0xffffff, 0xff7043, 0xb39ddb], r = mulberry32(31);
  const spots = world.flowerSpots.length ? world.flowerSpots : [[0, 0, 60, 0]];
  const bs = [];
  for (let i = 0; i < NB; i++) { const s = spots[Math.floor(r() * spots.length)]; bs.push({ s, ph: r() * 6.28, rad: 1.5 + r() * 2.5, sp: 0.4 + r() * 0.5, h: 0.6 + r() * 1.8 }); const c = new THREE.Color(cols[i % cols.length]); L.setColorAt(i, c); R.setColorAt(i, c); }
  for (const m of [L, R]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  // birds
  const bw = new THREE.BufferGeometry(); bw.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, 0, 0, -0.2, 0.9, 0.05, -0.05], 3)); bw.computeVertexNormals();
  const bw2 = bw.clone(); bw2.scale(-1, 1, 1);
  const birdMat = noOutline(new THREE.MeshToonMaterial({ color: 0x3e4a5c, gradientMap: GRAD, side: THREE.DoubleSide }));
  const NBIRD = 24, BL = new THREE.InstancedMesh(bw, birdMat, NBIRD), BR = new THREE.InstancedMesh(bw2, birdMat, NBIRD), birds = [];
  for (let i = 0; i < NBIRD; i++) { const flock = i % 3; birds.push({ flock, off: Math.floor(i / 3), ph: r() * 6.28 }); }
  for (const m of [BL, BR]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V3(), p = new V3();
  return {
    update(dt, day) {
      const t = world.time;
      for (let i = 0; i < NB; i++) {
        const b = bs[i], [sx, sy, sz, tier] = b.s, vis = day * smooth(0.4, 0.7, world.vib[tier]) > 0.3 && (i / NB) < smooth(0.4, 0.95, world.vib[tier]) * day;
        const a = t * b.sp + b.ph, x = sx + Math.cos(a) * b.rad + Math.sin(a * 2.3) * 0.6, z = sz + Math.sin(a * 1.3) * b.rad, y = sy + b.h + Math.sin(a * 3.1) * 0.4;
        const flap = Math.sin(t * 22 + b.ph) * 1.1, yaw = -a * 1.1 + Math.PI / 2, s = vis ? 1 : 0;
        p.set(x, y, z); sc.set(s, s, s);
        e.set(0, yaw, flap, 'YXZ'); q.setFromEuler(e); L.setMatrixAt(i, m4.compose(p, q, sc));
        e.set(0, yaw, -flap, 'YXZ'); q.setFromEuler(e); R.setMatrixAt(i, m4.compose(p, q, sc));
      }
      L.instanceMatrix.needsUpdate = R.instanceMatrix.needsUpdate = true;
      const gp = (world.vib[0] + world.vib[1] + world.vib[2]) / 3, nb = Math.round(NBIRD * clamp(0.3 + gp, 0, 1) * day);
      for (let i = 0; i < NBIRD; i++) {
        const b = birds[i], R0 = 45 + b.flock * 22, A = t * (0.12 + b.flock * 0.03) * (b.flock === 1 ? -1 : 1) + b.flock * 2.1 + b.off * 0.05;
        const x = Math.cos(A) * (R0 + b.off * 1.6) + Math.sin(b.off * 1.7) * 2, z = Math.sin(A) * (R0 + b.off * 1.6), y = 62 + b.flock * 14 + Math.sin(t * 0.7 + b.ph) * 2 + (b.off % 2) * 1.2;
        const dir = b.flock === 1 ? -1 : 1, yaw = -A - (dir > 0 ? 0 : Math.PI), flap = Math.sin(t * 9 + b.ph) * 0.7, s = i < nb ? 1.5 : 0;
        p.set(x, y, z); sc.set(s, s, s);
        e.set(0, yaw, flap, 'YXZ'); q.setFromEuler(e); BL.setMatrixAt(i, m4.compose(p, q, sc));
        e.set(0, yaw, -flap, 'YXZ'); q.setFromEuler(e); BR.setMatrixAt(i, m4.compose(p, q, sc));
      }
      BL.instanceMatrix.needsUpdate = BR.instanceMatrix.needsUpdate = true;
    },
  };
})();

// ---------- 9. Seed relics ----------
const relics = RELICS.map(d => {
  let p = d.p ? new V3(...d.p) : null;
  if (d.zipEnd) { const z = zips.find(z => z.id === d.zipEnd), post = z.posts[1]; p = new V3(post.x, post.top + 1.2, post.z); }
  const g = new THREE.Group(); g.position.copy(p); scene.add(g);
  const core = new THREE.Mesh(ICO1, toon(0xffe9a8, { emissive: 0xffb300, emissiveIntensity: 0.55 })); core.scale.set(0.28, 0.38, 0.28); g.add(core);
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), toon(PAL.leaf2)); leaf.position.y = 0.42; g.add(leaf);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 32), noOutline(new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.8 }))); halo.rotation.x = Math.PI / 2; g.add(halo);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT_TEX, color: 0xffe08a, transparent: true, opacity: 0.55, depthWrite: false })); glow.scale.setScalar(2.2); g.add(glow);
  return { ...d, pos: p, g, halo, found: false };
});
const RELIC_UNLOCKS = [[3, 'hat', 7, 'Leaf crown hat'], [6, 'glider', 8, 'Rainbow glider'], [9, 'hat', 8, 'Sprout hat'], [12, 'glider', 9, 'Golden glider']];
function relicsFound() { return relics.filter(r => r.found).length; }
(() => { const saved = store.get('canopy-spire-relics', []); if (Array.isArray(saved)) for (const r of relics) if (saved.includes(r.id)) { r.found = true; r.g.visible = false; } })();
function lockedLook(key, i) {
  if ((key === 'hat' && i === 9) || (key === 'g' && i === 10)) return QS.q.q5 === 'done' ? '' : 'Complete “The Keepers’ Blessing” quest to unlock';
  if (key === 'hat' && i === 10) return QS.flags.captainHat ? '' : 'Complete Captain Skerry’s side quest to unlock';
  if (key === 'g' && i === 11) return QS.flags.heartwood ? '' : 'Heal the Thornheart to unlock';
  for (const [n, k, idx] of RELIC_UNLOCKS) if (((key === 'hat' && k === 'hat') || (key === 'g' && k === 'glider')) && idx === i) return relicsFound() < n ? `Find ${n} Seed Relics to unlock` : '';
  return '';
}
function collectRelic(r) {
  r.found = true; r.g.visible = false; store.set('canopy-spire-relics', relics.filter(x => x.found).map(x => x.id));
  const n = relicsFound(); sfx.play('relic'); world.burst(r.pos.clone(), 0xffe08a, 140);
  game.toast(`🌰 Seed Relic found! (${n}/${relics.length})`, true);
  for (const [need, , , label] of RELIC_UNLOCKS) if (need === n) setTimeout(() => game.toast(`🎁 Unlocked: ${label} — equip it on the home screen`, true), 1800);
  if (game.net.mode !== 'offline') game.net.send({ t: 'CHAT', text: `🌰 found a Seed Relic (${n}/${relics.length})` });
  renderInventory();
}

// ---------- 10. Glide-ring courses ----------
const courses = COURSES.map(c => {
  const rings = c.rings.map((pt, i) => {
    const mat = toon(c.color, { emissive: c.color, emissiveIntensity: 0.2, unique: true, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(new THREE.TorusGeometry(2.3, i === 0 || i === c.rings.length - 1 ? 0.22 : 0.15, 10, 40), mat);
    m.position.set(...pt); scene.add(m);
    if (c.face === 'up') m.rotation.x = Math.PI / 2; else { const nxt = c.rings[Math.min(i + 1, c.rings.length - 1)], prv = c.rings[Math.max(i - 1, 0)]; m.lookAt(i < c.rings.length - 1 ? new V3(...nxt) : new V3(2 * pt[0] - prv[0], 2 * pt[1] - prv[1], 2 * pt[2] - prv[2])); }
    return { m, mat, pos: new V3(...pt) };
  });
  return { ...c, rings, active: !c.needs };
});
let courseRun = null; // { c, i, t0, last }
const records = (() => { const r = store.get('canopy-spire-records', {}), out = {}; for (const c of courses) { const v = Number(r && r[c.id]); if (Number.isFinite(v) && v > 0) out[c.id] = v; } return out; })();
function refreshCourses() { for (const c of courses) { c.active = !c.needs || world.nodes.get(c.needs).restored; for (const r of c.rings) r.m.visible = c.active; } }
function updateCourses(dt) {
  const ctr = player.pos.clone(); ctr.y += 0.9; const now = world.time;
  if (!courseRun) {
    for (const c of courses) if (c.active && !player.grounded && ctr.distanceTo(c.rings[0].pos) < 2.5) { courseRun = { c, i: 1, t0: now, last: now }; sfx.play('ring', 0); game.toast(`🏁 ${c.name} — fly through the rings!`); break; }
  } else {
    const c = courseRun.c, r = c.rings[courseRun.i];
    if (ctr.distanceTo(r.pos) < 2.8) {
      courseRun.i++; courseRun.last = now; sfx.play('ring', courseRun.i);
      if (courseRun.i >= c.rings.length) {
        const t = now - courseRun.t0, best = records[c.id], pb = !best || t < best;
        if (pb) { records[c.id] = +t.toFixed(2); store.set('canopy-spire-records', records); }
        sfx.play('finish'); game.toast(`🏁 ${c.name}: ${t.toFixed(2)}s${pb ? ' — new personal best!' : ` (best ${best.toFixed(2)}s)`}`, true);
        if (game.net.mode !== 'offline') game.net.send({ t: 'CHAT', text: `🏁 finished ${c.name} in ${t.toFixed(2)}s${pb ? ' (new best!)' : ''}` });
        courseRun = null;
      }
    } else if (now - courseRun.last > 10 || (player.grounded && now - courseRun.t0 > 0.5)) { sfx.play('fail'); game.toast(`${c.name} reset — try again from the first ring`); courseRun = null; }
  }
  const t = world.time;
  for (const c of courses) c.rings.forEach((r, i) => {
    const next = courseRun && courseRun.c === c ? i === courseRun.i : i === 0, done = courseRun && courseRun.c === c && i < courseRun.i;
    r.mat.emissiveIntensity = next ? 0.8 + Math.sin(t * 6) * 0.25 : 0.15; r.mat.opacity = done ? 0.25 : next ? 1 : 0.55;
    r.m.scale.setScalar(next ? 1 + Math.sin(t * 6) * 0.05 : 1);
  });
  const hud = $('courseHud');
  if (courseRun) { hud.classList.remove('hidden'); hud.innerHTML = `🏁 <b>${courseRun.c.name}</b> · ring ${courseRun.i}/${courseRun.c.rings.length - 1} · ${(now - courseRun.t0).toFixed(1)}s${records[courseRun.c.id] ? ` · best ${records[courseRun.c.id].toFixed(2)}s` : ''}`; }
  else hud.classList.add('hidden');
}

// ---------- 3. Pings ----------
const pings = [];
function castPing() {
  const o = camera.position.clone(), d = new V3(); camera.getWorldDirection(d); const ray = new THREE.Ray(o, d), hp = new V3();
  let best = 250, hit = null;
  for (const b of phys.boxes) { if (!b.enabled || b.box3.containsPoint(o)) continue; if (ray.intersectBox(b.box3, hp)) { const dd = hp.distanceTo(o); if (dd < best) { best = dd; hit = hp.clone(); } } }
  if (!hit && d.y < -0.01) { const t = -o.y / d.y; if (t > 0 && t < 250) hit = o.clone().addScaledVector(d, t); }
  return hit;
}
function pingLabel(p) {
  for (const q of world.pickups) if (q.available && q.pos.distanceTo(p) < 3) return `${RES_ICON[q.type]} ${RES_NAME[q.type]} here`;
  for (const n of world.nodes.values()) if (n.group.position.distanceTo(p) < 5) return `${TYPE_ICON[n.def.type]} ${n.def.name}`;
  for (const a of world.anchors) if (a.active && a.pos.distanceTo(p) < 4) return '◎ Grapple ring';
  for (const z of zips) if (z.a.distanceTo(p) < 4) return '🚡 Sky-line';
  for (const r of relics) if (!r.found && r.pos.distanceTo(p) < 4) return '🌰 Seed Relic!';
  return 'Over here!';
}
function showPing(id, p) {
  const isSelf = id === game.net.selfId, rem = game.remotes.get(id), color = isSelf ? game.selfColor : rem ? rem.color : '#ffffff', who = isSelf ? 'You' : rem ? esc(rem.name) : 'Someone';
  const g = new THREE.Group(); g.position.copy(p); scene.add(g);
  const mat = noOutline(new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 14, 10, 1, true), mat); beam.position.y = 7; g.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 6, 30), mat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring);
  const label = mkLabel('ping', ''); label.style.setProperty('--c', color);
  const txt = pingLabel(p);
  pings.push({ id, g, ring, label, txt, who, color, t: 0, pos: p.clone() });
  while (pings.length > 8) removePing(pings[0]);
  sfx.play('ping');
}
function removePing(pg) { scene.remove(pg.g); pg.label.remove(); pings.splice(pings.indexOf(pg), 1); }
function updatePings(dt) {
  for (const pg of [...pings]) {
    pg.t += dt; if (pg.t > 9) { removePing(pg); continue; }
    pg.ring.scale.setScalar(1 + (pg.t * 1.5 % 1) * 1.2); pg.ring.material.opacity = 0.6 * (1 - Math.min(1, pg.t / 9));
    pg.label.innerHTML = `<b>${pg.who}</b>: ${pg.txt}<br><span>${Math.round(pg.pos.distanceTo(player.pos))}m</span>`;
    place(pg.label, pg.pos.clone().add(new V3(0, 2.2, 0)), true);
  }
}

// ---------- 4. Emotes ----------
const EMOTES = [null, { k: 'wave', icon: '👋', name: 'Wave' }, { k: 'cheer', icon: '🙌', name: 'Cheer' }, { k: 'dance', icon: '💃', name: 'Dance' }, { k: 'sit', icon: '🪑', name: 'Sit' }];
player.emote = 0; player.emoteT = 0;
function startEmote(i) {
  if (!player.grounded || player.state === 'CLIMB') { game.toast('Find solid ground to emote.'); return; }
  player.emote = i; player.emoteT = 0; sfx.play('emote'); showBubble(selfBubble, EMOTES[i].icon);
}
const selfBubble = { el: mkLabel('bubble', ''), t: 0 };
function showBubble(b, icon) { b.el.textContent = icon; b.t = 2.5; }
function updateBubble(b, pos, dt) { b.t -= dt; place(b.el, pos.clone().add(new V3(0, 2.9, 0)), b.t > 0); if (b.t > 0) b.el.style.opacity = Math.min(1, b.t); }

// ---------- 2. Compass & tracking ----------
game.tracked = null;
const compassEls = new Map();
function cmpEl(key, cls, html) { let el = compassEls.get(key); if (!el) { el = document.createElement('span'); el.className = 'ci ' + cls; $('compassStrip').appendChild(el); compassEls.set(key, el); } if (el._h !== html) { el.innerHTML = html; el._h = html; } el._seen = true; return el; }
function trackNext() {
  const list = [...world.nodes.values()].filter(n => !n.restored).sort((a, b) => a.group.position.distanceTo(player.pos) - b.group.position.distanceTo(player.pos));
  if (!list.length) { game.tracked = null; game.toast('Everything is restored — nothing left to track! 🌈'); return; }
  const i = list.findIndex(n => n.id === game.tracked);
  game.tracked = i < 0 ? list[0].id : (i + 1 < list.length ? list[i + 1].id : null);
  sfx.play('ui');
  game.toast(game.tracked ? `📍 Tracking ${NODE_DEF[game.tracked].name}` : 'Tracking off');
  renderObjectives();
}
function updateCompass() {
  const f = new V3(); camera.getWorldDirection(f); const head = Math.atan2(f.x, -f.z), W = $('compassStrip').clientWidth || 520, FOVC = Math.PI * 0.62;
  for (const el of compassEls.values()) el._seen = false;
  const put = (key, cls, html, bearing) => { let rel = ((bearing - head + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; const el = cmpEl(key, cls, html); const vis = Math.abs(rel) < FOVC / 2; el.style.display = vis ? '' : 'none'; if (vis) { el.style.left = (W / 2 + rel / FOVC * W) + 'px'; el.style.opacity = 1 - Math.abs(rel) / (FOVC / 2) * 0.6; } };
  const bear = p => Math.atan2(p.x - player.pos.x, -(p.z - player.pos.z));
  [['N', 0], ['NE', Math.PI / 4], ['E', Math.PI / 2], ['SE', Math.PI * 0.75], ['S', Math.PI], ['SW', -Math.PI * 0.75], ['W', -Math.PI / 2], ['NW', -Math.PI / 4]].forEach(([l, b]) => put('c' + l, l.length > 1 ? 'cdir sm' : 'cdir', l, b));
  questCompass(put, bear);
  for (const n of world.nodes.values()) if (!n.restored && n.group.position.distanceTo(player.pos) < 600) put('n' + n.id, 'node' + (game.tracked === n.id ? ' trk' : ''), TYPE_ICON[n.def.type], bear(n.group.position));
  for (const r of game.remotes.values()) if (r.pos.y > -50) put('p' + r.id, 'mate', `<i style="background:${safeColor(r.color)}"></i>`, bear(r.pos));
  for (const pg of pings) put('g' + pings.indexOf(pg) + pg.id + pg.pos.x.toFixed(0), 'pingc', `<i style="border-color:${safeColor(pg.color)}"></i>`, bear(pg.pos));
  if (!courseRun) for (const c of courses) if (c.active && c.rings[0].pos.distanceTo(player.pos) < 120) put('k' + c.id, 'course', '🏁', bear(c.rings[0].pos));
  // needed materials near the player for the tracked node
  const tn = game.tracked && world.nodes.get(game.tracked);
  if (tn) {
    const need = RES.filter(k => (tn.def.req[k] || 0) - tn.cur[k] - game.inventory[k] > 0);
    world.pickups.filter(p => p.available && need.includes(p.type) && p.pos.distanceTo(player.pos) < 80).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos)).slice(0, 4)
      .forEach(p => put('m' + p.id, 'mat', RES_ICON[p.type], bear(p.pos)));
  }
  for (const [k, el] of compassEls) if (!el._seen) { el.remove(); compassEls.delete(k); }
  // on-screen waypoint for the tracked node
  const wp = $('waypoint');
  if (!tn || tn.restored) { if (tn && tn.restored) game.tracked = null; wp.classList.add('hidden'); return; }
  const target = tn.group.position.clone().add(new V3(0, 4, 0)), v = target.clone().project(camera), behind = v.z > 1;
  let x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
  if (behind) { x = innerWidth - x; y = innerHeight - 40; }
  x = clamp(x, 60, innerWidth - 60); y = clamp(y, 150, innerHeight - 120);
  if (x > innerWidth - 320 && y < 420) y = 420;
  wp.classList.remove('hidden'); wp.style.left = x + 'px'; wp.style.top = y + 'px';
  const need = RES.filter(k => (tn.def.req[k] || 0) - tn.cur[k] > 0).map(k => `${RES_ICON[k]}${(tn.def.req[k] || 0) - tn.cur[k]}`).join(' ');
  wp.innerHTML = `<div class="wpd">${TYPE_ICON[tn.def.type]}</div><div class="wpt">${tn.def.name}<br><b>${Math.round(tn.group.position.distanceTo(player.pos))}m</b>${need ? ' · needs ' + need : ' · ready to calibrate'}</div>`;
}

// ---------- Hooks the main loop calls ----------
let lastEmoteSent = 0, prevAirVy = 0, wasGrounded = true;
function featureInput() {
  if (pressed.has('KeyT')) trackNext();
  if ((pressed.has('KeyG') || pressed.has('Ping')) && world.time - (game.lastPing || -9) > 0.8) { const p = castPing(); if (p) { game.lastPing = world.time; game.net.send({ t: 'PING', p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] }); } }
  if (pressed.has('KeyB') && !ui.panelNode) { ui.emoteOpen = ui.emoteOpen ? 0 : 3; $('emoteHint').classList.toggle('hidden', !ui.emoteOpen); }
  if (ui.emoteOpen && !ui.panelNode) for (let i = 1; i <= 4; i++) if (pressed.has('Digit' + i)) { startEmote(i); ui.emoteOpen = 0; $('emoteHint').classList.add('hidden'); }
}
function featureUpdate(dt, inp) {
  if (ui.emoteOpen) { ui.emoteOpen = Math.max(0, ui.emoteOpen - dt); if (!ui.emoteOpen) $('emoteHint').classList.add('hidden'); }
  if (player.emote && (inp.f || inp.r || inp.jump || !player.grounded || player.state !== 'IDLE')) player.emote = 0;
  // player events → sound
  for (const ev of player.events) sfx.play(ev);
  if (player.grounded && !wasGrounded && prevAirVy < -9) sfx.play('land', -prevAirVy);
  wasGrounded = player.grounded; prevAirVy = player.vel.y;
  if (player.grounded && (player.state === 'WALK' || player.state === 'RUN')) { sfx.stepT -= dt; if (sfx.stepT <= 0) { sfx.stepT = player.state === 'RUN' ? 0.29 : 0.42; sfx.play('step'); } }
  else if (player.state === 'CLIMB' && (inp.f || inp.r)) { sfx.stepT -= dt; if (sfx.stepT <= 0) { sfx.stepT = 0.33; sfx.play('climb'); } }
  // relics
  const ctr = player.pos.clone(); ctr.y += 0.9;
  for (const r of relics) if (!r.found && ctr.distanceTo(r.pos) < 2.2) collectRelic(r);
  updateCourses(dt); updatePings(dt); updateCompass(); updateBubble(selfBubble, player.pos, dt);
  for (const r of game.remotes.values()) { if (!r.bubble) r.bubble = { el: mkLabel('bubble', ''), t: 0 }; if (r.emote && r.emote !== r.lastEmote) showBubble(r.bubble, EMOTES[r.emote].icon); r.lastEmote = r.emote; updateBubble(r.bubble, r.pos, dt); }
}
function featureWorld(dt) { // runs on menu & in game
  refreshZips(); refreshPads(); refreshCourses();
  const gp = (world.vib[0] + world.vib[1] + world.vib[2]) / 3;
  updateDayNight(dt, gp);
  wildlife.update(dt, dayState.day);
  for (const p of pads) { p.squash = Math.max(0, p.squash - dt * 3); const s = 1 - Math.sin(p.squash * Math.PI) * 0.35; p.cap.scale.set(1 + (1 - s) * 0.5, s, 1 + (1 - s) * 0.5); }
  for (const r of relics) if (!r.found) { r.g.rotation.y += dt * 1.2; r.g.position.y = r.pos.y + Math.sin(world.time * 2 + r.pos.x) * 0.15; r.halo.scale.setScalar(1 + Math.sin(world.time * 3) * 0.1); }
  // ambience summary for the sound engine
  let water = 0; for (const k in world.waterfalls) { const w = world.waterfalls[k]; if (!w.visible) continue; const d = Math.hypot(player.pos.x - w.position.x, player.pos.z - w.position.z); water = Math.max(water, clamp(1 - d / 45, 0, 1)); }
  sfx.update(dt, { alt: player.pos.y, speed: player.vel.length(), gliding: player.state === 'GLIDE', zipping: player.state === 'ZIP', water, day: dayState.day, vib: gp, progress: world.globalProgress(), playing: game.playing });
}
function onBounce(box) { const p = pads.find(p => p.col === box); if (p) p.squash = 1; }
player.onBounce = onBounce;

// =====================================================================
// QUESTS, PUZZLES & PORTAL REALMS
// Keepers give a quest chain; three co-op puzzles (host-authoritative,
// saved with the world) open portals to two new realms.
// =====================================================================
const VA = a => new V3(a[0], a[1], a[2]);
const xzDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const interactables = [];
const addInteract = o => (interactables.push(o), o);
function nearestInteract() {
  const c = player.pos.clone(); c.y += 0.9; let best = null, bd = Infinity;
  for (const it of interactables) { const d = c.distanceTo(it.pos); if (d > it.range) continue; const lab = it.label(); if (!lab) continue; const score = d - (it.prio || 0); if (score < bd) { bd = score; best = it; } }
  return best;
}
const realmAt = p => { for (const [k, R] of Object.entries(REALMS)) if (Math.hypot(p.x - R.c[0], p.z - R.c[2]) < (R.r || 200)) return k; return 'main'; };
game.realm = 'main';
player.killY = () => game.realm === 'main' ? -3.5 : (REALMS[game.realm].killY ?? -10);
const statics = []; // static meshes built here, merged at the end

// ---------- puzzle state (shared world state; host-authoritative) ----------
const CHIME_NOTES = [523.3, 587.3, 659.3, 784.0, 880.0], CHIME_COLS = [0xff6b6b, 0xffa94d, 0xffe066, 0x69db7c, 0x4dabf7];
const CHIME_LEN = [0, 3, 5, 7];
const PLATE_POS = [[52, -34], [52, -42], [47, -38]], STONE_HOME = [[44, -29], [44, -48], [57, -50]], KEY_POS = [63, 0, -38];
const MIRROR_CELLS = [[1, 3], [2, 3], [2, 5], [5, 5], [4, 3], [4, 1], [5, 1]];
const G0 = VA(REALMS.grotto.c), S0 = VA(REALMS.sky.c);
const cellPos = (c, r) => new V3(G0.x + (c - 3) * 5, 0, G0.z + (r - 3) * 5);
function defaultPuzzles() {
  return {
    chimes: { solved: false, round: 0, seq: [], pos: 0, phase: 'idle', n: 0 },
    plates: { solved: false, key: false, pressed: [false, false, false], stones: STONE_HOME.map(([x, z]) => ({ p: [x, 0, z], c: null })), n: 0 },
    mirrors: { states: [0, 0, 0, 0, 0, 0, 0], solved: false, n: 0 },
  };
}
const PHASES = new Set(['idle', 'show', 'input', 'wait', 'fail', 'done']);
function sanitizePuzzle(id, s) {
  const d = defaultPuzzles()[id]; if (!d || !s || typeof s !== 'object') return d;
  const n = safeInt(s.n, 0, 1e9);
  if (id === 'chimes') {
    const seq = Array.isArray(s.seq) ? s.seq.slice(0, 7).map(v => safeInt(v, 0, 4)) : [];
    const o = { solved: s.solved === true, round: safeInt(s.round, 0, 3), seq, pos: safeInt(s.pos, 0, 7), phase: PHASES.has(s.phase) ? s.phase : 'idle', n };
    if (s.hit && typeof s.hit === 'object') o.hit = { i: safeInt(s.hit.i, 0, 4), ok: s.hit.ok === true };
    return o;
  }
  if (id === 'plates') {
    const stones = d.stones.map((def, i) => { const st = Array.isArray(s.stones) && s.stones[i]; const p = st && safeVec(st.p); return { p: p || def.p, c: st && safeId(st.c) ? st.c : null }; });
    return { solved: s.solved === true, key: s.key === true, pressed: [0, 1, 2].map(i => Array.isArray(s.pressed) && s.pressed[i] === true), stones, n };
  }
  if (id === 'mirrors') return { states: d.states.map((_, i) => Array.isArray(s.states) ? safeInt(s.states[i], 0, 2) : 0), solved: s.solved === true, n };
  return d;
}
game.puzzles = defaultPuzzles();
function persistPuzzles() { // what gets written into the world save
  const P = JSON.parse(JSON.stringify(game.puzzles));
  P.chimes = { ...P.chimes, phase: P.chimes.solved ? 'done' : 'idle', round: 0, pos: 0 }; delete P.chimes.hit;
  P.plates.stones.forEach(s => { if (s.c) { s.c = null; s.p = [s.p[0], s.p[1], s.p[2]]; } });
  return P;
}
// Beam tracing on the 7x7 mirror grid. States: 0 '/', 1 '\', 2 lowered (beam passes).
function traceBeam(states) {
  const segs = [], hits = new Set(), seen = new Set(), beams = [{ c: -1, r: 3, dc: 1, dr: 0 }];
  while (beams.length) {
    const b = beams.pop(); let c = b.c, r = b.r, dc = b.dc, dr = b.dr, sc = c, sr = r;
    for (let i = 0; i < 40; i++) {
      c += dc; r += dr;
      const k = `${c},${r},${dc},${dr}`; if (seen.has(k)) { segs.push([sc, sr, c, r]); break; } seen.add(k);
      if (c < 0 || c > 6 || r < 0 || r > 6) { if (c === 5 && r === -1) hits.add('R1'); if (c === 7 && r === 5) hits.add('R2'); segs.push([sc, sr, c, r]); break; }
      if (c === 2 && r === 1) { segs.push([sc, sr, c - dc * 0.35, r - dr * 0.35]); break; } // obsidian blocker
      if (c === 4 && r === 5) { beams.push({ c, r, dc: dr, dr: -dc }); continue; }       // prism: also splits to the left
      const mi = MIRROR_CELLS.findIndex(m => m[0] === c && m[1] === r);
      if (mi >= 0 && states[mi] !== 2) { segs.push([sc, sr, c, r]); if (states[mi] === 0) [dc, dr] = [-dr, -dc]; else [dc, dr] = [dr, dc]; sc = c; sr = r; }
    }
  }
  return { segs, hits };
}
function senderPos(net, from) {
  if (from === net.selfId) return player.pos.clone();
  const pl = net.auth.players.get(from); return pl && Array.isArray(pl.p) ? VA(pl.p) : null;
}
// ----- host side -----
function puzzleHost(net, from, m) {
  const A = net.auth, id = m.id; if (!A.puzzles || !Object.hasOwn(A.puzzles, id)) return;
  const PZ = A.puzzles[id], sp = senderPos(net, from); if (!sp) return;
  const send = () => { PZ.n++; net.broadcast({ t: 'PUZZLE_STATE', id, s: PZ }); delete PZ.hit; };
  if (id === 'chimes') {
    const C = PZ, ctr = VA(PLAZAS.chimes);
    const showRound = () => { C.phase = 'show'; C.pos = 0; send(); const len = CHIME_LEN[C.round]; clearTimeout(net.chimeT); net.chimeT = setTimeout(() => { if (C.phase === 'show') { C.phase = 'input'; send(); } }, (len * 0.65 + 0.9) * 1000); };
    if (m.a === 'start') {
      if (C.solved || C.phase === 'show' || C.phase === 'input' || C.phase === 'wait' || xzDist(sp, ctr) > 9) return;
      C.seq = Array.from({ length: 7 }, () => Math.floor(Math.random() * 5)); C.round = 1; showRound();
    } else if (m.a === 'hit') {
      const i = safeInt(m.i, 0, 4), pill = chimePillarPos(i); if (sp.distanceTo(pill) > 4.5) return;
      if (C.solved) { C.hit = { i, ok: true }; send(); return; } // free play once solved
      if (C.phase !== 'input') return;
      if (C.seq[C.pos] === i) {
        C.pos++; C.hit = { i, ok: true };
        if (C.pos >= CHIME_LEN[C.round]) {
          if (C.round >= 3) { C.solved = true; C.phase = 'done'; send(); }
          else { C.round++; C.phase = 'wait'; send(); setTimeout(showRound, 1300); }
        } else send();
      } else { C.hit = { i, ok: false }; C.phase = 'fail'; C.pos = 0; send(); setTimeout(showRound, 1500); }
    }
  } else if (id === 'plates') {
    const Pl = PZ, i = safeInt(m.i, 0, 2), st = Pl.stones[i];
    if (m.a === 'pick') {
      if (st.c || Pl.stones.some(s => s.c === from) || sp.distanceTo(VA(st.p)) > 3.2) return;
      st.c = from; send();
    } else if (m.a === 'drop') {
      const p = safeVec(m.p); if (st.c !== from || !p || VA(p).distanceTo(sp) > 4) return;
      const plate = PLATE_POS.find(([x, z]) => Math.hypot(p[0] - x, p[2] - z) < 2.2);
      st.p = plate ? [plate[0], 0.18, plate[1]] : p; st.c = null; send();
    } else if (m.a === 'claim') {
      if (!Pl.solved || Pl.key || sp.distanceTo(VA(KEY_POS)) > 4) return;
      Pl.key = true; send();
    }
  } else if (id === 'mirrors' && m.a === 'rot') {
    const M = PZ, i = safeInt(m.i, 0, 6); if (M.solved) return;
    const [c, r] = MIRROR_CELLS[i]; if (xzDist(sp, cellPos(c, r)) > 4) return;
    M.states[i] = (M.states[i] + 1) % 3;
    if (traceBeam(M.states).hits.size === 2) M.solved = true;
    send();
  }
}
function puzzleHostTick(net) { // plates are pressed by players or seed-stones standing on them
  const A = net.auth; if (!A || !A.puzzles) return; const Pl = A.puzzles.plates;
  const bodies = [player.pos.clone()];
  for (const [id, pl] of A.players) if (id !== net.selfId && Array.isArray(pl.p)) bodies.push(VA(pl.p));
  for (const s of Pl.stones) if (!s.c) bodies.push(VA(s.p));
  let changed = false;
  PLATE_POS.forEach(([x, z], i) => { const on = bodies.some(b => Math.hypot(b.x - x, b.z - z) < 1.35 && b.y < 1.6 && b.y > -0.5); if (on !== Pl.pressed[i]) { Pl.pressed[i] = on; changed = true; } });
  if (!Pl.solved && Pl.pressed.every(Boolean)) { Pl.solved = true; changed = true; }
  if (changed) { Pl.n++; net.broadcast({ t: 'PUZZLE_STATE', id: 'plates', s: Pl }); }
}
function puzzleDropCarrier(net, id) { // a player left while carrying a seed-stone
  const A = net.auth; if (!A || !A.puzzles) return; const pl = A.players.get(id);
  let ch = false; for (const s of A.puzzles.plates.stones) if (s.c === id) { s.c = null; if (pl && Array.isArray(pl.p)) s.p = [pl.p[0], Math.max(0, pl.p[1]), pl.p[2]]; ch = true; }
  if (ch) { A.puzzles.plates.n++; net.broadcast({ t: 'PUZZLE_STATE', id: 'plates', s: A.puzzles.plates }); }
}

// ---------- shared building helpers ----------
const stoneMat = toon(0xe9e1cf, { map: TEX.stone }), paveMat = toon(0xe9e1cf, { map: TEX.tile }), darkStone = toon(0x5a5470, { map: TEX.stone });
function plazaFloor(c, r) {
  world.put(cylGeo(r, r, 0.12, 48), paveMat, c.x, 0.06, c.z, { cast: false });
  world.put(new THREE.TorusGeometry(r, 0.22, 6, 60), toon(PAL.teal), c.x, 0.12, c.z, { rx: Math.PI / 2 });
}
function glowMat(hex, k = 0.25) { return toon(hex, { emissive: hex, emissiveIntensity: k, unique: true }); }

// ---------- Puzzle 1: the Songbird Stone (chime memory) ----------
const CHP = VA(PLAZAS.chimes);
function chimePillarPos(i) { const a = Math.PI + (i - 2) * 0.55; return new V3(CHP.x + Math.cos(a) * 6.5, 1.6, CHP.z + Math.sin(a) * 6.5); }
plazaFloor(CHP, 11);
if (!putAsset(assetNode('props', 'SongbirdRock'), propMat(null), CHP.x, 0, CHP.z)) world.put(rockGeo(1.5, 7), toon(0x9aa7b0), CHP.x, 0.7, CHP.z, { sy: 0.9 });
phys.add(CHP.x - 1.2, 0, CHP.z - 1.2, CHP.x + 1.2, 1.7, CHP.z + 1.2, 'stone');
const songbird = new THREE.Group(); songbird.position.set(CHP.x, 1.75, CHP.z); scene.add(songbird);
const birdAsset = assetNode('props', 'SongbirdBird');
if (birdAsset) { const b = toonize(birdAsset.clone(), propMat(null)); b.position.set(0, -1.75, 0); b.rotation.y = Math.PI; songbird.add(b); }
else { const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), toon(0x7ec8e3)); body.scale.set(1, 0.85, 1.25); songbird.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), toon(0x7ec8e3)); head.position.set(0, 0.36, 0.38); songbird.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 8), toon(0xffb74d)); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.34, 0.68); songbird.add(beak);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(ICO1, toon(0x4fa3c7)); w.scale.set(0.12, 0.28, 0.42); w.position.set(s * 0.42, 0.05, -0.05); songbird.add(w); const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), toon(0x222222)); e.position.set(s * 0.12, 0.42, 0.58); songbird.add(e); } }
const songRing = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.07, 6, 48), glowMat(0x7ff0ff, 0.1)); songRing.rotation.x = Math.PI / 2; songRing.position.set(CHP.x, 1.25, CHP.z); scene.add(songRing);
const chimes = [0, 1, 2, 3, 4].map(i => {
  const p = chimePillarPos(i);
  if (putAsset(assetNode('props', 'ChimePillar'), propMat(null), p.x, 0, p.z)) phys.add(p.x - 0.45, 0, p.z - 0.45, p.x + 0.45, 3.4, p.z + 0.45);
  else { world.block(p.x - 0.45, 0, p.z - 0.45, p.x + 0.45, 3.4, p.z + 0.45, stoneMat, { r: 0.12 }); world.block(p.x - 0.65, 3.4, p.z - 0.65, p.x + 0.65, 3.7, p.z + 0.65, toon(PAL.brass), { collide: false, r: 0.08 }); }
  const mat = glowMat(CHIME_COLS[i], 0.12), crystal = new THREE.Mesh(facet(new THREE.OctahedronGeometry(0.42)), mat);
  crystal.scale.y = 1.6; crystal.position.set(p.x, 4.6, p.z); scene.add(crystal);
  const plate = new THREE.Mesh(cylGeo(0.8, 0.85, 0.1, 24), mat); plate.position.set(p.x + (CHP.x - p.x) * 0.22, 0.13, p.z + (CHP.z - p.z) * 0.22); scene.add(plate);
  return { i, p, mat, crystal, glow: 0 };
});
function chimeFlash(i, ok = true) {
  const c = chimes[i]; c.glow = 1;
  if (ok) { sfx.tone(CHIME_NOTES[i], 1.1, { type: 'triangle', vol: 0.16 }); sfx.tone(CHIME_NOTES[i] * 2, 0.8, { vol: 0.05, delay: 0.01 }); }
  else sfx.play('miss');
}
let melodyTimers = [];
function playMelody(seq, len) { melodyTimers.forEach(clearTimeout); melodyTimers = []; for (let k = 0; k < len; k++) melodyTimers.push(setTimeout(() => chimeFlash(seq[k]), 500 + k * 650)); songbird.userData.sing = len * 0.65 + 0.6; }
addInteract({ pos: CHP.clone().setY(1.5), range: 3.6, prio: 0.2, label: () => { const C = game.puzzles.chimes; return C.solved ? '🎶 The Songbird Stone hums happily' : C.phase === 'idle' || C.phase === 'done' ? '<span class="key">E</span> Wake the Songbird Stone' : C.phase === 'input' ? `🎵 Your turn — echo the melody (${C.pos}/${CHIME_LEN[C.round]})` : '🎵 Listen closely…'; },
  act: () => { const C = game.puzzles.chimes; if (!C.solved && (C.phase === 'idle' || C.phase === 'done')) puzzleSend('chimes', 'start'); } });
chimes.forEach(c => addInteract({ pos: c.p, range: 2.8, label: () => { const C = game.puzzles.chimes; return C.solved || C.phase === 'input' ? '<span class="key">E</span> Ring the chime' : '🔔 A silent chime (wake the Songbird Stone)'; },
  act: () => { const C = game.puzzles.chimes; if (C.solved || C.phase === 'input') puzzleSend('chimes', 'hit', { i: c.i }); } }));

// ---------- Puzzle 2: the Root Vault (pressure plates + seed-stones) ----------
const VC = VA(PLAZAS.vault);
plazaFloor(new V3(52, 0, -38), 10.5);
const vMat = toon(0xcfc6b0, { map: TEX.stone }), vTrim = toon(0x6fa86a);
world.block(58, 0, -42, 66, 6, -41, vMat); world.block(58, 0, -35, 66, 6, -34, vMat); world.block(65, 0, -41, 66, 6, -35, vMat);
world.block(58, 0, -41, 59, 6, -39.5, vMat); world.block(58, 0, -36.5, 59, 6, -35, vMat); world.block(58, 4.2, -39.5, 59, 6, -36.5, vMat);
world.block(57.6, 6, -42.4, 66.4, 6.7, -33.6, vTrim, { r: 0.15 });
world.put(new THREE.TorusGeometry(1.6, 0.22, 8, 20, Math.PI), toon(PAL.brass), 57.95, 4.2, -38, { ry: Math.PI / 2 });
for (const z of [-41.6, -34.4]) world.vines(58, z, 2, 6, -1, 0, 0, 1.2);
const doorMesh = new THREE.Mesh(boxGeo(0.5, 4.2, 3, 3, 0.06), toon(0x8a5a33, { map: TEX.wood })); doorMesh.position.set(58.5, 2.1, -38); doorMesh.castShadow = true; scene.add(doorMesh);
const doorCol = phys.add(58.2, 0, -39.5, 58.8, 4.2, -36.5, 'door');
const keyGroup = new THREE.Group(); keyGroup.position.set(KEY_POS[0], 1.6, KEY_POS[2]); scene.add(keyGroup);
world.put(cylGeo(0.5, 0.65, 1.1, 16, TEX.stone), vMat, KEY_POS[0], 0.55, KEY_POS[2]);
{ const km = glowMat(0xffd54f, 0.6); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 8, 20), km); ring.position.y = 0.35; keyGroup.add(ring); const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), km); keyGroup.add(bar); const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), km); t.position.set(0.1, -0.22, 0); keyGroup.add(t); }
const plates = PLATE_POS.map(([x, z]) => { const mat = glowMat(0x8bd34a, 0.05); const m = new THREE.Mesh(cylGeo(1.2, 1.3, 0.18, 32), mat); m.position.set(x, 0.09, z); m.receiveShadow = true; scene.add(m); const rune = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 6, 24), mat); rune.rotation.x = Math.PI / 2; rune.position.set(x, 0.2, z); scene.add(rune); return { mat, m }; });
const stones = STONE_HOME.map((_, i) => { const g = new THREE.Group(); scene.add(g); const r = new THREE.Mesh(rockGeo(0.6, 30 + i), toon(0xa59a8a)); r.castShadow = true; g.add(r); const seed = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 6, 20), glowMat(0x8bd34a, 0.5)); seed.position.y = 0.05; seed.rotation.y = i; g.add(seed); return g; });
stones.forEach((g, i) => addInteract({ get pos() { return g.position.clone().setY(g.position.y + 0.6); }, range: 2.6, label: () => { const st = game.puzzles.plates.stones[i]; return !st.c && !myStone() ? '<span class="key">E</span> Lift the seed-stone' : null; }, act: () => puzzleSend('plates', 'pick', { i }) }));
addInteract({ pos: VA(KEY_POS).setY(1.6), range: 3, label: () => { const Pl = game.puzzles.plates; return Pl.solved && !Pl.key ? '<span class="key">E</span> Claim the Grotto Key' : null; }, act: () => puzzleSend('plates', 'claim') });
const myStone = () => game.puzzles.plates.stones.findIndex(s => s.c === game.net.selfId) + 1;
function dropStone() {
  const i = myStone() - 1; if (i < 0) return;
  const f = new V3(Math.sin(player.yaw), 0, Math.cos(player.yaw)), p = player.pos.clone().addScaledVector(f, 1.4);
  const top = phys.surfaceY(p.x, p.z, player.pos.y + 1); p.y = top ?? player.pos.y;
  puzzleSend('plates', 'drop', { i, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
}

// ---------- Realm: Crystal Grotto (mirror puzzle) ----------
{
  const floor = toon(0x6e668f, { map: TEX.tile }), wall = toon(0x4b4568, { map: TEX.stone });
  world.block(G0.x - 40, -6, G0.z - 40, G0.x + 40, 0, G0.z + 40, floor, { r: 0.5 });
  world.block(G0.x - 44, -6, G0.z - 44, G0.x + 44, 22, G0.z - 40, wall, { r: 0.8 }); world.block(G0.x - 44, -6, G0.z + 40, G0.x + 44, 22, G0.z + 44, wall, { r: 0.8 });
  world.block(G0.x - 44, -6, G0.z - 40, G0.x - 40, 22, G0.z + 40, wall, { r: 0.8 }); world.block(G0.x + 40, -6, G0.z - 40, G0.x + 44, 22, G0.z + 40, wall, { r: 0.8 });
  const r = mulberry32(77), cc = [0x9b7bff, 0x6fe3ff, 0xff8fd1, 0x7dffb2];
  for (let i = 0; i < 70; i++) {
    const side = i % 4, t = (r() - 0.5) * 76, x = side === 0 ? G0.x - 38.5 + r() * 2 : side === 1 ? G0.x + 38.5 - r() * 2 : G0.x + t, z = side === 2 ? G0.z - 38.5 + r() * 2 : side === 3 ? G0.z + 38.5 - r() * 2 : G0.z + t;
    const h = 1.2 + r() * 4, g = facet(new THREE.OctahedronGeometry(0.6 + r() * 0.6)); g.scale(1, h, 1);
    world.put(g, toon(cc[i % 4], { emissive: cc[i % 4], emissiveIntensity: 0.55 }), x, h * 0.45, z, { rx: (r() - 0.5) * 0.5, rz: (r() - 0.5) * 0.5, cast: false });
  }
  for (let i = 0; i < 18; i++) { const x = G0.x + (r() - 0.5) * 70, z = G0.z + (r() - 0.5) * 70; if (Math.abs(x - G0.x) < 22 && Math.abs(z - G0.z) < 22) continue; world.put(cylGeo(0.08, 0.12, 0.5, 8), toon(0xf3e9d2), x, 0.25, z); world.put(new THREE.SphereGeometry(0.35, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x7dffb2, { emissive: 0x3dff9a, emissiveIntensity: 0.6 }), x, 0.5, z, { sy: 0.6 }); }
  const line = noOutline(new THREE.MeshBasicMaterial({ color: 0x9b7bff, transparent: true, opacity: 0.35 }));
  for (let k = 0; k <= 7; k++) { const o = -17.5 + k * 5; world.put(new THREE.BoxGeometry(35, 0.02, 0.08), line, G0.x, 0.02, G0.z + o, { cast: false }); world.put(new THREE.BoxGeometry(0.08, 0.02, 35), line, G0.x + o, 0.02, G0.z, { cast: false }); }
  for (const s of [-1, 1]) world.vines(G0.x + s * 40, G0.z, 10, 22, -s, 0, 3, 60);
}
const sunCrystal = new THREE.Mesh(facet(new THREE.OctahedronGeometry(1.0)), glowMat(0xffd54f, 1.2)); sunCrystal.scale.y = 1.5; { const p = cellPos(-1, 3); sunCrystal.position.set(p.x, 2.2, p.z); world.put(cylGeo(0.9, 1.1, 1.0, 16, TEX.stone), stoneMat, p.x, 0.5, p.z); phys.add(p.x - 0.9, 0, p.z - 0.9, p.x + 0.9, 1.0, p.z + 0.9); } scene.add(sunCrystal);
const receivers = [[5, -1], [7, 5]].map(([c, r]) => { const p = cellPos(c, r); world.put(cylGeo(0.8, 1.0, 1.0, 16, TEX.stone), stoneMat, p.x, 0.5, p.z); phys.add(p.x - 0.8, 0, p.z - 0.8, p.x + 0.8, 1.0, p.z + 0.8); const mat = glowMat(0x9b7bff, 0.1); const f = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), mat); f.position.set(p.x, 1.9, p.z); scene.add(f); return { mat, f }; });
{ const p = cellPos(2, 1); world.block(p.x - 0.9, 0, p.z - 0.9, p.x + 0.9, 3.4, p.z + 0.9, toon(0x26232f), { r: 0.2 }); }
const prism = new THREE.Mesh(new THREE.TetrahedronGeometry(0.9), toon(0xdff7ff, { emissive: 0x9fe8ff, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 })); { const p = cellPos(4, 5); prism.position.set(p.x, 1.7, p.z); world.put(cylGeo(0.5, 0.7, 0.9, 12, TEX.stone), stoneMat, p.x, 0.45, p.z); phys.add(p.x - 0.5, 0, p.z - 0.5, p.x + 0.5, 0.9, p.z + 0.5); } scene.add(prism);
const mirrors = MIRROR_CELLS.map(([c, r], i) => {
  const p = cellPos(c, r); world.put(cylGeo(0.55, 0.7, 0.6, 16, TEX.stone), stoneMat, p.x, 0.3, p.z); phys.add(p.x - 0.5, 0, p.z - 0.5, p.x + 0.5, 0.6, p.z + 0.5);
  const g = new THREE.Group(); g.position.set(p.x, 0.6, p.z); scene.add(g);
  const panel = new THREE.Mesh(boxGeo(2.2, 1.9, 0.14, 0, 0.05), toon(0xdbe9ff, { emissive: 0x7aa7ff, emissiveIntensity: 0.35 })); panel.position.y = 1.0; panel.castShadow = true; g.add(panel);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.06, 6, 4), toon(PAL.brass)); frame.rotation.z = Math.PI / 4; frame.position.y = 1.0; frame.scale.y = 0.85; g.add(frame);
  addInteract({ pos: p.clone().setY(1.2), range: 2.9, label: () => game.puzzles.mirrors.solved ? null : '<span class="key">E</span> Turn the mirror', act: () => puzzleSend('mirrors', 'rot', { i }) });
  return { g, panel, frame, target: 0, cur: 0, lift: 1 };
});
const beamGroup = new THREE.Group(); scene.add(beamGroup);
const beamMat = noOutline(new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
const beamGlow = noOutline(new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
function drawBeams() {
  while (beamGroup.children.length) { const m = beamGroup.children.pop(); m.geometry.dispose(); }
  const { segs, hits } = traceBeam(game.puzzles.mirrors.states);
  for (const [c0, r0, c1, r1] of segs) {
    const a = cellPos(c0, r0), b = cellPos(c1, r1); a.y = b.y = 1.6; const len = a.distanceTo(b); if (len < 0.01) continue;
    for (const [rad, mat] of [[0.07, beamMat], [0.22, beamGlow]]) { const g = new THREE.CylinderGeometry(rad, rad, len, 8, 1, true); g.rotateX(Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); beamGroup.add(m); }
  }
  receivers[0].mat.emissiveIntensity = hits.has('R1') ? 1.4 : 0.1; receivers[1].mat.emissiveIntensity = hits.has('R2') ? 1.4 : 0.1;
}
const grottoOrb = new THREE.Group(); grottoOrb.position.set(G0.x, 1.8, G0.z); scene.add(grottoOrb);
world.put(cylGeo(0.7, 0.9, 1.2, 16, TEX.stone), stoneMat, G0.x, 0.6, G0.z); phys.add(G0.x - 0.7, 0, G0.z - 0.7, G0.x + 0.7, 1.2, G0.z + 0.7);
{ const o = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), glowMat(0xc6a8ff, 0.9)); grottoOrb.add(o); const h = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 6, 32), glowMat(0xffffff, 0.8)); h.rotation.x = Math.PI / 2; grottoOrb.add(h); }
addInteract({ pos: G0.clone().setY(1.6), range: 3, prio: 0.3, label: () => game.puzzles.mirrors.solved && !QS.orbs.grotto ? '<span class="key">E</span> Take the Spirit Orb of Light' : null, act: () => takeOrb('grotto') });

// ---------- Realm: Sky Archipelago (parkour trial) ----------
const skyGrass = toon(0x8fd16a, { map: TEX.grass }), skyRock = toon(0x8f8aa0, { map: TEX.stone }), skyIslands = [];
function skyIsland(x, y, z, w, d) {
  const X = S0.x + x, Y = S0.y + y, Z = S0.z + z;
  world.block(X - w / 2, Y - 1.6, Z - d / 2, X + w / 2, Y, Z + d / 2, skyGrass, { r: 0.6 });
  const m = Math.min(w, d), rr = mulberry32(Math.round(x * 13 + z * 7 + 1000));
  world.put(new THREE.ConeGeometry(m * 0.6, m * 1.0, 9), skyRock, X, Y - 1.6 - m * 0.5, Z, { rx: Math.PI, ry: rr() * 6 });
  for (let k = 0; k < Math.floor(w * d / 18); k++) { const fx = X + (rr() - 0.5) * (w - 1.2), fz = Z + (rr() - 0.5) * (d - 1.2); world.flower(fx, Y, fz, 3, [PAL.blossom, PAL.flower, 0xffffff, 0x74c0fc][k % 4], 1); }
  skyIslands.push([X, Y, Z, w, d]);
}
function skyTree(x, y, z, s, col) { const X = S0.x + x, Y = S0.y + y, Z = S0.z + z; world.put(cylGeo(0.14 * s, 0.26 * s, 2 * s, 8, TEX.wood), toon(0x8d5e3a, { map: TEX.wood }), X, Y + s, Z); for (let k = 0; k < 4; k++) world.put(ICO1, toon(col), X + Math.cos(k * 1.7) * 0.6 * s, Y + 2.2 * s + (k % 2) * 0.5 * s, Z + Math.sin(k * 1.7) * 0.6 * s, { sx: 0.95 * s, sy: 0.8 * s, sz: 0.95 * s }); phys.add(X - 0.25 * s, Y, Z - 0.25 * s, X + 0.25 * s, Y + 2 * s, Z + 0.25 * s, 'tree'); }
skyIsland(0, 0, 40, 16, 16); skyIsland(0, 0, 27, 6, 6); skyIsland(8, 2, 19, 5, 5); skyIsland(16, 2, 9, 6, 6); skyIsland(22, 9, -1, 7, 7);
skyIsland(2, 4, -8, 9, 9); skyIsland(-16, 26, -14, 8, 8); skyIsland(8, 38, -34, 12, 12);
skyTree(-5, 0, 44, 1.2, 0xf4a6c6); skyTree(5, 0, 36, 1.0, PAL.leaf2); skyTree(24, 9, -3, 0.8, PAL.leaf); skyTree(13, 38, -30, 1.1, 0xf4a6c6); skyTree(-19, 26, -11, 0.8, PAL.leaf2);
for (const [x, y, z, s] of [[30, 15, 25, 5], [-25, 8, 30, 6], [-30, 40, -40, 7], [35, 30, -30, 6], [10, 55, 10, 4]]) { const X = S0.x + x, Y = S0.y + y, Z = S0.z + z; world.put(boxGeo(s, 1.2, s, 12, 0.5), skyGrass, X, Y, Z); world.put(new THREE.ConeGeometry(s * 0.6, s, 8), skyRock, X, Y - 0.6 - s / 2, Z, { rx: Math.PI }); }
{ const th = world.thermal('T3', S0.x + 2, S0.z - 8, 3.5, S0.y + 4, S0.y + 34); th.active = true; th.pts.visible = true; th.rings.forEach(r => r.visible = true); th.ventGlow.material.emissiveIntensity = 1.5; }
world.anchor('SR1', S0.x - 16, S0.y + 35, S0.z - 26, [0, 0, 0]);
world.anchor('SR2', S0.x + 2.5, S0.y + 42.5, S0.z - 33, [1, 0, 0]);
world.grassField(-1, 0x8fd16a, 2600, () => { const I = skyIslands[Math.floor(world.rng() * skyIslands.length)], x = I[0] + (world.rng() - 0.5) * (I[3] - 1), z = I[2] + (world.rng() - 0.5) * (I[4] - 1); return phys.pointInside(new V3(x, I[1] + 0.3, z)) ? null : [x, I[1], z]; });
const SKY_SHRINE = new V3(S0.x + 10, S0.y + 38, S0.z - 36);
world.put(cylGeo(0.8, 1.0, 1.2, 16, TEX.stone), stoneMat, SKY_SHRINE.x, SKY_SHRINE.y + 0.6, SKY_SHRINE.z); phys.add(SKY_SHRINE.x - 0.8, SKY_SHRINE.y, SKY_SHRINE.z - 0.8, SKY_SHRINE.x + 0.8, SKY_SHRINE.y + 1.2, SKY_SHRINE.z + 0.8);
for (const s of [-1, 1]) world.block(SKY_SHRINE.x + s * 2.4 - 0.35, SKY_SHRINE.y, SKY_SHRINE.z - 0.35, SKY_SHRINE.x + s * 2.4 + 0.35, SKY_SHRINE.y + 4.5, SKY_SHRINE.z + 0.35, stoneMat, { r: 0.1 });
world.put(new THREE.TorusGeometry(2.4, 0.3, 8, 20, Math.PI), toon(PAL.teal), SKY_SHRINE.x, SKY_SHRINE.y + 4.5, SKY_SHRINE.z);
const skyOrb = new THREE.Group(); skyOrb.position.copy(SKY_SHRINE).setY(SKY_SHRINE.y + 1.9); scene.add(skyOrb);
{ const o = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), glowMat(0x9be7ff, 0.9)); skyOrb.add(o); const h = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 6, 32), glowMat(0xffffff, 0.8)); h.rotation.x = Math.PI / 2; skyOrb.add(h); }
addInteract({ pos: SKY_SHRINE.clone().setY(SKY_SHRINE.y + 1.4), range: 3, prio: 0.3, label: () => !QS.orbs.sky ? '<span class="key">E</span> Take the Spirit Orb of Wind' : null, act: () => takeOrb('sky') });

// ---------- Portals ----------
const PORTAL_DEFS = [
  { id: 'toSky', pos: [24, 0, -84], face: 0, color: 0x5ad1ff, open: () => game.puzzles.chimes.solved, dest: REALMS.sky.spawn, yaw: 0, name: 'Sky Archipelago', sealed: 'Sealed — wake the Songbird Stone in the west plaza' },
  { id: 'toGrotto', pos: [36, 0, -84], face: 0, color: 0xb388ff, open: () => game.puzzles.plates.key, dest: REALMS.grotto.spawn, yaw: 0, name: 'Crystal Grotto', sealed: 'Sealed — claim the key in the Root Vault' },
  { id: 'skyBack', pos: [S0.x, S0.y, S0.z + 47.5], face: Math.PI, color: 0x9be7a0, open: () => true, dest: [24, 0.5, -74], yaw: Math.PI, name: 'Canopy Spire' },
  { id: 'skyTop', pos: [S0.x + 4, S0.y + 38, S0.z - 39], face: 0, color: 0x9be7a0, open: () => true, dest: [24, 0.5, -74], yaw: Math.PI, name: 'Canopy Spire' },
  { id: 'grottoBack', pos: [G0.x, 0, G0.z + 33], face: Math.PI, color: 0x9be7a0, open: () => true, dest: [36, 0.5, -74], yaw: Math.PI, name: 'Canopy Spire' },
];
plazaFloor(VA(PLAZAS.portals), PLAZAS.portals[3]);
const portalVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const portalFS = `uniform float uTime; uniform vec3 uColor; uniform float uOpen; varying vec2 vUv;
void main(){
  vec2 q = vec2((vUv.x - 0.5) * 4.2, vUv.y * 7.2);
  bool inside = (q.y < 5.0 && abs(q.x) < 2.05) || length(vec2(q.x, q.y - 5.0)) < 2.05; if (!inside) discard;
  vec2 c = q - vec2(0.0, 3.6); float r = length(c), a = atan(c.y, c.x);
  float sw = sin(a * 4.0 + r * 3.2 - uTime * 2.6) * 0.5 + 0.5, rings = sin(r * 6.0 - uTime * 4.0) * 0.5 + 0.5;
  vec3 base = mix(vec3(0.42, 0.44, 0.5), uColor, uOpen);
  vec3 col = base * (0.55 + 0.45 * sw) + vec3(1.0) * pow(rings, 6.0) * 0.4 * uOpen;
  gl_FragColor = vec4(col, mix(0.3, 0.85, uOpen) * (0.75 + 0.25 * sw));
  #include <colorspace_fragment>
}`;
function buildPortal(P) {
  const g = new THREE.Group(); g.position.set(...P.pos); g.rotation.y = P.face; scene.add(g);
  const sm = toon(0xf3ead6, { map: TEX.stone }), archAsset = assetNode('props', 'PortalArch');
  if (archAsset) { const a = toonize(archAsset.clone(), propMat(null)); a.position.set(0, 0, 0); a.rotation.set(0, 0, 0); g.add(a); }
  for (const s of [-1, 1]) { const p = new THREE.Mesh(boxGeo(0.9, 5.2, 0.9, 4, 0.12), sm); p.position.set(s * 2.5, 2.6, 0); p.castShadow = true; p.visible = !archAsset; g.add(p); phys.add(P.pos[0] + s * 2.5 - 0.45, P.pos[1], P.pos[2] - 0.45, P.pos[0] + s * 2.5 + 0.45, P.pos[1] + 5.2, P.pos[2] + 0.45, 'portal'); }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.45, 10, 28, Math.PI), sm); arch.position.y = 5.2; arch.castShadow = true; arch.visible = !archAsset; g.add(arch);
  const key = new THREE.Mesh(facet(new THREE.OctahedronGeometry(0.5)), glowMat(P.color, 0.6)); key.position.y = archAsset ? 8.75 : 7.9; g.add(key);
  const base = new THREE.Mesh(boxGeo(6.4, 0.3, 2.2, 4, 0.08), sm); base.position.y = 0.15; base.receiveShadow = true; base.visible = !archAsset; g.add(base);
  const mat = noOutline(new THREE.ShaderMaterial({ vertexShader: portalVS, fragmentShader: portalFS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(P.color) }, uOpen: { value: 0 } } }));
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 7.2), mat); surf.position.y = 3.6 + 0.0; g.add(surf);
  const label = mkLabel('portal', '');
  return { ...P, g, mat, key, label, center: VA(P.pos) };
}
const portals = PORTAL_DEFS.map(buildPortal);
let portalCD = 0, sealedCD = 0;
function teleport(dest, yaw) {
  $('flash').classList.add('on'); setTimeout(() => $('flash').classList.remove('on'), 380);
  player.pos.set(dest[0], dest[1], dest[2]); player.vel.set(0, 0, 0); player.state = 'FALL'; player.grapple = null; player.zip = null; player.lastSafe.copy(player.pos);
  cam.yaw = yaw; cam.target.copy(player.pos); portalCD = 1.5; sfx.play('portal');
  const r = realmAt(player.pos); game.realm = r;
  if (r !== 'main') { if (!QS.visited[r]) { QS.visited[r] = true; saveQuests(); } showRegionText(REALMS[r].name, REALMS[r].sub); } else ui.region = -1;
}
function updatePortals(dt) {
  portalCD -= dt; sealedCD -= dt;
  const ctr = player.pos.clone(); ctr.y += 0.9;
  for (const P of portals) {
    const open = P.open(); P.mat.uniforms.uTime.value = world.time; P.mat.uniforms.uOpen.value = lerp(P.mat.uniforms.uOpen.value, open ? 1 : 0, Math.min(1, dt * 2));
    P.key.rotation.y += dt; P.key.material.emissiveIntensity = open ? 0.9 : 0.15;
    const near = ctr.distanceTo(P.center) < 16 && game.playing;
    if (near) { P.label.innerHTML = open ? `✨ ${P.name}` : `🔒 ${P.sealed}`; } place(P.label, P.center.clone().add(new V3(0, 8.6, 0)), near);
    if (!game.playing || portalCD > 0) continue;
    const dx = ctr.x - P.center.x, dz = ctr.z - P.center.z, dy = ctr.y - P.center.y;
    if (Math.abs(dx) < 1.8 && Math.abs(dz) < 0.6 && dy > 0 && dy < 6) {
      if (open) teleport(P.dest, P.yaw);
      else if (sealedCD <= 0) { sealedCD = 3; game.toast('🔒 ' + P.sealed); sfx.play('fail'); }
    }
  }
}

// ---------- Keepers & quests ----------
const QUESTS = [
  { id: 'q1', name: 'The Songbird Stone', giver: 'mossa', req: () => true,
    intro: ['Oh! A wanderer — and the wind brought you right to me. I am Mossa, keeper of the old songs.', 'West of the stepping pillars sits the Songbird Stone. Wake it, listen to its melody, then ring the chime pillars in the same order.', 'Three songs, each longer than the last. Do that, and the sealed Sky Portal north of the canopy will remember how to open.'],
    steps: [{ text: 'Echo the Songbird Stone’s three melodies (west plaza)', done: () => game.puzzles.chimes.solved, where: PLAZAS.chimes }],
    turnIn: ['I heard it from here! The Sky Portal is humming again — find it at the Portal Plaza, north of the great deck.', 'Take these, for your work on the spire.'], reward: { energy: 2, bio: 2, scrap: 2 } },
  { id: 'q2', name: 'Two Hands, One Gate', giver: 'brindle', req: () => true,
    intro: ['Brindle here, vault-warden. The Root Vault only opens when all three plates are held down at once.', 'Bring friends to stand on them — or haul the old seed-stones onto the plates yourself. Press E to lift one, E again to set it down.', 'Inside is the key to the Crystal Grotto.'],
    steps: [{ text: 'Hold all three pressure plates at once', done: () => game.puzzles.plates.solved, where: [52, 0, -38] }, { text: 'Claim the Grotto Key inside the Root Vault', done: () => game.puzzles.plates.key, where: KEY_POS }],
    turnIn: ['Ha! The old gate creaked open. The Grotto portal at the plaza should glow violet now.', 'Here — scrap from the vault. Put it to good use.'], reward: { scrap: 3, energy: 2 } },
  { id: 'q3', name: 'Light in the Grotto', giver: 'aster', req: () => game.puzzles.plates.key || QS.q.q2 === 'done',
    intro: ['I am Aster. Beyond the violet portal lies the Crystal Grotto, where light itself is the lock.', 'Turn the mirrors so the sunbeam reaches BOTH crystal receivers. The prism splits the light — use that.', 'Bring me back the Spirit Orb of Light.'],
    steps: [{ text: 'Step through the Grotto portal (Portal Plaza)', done: () => QS.visited.grotto, where: [36, 0, -84] }, { text: 'Guide the sunbeam to both crystal receivers', done: () => game.puzzles.mirrors.solved, where: REALMS.grotto.c }, { text: 'Take the Spirit Orb of Light', done: () => QS.orbs.grotto, where: REALMS.grotto.c }],
    turnIn: ['The orb of light… it is warm, isn’t it? Keep it safe; Mossa will want to see it.'], reward: { bio: 3 } },
  { id: 'q4', name: 'Winds of the Archipelago', giver: 'aster', req: () => game.puzzles.chimes.solved || QS.q.q1 === 'done',
    intro: ['The blue portal leads to the Sky Archipelago — islands adrift on the wind.', 'Jump, bounce, ride the thermal and swing between the rings to reach the summit shrine. Fall, and the wind will catch you.', 'Bring back the Spirit Orb of Wind.'],
    steps: [{ text: 'Step through the Sky portal (Portal Plaza)', done: () => QS.visited.sky, where: [24, 0, -84] }, { text: 'Reach the summit shrine and take the Spirit Orb of Wind', done: () => QS.orbs.sky, where: [SKY_SHRINE.x, SKY_SHRINE.y, SKY_SHRINE.z] }],
    turnIn: ['You flew to the summit? Wonderful. The wind remembers you now.'], reward: { energy: 3 } },
  { id: 'q5', name: 'The Keepers’ Blessing', giver: 'mossa', req: () => QS.q.q3 === 'done' && QS.q.q4 === 'done',
    intro: ['Aster tells me you carry both Spirit Orbs. Bring them close, wanderer.'],
    steps: [{ text: 'Bring both Spirit Orbs to Keeper Mossa', done: () => QS.orbs.sky && QS.orbs.grotto, where: KEEPERS[0].pos }],
    turnIn: ['Light and wind, together again. The spire sings for you.', 'Wear these with pride — the Keeper’s Circlet and the Starlight Glider. You can equip them on the home screen.'], reward: { energy: 3, bio: 3, scrap: 3 }, unlock: true },
];
const IDLE_LINES = {
  mossa: ['The water used to sing all the way down to the sea. Restore the aqueduct and you’ll hear it again.', 'Seed Relics hide in the strangest places — one floats right above the bloom by the south path.'],
  brindle: ['Seed-stones are heavy, but they don’t complain. Unlike some keepers I know.', 'If you see a pink bloom, jump on it. Trust me.'],
  aster: ['Night is the best time to watch the fireflies over the restored meadows.', 'The sky-lines from the crown run again once the turbines turn. Fastest way down!'],
};
const QS = (() => {
  const s = store.get('canopy-spire-quests', {}), o = { q: {}, orbs: { sky: false, grotto: false }, visited: { sky: false, grotto: false } };
  for (const q of QUESTS) { const v = s && s.q && s.q[q.id]; if (v === 'active' || v === 'done') o.q[q.id] = v; }
  for (const k of ['sky', 'grotto']) { o.orbs[k] = !!(s && s.orbs && s.orbs[k] === true); o.visited[k] = !!(s && s.visited && s.visited[k] === true); }
  return o;
})();
function saveQuests() { store.set('canopy-spire-quests', QS); }
function questStatus(q) { const s = QS.q[q.id]; if (s === 'done') return 'done'; if (s === 'active') return q.steps.every(st => st.done()) ? 'ready' : 'active'; return q.req() ? 'available' : 'locked'; }
const curStep = q => q.steps.find(st => !st.done());
function takeOrb(k) { if (QS.orbs[k]) return; QS.orbs[k] = true; saveQuests(); sfx.play('relic'); world.burst((k === 'sky' ? skyOrb : grottoOrb).position.clone(), k === 'sky' ? 0x9be7ff : 0xc6a8ff, 160); game.toast(`🔮 You took the Spirit Orb of ${k === 'sky' ? 'Wind' : 'Light'}!`, true); }
const keepers = KEEPERS.map(k => {
  const m = makeCharacter(k.look); m.group.position.set(...k.pos); m.group.rotation.y = k.face; scene.add(m.group);
  phys.add(k.pos[0] - 0.35, k.pos[1], k.pos[2] - 0.35, k.pos[0] + 0.35, k.pos[1] + 1.8, k.pos[2] + 0.35, 'npc');
  const K = { ...k, m, lbl: mkLabel('npc', ''), idle: 0 };
  addInteract({ pos: VA(k.pos).setY(k.pos[1] + 1.2), range: 3.4, prio: 1, label: () => `<span class="key">E</span> Talk to ${k.name}`, act: () => talkTo(K) });
  return K;
});
function keeperMarker(k) { const mine = QUESTS.filter(q => q.giver === k.id).map(questStatus); return mine.includes('ready') ? '❓' : mine.includes('available') ? '❗' : ''; }
// dialogue
const dlg = { open: false, lines: [], i: 0, who: '', onEnd: null };
function openDialog(who, lines, onEnd) { Object.assign(dlg, { open: true, lines, i: 0, who, onEnd }); renderDialog(); sfx.play('dialog'); keys.clear(); }
function renderDialog() { $('dialog').classList.toggle('hidden', !dlg.open); if (!dlg.open) return; $('dialog').innerHTML = `<div class="dname">${esc(dlg.who)}</div><div class="dtext">${esc(dlg.lines[dlg.i])}</div><div class="dnext"><span class="key">E</span> ${dlg.i < dlg.lines.length - 1 ? 'Continue' : 'Close'} <span style="opacity:.6">(${dlg.i + 1}/${dlg.lines.length})</span></div>`; }
function advanceDialog() { dlg.i++; sfx.play('dialog'); if (dlg.i >= dlg.lines.length) { dlg.open = false; renderDialog(); const f = dlg.onEnd; dlg.onEnd = null; if (f) f(); } else renderDialog(); }
const NPC_SPECIAL = {};
function talkTo(k) {
  if (NPC_SPECIAL[k.id] && NPC_SPECIAL[k.id]()) return;
  const mine = QUESTS.filter(q => q.giver === k.id);
  const ready = mine.find(q => questStatus(q) === 'ready'), avail = mine.find(q => questStatus(q) === 'available'), act = mine.find(q => questStatus(q) === 'active');
  if (ready) return openDialog(k.name, ready.turnIn, () => completeQuest(ready));
  if (avail) return openDialog(k.name, avail.intro, () => { QS.q[avail.id] = 'active'; if (avail.onAccept) avail.onAccept(); saveQuests(); sfx.play('quest'); game.toast(`📜 New quest: ${avail.name}`, true); renderQuestUI(true); });
  if (act) return openDialog(k.name, [`How goes “${act.name}”? ${curStep(act).text}.`]);
  const lines = IDLE_LINES[k.id]; openDialog(k.name, [lines[k.idle++ % lines.length]]);
}
function completeQuest(q) {
  QS.q[q.id] = 'done'; saveQuests(); sfx.play('finish');
  const r = q.reward || {}; for (const k of RES) game.inventory[k] += r[k] || 0; renderInventory();
  game.toast(`✅ Quest complete: ${q.name}${Object.keys(r).length ? ' — ' + RES.filter(k => r[k]).map(k => r[k] + RES_ICON[k]).join(' ') : ''}`, true);
  if (q.onDone) q.onDone(); saveQuests();
  if (q.unlock) { setTimeout(() => game.toast('🎁 Unlocked: Keeper’s Circlet hat & Starlight Glider', true), 1600); for (let i = 0; i < 8; i++) setTimeout(() => world.burst(player.pos.clone().add(new V3((Math.random() - 0.5) * 10, 6 + Math.random() * 6, (Math.random() - 0.5) * 10)), [0xffd54f, 0x9be7ff, 0xc6a8ff, 0xff8fb1][i % 4], 150), i * 250); }
  renderQuestUI(true);
}
// quest HUD: tracker, log (J), step-complete notices, compass hints
const stepSeen = {};
let qTick = 0;
function renderQuestUI(force) {
  const act = QUESTS.filter(q => ['active', 'ready'].includes(questStatus(q)));
  $('questTracker').classList.toggle('hidden', !act.length);
  $('questTracker').innerHTML = '<h3>Quests <span class="key">J</span></h3>' + act.slice(0, 3).map(q => { const st = questStatus(q) === 'ready' ? `Return to ${KEEPERS.find(k => k.id === q.giver).name}` : curStep(q).text; return `<div class="qt"><b>${q.name}</b><br>▸ ${st}</div>`; }).join('');
  if (!$('questLog').classList.contains('hidden') || force) $('questLog').innerHTML = '<h2>Quest Log</h2>' + QUESTS.map(q => { const s = questStatus(q); if (s === 'locked') return `<div class="ql locked">🔒 ???</div>`; const icon = s === 'done' ? '✅' : s === 'ready' ? '❓' : s === 'available' ? '❗' : '📜'; return `<div class="ql ${s}">${icon} <b>${q.name}</b> <span class="qg">— ${KEEPERS.find(k => k.id === q.giver).name}</span>${s === 'available' ? '<div class="qs">Talk to the keeper to begin.</div>' : s === 'done' ? '' : q.steps.map(st => `<div class="qs">${st.done() ? '✔' : '○'} ${st.text}</div>`).join('')}</div>`; }).join('') + '<div class="qfoot">🔮 Spirit Orbs: ' + (QS.orbs.sky ? 'Wind ✔ ' : 'Wind ○ ') + (QS.orbs.grotto ? 'Light ✔' : 'Light ○') + ' · Press J to close</div>';
}
function questUpdate(dt) {
  game.realm = realmAt(player.pos);
  qTick -= dt;
  if (qTick <= 0) {
    qTick = 0.3;
    for (const q of QUESTS) if (QS.q[q.id] === 'active') q.steps.forEach((st, i) => { const k = q.id + i, d = st.done(); if (d && stepSeen[k] === false) { game.toast(`✔ ${st.text}`); sfx.play('calib'); } stepSeen[k] = d; });
    renderQuestUI();
  }
  for (const k of keepers) {
    const d = xzDist(player.pos, k.m.group.position), want = d < 7 ? Math.atan2(player.pos.x - k.pos[0], player.pos.z - k.pos[2]) : k.face;
    k.m.group.rotation.y = lerpAngle(k.m.group.rotation.y, want, Math.min(1, dt * 4)); animateCharacter(k.m, 'IDLE', dt, d < 4 && dlg.open && dlg.who === k.name ? 1 : 0);
    const mk = keeperMarker(k); k.lbl.innerHTML = `${mk ? `<span class="mk">${mk}</span><br>` : ''}${k.name}`; place(k.lbl, k.m.group.position.clone().add(new V3(0, 2.6, 0)), d < 60);
  }
}
function questCompass(put, bear) {
  for (const q of QUESTS) { const s = questStatus(q); if (s !== 'active' && s !== 'ready') continue; const w = s === 'ready' ? KEEPERS.find(k => k.id === q.giver).pos : curStep(q).where; if (!w) continue; const p = VA(w); if (p.distanceTo(player.pos) < 600) put('q' + q.id, 'quest', '❗', bear(p)); }
  for (const k of keepers) if (keeperMarker(k) && k.m.group.position.distanceTo(player.pos) < 600) put('k' + k.id, 'quest', keeperMarker(k), bear(k.m.group.position));
}

// ---------- applying shared puzzle state (all peers) ----------
function applyPuzzleState(id, raw) {
  if (!Object.hasOwn(game.puzzles, id)) return;
  const prev = game.puzzles[id], s = sanitizePuzzle(id, raw); game.puzzles[id] = s;
  if (id === 'chimes') {
    if (s.n !== prev.n) {
      if (s.hit) chimeFlash(s.hit.i, s.hit.ok);
      if (s.phase === 'show' && (prev.phase !== 'show' || s.round !== prev.round)) playMelody(s.seq, CHIME_LEN[s.round]);
      if (s.phase === 'input' && prev.phase === 'show') game.toast(`🎵 Your turn — ring the ${CHIME_LEN[s.round]} chimes in order`);
      if (s.phase === 'wait') game.toast(`🎶 Song ${s.round - 1} of 3 complete!`);
      if (s.phase === 'fail') game.toast('🎵 Not quite — listen again…');
    }
    if (s.solved && !prev.solved && game.playing) { sfx.play('restore'); world.burst(CHP.clone().setY(3), 0x7ff0ff, 200); game.toast('🌀 The Songbird Stone sings! The Sky Portal has awoken.', true); }
  } else if (id === 'plates') {
    dynSyncStoneState(s);
    s.pressed.forEach((p, i) => { if (p && !prev.pressed[i] && game.playing) sfx.play('plate'); });
    if (s.solved && !prev.solved) { doorCol.enabled = false; world.tween(2.2, k => doorMesh.position.y = 2.1 - k * 4.3); if (game.playing) { sfx.play('door'); game.toast('🚪 The Root Vault rumbles open!', true); } }
    if (s.solved) doorCol.enabled = false;
    if (s.key && !prev.key && game.playing) { sfx.play('relic'); game.toast('🗝️ The Grotto Key is claimed — the violet portal glows!', true); world.burst(keyGroup.position.clone(), 0xffd54f, 120); }
  } else if (id === 'mirrors') {
    if (s.n !== prev.n && game.playing) sfx.play('rotate');
    drawBeams();
    if (s.solved && !prev.solved && game.playing) { sfx.play('restore'); game.toast('✨ Both receivers blaze with light — the Spirit Orb appears!', true); world.burst(G0.clone().setY(2), 0xffe08a, 220); }
  }
}
function applyPuzzleAll(P) { for (const id of Object.keys(game.puzzles)) applyPuzzleState(id, P && P[id] ? P[id] : game.puzzles[id]); if (game.puzzles.plates.solved) { doorCol.enabled = false; doorMesh.position.y = -2.2; } }
function puzzleSend(id, a, extra = {}) { game.net.send({ t: 'PUZZLE', id, a, ...extra }); }

// ---------- per-frame visuals ----------
function puzzleVisuals(dt) {
  const t = world.time, P = game.puzzles;
  for (const c of chimes) { c.glow = Math.max(0, c.glow - dt * 1.6); c.mat.emissiveIntensity = 0.12 + c.glow * 1.6 + (P.chimes.solved ? 0.25 + Math.sin(t * 2 + c.i) * 0.15 : 0); c.crystal.rotation.y += dt * (0.4 + c.glow * 4); }
  songbird.userData.sing = Math.max(0, (songbird.userData.sing || 0) - dt);
  songbird.position.y = 1.75 + (songbird.userData.sing > 0 ? Math.abs(Math.sin(t * 10)) * 0.12 : 0); songbird.rotation.y = Math.sin(t * 0.5) * 0.4;
  songRing.material.emissiveIntensity = P.chimes.solved ? 0.9 : P.chimes.phase === 'input' ? 0.5 + Math.sin(t * 6) * 0.3 : 0.1;
  P.plates.pressed.forEach((p, i) => { plates[i].mat.emissiveIntensity = P.plates.solved ? 0.9 : p ? 1.2 : 0.05; });
  P.plates.stones.forEach((st, i) => { // resting/rolling stones are drawn by the physics layer (dynStep); here only carried ones
    if (!st.c) return;
    const g = stones[i], carrier = st.c === game.net.selfId ? player.pos : (game.remotes.get(st.c) || {}).pos;
    const target = carrier ? carrier.clone().add(new V3(0, 2.15 + STONE_R, 0)) : VA(st.p).setY(st.p[1] + STONE_R);
    g.position.lerp(target, Math.min(1, dt * 14)); if (g.position.distanceTo(target) > 6) g.position.copy(target);
  });
  keyGroup.visible = !P.plates.key; keyGroup.rotation.y += dt * 1.5; keyGroup.position.y = 1.7 + Math.sin(t * 2) * 0.1;
  mirrors.forEach((m, i) => { const s = P.mirrors.states[i]; const yaw = s === 0 ? Math.PI / 4 : -Math.PI / 4; m.cur = lerpAngle(m.cur, yaw, Math.min(1, dt * 10)); m.g.rotation.y = m.cur; m.lift = lerp(m.lift, s === 2 ? 0.08 : 1, Math.min(1, dt * 8)); m.panel.scale.y = m.lift; m.panel.position.y = 1.0 * m.lift; m.frame.visible = m.lift > 0.5; });
  sunCrystal.rotation.y += dt * 0.8; prism.rotation.y += dt * 0.6;
  grottoOrb.visible = P.mirrors.solved && !QS.orbs.grotto; grottoOrb.rotation.y += dt; grottoOrb.position.y = 1.9 + Math.sin(t * 2) * 0.12;
  skyOrb.visible = !QS.orbs.sky; skyOrb.rotation.y += dt; skyOrb.position.y = SKY_SHRINE.y + 1.9 + Math.sin(t * 2) * 0.12;
}
// =====================================================================
// DYNAMIC PHYSICS (Rapier) — the authority (host / solo) simulates; clients render snapshots.
// Bodies are created in the same order on every peer, so a body's index is its network id.
// =====================================================================
const STONE_R = 0.55;
const DYN = { list: [], stones: [], acc: 0, sendAcc: 0, time: 0, pushT: -1, STEP: 1 / 60, SEND_HZ: 15 };
const _dq = new THREE.Quaternion(), _dm = new THREE.Matrix4();
function dynAdd(kind, mesh, pos, o = {}) { // kind: 'box' (o.size [w,h,d]) | 'ball' (o.r) | 'cyl' (o.r, o.h)
  const half = kind === 'ball' ? new V3(o.r, o.r, o.r) : kind === 'cyl' ? new V3(o.r, o.h / 2, o.r) : new V3(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2);
  const body = phys.rw.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(o.ldamp ?? 0.3).setAngularDamping(o.adamp ?? 0.6));
  const cd = kind === 'ball' ? RAPIER.ColliderDesc.ball(o.r) : kind === 'cyl' ? RAPIER.ColliderDesc.cylinder(o.h / 2, o.r) : RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
  phys.rw.createCollider(cd.setDensity(o.density ?? 1).setFriction(o.friction ?? 0.8).setRestitution(o.bounce ?? 0.05), body);
  const e = { i: DYN.list.length, kind, body, mesh, half, home: pos.clone(), box: phys.addDyn(o.tag || 'crate'), tp: pos.clone(), tq: new THREE.Quaternion(), held: false, push: null, sentSleep: false, pushSpeed: o.pushSpeed ?? 3, stone: o.stone ?? -1 };
  e.box.dyn = e; mesh.position.copy(pos); if (!mesh.parent) scene.add(mesh); DYN.list.push(e); dynProxy(e); return e;
}
function dynProxy(e) { // world AABB of the (possibly tumbling) body, from its rendered pose
  const b = e.box; b.enabled = !e.held; if (e.held) return;
  const p = e.mesh.position, h = e.half;
  let ex = h.x, ey = h.y, ez = h.z;
  if (e.kind !== 'ball') { const m = _dm.makeRotationFromQuaternion(e.mesh.quaternion).elements; ex = Math.abs(m[0]) * h.x + Math.abs(m[4]) * h.y + Math.abs(m[8]) * h.z; ey = Math.abs(m[1]) * h.x + Math.abs(m[5]) * h.y + Math.abs(m[9]) * h.z; ez = Math.abs(m[2]) * h.x + Math.abs(m[6]) * h.y + Math.abs(m[10]) * h.z; }
  b.min.set(p.x - ex, p.y - ey, p.z - ez); b.max.set(p.x + ex, p.y + ey, p.z + ez);
}
const dynPose = e => { const t = e.body.translation(), r = e.body.rotation(); return [e.i, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), +r.x.toFixed(3), +r.y.toFixed(3), +r.z.toFixed(3), +r.w.toFixed(3)]; };
function dynSnapshot() { return DYN.list.map(e => e.held ? [e.i, ...e.mesh.position.toArray().map(v => +v.toFixed(2)), 0, 0, 0, 1] : dynPose(e)); }
function dynPlace(e, p, q) { // authority only: teleport a body and let it settle
  e.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true); if (q) e.body.setRotation(q, true);
  e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true); e.sentSleep = false;
  e.mesh.position.copy(p); if (q) e.mesh.quaternion.copy(q); e.tp.copy(p);
}
// client: apply host snapshot [i, x,y,z, qx,qy,qz,qw]
function dynApply(arr, snap) {
  for (const it of arr.slice(0, DYN.list.length)) {
    if (!Array.isArray(it) || it.length !== 8) continue;
    const e = DYN.list[safeInt(it[0], 0, DYN.list.length - 1)], v = it.slice(1).map(Number); if (!e || v.some(n => !Number.isFinite(n) || Math.abs(n) > 5000)) continue;
    e.tp.set(v[0], v[1], v[2]); e.tq.set(v[3], v[4], v[5], v[6]); if (e.tq.lengthSq() < 0.5) e.tq.identity(); else e.tq.normalize();
    if (snap || e.mesh.position.distanceTo(e.tp) > 8) { e.mesh.position.copy(e.tp); e.mesh.quaternion.copy(e.tq); }
    if (e.stone >= 0) { const st = game.puzzles.plates.stones[e.stone]; if (st && !st.c) st.p = [v[0], +(v[1] - STONE_R).toFixed(2), v[2]]; }
  }
}
// a client that loses its host takes over the simulation from what it was showing
function dynBecomeAuthority() { for (const e of DYN.list) { e.body.setEnabled(!e.held); if (!e.held) dynPlace(e, e.mesh.position.clone(), e.mesh.quaternion.clone()); } }
// walking into a body asks the authority to shove it (rate-limited; same path for host and clients)
function dynRequestPush(e, mx, mz) {
  if (DYN.time - DYN.pushT < 0.09) return; DYN.pushT = DYN.time;
  const l = Math.hypot(mx, mz) || 1; game.net.send({ t: 'BODY_PUSH', i: e.i, d: [+(mx / l).toFixed(2), +(mz / l).toFixed(2)] });
}
function dynHostPush(net, from, m) {
  if (!DYN.list.length || !Array.isArray(m.d)) return;
  const e = DYN.list[safeInt(m.i, 0, DYN.list.length - 1)]; if (!e || e.held) return;
  const dx = safeNum(m.d[0], -1, 1, 0), dz = safeNum(m.d[1], -1, 1, 0), l = Math.hypot(dx, dz); if (l < 0.5) return;
  const sp = senderPos(net, from), t = e.body.translation(); if (!sp || Math.hypot(sp.x - t.x, sp.z - t.z) > Math.max(e.half.x, e.half.z) + 2.2) return;
  e.push = { x: dx / l, z: dz / l, t: 0.2 }; e.body.wakeUp();
}
// carried seed-stones leave the simulation; dropped ones are placed where the puzzle state says
function dynSyncStoneState(s) {
  s.stones.forEach((st, k) => {
    const e = DYN.stones[k]; if (!e) return;
    const held = !!st.c, auth = game.net.isAuthority, base = VA(st.p).setY(st.p[1] + STONE_R);
    if (held !== e.held) { e.held = held; if (auth) e.body.setEnabled(!held); dynProxy(e); }
    if (held) return;
    if (auth) { if (e.body.translation().y < -50 || base.distanceTo(e.body.translation()) > 0.3) dynPlace(e, base.add(new V3(0, 0.25, 0))); } // drop / load: small fall onto the spot
    else if (base.distanceTo(e.tp) > 3) e.tp.copy(base);
  });
}
function dynStep(dt) {
  const net = game.net; DYN.time += dt;
  if (net.isAuthority) {
    phys.syncColliders();
    DYN.acc = Math.min(DYN.acc + dt, DYN.STEP * 3);
    while (DYN.acc >= DYN.STEP) {
      DYN.acc -= DYN.STEP;
      for (const e of DYN.list) if (e.push) {
        e.push.t -= DYN.STEP; if (e.push.t <= 0) { e.push = null; continue; }
        const v = e.body.linvel(), k = Math.min(1, 30 * DYN.STEP);
        e.body.setLinvel({ x: v.x + (e.push.x * e.pushSpeed - v.x) * k, y: v.y, z: v.z + (e.push.z * e.pushSpeed - v.z) * k }, true);
      }
      phys.rw.step();
    }
    for (const e of DYN.list) {
      if (e.held) continue;
      const t = e.body.translation();
      if (t.y < -20) { dynPlace(e, e.home.clone(), _dq.identity()); continue; } // fell off the island
      e.mesh.position.set(t.x, t.y, t.z); const r = e.body.rotation(); e.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (e.stone >= 0 && net.auth) { const p = [+t.x.toFixed(2), +(t.y - STONE_R).toFixed(2), +t.z.toFixed(2)]; for (const P of [net.auth.puzzles, game.puzzles]) { const st = P.plates.stones[e.stone]; if (!st.c) st.p = p; } }
    }
    if (net.mode === 'host' && net.conns.size && (DYN.sendAcc += dt) >= 1 / DYN.SEND_HZ) {
      DYN.sendAcc = 0; const b = [];
      for (const e of DYN.list) { if (e.held) continue; const sl = e.body.isSleeping(); if (sl && e.sentSleep) continue; e.sentSleep = sl; b.push(dynPose(e)); }
      if (b.length) net.broadcast({ t: 'BODIES', b }, net.selfId);
    }
  } else {
    const k = Math.min(1, dt * 12);
    for (const e of DYN.list) if (!e.held) { e.mesh.position.lerp(e.tp, k); e.mesh.quaternion.slerp(e.tq, k); }
  }
  for (const e of DYN.list) dynProxy(e);
}
player.onPush = dynRequestPush;

// ----- content: the vault's seed-stones roll, and crates & barrels sit around the town -----
stones.forEach((g, k) => { const [x, z] = STONE_HOME[k]; DYN.stones[k] = dynAdd('ball', g, new V3(x, STONE_R, z), { r: STONE_R, density: 2.5, stone: k, tag: 'stone', ldamp: 0.8, adamp: 1.6, pushSpeed: 3.5 }); });
{
  const crateMat = toon(PAL.wood, { map: TEX.wood }), bandMat = toon(0x6b4423), barrelMat = toon(0x9c6b3f, { map: TEX.wood }), hoopMat = toon(PAL.metal);
  const crateMesh = s => { const g = new THREE.Group(), c = new THREE.Mesh(boxGeo(s, s, s, TEX.wood.userData.world, 0.05), crateMat); c.castShadow = c.receiveShadow = true; g.add(c);
    for (const y of [-0.36, 0.36]) { const b = new THREE.Mesh(boxGeo(s + 0.04, s * 0.1, s + 0.04, 0, 0.02), bandMat); b.position.y = y * s; g.add(b); } return g; };
  const barrelMesh = (r, h) => { const g = new THREE.Group(), c = new THREE.Mesh(cylGeo(r * 0.92, r * 0.92, h, 16, TEX.wood), barrelMat); c.castShadow = c.receiveShadow = true; g.add(c);
    for (const y of [-0.32, 0.32]) { const b = new THREE.Mesh(cylGeo(r * 0.97, r * 0.97, h * 0.07, 16), hoopMat); b.position.y = y * h; g.add(b); } return g; };
  const free = (x, y, z, hx, hy, hz) => { for (const dx of [-hx, 0, hx]) for (const dz of [-hz, 0, hz]) if (phys.pointInside(new V3(x + dx * 0.95, y + hy, z + dz * 0.95))) return false; return true; };
  const ground = (x, z) => phys.surfaceY(x, z, 1.5) ?? 0;
  // [kind, x, z, size | [r,h], stackOn?]  — stacks reference the previous spot
  const SPOTS = [
    ['crate', 12.5, 52, 1.1], ['crate', 13.8, 52.3, 1.1], ['crate', 13.1, 52.1, 0.9, true], ['barrel', 10.8, 49.5, [0.45, 1.1]], ['barrel', 15.6, 50.4, [0.45, 1.1]],
    ['crate', 47, -45, 1.1], ['crate', 48.3, -45.2, 1.0], ['barrel', 49.5, -31, [0.45, 1.1]], ['crate', 46.5, -31.5, 1.2],
    ['crate', -62, 38, 1.1], ['crate', -63.3, 38.4, 1.1], ['crate', -62.6, 38.2, 0.9, true], ['barrel', -60, 35.5, [0.45, 1.1]],
  ];
  let lastTop = null;
  for (const [kind, x, z, sz, stack] of SPOTS) {
    const [hx, hy] = kind === 'crate' ? [sz / 2, sz / 2] : [sz[0], sz[1] / 2];
    const y = stack ? lastTop : ground(x, z);
    if (y === null || (!stack && !free(x, y, z, hx, hy, hx))) { lastTop = null; continue; }
    const pos = new V3(x, y + hy + 0.01, z);
    if (kind === 'crate') dynAdd('box', crateMesh(sz), pos, { size: [sz, sz, sz], density: 0.6, friction: 0.6 });
    else dynAdd('cyl', barrelMesh(sz[0], sz[1]), pos, { r: sz[0], h: sz[1], density: 0.5, friction: 0.6, pushSpeed: 2.5 });
    lastTop = y + 2 * hy;
  }
}

// rehome any pickups that ended up inside the new scenery
for (const p of world.pickups) if (phys.pointInside(p.pos) || phys.pointInside(p.pos.clone().setY(p.pos.y + 1))) { const top = phys.surfaceY(p.pos.x, p.pos.z, p.pos.y + 12); if (top !== null) { p.pos.y = top + 0.9; p.mesh.position.y = p.pos.y; } }
world.finalizeStatics();
applyPuzzleAll(game.puzzles);
renderQuestUI(true);
for (const z of zips) addInteract({ pos: z.a.clone().setY(z.a.y - 1.05), range: 3.4, label: () => player.state === 'ZIP' ? null : z.active ? '<span class="key">E</span> Ride the sky-line 🚡' : '🚡 Sky-line dormant — restore the Crown Wind Turbines',
  act: () => { if (z.active) player.startZip(z); else game.toast('This sky-line is dormant — restore the Crown Wind Turbines to power it.'); } });
function questInput() {
  if (pressed.has('KeyJ')) { $('questLog').classList.toggle('hidden'); renderQuestUI(true); }
  if (dlg.open) { if (pressed.has('KeyE') || pressed.has('Space')) advanceDialog(); pressed.delete('KeyE'); pressed.delete('Space'); }
}

// =====================================================================
// EXPANSION — items, crafting & tools · side-quest NPCs · three new realms
// · the Thornheart, a co-op "boss" you heal rather than fight
// =====================================================================
// ---------- items, tools & recipes ----------
const ITEMS = {
  shell: { n: 'Spiral Shell', i: '🐚', d: 'Pink and pearly. Found on Tidepool Lagoon beaches.' },
  feather: { n: 'Sky Feather', i: '🪶', d: 'From rooftop nests and the floating isles.' },
  crystal: { n: 'Glow Crystal', i: '💎', d: 'Hums faintly. Crystal Grotto & Moonlit Bloomwood.' },
  moonpetal: { n: 'Moonpetal', i: '🌸', d: 'Only blooms where it is always night.' },
  resin: { n: 'Amber Resin', i: '🍯', d: 'Sticky sap from the island trees. Excellent glue.' },
  spring: { n: 'Coil Spring', i: '🔩', d: 'Bent from scrap. A component for tools.' },
  seed: { n: 'Bloom Seed', i: '🫘', d: 'Plant it in fertile soil with the Seed Pouch.' },
  parcel: { n: 'Juniper’s Parcel', i: '📦', d: 'Addressed to “Capt. Skerry, The Lagoon”. Smells of cinnamon.' },
  letter: { n: 'Skerry’s Reply', i: '✉️', d: 'Sealed with a blob of sea-wax.' },
  compass: { n: 'Old Brass Compass', i: '🧭', d: 'Always points toward whoever you miss most.' },
  heartseed: { n: 'Heartwood Seed', i: '🌳', d: 'A gift from the Thornheart. Warm to the touch.' },
};
const TOOLS = [null,
  { id: 'can', n: 'Watering Can', i: '🚿', d: 'Water withered sprouts and roots — they grow into paths.' },
  { id: 'lantern', n: 'Glow Lantern', i: '🏮', d: 'Toggle its light. Reveals glyph platforms and wakes moth shrines — for everyone nearby.' },
  { id: 'horn', n: 'Wind Horn', i: '📯', d: 'A gust that spins wind wheels. Blow it mid-air for a lift.' },
  { id: 'pouch', n: 'Seed Pouch', i: '👝', d: 'Plant Bloom Seeds in fertile soil to grow bounce blooms.' },
  { id: 'lens', n: 'Prism Lens', i: '🔍', d: 'Raise it to bend a beam of light toward where you face.' }];
const RECIPES = [
  { out: 'spring', n: 1, need: { scrap: 2 } },
  { out: 'seed', n: 3, need: { bio: 2 } },
  { out: 'can', need: { shell: 2, scrap: 2, resin: 1 } },
  { out: 'lantern', need: { crystal: 2, energy: 1, resin: 1 } },
  { out: 'horn', need: { feather: 3, spring: 1 } },
  { out: 'pouch', need: { resin: 1, bio: 2 } },
  { out: 'lens', need: { crystal: 2, moonpetal: 1, scrap: 1 } },
];
const toolIdx = id => TOOLS.findIndex(t => t && t.id === id);
const itemInfo = k => RES.includes(k) ? { n: RES_NAME[k], i: RES_ICON[k], d: 'Restoration material.' } : ITEMS[k] || TOOLS[toolIdx(k)];
const bag = (() => { const s = store.get('canopy-spire-items', {}), o = {}; for (const k of Object.keys(ITEMS)) o[k] = safeInt(s && s[k], 0, 999); for (const t of TOOLS) if (t) o[t.id] = s && s[t.id] === 1 ? 1 : 0; return o; })();
function saveBag() { store.set('canopy-spire-items', bag); }
const count = k => RES.includes(k) ? game.inventory[k] : bag[k] || 0;
function give(k, n = 1) { if (RES.includes(k)) game.inventory[k] += n; else bag[k] = (bag[k] || 0) + n; saveBag(); renderInventory(); renderBag(); renderHotbar(); }
function take(k, n = 1) { if (count(k) < n) return false; if (RES.includes(k)) game.inventory[k] -= n; else bag[k] -= n; saveBag(); renderInventory(); renderBag(); return true; }
game.tool = 0; player.toolUse = false;
function craft(i) {
  const r = RECIPES[i]; if (!r) return;
  if (toolIdx(r.out) > 0 && bag[r.out]) return;
  if (!Object.entries(r.need).every(([k, n]) => count(k) >= n)) { sfx.play('miss'); return; }
  for (const [k, n] of Object.entries(r.need)) take(k, n);
  give(r.out, r.n || 1); sfx.play('craft');
  const info = itemInfo(r.out); game.toast(`🛠️ Crafted ${info.i} ${info.n}${r.n > 1 ? ' ×' + r.n : ''}`);
  if (toolIdx(r.out) > 0 && !game.tool) selectTool(toolIdx(r.out));
}
function selectTool(k) {
  if (k && !bag[TOOLS[k].id]) { game.toast(`${TOOLS[k].i} ${TOOLS[k].n} — not crafted yet (open your backpack with I)`); return; }
  game.tool = game.tool === k ? 0 : k; player.toolUse = false; sfx.play('ui'); renderHotbar();
}
// ---------- backpack & hotbar UI ----------
ui.bagOpen = false; let bagTab = 'items';
function openBag(tab) { ui.bagOpen = true; if (tab) bagTab = tab; keys.clear(); document.exitPointerLock(); $('bag').classList.remove('hidden'); renderBag(); }
function closeBag() { ui.bagOpen = false; $('bag').classList.add('hidden'); lockPointer(); }
function renderBag() {
  if (!ui.bagOpen) return;
  const tabs = `<div class="bagtabs">${['items', 'craft'].map(t => `<button data-tab="${t}" class="${bagTab === t ? 'on' : ''}">${t === 'items' ? '🎒 Items' : '🛠️ Craft'}</button>`).join('')}</div>`;
  let body = '';
  if (bagTab === 'items') {
    const cell = (k, n, extra = '') => { const f = itemInfo(k); return `<div class="cell${n ? '' : ' empty'}${extra}" title="${f.n} — ${f.d}"><span class="ic">${f.i}</span>${n > 1 ? `<span class="ct">${n}</span>` : ''}<span class="nm">${f.n}</span></div>`; };
    body += '<h4>Tools</h4><div class="grid">' + TOOLS.slice(1).map((t, i) => bag[t.id] ? cell(t.id, 1, game.tool === i + 1 ? ' sel" data-equip="' + (i + 1) : '" data-equip="' + (i + 1)) : `<div class="cell empty" title="${t.n} — craft it in the Craft tab"><span class="ic" style="filter:grayscale(1);opacity:.35">${t.i}</span><span class="nm">${t.n}</span></div>`).join('') + '</div>';
    body += '<h4>Materials & parts</h4><div class="grid">' + [...RES, 'shell', 'feather', 'crystal', 'moonpetal', 'resin', 'spring', 'seed'].map(k => cell(k, count(k))).join('') + '</div>';
    const keyItems = ['parcel', 'letter', 'compass', 'heartseed'].filter(k => bag[k]);
    if (keyItems.length) body += '<h4>Keepsakes</h4><div class="grid">' + keyItems.map(k => cell(k, bag[k])).join('') + '</div>';
    body += '<div class="hint">Hover an item for details · click a tool to equip it</div>';
  } else {
    body += RECIPES.map((r, i) => {
      const f = itemInfo(r.out), isTool = toolIdx(r.out) > 0, owned = isTool && bag[r.out], ok = Object.entries(r.need).every(([k, n]) => count(k) >= n);
      const need = Object.entries(r.need).map(([k, n]) => `<span class="${count(k) >= n ? 'have' : 'miss'}">${itemInfo(k).i} ${count(k)}/${n}</span>`).join(' ');
      return `<div class="recipe"><span class="ic">${f.i}</span><div class="rt"><b>${f.n}${r.n > 1 ? ' ×' + r.n : ''}</b><br><small>${f.d}</small><br>${need}</div><button data-craft="${i}" ${owned || !ok ? 'disabled' : ''}>${owned ? '✓ Owned' : 'Craft'}</button></div>`;
    }).join('');
  }
  $('bag').innerHTML = tabs + '<div class="bagbody">' + body + '</div><div class="bagfoot"><span class="key">I</span>/<span class="key">Tab</span> close · <span class="key">1</span>–<span class="key">5</span> select tool · <span class="key">LMB</span>/<span class="key">V</span> use</div>';
}
$('bag').addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-craft],[data-equip]'); if (!t) return;
  if (t.dataset.tab) { bagTab = t.dataset.tab === 'craft' ? 'craft' : 'items'; renderBag(); }
  else if (t.dataset.craft !== undefined) craft(safeInt(t.dataset.craft, 0, RECIPES.length - 1));
  else if (t.dataset.equip) { selectTool(safeInt(t.dataset.equip, 1, 5)); renderBag(); }
});
function renderHotbar() {
  $('hotbar').innerHTML = TOOLS.slice(1).map((t, i) => `<div class="slot${bag[t.id] ? '' : ' locked'}${game.tool === i + 1 ? ' sel' : ''}${game.tool === i + 1 && player.toolUse ? ' on' : ''}" title="${t.n}"><span class="k">${i + 1}</span>${t.i}</div>`).join('');
}

// ---------- foraging (per-player, respawning) ----------
const FORAGE_COL = { shell: 0xff9ec4, feather: 0xffffff, crystal: 0x6fe3ff, moonpetal: 0xff8fd1, resin: 0xffb300 };
const FORAGE_GEO = {
  shell: (() => { const a = new THREE.ConeGeometry(0.22, 0.4, 10); a.rotateX(Math.PI / 2); const b = new THREE.TorusGeometry(0.16, 0.07, 6, 12); return mergeNI([a, b]); })(),
  feather: (() => { const g = ICO1.clone(); g.scale(0.09, 0.42, 0.03); g.rotateZ(0.5); return g; })(),
  crystal: (() => { const g = facet(new THREE.OctahedronGeometry(0.22)); g.scale(1, 1.8, 1); return g; })(),
  moonpetal: (() => { const parts = []; for (let i = 0; i < 5; i++) { const p = ICO1.clone(); p.scale(0.16, 0.04, 0.08); p.translate(0.14, 0, 0); p.rotateY(i * 1.2566); parts.push(p); } return mergeNI(parts); })(),
  resin: new THREE.SphereGeometry(0.2, 14, 10),
};
const forage = [];
function addForage(type, x, y, z) {
  const m = new THREE.Mesh(FORAGE_GEO[type], toon(FORAGE_COL[type], { emissive: FORAGE_COL[type], emissiveIntensity: type === 'feather' ? 0.2 : 0.45 }));
  m.position.set(x, y + 0.55, z); m.castShadow = true; scene.add(m);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT_TEX, color: FORAGE_COL[type], transparent: true, opacity: 0.5, depthWrite: false })); sp.scale.setScalar(1.1); m.add(sp);
  forage.push({ type, pos: new V3(x, y + 0.55, z), m, cd: 0, ph: Math.random() * 6, lbl: null });
}
function scatterForage(type, n, cx, cz, rad, maxY, seed, filter) {
  const r = mulberry32(seed); let k = 0;
  for (let t = 0; t < n * 40 && k < n; t++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const b = phys.surfaceBox(x, z, maxY); if (!b || ['roof', 'lamp', 'post', 'tree', 'bounce', 'npc', 'portal', 'crate', 'stone'].includes(b.tag)) continue;
    const y = b.max.y; if (phys.pointInside(new V3(x, y + 0.5, z)) || (filter && !filter(x, y, z))) continue;
    if (forage.some(f => f.pos.distanceTo(new V3(x, y + 0.55, z)) < 4)) continue;
    addForage(type, x, y, z); k++;
  }
}
function updateForage(dt) {
  const c = player.pos.clone(); c.y += 0.9;
  for (const f of forage) {
    if (f.cd > 0) { f.cd -= dt; if (f.cd <= 0) f.m.visible = true; }
    if (!f.m.visible) continue;
    f.m.rotation.y += dt * 1.4; f.m.position.y = f.pos.y + Math.sin(world.time * 2.2 + f.ph) * 0.12;
    if (game.playing && c.distanceTo(f.pos) < 2.0) { f.m.visible = false; f.cd = 90; give(f.type, 1); sfx.play('pickup', f.type === 'crystal' ? 'energy' : 'bio'); game.toast(`${ITEMS[f.type].i} +1 ${ITEMS[f.type].n}`); }
  }
}

// ---------- shared environment state (host-authoritative, saved with the world) ----------
const SPROUTS = [
  { id: 'S1', pos: [11.6, 36, 8.6], name: 'canopy sprout' },
  { id: 'S2', pos: [37.4, 0, -9.0], name: 'tower sprout' },
  { id: 'S3', pos: [8, 0, 96], name: 'south-shore sprout' },
];
const LG = VA(REALMS.lagoon.c), BW = VA(REALMS.bloomwood.c), TW = VA(REALMS.thornwood.c);
const FERTILE = [
  { id: 'F1', pos: [LG.x + 11.8, 0, LG.z - 22] },
  { id: 'F2', pos: [LG.x + 5.6, 6, LG.z - 22] },
  { id: 'F3', pos: [-14, 0, 40] },            // a free spot on the main island for shortcuts & fun
];
const WHEEL_POS = [LG.x + 6, 0, LG.z + 1], ALTAR_POS = [BW.x, 14, BW.z - 8];
const SHRINES = [[BW.x - 26, 0, BW.z - 6], [BW.x + 26, 0, BW.z - 6], [BW.x - 12, 0, BW.z - 32], [BW.x + 12, 0, BW.z - 32]];
function defaultEnv() { return { sprouts: { S1: false, S2: false, S3: false }, plants: { F1: false, F2: false, F3: false }, wheel: false, gateOpened: false, shrines: [false, false, false, false], altar: false, n: 0 }; }
function sanitizeEnv(s) {
  const d = defaultEnv(); if (!s || typeof s !== 'object') return d;
  for (const k of Object.keys(d.sprouts)) d.sprouts[k] = !!(s.sprouts && s.sprouts[k] === true);
  for (const k of Object.keys(d.plants)) d.plants[k] = !!(s.plants && s.plants[k] === true);
  d.wheel = s.wheel === true; d.gateOpened = s.gateOpened === true; d.altar = s.altar === true; d.n = safeInt(s.n, 0, 1e9);
  d.shrines = d.shrines.map((_, i) => !!(Array.isArray(s.shrines) && s.shrines[i] === true));
  if (s.ev && typeof s.ev === 'object') d.ev = { a: String(s.ev.a).slice(0, 12), id: String(s.ev.id).slice(0, 8), by: safeId(s.ev.by) };
  return d;
}
game.env = defaultEnv();
const toolOf = (net, from) => { if (from === net.selfId) return { k: game.tool, u: player.toolUse }; const pl = net.auth.players.get(from) || {}; return { k: pl.k || 0, u: pl.u === true }; };
function envHost(net, from, m) {
  const E = net.auth.env, sp = senderPos(net, from), tl = toolOf(net, from); if (!sp || !E) return;
  const send = ev => { E.ev = ev; E.n++; net.broadcast({ t: 'ENV_STATE', s: E }); delete E.ev; };
  const id = typeof m.id === 'string' ? m.id : '';
  if (m.a === 'water') { const s = SPROUTS.find(s => s.id === id); if (!s || E.sprouts[id] || tl.k !== 1 || sp.distanceTo(VA(s.pos)) > 4.5) return; E.sprouts[id] = true; send({ a: 'water', id, by: from }); }
  else if (m.a === 'plant') { const f = FERTILE.find(f => f.id === id); if (!f || E.plants[id] || tl.k !== 4 || sp.distanceTo(VA(f.pos)) > 4) return; E.plants[id] = true; send({ a: 'plant', id, by: from }); }
  else if (m.a === 'gust') { if (tl.k !== 3 || sp.distanceTo(VA(WHEEL_POS)) > 12) return; E.wheel = true; E.gateOpened = true; send({ a: 'gust', id: 'W', by: from }); clearTimeout(net.wheelT); net.wheelT = setTimeout(() => { E.wheel = false; send({ a: 'close', id: 'W', by: null }); }, 20000); }
  else if (m.a === 'light') { const i = safeInt(m.i, 0, 3); if (E.shrines[i] || tl.k !== 2 || !tl.u || sp.distanceTo(VA(SHRINES[i])) > 4.5) return; E.shrines[i] = true; send({ a: 'light', id: String(i), by: from }); }
  else if (m.a === 'altar') { if (E.altar || !E.shrines.every(Boolean) || sp.distanceTo(VA(ALTAR_POS)) > 4.5) return; E.altar = true; send({ a: 'altar', id: 'A', by: from }); }
}
const envSend = (a, extra = {}) => game.net.send({ t: 'ENV', a, ...extra });
// ---------- main-island sprouts (Watering Can) ----------
const leafMat = toon(0x6cc04a), stemMat = toon(0x3f8f3a), witherMat = toon(0x8a6a48);
const sproutObjs = SPROUTS.map(S => {
  const p = VA(S.pos), withered = new THREE.Group(); withered.position.copy(p); scene.add(withered);
  for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(ICO1, witherMat); l.scale.set(0.08, 0.3, 0.14); l.position.set(Math.cos(i * 1.57) * 0.18, 0.3, Math.sin(i * 1.57) * 0.18); l.rotation.z = Math.cos(i * 1.57) * 0.9; l.rotation.x = Math.sin(i * 1.57) * 0.9; withered.add(l); }
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(0x6b4a2e)); mound.scale.y = 0.35; withered.add(mound);
  const grown = new THREE.Group(); scene.add(grown); grown.visible = false; const cols = [];
  const leaf = (x, y, z, s = 1) => { const l = new THREE.Mesh(ICO1, leafMat); l.scale.set(1.25 * s, 0.18, 1.25 * s); l.position.set(x, y - 0.12, z); l.castShadow = l.receiveShadow = true; grown.add(l); const c = phys.add(x - 1.1 * s, y - 0.3, z - 1.1 * s, x + 1.1 * s, y, z + 1.1 * s, 'leaf'); c.enabled = false; cols.push(c); };
  const stem = (x0, y0, z0, x1, y1, z1, r = 0.12) => { const a = new V3(x0, y0, z0), b = new V3(x1, y1, z1), g = new THREE.CylinderGeometry(r, r * 1.2, a.distanceTo(b), 8); g.rotateX(Math.PI / 2); const m = new THREE.Mesh(g, stemMat); m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); grown.add(m); };
  if (S.id === 'S1') { // leaf staircase up the spire's east face to the first setback
    let prev = [p.x, 36, p.z]; [6, 3, 0, -3, -6, -9].forEach((z, i) => { const y = 37.8 + i * 1.8; leaf(10.6, y, z); stem(prev[0], prev[1], prev[2], 10.9, y - 0.2, z, 0.1); prev = [10.9, y - 0.2, z]; });
  } else if (S.id === 'S2') { // beanstalk to the solar-tower terrace (climbable, with rest leaves)
    const sx = 39, sz = -9, H = 34;
    const g = cylGeo(0.55, 0.75, H, 10); const m = new THREE.Mesh(g, stemMat); m.position.set(sx, H / 2, sz); m.castShadow = true; grown.add(m);
    const c = phys.add(sx - 0.6, 0, sz - 0.6, sx + 0.6, H, sz + 0.6, 'stalk'); c.enabled = false; cols.push(c);
    [6, 12, 18, 24, 30].forEach((y, i) => leaf(sx + (i % 2 ? -1.75 : 1.75), y, sz, 0.85));
    leaf(40.6, 34.4, -5.6, 0.95);
    for (let i = 0; i < 14; i++) { const l = new THREE.Mesh(ICO1, leafMat); l.scale.set(0.5, 0.1, 0.3); l.position.set(sx + Math.cos(i * 2.4) * 0.8, 2 + i * 2.3, sz + Math.sin(i * 2.4) * 0.8); l.rotation.y = -i * 2.4; grown.add(l); }
  } else { // a giant flower
    stem(p.x, 0, p.z, p.x, 5, p.z, 0.3);
    for (let i = 0; i < 8; i++) { const l = new THREE.Mesh(ICO1, toon(i % 2 ? 0xff8fb1 : 0xffb3d1)); const a = i / 8 * Math.PI * 2; l.scale.set(1.6, 0.25, 0.8); l.position.set(p.x + Math.cos(a) * 1.4, 5.2, p.z + Math.sin(a) * 1.4); l.rotation.y = -a; grown.add(l); }
    const ctr = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 10), toon(0xffd54f, { emissive: 0xffb300, emissiveIntensity: 0.4 })); ctr.position.set(p.x, 5.4, p.z); ctr.scale.y = 0.5; grown.add(ctr);
    leaf(p.x, 5.6, p.z, 1.2);
  }
  addInteract({ pos: p.clone().setY(p.y + 0.8), range: 3.6, label: () => game.env.sprouts[S.id] ? null : game.tool === 1 ? '<span class="key">V</span> Water the withered sprout' : '🥀 A withered sprout — it needs a Watering Can 🚿' });
  return { ...S, p, withered, grown, cols };
});
function growSprout(o, instant) {
  o.withered.visible = false; o.grown.visible = true; o.cols.forEach(c => c.enabled = true);
  if (instant) { o.grown.scale.setScalar(1); return; }
  o.grown.scale.setScalar(0.01); world.tween(2.2, k => { o.grown.scale.setScalar(Math.max(0.01, k)); o.grown.position.set(o.p.x * (1 - k), o.p.y * (1 - k), o.p.z * (1 - k)); }, () => o.grown.position.set(0, 0, 0));
  world.burst(o.p.clone().setY(o.p.y + 1), 0x8bd34a, 160);
}

// ---------- fertile soil (Seed Pouch → bounce blooms) ----------
const fertileObjs = FERTILE.map(F => {
  const p = VA(F.pos), soil = new THREE.Mesh(cylGeo(1.2, 1.3, 0.16, 24), toon(0x5b3b22)); soil.position.set(p.x, p.y + 0.08, p.z); scene.add(soil);
  const sp = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.05, 6, 24), glowMat(0x8bd34a, 0.4)); sp.rotation.x = Math.PI / 2; sp.position.set(p.x, p.y + 0.18, p.z); scene.add(sp);
  addInteract({ pos: p.clone().setY(p.y + 0.8), range: 3.4, label: () => game.env.plants[F.id] ? null : game.tool === 4 ? `<span class="key">V</span> Plant a Bloom Seed (${count('seed')} 🫘)` : '🟫 Fertile soil — plant a seed with the Seed Pouch 👝' });
  return { ...F, p, soil, sp, pad: null };
});
function growPlant(o, instant) {
  if (o.pad) return; o.sp.visible = false;
  const g = new THREE.Group(); g.position.copy(o.p); scene.add(g);
  const stem = new THREE.Mesh(cylGeo(0.35, 0.5, 0.55, 12), toon(PAL.leaf3)); stem.position.y = 0.27; g.add(stem);
  const cap = new THREE.Group(); cap.position.y = 0.55; g.add(cap);
  const disc = new THREE.Mesh(new THREE.SphereGeometry(1.25, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xff7eb3)); disc.scale.y = 0.28; disc.castShadow = true; cap.add(disc);
  for (let i = 0; i < 10; i++) { const pt = new THREE.Mesh(ICO1, toon(i % 2 ? 0xffb3d1 : 0xff5c9a)); const a = i / 10 * Math.PI * 2; pt.scale.set(0.55, 0.12, 0.3); pt.position.set(Math.cos(a) * 1.3, 0.05, Math.sin(a) * 1.3); pt.rotation.y = -a; cap.add(pt); }
  const col = phys.add(o.p.x - 1.25, o.p.y, o.p.z - 1.25, o.p.x + 1.25, o.p.y + 0.5, o.p.z + 1.25, 'bounce');
  o.pad = { g, cap, col, tier: null, active: true, squash: 0 }; pads.push(o.pad);
  if (!instant) { g.scale.setScalar(0.01); world.tween(1.2, k => g.scale.setScalar(Math.max(0.01, k))); world.burst(o.p.clone().setY(o.p.y + 1), 0xff7eb3, 120); }
}

// ---------- Realm: Tidepool Lagoon ----------
const sandMat = toon(0xf3dfb0, { map: TEX.plaster }), coralMat = toon(0xff8a7a, { map: TEX.stone }), templeMat = toon(0x9fd8cf, { map: TEX.stone });
{
  world.block(LG.x - 50, -8, LG.z - 50, LG.x + 50, 0, LG.z + 50, sandMat, { r: 3 });
  const r = mulberry32(501);
  for (let i = 0; i < 6; i++) { const x = LG.x + (r() - 0.5) * 70, z = LG.z + 10 + (r() - 0.5) * 50; if (Math.abs(x - LG.x) < 18 && z < LG.z - 2) continue; const w = world.waterPlane(x - 4 - r() * 4, 0.06, z - 3 - r() * 3, x + 4 + r() * 4, z + 3 + r() * 3, 3); w.visible = true; w.material.opacity = 0.7; w.material.color = new THREE.Color(0x7ff0e0); }
  for (let i = 0; i < 16; i++) { // palms
    const a = r() * Math.PI * 2, d = 30 + r() * 16, x = LG.x + Math.cos(a) * d, z = LG.z + Math.sin(a) * d; if (Math.hypot(x - LG.x, z - (LG.z + 40)) < 8) continue;
    const lean = (r() - 0.5) * 0.5, h = 5 + r() * 3;
    for (let k = 0; k < 5; k++) world.put(cylGeo(0.22, 0.28, h / 5 + 0.1, 8, TEX.wood), toon(0xa47b52, { map: TEX.wood }), x + Math.sin(lean) * k * h / 5, (k + 0.5) * h / 5, z, { rz: -lean });
    const tx = x + Math.sin(lean) * h, ty = h;
    for (let k = 0; k < 7; k++) { const fa = k / 7 * Math.PI * 2; world.put(ICO1, toon(0x4caf50), tx + Math.cos(fa) * 1.4, ty - 0.3, z + Math.sin(fa) * 1.4, { sx: 1.7, sy: 0.12, sz: 0.4, ry: -fa, rz: 0.25 }); }
    phys.add(x - 0.3, 0, z - 0.3, x + 0.3, h * 0.6, z + 0.3, 'tree');
  }
  for (let i = 0; i < 14; i++) { const a = r() * 6.28, d = 20 + r() * 28; world.put(rockGeo(0.6 + r(), 900 + i), toon(0xc9b99a), LG.x + Math.cos(a) * d, 0.1, LG.z + Math.sin(a) * d); }
  // courtyard walls (coral — too slick to climb) with a wind-wheel gate
  const W = (x0, z0, x1, z1) => world.block(x0, 0, z0, x1, 9, z1, coralMat, { r: 0.4, tag: 'noclimb' });
  W(LG.x - 16, LG.z - 36, LG.x + 16, LG.z - 34.5); W(LG.x - 16, LG.z - 34.5, LG.x - 14.5, LG.z - 4); W(LG.x + 14.5, LG.z - 34.5, LG.x + 16, LG.z - 4);
  W(LG.x - 16, LG.z - 5.5, LG.x - 2.6, LG.z - 4); W(LG.x + 2.6, LG.z - 5.5, LG.x + 16, LG.z - 4);
  for (let i = 0; i < 26; i++) { const t = i / 26; const x = LG.x - 16 + t * 32; world.put(new THREE.ConeGeometry(0.4, 1.4, 6), toon(0xff6f61), x, 9.6, LG.z - 4.7); world.put(new THREE.ConeGeometry(0.4, 1.4, 6), toon(0xff6f61), x, 9.6, LG.z - 35.2); }
  // sunken temple: three smooth tiers (no climbing — bounce your way up)
  const tz = LG.z - 22;
  world.block(LG.x - 10, 0, tz - 10, LG.x + 10, 3, tz + 10, templeMat, { r: 0.3, tag: 'noclimb' });
  world.block(LG.x - 7.5, 3, tz - 7.5, LG.x + 7.5, 6, tz + 7.5, templeMat, { r: 0.3, tag: 'noclimb' });
  world.block(LG.x - 3.5, 6, tz - 3.5, LG.x + 3.5, 9.5, tz + 3.5, templeMat, { r: 0.3, tag: 'noclimb' });
  for (const s of [-1, 1]) { world.put(new THREE.TorusGeometry(1.5, 0.25, 6, 16, Math.PI), toon(PAL.brass), LG.x + s * 7.55, 4.0, tz, { ry: Math.PI / 2 }); }
  world.vines(LG.x, tz + 10, 0.5, 3, 0, 1, 3, 16);
  // shipwreck by the captain
  const hull = new THREE.CylinderGeometry(2.2, 2.2, 9, 14, 1, true, 0, Math.PI); hull.rotateZ(Math.PI / 2); hull.rotateY(0.4);
  world.put(hull, toon(0x8a5a33, { map: TEX.wood, side: THREE.DoubleSide }), LG.x + 14, 1.6, LG.z + 27, { rx: Math.PI });
  world.put(cylGeo(0.15, 0.18, 7, 8, TEX.wood), toon(0x8a5a33, { map: TEX.wood }), LG.x + 14, 3.5, LG.z + 27, { rz: 0.5 });
  phys.add(LG.x + 9.5, 0, LG.z + 24.5, LG.x + 18.5, 1.6, LG.z + 29.5);
}
const gateMesh = new THREE.Mesh(boxGeo(5.2, 9, 1.2, 3, 0.2), toon(0xd96b5f, { map: TEX.wood })); gateMesh.position.set(LG.x, 4.5, LG.z - 4.75); scene.add(gateMesh);
const gateCol = phys.add(LG.x - 2.6, 0, LG.z - 5.4, LG.x + 2.6, 9, LG.z - 4.1, 'noclimb');
const wheel = new THREE.Group(); wheel.position.set(WHEEL_POS[0], 3.4, WHEEL_POS[2]); scene.add(wheel);
world.put(cylGeo(0.15, 0.22, 3.4, 8, TEX.wood), toon(0x8a5a33, { map: TEX.wood }), WHEEL_POS[0], 1.7, WHEEL_POS[2]); phys.add(WHEEL_POS[0] - 0.2, 0, WHEEL_POS[2] - 0.2, WHEEL_POS[0] + 0.2, 3.4, WHEEL_POS[2] + 0.2, 'post');
const wheelRotor = new THREE.Group(); wheelRotor.position.z = 0.3; wheel.add(wheelRotor);
for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(boxGeo(0.35, 1.5, 0.05, 0, 0.02), toon(i % 2 ? 0xffffff : 0x4fd1c5)); b.position.y = 0.8; const pv = new THREE.Group(); pv.rotation.z = i * Math.PI / 3; pv.add(b); wheelRotor.add(pv); }
addInteract({ pos: VA(WHEEL_POS).setY(1.5), range: 5, label: () => game.env.wheel ? '🌬️ The wheel spins — the gate is open!' : game.tool === 3 ? '<span class="key">V</span> Blow the Wind Horn at the wheel' : '🌬️ A still wind wheel — it needs a gust (📯 Wind Horn)' });
const compassMesh = new THREE.Group(); compassMesh.position.set(LG.x, 10.3, LG.z - 22); scene.add(compassMesh);
{ const c1 = new THREE.Mesh(cylGeo(0.35, 0.35, 0.1, 24), toon(PAL.brass, { emissive: 0x8a6000, emissiveIntensity: 0.4 })); c1.rotation.x = Math.PI / 2; compassMesh.add(c1); const n = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 6), toon(0xff5252)); n.rotation.z = Math.PI / 2; n.position.z = 0.07; compassMesh.add(n); }
addInteract({ pos: compassMesh.position.clone(), range: 3, prio: 0.5, label: () => count('compass') || QS.flags.compassReturned ? null : '<span class="key">E</span> Pick up the old brass compass', act: () => { give('compass'); sfx.play('relic'); game.toast('🧭 Found Captain Skerry’s compass!', true); } });

// ---------- Realm: Moonlit Bloomwood ----------
{
  world.block(BW.x - 58, -8, BW.z - 58, BW.x + 58, 0, BW.z + 58, toon(0x2f5a46, { map: TEX.grass }), { r: 3 });
  const r = mulberry32(777), glowCols = [0x6fe3ff, 0xb388ff, 0xff8fd1, 0x7dffb2];
  for (let i = 0; i < 22; i++) { // glowing trees
    const a = r() * 6.28, d = 18 + r() * 36, x = BW.x + Math.cos(a) * d, z = BW.z + Math.sin(a) * d; if (Math.hypot(x - BW.x, z - (BW.z + 40)) < 9 || SHRINES.some(s => Math.hypot(x - s[0], z - s[2]) < 5)) continue;
    const h = 4 + r() * 4, c = glowCols[i % 4];
    world.put(cylGeo(0.25, 0.45, h, 8, TEX.wood), toon(0x3b2f4a, { map: TEX.wood }), x, h / 2, z); phys.add(x - 0.35, 0, z - 0.35, x + 0.35, h, z + 0.35, 'tree');
    for (let k = 0; k < 4; k++) world.put(ICO1, toon(c, { emissive: c, emissiveIntensity: 0.55 }), x + Math.cos(k * 1.6) * 1.1, h + (k % 2) * 0.8, z + Math.sin(k * 1.6) * 1.1, { sx: 1.4, sy: 1.0, sz: 1.4 });
  }
  for (let i = 0; i < 14; i++) { // giant mushrooms (caps are platforms)
    const a = r() * 6.28, d = 12 + r() * 40, x = BW.x + Math.cos(a) * d, z = BW.z + Math.sin(a) * d; if (Math.hypot(x - BW.x, z - (BW.z + 40)) < 9 || Math.hypot(x - BW.x, z - (BW.z - 8)) < 9 || SHRINES.some(s => Math.hypot(x - s[0], z - s[2]) < 5)) continue;
    const h = 1.5 + r() * 3.5, rad = 1.2 + r() * 1.3, c = glowCols[(i + 1) % 4];
    world.put(cylGeo(0.3, 0.45, h, 10), toon(0xf3e9d2), x, h / 2, z);
    world.put(new THREE.SphereGeometry(rad, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(c, { emissive: c, emissiveIntensity: 0.5 }), x, h, z, { sy: 0.55 });
    phys.add(x - rad * 0.7, 0, z - rad * 0.7, x + rad * 0.7, h + rad * 0.45, z + rad * 0.7, 'mushroom');
  }
  for (let i = 0; i < 40; i++) { const x = BW.x + (r() - 0.5) * 100, z = BW.z + (r() - 0.5) * 100; world.put(new THREE.SphereGeometry(0.18, 8, 6), toon(0x7dffb2, { emissive: 0x3dff9a, emissiveIntensity: 0.9 }), x, 0.12, z, { cast: false }); }
  // central moon rock (smooth) + altar
  world.block(BW.x - 3, 0, BW.z - 11, BW.x + 3, 14, BW.z - 5, toon(0x4b4568, { map: TEX.stone }), { r: 0.6, tag: 'noclimb' });
  world.put(cylGeo(0.7, 0.9, 1.1, 16, TEX.stone), stoneMat, ALTAR_POS[0], 14.55, ALTAR_POS[2]);
  phys.add(ALTAR_POS[0] - 0.7, 14, ALTAR_POS[2] - 0.7, ALTAR_POS[0] + 0.7, 15.1, ALTAR_POS[2] + 0.7);
}
const moonOrb = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), toon(0xdfe8ff, { emissive: 0x9fb4ff, emissiveIntensity: 0.1 })); moonOrb.position.set(ALTAR_POS[0], 16, ALTAR_POS[2]); scene.add(moonOrb);
const moonBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 300, 12, 1, true), noOutline(new THREE.MeshBasicMaterial({ color: 0xbfd0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))); moonBeam.position.set(ALTAR_POS[0], 166, ALTAR_POS[2]); moonBeam.visible = false; scene.add(moonBeam);
addInteract({ pos: VA(ALTAR_POS).setY(15.4), range: 3.4, prio: 0.5, label: () => game.env.altar ? '🌕 The Moon Altar shines — the Thornwood portal is open' : game.env.shrines.every(Boolean) ? '<span class="key">E</span> Wake the Moon Altar' : `🌑 The altar sleeps — light the moth shrines (${game.env.shrines.filter(Boolean).length}/4)`, act: () => { if (!game.env.altar && game.env.shrines.every(Boolean)) envSend('altar'); } });
const shrineObjs = SHRINES.map((sp, i) => {
  const p = VA(sp); world.block(p.x - 0.5, 0, p.z - 0.5, p.x + 0.5, 2.6, p.z + 0.5, stoneMat, { r: 0.1 });
  const lampMat = glowMat(0xffe9a8, 0.05), bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), lampMat); bulb.position.set(p.x, 3.0, p.z); scene.add(bulb);
  const moths = new THREE.Group(); moths.position.set(p.x, 3.0, p.z); scene.add(moths);
  for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), noOutline(new THREE.MeshBasicMaterial({ color: 0xfff3d6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }))); m.userData.a = k; moths.add(m); }
  addInteract({ pos: p.clone().setY(1.6), range: 4, label: () => game.env.shrines[i] ? '🦋 The moths are dancing' : game.tool === 2 && player.toolUse ? '🏮 Hold your light near…' : '🦋 A dark moth shrine — bring a lit Glow Lantern 🏮' });
  return { p, lampMat, moths };
});
// glyph platforms: only solid near a lit lantern
const glyphMat = noOutline(new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.08, depthWrite: false }));
const glyphs = [];
for (let i = 0; i < 8; i++) {
  const a = -Math.PI / 2 + i * Math.PI / 4, cx = BW.x, cz = BW.z - 8, x = cx + Math.cos(a) * 5.4, z = cz + Math.sin(a) * 5.4, y = 1.75 * (i + 1);
  const m = new THREE.Mesh(boxGeo(2.3, 0.25, 2.3, 0, 0.08), glyphMat.clone()); m.position.set(x, y - 0.125, z); scene.add(m);
  const rune = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 24), m.material); rune.rotation.x = Math.PI / 2; rune.position.y = 0.15; m.add(rune);
  const col = phys.add(x - 1.15, y - 0.25, z - 1.15, x + 1.15, y, z + 1.15, 'glyph'); col.enabled = false;
  glyphs.push({ m, col, x, y, z, k: 0 });
}
// a pool of lantern lights (fixed count so materials never recompile)
const lanternLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffd29a, 0, 16, 2); scene.add(l); return l; });
const bloomFlies = (() => {
  const N = 320, pos = new Float32Array(N * 3), seed = [], r = mulberry32(12);
  for (let i = 0; i < N; i++) seed.push([BW.x + (r() - 0.5) * 110, 0.5 + r() * 5, BW.z + (r() - 0.5) * 110, r() * 6.28]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8ff8a, size: 0.35, map: DOT_TEX, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.frustumCulled = false; scene.add(m);
  return { m, g, pos, seed, N };
})();
// ---------- Realm: Thornwood Hollow & the Thornheart ----------
const AY = TW.y, ANCHORS = [90, 210, 330].map(d => { const a = d * Math.PI / 180; return new V3(TW.x + Math.cos(a) * 18, AY, TW.z + Math.sin(a) * 18); });
const PAD_A = new V3(TW.x - 14, AY, TW.z), PAD_B = new V3(TW.x + 14, AY, TW.z), PYL_A = new V3(TW.x - 14, AY, TW.z - 31), PYL_B = new V3(TW.x + 14, AY, TW.z + 31);
const FLOWERS = [[0, -26], [26, 0], [0, 26], [-26, 0]].map(([x, z]) => new V3(TW.x + x, AY, TW.z + z));
const FLOWER_COLS = [0xff6b8b, 0xffd54f, 0x69db7c, 0x4dabf7], FLOWER_NOTES = [392.0, 493.9, 587.3, 784.0];
{
  world.block(TW.x - 34, AY - 3, TW.z - 34, TW.x + 34, AY, TW.z + 34, toon(0x6d5a6e, { map: TEX.grass }), { r: 3 });
  world.put(new THREE.ConeGeometry(40, 45, 10), toon(0x5a4a5e, { map: TEX.stone }), TW.x, AY - 3 - 22.5, TW.z, { rx: Math.PI });
  const r = mulberry32(66);
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 29 + r() * 4, x = TW.x + Math.cos(a) * d, z = TW.z + Math.sin(a) * d; if (Math.hypot(x - (TW.x - 10), z - (TW.z + 31)) < 5 || Math.hypot(x - PYL_B.x, z - PYL_B.z) < 4 || Math.hypot(x - PYL_A.x, z - PYL_A.z) < 4) continue; world.put(new THREE.ConeGeometry(0.4 + r() * 0.4, 2 + r() * 3, 6), toon(0x4a2f4f), x, AY + 1.2, z, { rx: (r() - 0.5) * 0.6, rz: (r() - 0.5) * 0.6 }); }
  for (const p of [PYL_A, PYL_B]) { world.block(p.x - 0.8, AY, p.z - 0.8, p.x + 0.8, AY + 3.2, p.z + 0.8, stoneMat, { r: 0.15 }); }
  for (const p of [PAD_A, PAD_B]) { world.put(cylGeo(1.5, 1.6, 0.2, 24), toon(0xe9e1cf, { map: TEX.tile }), p.x, AY + 0.1, p.z); world.put(new THREE.TorusGeometry(1.25, 0.06, 6, 24), glowMat(0xffe08a, 0.6), p.x, AY + 0.22, p.z, { rx: Math.PI / 2 }); }
  for (const a of ANCHORS) world.put(rockGeo(1.3, a.x), toon(0x6b4a2e), a.x, AY + 0.4, a.z, { sy: 0.6 });
}
const pylonGems = [PYL_A, PYL_B].map(p => { const m = new THREE.Mesh(facet(new THREE.OctahedronGeometry(0.6)), glowMat(0xffd54f, 1.1)); m.position.set(p.x, AY + 4, p.z); scene.add(m); return m; });
const padMirror = new THREE.Group(); padMirror.position.set(PAD_B.x, AY + 0.25, PAD_B.z); scene.add(padMirror);
{ const pnl = new THREE.Mesh(boxGeo(1.8, 1.6, 0.12, 0, 0.04), toon(0xdbe9ff, { emissive: 0x7aa7ff, emissiveIntensity: 0.35 })); pnl.position.y = 1.4; padMirror.add(pnl); const post = new THREE.Mesh(cylGeo(0.08, 0.1, 0.8, 8), toon(PAL.brass)); post.position.y = 0.4; padMirror.add(post); }
const anchorRings = ANCHORS.map(a => { const m = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.1, 6, 32), glowMat(0x7dffb2, 0.05)); m.rotation.x = Math.PI / 2; m.position.set(a.x, AY + 0.3, a.z); scene.add(m); return m; });
const flowerObjs = FLOWERS.map((p, i) => { const g = new THREE.Group(); g.position.copy(p); scene.add(g); const mat = glowMat(FLOWER_COLS[i], 0.15); world.put(cylGeo(0.12, 0.16, 2, 8), toon(PAL.leaf3), p.x, AY + 1, p.z); for (let k = 0; k < 6; k++) { const pt = new THREE.Mesh(ICO1, mat); const a = k / 6 * Math.PI * 2; pt.scale.set(0.6, 0.12, 0.3); pt.position.set(Math.cos(a) * 0.55, 2.1, Math.sin(a) * 0.55); pt.rotation.y = -a; g.add(pt); } return { g, mat, glow: 0 }; });
// the Thornheart
const guardian = new THREE.Group(); guardian.position.set(TW.x, AY, TW.z); scene.add(guardian);
const barkMat = toon(0x6b4a3a, { map: TEX.wood, unique: true }), eyeMat = glowMat(0xff3d5a, 1.2), heartMat = glowMat(0xff3d5a, 0.9), crownMat = toon(0x6a5a6e, { unique: true });
let guardianMixer = null, guardianActs = {}, guardianClip = '', guardianRoarT = 0;
function guardianRoar() { if (!guardianMixer) return; guardianClip = ''; guardianPlay('Roar', true); guardianRoarT = 1.6; }
if (ASSETS.thornheart) {
  const gl = ASSETS.thornheart, root = gl.scene;
  toonize(root, n => ({ Bark: barkMat, Leaves: crownMat, Eyes: eyeMat, Heart: heartMat, Thorn: toon(0x3b2340), Blossom: toon(0xff8fb1), White: toon(0xffffff), Pollen: toon(0xffd54f), Dark: toon(0x2a1d16), Moss: toon(0x5c7a4a) })[n]);
  root.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  guardian.add(root);
  guardian.userData = { heart: root.getObjectByName('Heart'), thorns: root.getObjectByName('Thorns'), blossoms: root.getObjectByName('Blossoms'), arms: [] };
  guardian.userData.blossoms.visible = false;
  guardianMixer = new THREE.AnimationMixer(root); for (const c of gl.animations) guardianActs[c.name] = guardianMixer.clipAction(c);
}
function guardianPlay(name, once = false) {
  if (!guardianMixer || !guardianActs[name] || guardianClip === name) return;
  const next = guardianActs[name], prev = guardianActs[guardianClip];
  next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = once; next.fadeIn(0.4).play(); if (prev) prev.fadeOut(0.4);
  guardianClip = name;
}
if (!ASSETS.thornheart) {
  const body = new THREE.Mesh(cylGeo(2.0, 2.8, 9, 14, TEX.wood), barkMat); body.position.y = 4.5; body.castShadow = true; guardian.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14), barkMat); head.position.y = 10.2; head.scale.set(1, 0.85, 0.95); guardian.add(head);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), eyeMat); e.position.set(s * 0.85, 10.5, 2.0); guardian.add(e); }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 6, 16, Math.PI), toon(0x2a1d16)); mouth.position.set(0, 9.4, 2.15); mouth.rotation.z = Math.PI; guardian.add(mouth);
  guardian.userData.arms = [-1, 1].map(s => { const pv = new THREE.Group(); pv.position.set(s * 2.4, 7.5, 0); guardian.add(pv); const arm = new THREE.Mesh(cylGeo(0.35, 0.55, 6, 8, TEX.wood), barkMat); arm.position.y = -2.6; arm.rotation.z = s * 0.25; pv.add(arm); for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(ICO1, crownMat); l.scale.setScalar(0.7); l.position.set(s * 0.4, -5 - k * 0.3, k * 0.4 - 0.4); pv.add(l); } return pv; });
  const heart = new THREE.Mesh(facet(new THREE.OctahedronGeometry(0.75)), heartMat); heart.position.set(0, 5.5, 2.5); guardian.add(heart); guardian.userData.heart = heart;
  for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(ICO1, crownMat); const a = k / 7 * Math.PI * 2; l.scale.set(1.3, 0.9, 1.3); l.position.set(Math.cos(a) * 1.8, 12.4 + (k % 2) * 0.4, Math.sin(a) * 1.8); guardian.add(l); }
  const thorns = new THREE.Group(); guardian.add(thorns); guardian.userData.thorns = thorns;
  for (let k = 0; k < 34; k++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 6), toon(0x3b2340)); const a = k * 2.4, y = 1 + (k % 9) * 1.1; t.position.set(Math.cos(a) * 2.7, y, Math.sin(a) * 2.7); t.lookAt(t.position.clone().multiplyScalar(2).setY(y + 0.3)); t.rotateX(Math.PI / 2); thorns.add(t); }
  const blossoms = new THREE.Group(); blossoms.visible = false; guardian.add(blossoms); guardian.userData.blossoms = blossoms;
  for (let k = 0; k < 16; k++) { const b = new THREE.Mesh(ICO1, toon(k % 2 ? 0xff8fb1 : 0xffffff)); b.scale.setScalar(0.35); const a = k * 2.4; b.position.set(Math.cos(a) * 2.2, 11.5 + (k % 4) * 0.6, Math.sin(a) * 2.2); blossoms.add(b); }
}
phys.add(TW.x - 2.6, AY, TW.z - 2.6, TW.x + 2.6, AY + 12, TW.z + 2.6, 'noclimb');
const bossBeams = new THREE.Group(); scene.add(bossBeams);
const waves = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.9, 72, 1, true), noOutline(new THREE.MeshBasicMaterial({ color: 0xb06cff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }))); m.visible = false; scene.add(m); return { m, r: 0, on: false, hitDone: false }; });
function defaultBoss() { return { phase: 0, anchors: [0, 0, 0], mirror: 0, beams: [false, false], lightT: 0, seq: [], pos: 0, sp: 'idle', n: 0 }; }
function sanitizeBoss(s) {
  const d = defaultBoss(); if (!s || typeof s !== 'object') return d;
  d.phase = Number.isInteger(s.phase) && s.phase >= 0 && s.phase <= 4 ? s.phase : 0; d.anchors = [0, 1, 2].map(i => safeNum(Array.isArray(s.anchors) ? s.anchors[i] : 0, 0, 25)); d.mirror = safeInt(s.mirror, 0, 2);
  d.beams = [0, 1].map(i => !!(Array.isArray(s.beams) && s.beams[i] === true)); d.lightT = safeNum(s.lightT, 0, 3);
  d.seq = Array.isArray(s.seq) ? s.seq.slice(0, 6).map(v => safeInt(v, 0, 3)) : []; d.pos = safeInt(s.pos, 0, 6);
  d.sp = ['idle', 'show', 'input', 'fail'].includes(s.sp) ? s.sp : 'idle'; d.n = safeInt(s.n, 0, 1e9);
  if (s.hit && typeof s.hit === 'object') d.hit = { i: safeInt(s.hit.i, 0, 3), ok: s.hit.ok === true };
  return d;
}
game.boss = defaultBoss();
// ----- host side -----
function bossSendFn(net) { return () => { const B = net.auth.boss, now = performance.now() / 1000; B.anchors = net.anchT.map(t => t ? Math.max(0, 25 - (now - t)) : 0); B.n++; net.broadcast({ t: 'BOSS_STATE', s: B }); delete B.hit; }; }
function bossStartSong(net) {
  const B = net.auth.boss, send = bossSendFn(net);
  B.seq = Array.from({ length: 6 }, () => Math.floor(Math.random() * 4)); B.pos = 0; B.sp = 'show'; send();
  clearTimeout(net.songT); net.songT = setTimeout(() => { if (B.phase === 3 && B.sp === 'show') { B.sp = 'input'; B.noteAt = performance.now(); send(); } }, (6 * 0.85 + 1.2) * 1000);
}
function bossHost(net, from, m) {
  const B = net.auth.boss, sp = senderPos(net, from), tl = toolOf(net, from), send = bossSendFn(net); if (!sp || !B) return;
  net.anchT = net.anchT || [0, 0, 0];
  if (m.a === 'start') { if (B.phase !== 0 || xzDist(sp, TW) > 12 || Math.abs(sp.y - AY) > 4) return; B.phase = 1; net.bossWaveT = 3; send(); }
  else if (m.a === 'water') {
    const i = safeInt(m.i, 0, 2); if (B.phase !== 1 || tl.k !== 1 || sp.distanceTo(ANCHORS[i]) > 4.5) return;
    net.anchT[i] = performance.now() / 1000;
    if (net.anchT.every(t => t > 0)) { B.phase = 2; B.lightT = 0; net.anchT = [0, 0, 0]; }
    send();
  } else if (m.a === 'mirror') { if (B.phase !== 2 || sp.distanceTo(PAD_B) > 4) return; B.mirror = (B.mirror + 1) % 3; send(); }
  else if (m.a === 'touch') {
    const i = safeInt(m.i, 0, 3); if (B.phase !== 3 || B.sp !== 'input' || sp.distanceTo(FLOWERS[i]) > 4.5) return;
    if (B.seq[B.pos] === i) { B.pos++; B.hit = { i, ok: true }; B.noteAt = performance.now(); if (B.pos >= B.seq.length) { B.phase = 4; B.sp = 'idle'; } send(); }
    else { B.hit = { i, ok: false }; B.sp = 'fail'; send(); setTimeout(() => bossStartSong(net), 1600); }
  }
}
function bossHostTick(net, dt) {
  const B = net.auth && net.auth.boss; if (!B || B.phase === 0 || B.phase === 4) return;
  const send = bossSendFn(net), now = performance.now() / 1000; net.anchT = net.anchT || [0, 0, 0];
  if (B.phase <= 2) { net.bossWaveT = (net.bossWaveT ?? 4) - dt; if (net.bossWaveT <= 0) { net.bossWaveT = B.phase === 1 ? 7.5 : 6.5; net.broadcast({ t: 'BOSS_WAVE' }); } }
  if (B.phase === 1) { let ch = false; for (let i = 0; i < 3; i++) if (net.anchT[i] && now - net.anchT[i] > 25) { net.anchT[i] = 0; ch = true; } net.bossSync = (net.bossSync || 0) + dt; if (ch || net.bossSync > 2) { net.bossSync = 0; if (ch || net.anchT.some(Boolean)) send(); } }
  if (B.phase === 2) {
    const lensOn = pad => { if (game.tool === 5 && player.toolUse && xzDist(player.pos, pad) < 1.8 && Math.abs(player.pos.y - AY) < 1.5) return true; for (const [id, pl] of net.auth.players) if (id !== net.selfId && pl.k === 5 && pl.u === true && Array.isArray(pl.p) && Math.hypot(pl.p[0] - pad.x, pl.p[2] - pad.z) < 1.8 && Math.abs(pl.p[1] - AY) < 1.5) return true; return false; };
    const a = lensOn(PAD_A), b = B.mirror === 1 || lensOn(PAD_B);
    const was = B.lightT;
    if (a && b) B.lightT = Math.min(3, B.lightT + dt); else B.lightT = Math.max(0, B.lightT - dt * 0.5);
    if (a !== B.beams[0] || b !== B.beams[1] || Math.floor(was * 2) !== Math.floor(B.lightT * 2)) { B.beams = [a, b]; send(); }
    if (B.lightT >= 3) { B.phase = 3; bossStartSong(net); }
  }
  if (B.phase === 3 && B.sp === 'input' && B.noteAt && performance.now() - B.noteAt > 7000) { B.sp = 'fail'; send(); B.noteAt = 0; setTimeout(() => bossStartSong(net), 1600); }
}
const bossSend = (a, extra = {}) => game.net.send({ t: 'BOSS', a, ...extra });
// ----- client side -----
let songTimers = [];
function flowerFlash(i, ok = true) { flowerObjs[i].glow = 1; if (ok) { sfx.tone(FLOWER_NOTES[i], 1.2, { type: 'triangle', vol: 0.15 }); sfx.tone(FLOWER_NOTES[i] * 1.5, 0.9, { vol: 0.05 }); } else sfx.play('miss'); }
function applyBoss(raw) {
  const prev = game.boss, s = sanitizeBoss(raw); game.boss = s;
  const inArena = game.realm === 'thornwood' && game.playing;
  if (s.n !== prev.n) {
    if (s.hit) flowerFlash(s.hit.i, s.hit.ok);
    if (s.phase === 3 && s.sp === 'show' && (prev.sp !== 'show' || prev.phase !== 3)) { songTimers.forEach(clearTimeout); songTimers = s.seq.map((f, k) => setTimeout(() => flowerFlash(f), 700 + k * 850)); if (inArena) game.toast('🎶 The Thornheart hums a melody — remember it!'); }
    if (s.phase === 3 && s.sp === 'input' && prev.sp === 'show' && inArena) game.toast('🌸 Touch the flowers in the same order (E)');
    if (s.sp === 'fail' && prev.sp !== 'fail' && inArena) game.toast('🎶 The song falters… listen again.');
  }
  if (s.phase !== prev.phase) {
    if (s.phase >= 1 && s.phase <= 3 && game.playing) guardianRoar();
    if (s.phase === 1) { sfx.play('roar'); if (inArena) game.toast('🌳 The Thornheart stirs! Water its three roots within 25s of each other 🚿', true); }
    if (s.phase === 2) { sfx.play('roar'); world.tween(1.5, k => guardian.userData.thorns.scale.setScalar(Math.max(0.01, 1 - k))); if (inArena) game.toast('✨ The thorns wither! Raise a Prism Lens 🔍 on the west pad — and light the east pad too (mirror or lens)', true); }
    if (s.phase === 3) { sfx.play('roar'); if (inArena) game.toast('💖 Its heart is warming… now, the song!', true); }
    if (s.phase === 4 && prev.phase !== 4) healGuardian(!game.playing);
  }
  if (s.phase >= 2) guardian.userData.thorns.scale.setScalar(s.phase === 2 && prev.phase < 2 ? guardian.userData.thorns.scale.x : 0.01);
  if (s.phase === 0) guardian.userData.thorns.scale.setScalar(1);
  drawBossBeams();
}
function healGuardian(instant) {
  eyeMat.color.setHex(0x7dffb2); eyeMat.emissive.setHex(0x3dff9a); heartMat.color.setHex(0x7dffb2); heartMat.emissive.setHex(0x3dff9a);
  barkMat.color.setHex(0x8d6e4a); crownMat.color.setHex(0x5cb85c); guardian.userData.blossoms.visible = true; guardian.userData.thorns.scale.setScalar(0.01);
  if (!instant) { sfx.play('restore'); for (let i = 0; i < 10; i++) setTimeout(() => world.burst(guardian.position.clone().add(new V3((Math.random() - 0.5) * 8, 8 + Math.random() * 6, (Math.random() - 0.5) * 8)), [0xff8fb1, 0x7dffb2, 0xffd54f][i % 3], 160), i * 220); if (game.realm === 'thornwood') game.toast('🌳 The Thornheart is healed! Its thorns turn to blossoms.', true); }
}
function drawBossBeams() {
  while (bossBeams.children.length) bossBeams.children.pop().geometry.dispose();
  if (game.boss.phase !== 2) return;
  const seg = (a, b) => { const A = a.clone().setY(AY + 4), Bp = b.clone().setY(AY + (b === guardian.position ? 5.5 : 4)); for (const [rad, mat] of [[0.08, beamMat], [0.25, beamGlow]]) { const g = new THREE.CylinderGeometry(rad, rad, A.distanceTo(Bp), 8, 1, true); g.rotateX(Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.copy(A).add(Bp).multiplyScalar(0.5); m.lookAt(Bp); bossBeams.add(m); } };
  const [a, b] = game.boss.beams;
  seg(PYL_A, PAD_A); if (a) seg(PAD_A, guardian.position); else seg(PAD_A, new V3(PAD_A.x, AY, TW.z + 33));
  seg(PYL_B, PAD_B); if (b) seg(PAD_B, guardian.position); else seg(PAD_B, new V3(PAD_B.x, AY, TW.z - 33));
}
function onBossWave() { if (game.realm !== 'thornwood') return; const w = waves.find(w => !w.on) || waves[0]; w.on = true; w.r = 2.5; w.hitDone = false; w.m.visible = true; sfx.play('wave'); }
addInteract({ pos: TW.clone().setY(AY + 1.5), range: 7, prio: 0.6, label: () => { const B = game.boss; return B.phase === 0 ? '<span class="key">E</span> Approach the Thornheart' : B.phase === 4 ? (count('heartseed') || QS.flags.heartseedTaken ? '🌳 The Thornheart rustles happily' : '<span class="key">E</span> Accept the Heartwood Seed') : null; },
  act: () => { const B = game.boss; if (B.phase === 0) bossSend('start'); else if (B.phase === 4 && !count('heartseed') && !QS.flags.heartseedTaken) { give('heartseed'); QS.flags.heartseedTaken = true; saveQuests(); sfx.play('relic'); game.toast('🌳 You received the Heartwood Seed!', true); } } });
ANCHORS.forEach((a, i) => addInteract({ pos: a.clone().setY(AY + 0.8), range: 4.5, label: () => game.boss.phase === 1 ? (game.boss.anchors[i] > 0 ? `💧 Root watered (${Math.ceil(game.boss.anchors[i])}s)` : game.tool === 1 ? '<span class="key">V</span> Water the root' : '🌱 A parched root — Watering Can 🚿') : null }));
addInteract({ pos: PAD_B.clone().setY(AY + 1.2), range: 3.5, prio: 0.4, label: () => game.boss.phase === 2 ? `<span class="key">E</span> Turn the mirror (${game.boss.beams[1] ? 'lit ✓' : 'unlit'})` : null, act: () => bossSend('mirror') });
addInteract({ pos: PAD_A.clone().setY(AY + 1.2), range: 3, label: () => game.boss.phase === 2 ? (game.boss.beams[0] ? '🔍 Holding the beam — keep it steady!' : game.tool === 5 ? `<span class="key">V</span> Raise the Prism Lens here` : '🔆 Stand here with a raised Prism Lens 🔍') : null });
FLOWERS.forEach((p, i) => addInteract({ pos: p.clone().setY(AY + 1.5), range: 4, prio: 0.4, label: () => game.boss.phase === 3 ? (game.boss.sp === 'input' ? `<span class="key">E</span> Touch the flower (${game.boss.pos}/6)` : '🎶 Listen…') : null, act: () => { if (game.boss.phase === 3 && game.boss.sp === 'input') bossSend('touch', { i }); } }));

// ---------- portals to the new realms ----------
for (const P of [
  { id: 'toLagoon', pos: [12, 0, -82], face: 0, color: 0x4fd1c5, open: () => true, dest: REALMS.lagoon.spawn, yaw: 0, name: 'Tidepool Lagoon', sealed: '' },
  { id: 'toBloom', pos: [48, 0, -82], face: 0, color: 0x8c7bff, open: () => game.puzzles.chimes.solved || game.puzzles.plates.key, dest: REALMS.bloomwood.spawn, yaw: 0, name: 'Moonlit Bloomwood', sealed: 'Sealed — solve the Songbird Stone or the Root Vault first' },
  { id: 'toThorn', pos: [30, 0, -95], face: 0, color: 0xff6b8b, open: () => game.env.altar, dest: REALMS.thornwood.spawn, yaw: 0, name: 'Thornwood Hollow', sealed: 'Sealed — wake the Moon Altar in the Bloomwood' },
  { id: 'lagoonBack', pos: [LG.x, 0, LG.z + 43], face: Math.PI, color: 0x9be7a0, open: () => true, dest: [12, 0.5, -73], yaw: Math.PI, name: 'Canopy Spire' },
  { id: 'bloomBack', pos: [BW.x, 0, BW.z + 47], face: Math.PI, color: 0x9be7a0, open: () => true, dest: [48, 0.5, -73], yaw: Math.PI, name: 'Canopy Spire' },
  { id: 'thornBack', pos: [TW.x - 10, AY, TW.z + 31.5], face: Math.PI, color: 0x9be7a0, open: () => true, dest: [30, 0.5, -87], yaw: Math.PI, name: 'Canopy Spire' },
]) portals.push(buildPortal(P));

// ---------- side-quest NPCs: stories & quests ----------
Object.assign(IDLE_LINES, {
  pip: ['I once built a self-stirring teapot. It stirred itself right off the table and out the window.', 'Springs, resin, shells — put the right bits together and anything’s a tool! Press I and try the Craft tab.', 'Rumour says the Thornheart hums when it’s sad. I’d hum too if I were made of brambles.'],
  fennel: ['My Sorrel planted those sprouts before she sailed off to keep the lagoon lighthouse. They’ve sulked ever since.', 'Plants are like people: a little water and a kind word go a long way.', 'The beanstalk by the solar tower? Sorrel named it Gerald. Don’t ask me why.'],
  juniper: ['Rain, wind or thorny forest spirits — the post must go through!', 'I’ve delivered letters to the clouds. Literally. The sky islands have a mailbox. It’s mostly bird gossip.', 'Captain Skerry still owes me for a parcel of cinnamon buns from three summers back.'],
  skerry: ['Forty years I sailed the sky-ships. Then one day the wind said “retire”, so I did. Never argue with the wind.', 'Sorrel — Fennel’s girl — keeps the lighthouse on the far sandbar. Grand lass. Writes to her mum every week, mind.', 'That temple swallowed my compass in a storm. Bloomin’ greedy building.'],
  luma: ['Moths aren’t drawn to light, you know. They’re drawn to hope. Light is just what hope looks like at night.', 'The Thornheart was the gentlest guardian of the old wood. It isn’t angry — it’s hurting.', 'Bring a lantern. Bring friends. Bring snacks. Mostly snacks.'],
});
QS.flags = (() => { const s = store.get('canopy-spire-quests', {}), f = {}; for (const k of ['parcelGiven', 'compassReturned', 'captainHat', 'heartwood', 'heartseedTaken']) f[k] = !!(s && s.flags && s.flags[k] === true); return f; })();
for (const k of ['lagoon', 'bloomwood', 'thornwood']) { const s = store.get('canopy-spire-quests', {}); QS.visited[k] = !!(s && s.visited && s.visited[k] === true); }
const SIDE = [
  { id: 'sq_pip', name: 'First Tinkering', giver: 'pip', side: true, req: () => true,
    intro: ['Ooh, hands! You have hands! Pip, tinker extraordinaire. Can you help an old inventor?', 'Here — two blobs of resin, a little scrap and a coil spring to get you started. They’re in your backpack.', 'Now fetch two Spiral Shells from the Tidepool Lagoon — teal portal at the Portal Plaza — and craft yourself a Watering Can. Press I, then Craft.'],
    onAccept: () => { give('resin', 2); give('scrap', 2); give('spring', 1); },
    steps: [{ text: 'Collect 2 Spiral Shells in the Tidepool Lagoon', done: () => bag.can === 1 || count('shell') >= 2, where: [12, 0, -82] }, { text: 'Craft a Watering Can (I → Craft)', done: () => bag.can === 1, where: KEEPERS.find(k => k.id === 'pip').pos }],
    turnIn: ['A Watering Can! Look at that spout. Magnificent.', 'Take this Seed Pouch I had lying about, and a few seeds. Fertile soil grows bounce blooms — try the patch north of the west pillars!'],
    reward: { scrap: 2 }, onDone: () => { if (!bag.pouch) give('pouch'); give('seed', 3); } },
  { id: 'sq_fennel', name: 'Wake the Withered', giver: 'fennel', side: true, req: () => true,
    intro: ['Hello, petal. I’m Fennel. My daughter Sorrel planted three sprouts before she left to keep the lagoon lighthouse.', 'One here on the deck by the spire, one below by the solar tower, and one down on the south shore by the aqueduct’s end.', 'They’ve withered without her. Would you water them for me? You’ll need a Watering Can — Pip makes lovely ones.'],
    steps: [{ text: 'Water the canopy sprout (by the spire’s east face)', done: () => game.env.sprouts.S1, where: SPROUTS[0].pos }, { text: 'Water the sprout by the solar tower', done: () => game.env.sprouts.S2, where: SPROUTS[1].pos }, { text: 'Water the sprout on the south shore', done: () => game.env.sprouts.S3, where: SPROUTS[2].pos }],
    turnIn: ['Oh… a staircase of leaves, a beanstalk, and the biggest flower I’ve ever seen. She’d be so proud.', 'If you ever see Sorrel, tell her the garden’s awake again.'], reward: { bio: 3, energy: 2 } },
  { id: 'sq_juniper', name: 'Special Delivery', giver: 'juniper', side: true, req: () => true,
    intro: ['Juniper, Spire Post! Rain or shine or giant sulking tree!', 'I’ve a parcel for Captain Skerry in the Tidepool Lagoon, but my glider’s in for repairs. Could you take it?', 'And bring back his reply — he never pays postage, but he does write lovely letters.'],
    onAccept: () => give('parcel'),
    steps: [{ text: 'Deliver the parcel to Captain Skerry (Tidepool Lagoon)', done: () => QS.flags.parcelGiven, where: KEEPERS.find(k => k.id === 'skerry').pos }, { text: 'Bring Skerry’s reply back to Juniper', done: () => QS.flags.parcelGiven && count('letter') > 0, where: KEEPERS.find(k => k.id === 'juniper').pos }],
    turnIn: ['A reply! “Dear Juniper, thank you for the buns, I owe you nothing, love Skerry.” Classic.', 'Here — feathers from the sky mailbox, and a spare spring. Postage, if you like.'], reward: { scrap: 1 }, onDone: () => { take('letter'); give('feather', 3); give('spring', 1); } },
  { id: 'sq_skerry', name: 'The Captain’s Compass', giver: 'skerry', side: true, req: () => true,
    intro: ['Ahoy. Skerry, retired sky-captain. My old compass is stuck atop the sunken temple behind the coral gate.', 'The gate opens when the wind wheel spins — give it a blast with a Wind Horn. Feathers and a spring, any tinker can make one.', 'The temple’s slick as an eel — no climbing. But plant bloom seeds in the fertile soil and you’ll bounce right up, tier by tier.'],
    steps: [{ text: 'Spin the wind wheel to open the coral gate (📯 Wind Horn)', done: () => game.env.gateOpened, where: WHEEL_POS }, { text: 'Bounce up the sunken temple and take the compass', done: () => count('compass') > 0, where: [LG.x, 9.5, LG.z - 22] }],
    turnIn: ['My compass! It always points to whoever you miss most… and look, it’s pointing at the lighthouse. Ha. Sorrel.', 'Take my spare captain’s hat — it suits you. Equip it on the home screen. And some crystals for the road.'],
    reward: { energy: 2 }, onDone: () => { take('compass'); QS.flags.compassReturned = true; QS.flags.captainHat = true; give('crystal', 3); setTimeout(() => game.toast('🎁 Unlocked: Captain’s Hat', true), 1500); } },
  { id: 'sq_luma', name: 'Moths Love Light', giver: 'luma', side: true, req: () => true,
    intro: ['Shh — the moths are sleeping. I’m Luma. I study them, and they study me.', 'Four moth shrines circle this wood. Carry a lit Glow Lantern close to each and they’ll wake.', 'When all four dance, climb the glyph-steps around the moon rock — they only appear near lantern light — and wake the Moon Altar.'],
    steps: [{ text: 'Wake the four moth shrines with a lit lantern 🏮', done: () => game.env.shrines.every(Boolean), where: REALMS.bloomwood.c }, { text: 'Climb the glyph-steps and wake the Moon Altar', done: () => game.env.altar, where: ALTAR_POS }],
    turnIn: ['The moon answered! And a new portal has opened at your plaza — to Thornwood Hollow.', 'Take these moonpetals. You’ll want a Prism Lens for what comes next.'], reward: { bio: 2 }, onDone: () => give('moonpetal', 2) },
  { id: 'q_heart', name: 'Heart of Thornwood', giver: 'luma', req: () => game.env.altar,
    intro: ['The Thornheart guarded this wood for a thousand years. Then the spire went quiet, and it curled up in its thorns.', 'You can’t fight it. You have to heal it — water its roots, warm its heart with light, and sing back its song.', 'Bring friends. Bring a Watering Can and a Prism Lens. And jump over the thorn waves — they sting.'],
    steps: [{ text: 'Enter Thornwood Hollow (red portal, Portal Plaza)', done: () => QS.visited.thornwood, where: [30, 0, -95] }, { text: 'Heal the Thornheart (water · light · song)', done: () => game.boss.phase === 4, where: REALMS.thornwood.c }, { text: 'Accept the Heartwood Seed', done: () => count('heartseed') > 0 || QS.flags.heartseedTaken, where: REALMS.thornwood.c }],
    turnIn: ['You did it. Listen — the whole wood is humming.', 'The Heartwood Glider is yours. Fly gently.'], reward: { energy: 5, bio: 5, scrap: 5 }, onDone: () => { QS.flags.heartwood = true; setTimeout(() => game.toast('🎁 Unlocked: Heartwood Glider', true), 1500); } },
];
{ const sv = store.get('canopy-spire-quests', {}); for (const q of SIDE) { QUESTS.push(q); const v = sv && sv.q && sv.q[q.id]; if (v === 'active' || v === 'done') QS.q[q.id] = v; } }
NPC_SPECIAL.skerry = () => {
  const q = QUESTS.find(q => q.id === 'sq_juniper');
  if (QS.q.sq_juniper === 'active' && count('parcel') > 0) return openDialog('Captain Skerry', ['A parcel? From Juniper? …Cinnamon buns! The woman’s a saint. A pushy saint.', 'Here — take my reply back to her. And mind the gulls, they’re after the wax.'], () => { take('parcel'); give('letter'); QS.flags.parcelGiven = true; saveQuests(); sfx.play('quest'); }), true;
  return false;
};
// ---------- using tools ----------
let hornCD = 0, lightSendCD = 0;
function splash(color, n = 40) { world.burst(player.pos.clone().add(new V3(Math.sin(player.yaw) * 1.2, 1.2, Math.cos(player.yaw) * 1.2)), color, n); }
function useTool() {
  const k = game.tool, c = player.pos.clone(); c.y += 0.9;
  if (!k) { game.toast('Select a tool with 1–5 (craft them in your backpack — press I)'); return; }
  if (k === 1) {
    sfx.play('water'); splash(0x4fc3f7);
    const s = sproutObjs.find(s => !game.env.sprouts[s.id] && c.distanceTo(s.p) < 4.2); if (s) return envSend('water', { id: s.id });
    if (game.realm === 'thornwood' && game.boss.phase === 1) { const i = ANCHORS.findIndex(a => c.distanceTo(a) < 4.5); if (i >= 0) return bossSend('water', { i }); }
  } else if (k === 2) { player.toolUse = !player.toolUse; sfx.play('lantern'); }
  else if (k === 3) {
    if (hornCD > 0) return; hornCD = 1.2; sfx.play('horn'); splash(0xffffff, 60);
    if (!player.grounded && player.state !== 'CLIMB') { player.vel.y = Math.max(player.vel.y, 10); hornCD = 4; }
    if (c.distanceTo(VA(WHEEL_POS)) < 12) envSend('gust');
  } else if (k === 4) {
    const f = fertileObjs.find(f => !game.env.plants[f.id] && c.distanceTo(f.p) < 3.6);
    if (!f) { game.toast('🫘 Find fertile soil (a dark patch with a green ring) to plant in'); return; }
    if (count('seed') < 1) { game.toast('No Bloom Seeds — craft some (2 🌱 → 3 🫘)'); return; }
    envSend('plant', { id: f.id }); sfx.play('plant');
  } else if (k === 5) { player.toolUse = !player.toolUse; sfx.play('lantern'); }
  renderHotbar();
}
// held tools on every character (self, friends, keepers)
function buildHeld(c) {
  if (c.held && c.held._arm === c.arms[0]) return c.held; const hand = new THREE.Group();
  if (c.handBone) { hand.position.set(0, 0.06, 0); hand.rotation.x = Math.PI; c.handBone.add(hand); } else { hand.position.set(0, -0.5, 0.06); c.arms[0].add(hand); }
  const T = []; const grp = () => { const g = new THREE.Group(); g.visible = false; hand.add(g); T.push(g); return g; }; T.push(null);
  { const g = grp(); const b = new THREE.Mesh(cylGeo(0.13, 0.14, 0.22, 14), toon(0x4fb3c7)); g.add(b); const sp = new THREE.Mesh(cylGeo(0.025, 0.035, 0.32, 8), toon(0x4fb3c7)); sp.rotation.x = 1.0; sp.position.set(0, 0.04, 0.2); g.add(sp); const h = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI), toon(0x2f7f8f)); h.position.y = 0.11; g.add(h); }
  { const g = grp(); const f = new THREE.Mesh(boxGeo(0.18, 0.24, 0.18, 0, 0.03), toon(PAL.brass, { transparent: true, opacity: 0.6 })); g.add(f); const glowM = toon(0xfff1c1, { emissive: 0xffc46b, emissiveIntensity: 0.1, unique: true }); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), glowM); g.add(bulb); g.userData.glow = glowM; const h = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12), toon(PAL.brass)); h.position.y = 0.16; g.add(h); }
  { const g = grp(); const h = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 12, 1, true), toon(PAL.brass, { side: THREE.DoubleSide })); h.rotation.x = Math.PI / 2; h.position.z = 0.12; g.add(h); }
  { const g = grp(); const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), toon(0x8d6e4a)); s.scale.y = 1.2; g.add(s); const t = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 12), toon(PAL.leaf3)); t.position.y = 0.14; t.rotation.x = Math.PI / 2; g.add(t); }
  { const g = grp(); const r = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 20), toon(PAL.brass)); r.position.y = 0.15; g.add(r); const d = new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), toon(0xdff7ff, { emissive: 0x9fe8ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); d.position.y = 0.15; g.add(d); const st = new THREE.Mesh(cylGeo(0.02, 0.02, 0.12, 6), toon(PAL.brass)); g.add(st); }
  T._arm = c.arms[0]; c.held = T; return T;
}
function showHeld(c, k, use) {
  const T = buildHeld(c); for (let i = 1; i < T.length; i++) T[i].visible = i === k;
  if (k === 2) T[2].userData.glow.emissiveIntensity = use ? 2.2 : 0.1;
  c.holding = !!(k && use && (k === 2 || k === 5));
  if (c.holding && !c.mixer) { c.arms[0].rotation.x = k === 5 ? -1.65 : -0.9; c.arms[0].rotation.z = -0.15; }
}

// ---------- per-frame update ----------
function expansionInput() {
  if (pressed.has('KeyI') || pressed.has('Tab')) { if (ui.bagOpen) closeBag(); else openBag(); }
  if (!ui.panelNode && !ui.emoteOpen && !dlg.open) for (let i = 1; i <= 5; i++) if (pressed.has('Digit' + i)) selectTool(i);
  if ((pressed.has('Use') || pressed.has('KeyV')) && !dlg.open && !ui.mg) useTool();
}
function litLanterns() { const L = []; if (game.tool === 2 && player.toolUse) L.push(player.pos); for (const r of game.remotes.values()) if (r.tool === 2 && r.use) L.push(r.pos); return L; }
function expansionUpdate(dt) {
  hornCD -= dt; lightSendCD -= dt;
  updateForage(dt);
  // auto-wake moth shrines when you carry a lit lantern past them
  if (game.tool === 2 && player.toolUse && lightSendCD <= 0) shrineObjs.forEach((s, i) => { if (!game.env.shrines[i] && xzDist(player.pos, s.p) < 4 && lightSendCD <= 0) { lightSendCD = 1; envSend('light', { i }); } });
  // thorn waves (each player handles their own knockback)
  for (const w of waves) {
    if (!w.on) continue; w.r += dt * 7.5; w.m.scale.set(w.r, 1, w.r); w.m.position.set(TW.x, AY + 0.45, TW.z); w.m.material.opacity = 0.75 * (1 - w.r / 34);
    if (w.r > 34) { w.on = false; w.m.visible = false; continue; }
    const d = xzDist(player.pos, TW);
    if (!w.hitDone && game.realm === 'thornwood' && Math.abs(d - w.r) < 0.9 && player.pos.y - AY < 0.95) {
      w.hitDone = true; const out = new V3(player.pos.x - TW.x, 0, player.pos.z - TW.z).normalize();
      player.vel.set(out.x * 11, 7, out.z * 11); player.state = 'FALL'; player.grounded = false; player.stamina = Math.max(0, player.stamina - 25); sfx.play('hit'); game.toast('🌵 Ouch — thorn wave! Jump over them.');
    }
  }
}
function expansionWorld(dt) {
  const t = world.time, L = litLanterns();
  // lantern lights (fixed pool)
  lanternLights.forEach((l, i) => { const p = L[i]; l.intensity = p ? 14 : 0; if (p) l.position.set(p.x, p.y + 2.6, p.z); });
  // glyph platforms solidify near lantern light
  for (const g of glyphs) { const on = L.some(p => Math.hypot(p.x - g.x, p.z - g.z) < 10 && Math.abs(p.y - g.y) < 10); g.col.enabled = on; g.k = lerp(g.k, on ? 1 : 0, Math.min(1, dt * 5)); g.m.material.opacity = 0.08 + g.k * 0.75; g.m.material.color.setHex(on ? 0xffe9a8 : 0x9fb4ff); }
  // sprouts, wheel & gate, shrines, altar
  wheelRotor.rotation.z += dt * (game.env.wheel ? 9 : 0.2);
  gateMesh.position.y = lerp(gateMesh.position.y, game.env.wheel ? -4.6 : 4.5, Math.min(1, dt * 3)); gateCol.enabled = !game.env.wheel;
  shrineObjs.forEach((s, i) => { const on = game.env.shrines[i]; s.lampMat.emissiveIntensity = on ? 1.6 : 0.05; s.moths.children.forEach((m, k) => { m.visible = on; const a = t * 2 + k * 1.05; m.position.set(Math.cos(a) * 0.9, Math.sin(a * 1.7) * 0.4, Math.sin(a) * 0.9); m.rotation.y = -a; m.scale.x = 0.6 + Math.abs(Math.sin(t * 20 + k)) * 0.6; }); });
  moonOrb.material.emissiveIntensity = game.env.altar ? 1.6 : game.env.shrines.every(Boolean) ? 0.6 + Math.sin(t * 3) * 0.3 : 0.1; moonBeam.visible = game.env.altar;
  compassMesh.visible = !count('compass') && !QS.flags.compassReturned; compassMesh.rotation.y += dt;
  // Bloomwood fireflies
  if (game.realm === 'bloomwood') { const F = bloomFlies; for (let i = 0; i < F.N; i++) { const [x, y, z, ph] = F.seed[i]; F.pos[i * 3] = x + Math.sin(t * 0.4 + ph) * 2.5; F.pos[i * 3 + 1] = y + Math.sin(t * 0.9 + ph * 3) * 0.5; F.pos[i * 3 + 2] = z + Math.cos(t * 0.33 + ph) * 2.5; } F.g.attributes.position.needsUpdate = true; }
  // Thornheart animation
  const B = game.boss, calm = B.phase === 4;
  guardian.rotation.y = Math.sin(t * 0.4) * (calm ? 0.05 : 0.15); guardian.userData.arms.forEach((a, i) => a.rotation.z = (i ? -1 : 1) * (0.15 + Math.sin(t * (calm ? 0.8 : 1.6) + i) * (calm ? 0.05 : 0.18)));
  if (guardianMixer) { guardianRoarT -= dt; if (guardianRoarT <= 0) guardianPlay(calm ? 'Calm' : 'Sway'); guardianMixer.update(dt); }
  guardian.userData.heart.rotation.y += dt * (B.phase >= 2 ? 2 : 0.5); heartMat.emissiveIntensity = calm ? 1.2 : B.phase >= 2 ? 0.6 + B.lightT * 0.4 + Math.sin(t * 6) * 0.2 : 0.4;
  anchorRings.forEach((m, i) => m.material.emissiveIntensity = B.phase === 1 && B.anchors[i] > 0 ? 1.2 : B.phase >= 2 ? 0.6 : 0.05);
  padMirror.rotation.y = lerpAngle(padMirror.rotation.y, B.mirror === 1 ? Math.PI / 4 : B.mirror === 0 ? -Math.PI / 4 : Math.PI / 2, Math.min(1, dt * 8));
  flowerObjs.forEach(f => { f.glow = Math.max(0, f.glow - dt * 1.5); f.mat.emissiveIntensity = 0.15 + f.glow * 1.8 + (calm ? 0.4 : 0); });
  pylonGems.forEach(g => g.rotation.y += dt);
  // boss HUD
  const hud = $('bossHud');
  if (game.playing && game.realm === 'thornwood') {
    const steps = ['Approach the Thornheart (E)', `Water the three roots within 25s 🚿 (${B.anchors.filter(v => v > 0).length}/3)`, `Hold both beams on its heart 🔍 (${B.beams.filter(Boolean).length}/2 · ${(B.lightT / 3 * 100) | 0}%)`, `Sing back its song 🌸 (${B.pos}/6)`, 'Healed! Accept the Heartwood Seed'];
    const corruption = [1, 1, 0.66, 0.33, 0][B.phase] - (B.phase === 2 ? B.lightT / 3 * 0.33 : B.phase === 3 ? B.pos / 6 * 0.33 : 0);
    hud.classList.remove('hidden'); hud.innerHTML = `<div class="bn">🌳 The Thornheart ${B.phase === 4 ? '— healed' : B.phase ? `· Phase ${B.phase}/3` : '· sleeping'}</div><div class="bb"><i style="width:${Math.max(0, corruption) * 100}%"></i></div><div class="bs">${steps[B.phase]}</div>`;
  } else hud.classList.add('hidden');
}
// ---------- applying shared env state ----------
function applyEnv(raw) {
  const prev = game.env, s = sanitizeEnv(raw); game.env = s; const ev = s.ev, mine = ev && ev.by === game.net.selfId, live = game.playing;
  sproutObjs.forEach(o => { if (s.sprouts[o.id] && !prev.sprouts[o.id]) { growSprout(o, !live); if (live) { sfx.play('restore'); game.toast(`🌱 The ${o.name} bursts into life!`); } if (mine) give('bio', 2); } });
  fertileObjs.forEach(o => { if (s.plants[o.id] && !o.pad) { growPlant(o, !live); if (live) sfx.play('plant'); if (mine) take('seed', 1); } });
  if (s.wheel && !prev.wheel && live) { sfx.play('horn'); game.toast('🌬️ The wind wheel spins — the coral gate opens for 20 seconds!'); }
  s.shrines.forEach((on, i) => { if (on && !prev.shrines[i] && live) { sfx.play('calib'); world.burst(shrineObjs[i].p.clone().setY(3), 0xffe9a8, 90); game.toast(`🦋 A moth shrine wakes (${s.shrines.filter(Boolean).length}/4)`); } });
  if (s.altar && !prev.altar && live) { sfx.play('restore'); game.toast('🌕 The Moon Altar shines! A red portal opens at the Portal Plaza — Thornwood Hollow.', true); }
}
function persistEnv() { const E = JSON.parse(JSON.stringify(game.env)); E.wheel = false; delete E.ev; return E; }
function persistBoss() { return { ...defaultBoss(), phase: game.boss.phase === 4 ? 4 : 0 }; }
// starting forage spread
scatterForage('resin', 14, 0, 0, 100, 1, 11, (x, y, z) => world.plants[0].some(g => Math.hypot(g.position.x - x, g.position.z - z) < 6));
scatterForage('feather', 8, 0, 0, 100, 14, 12, (x, y) => y >= 4);
for (const I of skyIslands) addForage('feather', I[0] + I[3] * 0.25, I[1], I[2] - I[4] * 0.25);
scatterForage('crystal', 8, G0.x, G0.z, 36, 1, 13, (x, y, z) => Math.abs(x - G0.x) > 20 || Math.abs(z - G0.z) > 20);
scatterForage('shell', 14, LG.x, LG.z + 8, 44, 1, 14, (x, y, z) => !(Math.abs(x - LG.x) < 17 && z < LG.z - 3));
scatterForage('moonpetal', 9, BW.x, BW.z, 52, 1, 15); scatterForage('crystal', 6, BW.x, BW.z, 52, 1, 16);
for (const p of world.pickups) if (phys.pointInside(p.pos) || phys.pointInside(p.pos.clone().setY(p.pos.y + 1))) { const top = phys.surfaceY(p.pos.x, p.pos.z, p.pos.y + 12); if (top !== null) { p.pos.y = top + 0.9; p.mesh.position.y = p.pos.y; } }
world.finalizeStatics();
applyEnv(game.env); applyBoss(game.boss); renderHotbar();

// =====================================================================
// MAIN LOOP
// =====================================================================
let last = performance.now(), menuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(dt);
  if (dt > 0) fpsAvg = lerp(fpsAvg, 1 / dt, 0.05);
  const G = GFX[gfxKey];
  if (G.post) { gradePass.uniforms.uWarm.value = 0.45 + 0.55 * clamp(1 - Math.abs(dayState.sunDir.y) * 2.2, 0, 1); gradePass.uniforms.uNight.value = 1 - dayState.day; composer.render(dt); }
  else if (G.outline) outlineFx.render(scene, camera); else renderer.render(scene, camera);
  if (!game.playing) renderPreview(dt);
}
function simulate(dt) {
  world.scanning = game.scanning; world.grassFocus = game.playing ? player.pos : null;
  world.update(dt, camera);
  if (game.playing) {
    if (pressed.has('KeyQ')) { game.scanning = !game.scanning; document.body.classList.toggle('scanning', game.scanning); }
    if (pressed.has('KeyH')) { ui.helpOn = !ui.helpOn; $('help').classList.toggle('hidden', !ui.helpOn); }
    if (pressed.has('Escape') && ui.mg) closeMinigame();
    updateMinigame(dt);
    const inp = readInput();
    dynStep(dt);
    player.update(dt, inp, cam.yaw);
    featureInput();
    for (const ev of player.events.splice(0)) { sfx.play(ev); if (ev === 'respawn') game.toast('🍃 The wind spirits carried you back to safety.'); else if (ev === 'exhausted') game.toast('😮‍💨 Out of stamina! Rest on flat ground.'); }
    featureUpdate(dt, inp);
    questInput(); expansionInput(); questUpdate(dt); expansionUpdate(dt);
    if (game.net.isAuthority) { puzzleHostTick(game.net); bossHostTick(game.net, dt); }
    updateInteraction();
    updateCamera(dt);
    updateGrappleTarget();
    game.net.tick(dt);
    selfModel.group.position.copy(player.pos); selfModel.group.rotation.y = player.yaw;
    animateCharacter(selfModel, player.state, dt, player.emote); showHeld(selfModel, game.tool, player.toolUse);
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
    r.model.group.position.copy(r.pos); r.model.group.rotation.y = r.yaw; animateCharacter(r.model, r.state, dt, r.emote || 0); showHeld(r.model, r.tool || 0, !!r.use);
  }
  // sky, sun/moon, lights, wildlife, ambience (day/night + restoration progress)
  featureWorld(dt); puzzleVisuals(dt); updatePortals(dt); expansionWorld(dt);
  sky.position.copy(camera.position);
}
requestAnimationFrame(frame);

// =====================================================================
// SAVE / LOAD — your spire (solo + host) persists in localStorage
// =====================================================================
const SAVE_KEY = 'canopy-spire-save-v1';
const SAVE_TRIGGERS = new Set(['NODE_PROGRESS_UPDATE', 'NODE_RESTORED', 'PICKUP_TAKEN', 'REFUND']);
game.ownsWorld = false; // true only for solo / hosting from your own save
function readSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s && s.v === 1 && s.nodes && typeof s.nodes === 'object' ? s : null; } catch (_) { return null; }
}
function saveGame() {
  if (!game.playing || !game.ownsWorld) return;
  const nodes = {}; for (const n of world.nodes.values()) nodes[n.id] = { cur: { ...n.cur }, calib: n.calib, restored: n.restored };
  const p = player.lastSafe;
  const data = { v: 1, savedAt: Date.now(), tod: +game.tod.toFixed(4), puzzles: persistPuzzles(), env: persistEnv(), boss: persistBoss(), nodes, inventory: { ...game.inventory }, pos: [p.x, p.y, p.z].map(v => +v.toFixed(2)) };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (_) { /* storage full / disabled: play on without saving */ }
}
let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveGame, 600); }
setInterval(saveGame, 10000);
function loadSaveIntoWorld() {
  game.ownsWorld = true;
  const s = readSave(); if (!s) return false;
  for (const d of NODE_DEFS) {
    const ns = Object.hasOwn(s.nodes, d.id) ? s.nodes[d.id] : null; if (!ns || typeof ns !== 'object') continue;
    world.setNodeProgress(d.id, ns.cur, ns.calib);
    if (ns.restored === true) world.restoreNode(d.id, true);
  }
  const inv = safeRes(s.inventory, 999); for (const k of RES) game.inventory[k] = inv[k] || 0;
  if (Number.isFinite(s.tod)) game.tod = clamp(s.tod, 0, 0.9999);
  if (s.puzzles && typeof s.puzzles === 'object') applyPuzzleAll(s.puzzles);
  if (s.env) applyEnv(s.env);
  if (s.boss) applyBoss(s.boss);
  const pos = safeVec(s.pos);
  if (pos) { const v = new V3(pos[0], pos[1] + 0.05, pos[2]); if (v.y > -1 && !phys.overlapAt(v)) player.spawn(v); }
  return true;
}
{ const inner = game.apply; game.apply = m => { inner(m); if (isMsg(m) && SAVE_TRIGGERS.has(m.t)) saveSoon(); }; }
function timeAgo(t) { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; }
function renderSaveInfo() {
  const s = readSave();
  if (!s) { $('saveInfo').innerHTML = '🌱 <b>New spire.</b> Progress saves automatically in this browser.'; return; }
  const done = NODE_DEFS.filter(d => s.nodes[d.id] && s.nodes[d.id].restored === true).length;
  const inv = safeRes(s.inventory, 999);
  $('saveInfo').innerHTML = `💾 <b>Your spire: ${done}/${NODE_DEFS.length} restored</b> · saved ${timeAgo(Number(s.savedAt) || 0)}<br>` +
    `Carrying ${RES.map(k => (inv[k] || 0) + RES_ICON[k]).join(' ')} · <i>Play Solo</i> and <i>Host Room</i> continue from here. ` +
    '<button class="linkbtn" id="btnReset">Start over</button>';
  $('btnReset').addEventListener('click', () => { if (confirm('Erase your saved spire and start fresh? This cannot be undone.')) { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('canopy-spire-quests'); location.reload(); } });
}

// =====================================================================
// MENU / SESSION START
// =====================================================================
let saved = {}; try { saved = JSON.parse(localStorage.getItem('canopy-spire') || '{}') || {}; } catch (_) {}
$('nameInput').value = typeof saved.name === 'string' ? safeName(saved.name) : '';
let selfLook = safeLook(saved.look && typeof saved.look === 'object' ? saved.look : { ...DEFAULT_LOOK, o: LOOK_OPTS.outfit.includes(saved.color) ? LOOK_OPTS.outfit.indexOf(saved.color) : Math.floor(Math.random() * LOOK_OPTS.outfit.length) });
function saveProfile() { try { localStorage.setItem('canopy-spire', JSON.stringify({ name: safeName($('nameInput').value), look: selfLook })); } catch (_) {} }
const preview = (() => {
  const canvas = $('preview'), r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, Math.max(1.5, devicePixelRatio))); r.setSize(180, 230, false);
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.4));
  const dl = new THREE.DirectionalLight(0xfff1d6, 2.2); dl.position.set(2, 4, 3); sc.add(dl);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.18, 40), toon(0x8ed65a)); ped.position.y = -0.09; sc.add(ped);
  const cam = new THREE.PerspectiveCamera(30, 180 / 230, 0.1, 50);
  return { r, sc, cam, fx: new OutlineEffect(r, { defaultThickness: 0.004, defaultColor: [0.1, 0.14, 0.13] }), model: null, gliderT: 0, alive: true };
})();
function rebuildPreview() { if (!preview.alive) return; if (preview.model) preview.sc.remove(preview.model.group); preview.model = makeCharacter(selfLook); preview.sc.add(preview.model.group); }
function renderPreview(dt) {
  if (!preview.alive || !preview.model) return;
  preview.gliderT -= dt; const gl = preview.gliderT > 0; preview.model.showGlider = gl;
  preview.model.group.rotation.y += dt * 0.7; animateCharacter(preview.model, gl ? 'GLIDE' : 'IDLE', dt);
  if (gl) { preview.cam.position.set(0, 1.9, 7.2); preview.cam.lookAt(0, 1.45, 0); } else { preview.cam.position.set(0, 1.4, 5.4); preview.cam.lookAt(0, 1.12, 0); }
  preview.fx.render(preview.sc, preview.cam);
}
function disposePreview() { if (!preview.alive) return; preview.alive = false; preview.r.dispose(); preview.r.forceContextLoss(); }
function renderLookOpts() {
  $('lookOpts').innerHTML = LOOK_KEYS.map(([k, arr, label]) => `<div class="lrow"><span class="lab">${label}</span>` + LOOK_OPTS[arr].map((v, i) => arr === 'hat'
    ? `<span class="opt${selfLook[k] === i ? ' sel' : ''}${lockedLook(k, i) ? ' locked' : ''}" data-k="${k}" data-i="${i}" title="${lockedLook(k, i)}">${lockedLook(k, i) ? '🔒 ' : ''}${v}</span>`
    : `<span class="sw${selfLook[k] === i ? ' sel' : ''}${lockedLook(k, i) ? ' locked' : ''}" data-k="${k}" data-i="${i}" title="${lockedLook(k, i)}" style="background:${v === 'rainbow' ? 'linear-gradient(135deg,#ff5252,#ffd54f,#69db7c,#4dabf7,#da77f2)' : v === 'gold' ? 'linear-gradient(135deg,#fff3b0,#e0a800)' : v === 'starlight' ? 'radial-gradient(circle at 30% 30%,#9fb4ff,#1b2350)' : v === 'heartwood' ? 'linear-gradient(135deg,#a0784e,#5c3d22)' : v}"></span>`).join('') + '</div>').join('')
    + '<div class="lrow"><span class="lab"></span><span class="opt" id="lookRandom">🎲 Randomize</span></div>';
}
$('lookOpts').addEventListener('click', e => {
  const t = e.target;
  if (t.id === 'lookRandom') { for (const [k, arr] of LOOK_KEYS) selfLook[k] = Math.floor(Math.random() * LOOK_OPTS[arr].length); }
  else if (t.dataset && t.dataset.k) { const def = LOOK_KEYS.find(x => x[0] === t.dataset.k), i = Number(t.dataset.i); if (!def || !Number.isInteger(i) || i < 0 || i >= LOOK_OPTS[def[1]].length) return; const lk = lockedLook(def[0], i); if (lk) { $('menuStatus').textContent = `🔒 ${lk}.`; return; } selfLook[def[0]] = i; if (def[0] === 'g') preview.gliderT = 3; }
  else return;
  selfLook = safeLook(selfLook); renderLookOpts(); rebuildPreview(); saveProfile();
});
if (lockedLook('hat', selfLook.hat)) selfLook.hat = DEFAULT_LOOK.hat; if (lockedLook('g', selfLook.g)) selfLook.g = DEFAULT_LOOK.g;
renderLookOpts(); rebuildPreview();
renderSaveInfo();
for (const id of ['volSel', 'volSelPause']) { $(id).value = Math.round(sfx.vol * 100); $(id).addEventListener('input', e => { sfx.setVolume(Number(e.target.value) / 100); for (const o of ['volSel', 'volSelPause']) $(o).value = e.target.value; }); }
if (!window.Peer) { $('btnHost').disabled = $('btnJoin').disabled = true; $('menuStatus').textContent = 'PeerJS could not load — multiplayer unavailable, solo still works.'; }
function setBusy(b) { for (const id of ['btnHost', 'btnJoin', 'btnSolo']) $(id).disabled = b || (id !== 'btnSolo' && !window.Peer); }
function beginPlay() {
  sfx.init();
  game.ownsWorld = false;
  game.selfName = safeName($('nameInput').value); game.selfLook = safeLook(selfLook); game.selfColor = lookColor(game.selfLook);
  saveProfile();
  scene.remove(selfModel.group); const nm = makeCharacter(game.selfLook); Object.assign(selfModel, nm); scene.add(selfModel.group);
}
function enterGame() {
  disposePreview();
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  game.playing = true; game.refreshRoomInfo(); renderObjectives(); renderInventory();
  cam.yaw = 0; cam.pitch = 0.25; cam.target.copy(player.pos);
  ui.helpOn = true; $('help').classList.remove('hidden'); setTimeout(() => { ui.helpOn = false; $('help').classList.add('hidden'); }, 14000);
  if (game.net.mode === 'host') { chatLine('', '', `Room <b>${game.net.code}</b> is open — share the code with up to ${CFG.MAX_PLAYERS - 1} friends.`, true); }
  chatLine('', '', 'Scan (Q) for broken nodes and resources. Restore all 7 to bring the Spire back to life.', true);
  lockPointer();
}
$('btnSolo').onclick = () => { beginPlay(); loadSaveIntoWorld(); game.net.startSolo(); enterGame(); };
$('btnHost').onclick = async () => {
  beginPlay(); setBusy(true); $('menuStatus').textContent = 'Opening room…';
  try { const code = await game.net.host(); loadSaveIntoWorld(); game.net.initAuthority(true); enterGame(); game.toast(`Room code: <b>${code}</b>`, true); }
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
game.cam = cam; game.simulate = simulate; game.saveGame = saveGame; game.keys = keys; game.pressed = pressed; window.__game = game; // debug handle (console tinkering / automated tests)
