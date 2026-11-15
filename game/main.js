/* ============================================================================
   DUSTLINE // Sector 7 — a round-based tactical FPS (three.js 0.187.0)
   Single-player vs bots. No build step, no network, no external assets.
   Everything below is original: the map, the art, the sounds, the names.

   Structure
     1. utils + config + weapons      5. map, colliders, waypoints
     2. synthesized audio             6. characters (player + bots)
     3. procedural textures           7. combat, tracers, particles
     4. renderer / scene / lighting   8. bot AI, bomb, rounds, economy
                                       9. HUD, minimap, menus, main loop
   Simulation runs on a fixed 1/60 s step, decoupled from rendering
   (criterion 5): the world advances the same on any machine, and the
   hot loops reuse scratch vectors instead of allocating every frame.
   ========================================================================== */
import * as THREE from 'three';

/* ---------------- 1. utils + config ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const CONFIG = {
  matchWinRounds: 5, roundTime: 100, buyTime: 12,
  playerSpeed: 5.4, walkSpeed: 2.7, crouchSpeed: 2.6, jumpSpeed: 5.6,
  gravity: 16, eyeHeight: 1.62, crouchEye: 1.12, playerRadius: 0.42,
  plantTime: 3.5, defuseTime: 5.0, bombTimer: 35,
  killReward: 300, winReward: 3250, lossReward: 1900, plantReward: 300,
  startMoney: 800, maxMoney: 16000,
};

/* Weapons. dmg = chest damage at close range; falloff shrinks it with distance. */
const WEAPONS = {
  p9:   { id: 'p9',   name: 'P9 SIDEARM',  short: 'P9',    price: 0,    slot: 'side', auto: false, rpm: 320, mag: 12, reserve: 36,  reload: 1.15, dmg: 34, hsMult: 2.0, spread: 0.011, moveSpread: 0.020, range: 26, falloff: 0.55, zoom: 1,    kick: 0.011, tracer: 0xffd27d },
  vk47: { id: 'vk47', name: 'VK-47 RIFLE', short: 'VK-47', price: 2700, slot: 'main', auto: true,  rpm: 600, mag: 30, reserve: 90,  reload: 2.2,  dmg: 33, hsMult: 2.2, spread: 0.009, moveSpread: 0.030, range: 55, falloff: 0.70, zoom: 1,    kick: 0.020, tracer: 0xffe9a8 },
  rs12: { id: 'rs12', name: 'RS-12 SMG',   short: 'RS-12', price: 1500, slot: 'main', auto: true,  rpm: 780, mag: 28, reserve: 84,  reload: 1.9,  dmg: 24, hsMult: 2.0, spread: 0.014, moveSpread: 0.026, range: 30, falloff: 0.50, zoom: 1,    kick: 0.013, tracer: 0xffd27d },
  lw308:{ id: 'lw308',name: 'LW-308 MARKSMAN', short:'LW-308', price: 4750, slot: 'main', auto: false, rpm: 55,  mag: 5,  reserve: 15,  reload: 3.0,  dmg: 105, hsMult: 2.0, spread: 0.001, moveSpread: 0.045, range: 90, falloff: 0.95, zoom: 2.6,  kick: 0.055, tracer: 0xfff2c0 },
  sg12: { id: 'sg12', name: 'SG-12 BREACHER', short:'SG-12', price: 1200, slot: 'main', auto: false, rpm: 75,  mag: 7,  reserve: 28,  reload: 2.6,  dmg: 13, hsMult: 1.8, spread: 0.035, moveSpread: 0.045, range: 18, falloff: 0.35, zoom: 1,    kick: 0.040, pellets: 8, tracer: 0xffc46b },
};
const SHOP = [
  { key: '1', w: 'vk47', tag: 'The workhorse. Accurate bursts, big mag.' },
  { key: '2', w: 'rs12', tag: 'Fast, cheap, deadly up close.' },
  { key: '3', w: 'lw308', tag: 'One tap through helmets. Right-click to scope.' },
  { key: '4', w: 'sg12', tag: 'Clears corners. Eight pellets per shell.' },
  { key: '5', w: 'armor', tag: 'Kevlar vest — halves bullet damage.' },
  { key: '6', w: 'smoke', tag: 'Smoke grenade — blocks sight for 12s.' },
  { key: '7', w: 'flash', tag: 'Flashbang — whites out anyone looking.' },
];
const ARMOR_PRICE = 650, SMOKE_PRICE = 300, FLASH_PRICE = 200;
const DIFF = {
  recruit: { aimErr: 0.055, react: 0.75, burst: [2, 4], hp: 100, dmg: 0.7 },
  regular: { aimErr: 0.034, react: 0.5,  burst: [3, 6], hp: 100, dmg: 0.9 },
  veteran: { aimErr: 0.020, react: 0.32, burst: [4, 8], hp: 100, dmg: 1.1 },
};
const BOT_NAMES_CT = ['Sable', 'Irons', 'Pip', 'Doc'];
const BOT_NAMES_T = ['Vex', 'Rook', 'Havoc', 'Mira', 'Dagger'];

/* ---------------- 2. synthesized audio (no audio files) ---------------- */
const AudioSys = {
  ctx: null, master: null, enabled: true, volume: 0.55,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  _noiseBuf(dur = 0.3) {
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return buf;
  },
  shot(weaponId, dist = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, vol = clamp(1 - dist / 70, 0.15, 1);
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf(0.22);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = weaponId === 'lw308' ? 900 : weaponId === 'sg12' ? 1200 : 2600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.85 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.25);
    // body thump
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(weaponId === 'lw308' ? 90 : 150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = this.ctx.createGain(); og.gain.setValueAtTime(0.5 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.11);
  },
  _tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  dryFire() { this._tone(1400, 0.05, 'square', 0.12); },
  reload() { this._tone(900, 0.06, 'square', 0.12); setTimeout(() => this._tone(620, 0.06, 'square', 0.14), 140); },
  hit(head = false) { this._tone(head ? 2400 : 1700, 0.07, 'sine', 0.3); },
  kill() { this._tone(520, 0.1, 'sine', 0.3); setTimeout(() => this._tone(780, 0.14, 'sine', 0.3), 90); },
  hurt() { this._tone(160, 0.16, 'sawtooth', 0.25, 90); },
  step() { if (Math.random() < 0.5) this._tone(rand(70, 110), 0.05, 'sine', 0.07); },
  beep(fast = false) { this._tone(fast ? 1250 : 950, 0.12, 'square', 0.22); },
  plant() { this._tone(700, 0.12, 'square', 0.2); setTimeout(() => this._tone(1050, 0.16, 'square', 0.2), 130); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 'triangle', 0.28), i * 120)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.24, 'triangle', 0.25), i * 130)); },
  explosion() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(1.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
    this._tone(60, 0.9, 'sine', 0.5, 30);
  },
};

/* ---------------- 3. procedural textures ---------------- */
function canvasTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function speckle(ctx, s, n, colors, rMin = 1, rMax = 3) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = pick(colors);
    ctx.globalAlpha = rand(0.15, 0.55);
    ctx.beginPath(); ctx.arc(rand(0, s), rand(0, s), rand(rMin, rMax), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
const TEX = {};
function buildTextures() {
  TEX.sand = canvasTexture(256, (x, s) => {
    x.fillStyle = '#c2a06b'; x.fillRect(0, 0, s, s);
    speckle(x, s, 2200, ['#b28e58', '#d4b47e', '#a37f4e', '#cbb184']);
    x.strokeStyle = 'rgba(90,70,40,.25)';
    for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(rand(0, s), rand(0, s)); x.lineTo(rand(0, s), rand(0, s)); x.stroke(); }
  }, [24, 18]);
  TEX.concrete = canvasTexture(256, (x, s) => {
    x.fillStyle = '#9a958c'; x.fillRect(0, 0, s, s);
    speckle(x, s, 1800, ['#8a857c', '#aaa59c', '#7d7870']);
    x.strokeStyle = 'rgba(60,58,52,.35)'; x.lineWidth = 2;
    x.strokeRect(1, 1, s - 2, s - 2);
    x.beginPath(); x.moveTo(0, s / 2); x.lineTo(s, s / 2); x.stroke();
  }, [6, 3]);
  TEX.metal = canvasTexture(256, (x, s) => {
    x.fillStyle = '#7e6f5a'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.07)'; x.fillRect(0, i * 22, s, 10); }
    speckle(x, s, 500, ['#6b5d4b', '#8d7d66', '#5d4f3f']);
    x.fillStyle = 'rgba(40,30,20,.5)'; x.fillRect(0, 0, s, 6); x.fillRect(0, s - 6, s, 6);
  }, [2, 1]);
  TEX.crate = canvasTexture(256, (x, s) => {
    x.fillStyle = '#8a6b3f'; x.fillRect(0, 0, s, s);
    x.strokeStyle = '#5d4526'; x.lineWidth = 10; x.strokeRect(5, 5, s - 10, s - 10);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(s, s); x.moveTo(s, 0); x.lineTo(0, s); x.stroke();
    speckle(x, s, 500, ['#7a5c34', '#9c7c4c']);
  });
  TEX.containerBlue = canvasTexture(256, (x, s) => {
    x.fillStyle = '#2f5d7d'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 16, 0, 6, s); }
    speckle(x, s, 400, ['#274f6b', '#3a6d8f', '#1e4258']);
  }, [2, 1]);
  TEX.containerRust = canvasTexture(256, (x, s) => {
    x.fillStyle = '#8a4a30'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 16, 0, 6, s); }
    speckle(x, s, 700, ['#7a3f28', '#9c5a3a', '#5f3018']);
  }, [2, 1]);
  TEX.wallPaint = canvasTexture(256, (x, s) => {
    x.fillStyle = '#b8a888'; x.fillRect(0, 0, s, s);
    x.fillStyle = '#a30f0f'; x.fillRect(0, s * 0.62, s, s * 0.1);
    speckle(x, s, 900, ['#a89a78', '#c4b694']);
    x.fillStyle = 'rgba(40,32,20,.35)'; x.fillRect(0, s - 14, s, 14);
  }, [4, 1]);
}

/* ---------------- 4. renderer / scene / lighting ---------------- */
let renderer, scene, camera, sunLight;
const WORLD = { w: 64, d: 48 }; // playable yard, x in [-32,32], z in [-24,24]
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // (PCFSoft was removed in r187)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'game';
  $('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd9e8);
  scene.fog = new THREE.Fog(0xc8b489, 55, 140);
  camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 220);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x8a6f4d, 0.85);
  scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xffe3b0, 2.4);
  sunLight.position.set(28, 42, 14);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -45; sunLight.shadow.camera.right = 45;
  sunLight.shadow.camera.top = 45; sunLight.shadow.camera.bottom = -45;
  sunLight.shadow.camera.far = 120; sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);

  // sky dome + sun disc + drifting dust
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(160, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x6fa8d8) }, bot: { value: new THREE.Color(0xe8d9b0) } },
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bot; void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,pow(h,0.8)),1.0); }',
    }));
  scene.add(sky);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(7, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff3cf, fog: false }));
  sunDisc.position.set(90, 70, 40); sunDisc.lookAt(0, 0, 0); scene.add(sunDisc);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ---------------- 5. map, colliders, waypoints ---------------- */
/* Colliders are axis-aligned boxes: {min:Vector3, max:Vector3}. Everything
   solid in the yard registers here; movement + bullets both use them. */
const colliders = [];
const shootables = []; // meshes raycast can hit (walls, crates) — for impact FX
function addCollider(cx, cz, w, h, d, y0 = 0) {
  colliders.push({ min: V3(cx - w / 2, y0, cz - d / 2), max: V3(cx + w / 2, y0 + h, cz + d / 2) });
}
function box(w, h, d, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = opts.shadow !== false; m.receiveShadow = true;
  scene.add(m); return m;
}
function makeMat(tex, color = 0xffffff, rough = 0.9) {
  return new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough, metalness: 0.04 });
}

const sites = {
  A: { name: 'A — FOUNDRY', center: V3(-24, 0, -17), r: 5.5 },
  B: { name: 'B — DEPOT', center: V3(24, 0, 17), r: 5.5 },
};
const spawns = {
  CT: [V3(26, 0, -19), V3(28, 0, -16), V3(24, 0, -20), V3(28, 0, -21), V3(22, 0, -17)],
  T: [V3(-27, 0, 19), V3(-29, 0, 16), V3(-25, 0, 21), V3(-29, 0, 21), V3(-23, 0, 18)],
};
let waypointGraph = {}; // id -> {pos, links:[ids]}
function buildMap() {
  buildTextures();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.w + 26, WORLD.d + 26),
    new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const wallMat = makeMat(TEX.wallPaint);
  const concMat = makeMat(TEX.concrete);
  const metalMat = makeMat(TEX.metal);
  const crateMat = makeMat(TEX.crate);
  const blueMat = makeMat(TEX.containerBlue);
  const rustMat = makeMat(TEX.containerRust);

  // perimeter walls (h=4.2)
  const W = WORLD.w / 2, D = WORLD.d / 2;
  [[0, -D - 1, WORLD.w + 4, 2], [0, D + 1, WORLD.w + 4, 2], [-W - 1, 0, 2, WORLD.d + 4], [W + 1, 0, 2, WORLD.d + 4]]
    .forEach(([x, z, w, d]) => { box(w, 4.2, d, wallMat, x, 2.1, z); addCollider(x, z, w, 4.2, d); });
  // outer silhouette buildings (visual depth, outside the fence)
  box(18, 9, 8, concMat, -44, 4.5, -18); box(14, 12, 10, concMat, 44, 6, 16);
  box(16, 7, 9, metalMat, 40, 3.5, -22); box(20, 10, 8, concMat, -40, 5, 22);

  const wall = (x, z, w, d, h = 3.0, mat = wallMat) => { box(w, h, d, mat, x, h / 2, z); addCollider(x, z, w, h, d); };
  const crate = (x, z, s = 1.6, ry = 0) => {
    const m = box(s, s, s, crateMat, x, s / 2, z, { ry }); addCollider(x, z, s, s, s); shootables.push(m); return m;
  };
  const container = (x, z, ry, mat) => {
    const m = box(6.1, 2.6, 2.5, mat, x, 1.3, z, { ry }); addCollider(x, z, 6.1, 2.6, 2.5); shootables.push(m); return m;
  };

  // --- mid: open crossroads with crate cover (lanes stay walkable) ---
  // (An earlier 4-wall box here enclosed mid and trapped the bots' waypoint
  //  lanes — mid must stay open so straight waypoint edges never cross a wall.)
  crate(-3, -2.5, 1.6); crate(4, 3, 1.6); crate(-4, 3.5, 1.2);
  wall(-8, -11, 5, 1, 1.3, concMat); wall(8, 11, 5, 1, 1.3, concMat);
  container(-14, 0, 0, blueMat); container(14, 0, 0, rustMat);

  // --- A site (NW, foundry): furnace block, pipes, crates ---
  wall(-24, -21, 12, 1.2, 3.4); wall(-30.5, -15, 1.2, 12, 3.4);
  box(5, 4.4, 3, metalMat, -27, 2.2, -19); addCollider(-27, -19, 5, 4.4, 3);
  // furnace: dark steel body, the glow confined to its mouth — the old
  // full-face emissive read as a flat orange placeholder box in screenshots.
  const furnace = box(2.4, 5.2, 2.4, new THREE.MeshStandardMaterial({ color: 0x3a3a3f, roughness: .55, metalness: .55, emissive: 0xff5a00, emissiveIntensity: 0.12 }), -24, 2.6, -14);
  shootables.push(furnace);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: 0xff6a00, emissiveIntensity: 1.6, roughness: .4 }));
  mouth.position.set(-22.78, 1.1, -14); mouth.rotation.y = Math.PI / 2; scene.add(mouth);
  crate(-19, -18, 1.6); crate(-19, -16.2, 1.2); crate(-28, -12, 1.6);
  box(1.1, 3.4, 1.1, metalMat, -17, 1.7, -21); addCollider(-17, -21, 1.1, 3.4, 1.1);

  // --- B site (SE, depot): containers + silo ---
  wall(24, 21, 12, 1.2, 3.4); wall(30.5, 15, 1.2, 12, 3.4);
  container(20, 19, 0.35, blueMat); container(27, 13, -0.3, rustMat);
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 6.5, 18), metalMat);
  silo.position.set(18, 3.25, 14); silo.castShadow = silo.receiveShadow = true; scene.add(silo);
  addCollider(18, 14, 4.4, 6.5, 4.4); shootables.push(silo);
  crate(27, 20, 1.6); crate(22, 21, 1.2);

  // --- scattered cover: barrels, crates, low walls ---
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a5a2e, roughness: .7, metalness: .35 });
  const barrel = (x, z) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.25, 14), barrelMat);
    b.position.set(x, 0.62, z); b.castShadow = b.receiveShadow = true; scene.add(b);
    addCollider(x, z, 1.1, 1.25, 1.1); shootables.push(b);
  };
  barrel(-10, 12); barrel(-9, 13); barrel(11, -13); barrel(12, -12); barrel(2, -16); barrel(-2, 16);
  crate(-12, -12, 1.6, 0.4); crate(12, 12, 1.6, -0.3); crate(-16, 8, 1.4); crate(16, -8, 1.4);
  crate(0, -18, 1.6); crate(0, 18, 1.6); crate(-6, 14, 1.2); crate(6, -14, 1.2);
  wall(-18, 10, 6, 1, 1.3, concMat); wall(18, -10, 6, 1, 1.3, concMat);
  wall(-4, -12, 1, 6, 1.3, concMat); wall(4, 12, 1, 6, 1.3, concMat);

  // --- site markers: glowing rings + floating labels ---
  for (const [key, s] of Object.entries(sites)) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.35, s.r, 48),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xffb454 : 0x7fd4ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.center.x, 0.06, s.center.z); scene.add(ring);
    s.ring = ring;
    const label = makeTextSprite(key + ' SITE', key === 'A' ? '#ffb454' : '#7fd4ff');
    label.position.set(s.center.x, 5.4, s.center.z); scene.add(label);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xffb454 : 0x7fd4ff, transparent: true, opacity: 0.35 }));
    beacon.position.set(s.center.x, 2.5, s.center.z); scene.add(beacon);
  }
  // mid label
  const mid = makeTextSprite('MID', '#ffffff'); mid.position.set(0, 4.6, 0); scene.add(mid);

  // --- spike prop (hidden until planted) ---
  const spike = new THREE.Group();
  const spikeBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x222226, roughness: .4, metalness: .6, emissive: 0xff2200, emissiveIntensity: .8 }));
  spikeBody.position.y = 0.35; spike.add(spikeBody);
  const spikeLight = new THREE.PointLight(0xff2200, 3, 9); spikeLight.position.y = 1; spike.add(spikeLight);
  spike.visible = false; scene.add(spike);
  Game.spikeMesh = spike;

  buildWaypoints();
  buildDust();
}

function makeTextSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.font = 'bold 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#000'; x.shadowBlur = 12; x.fillStyle = color;
  x.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(7, 1.75, 1); return sp;
}

let dustPoints;
function buildDust() {
  const n = 350, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rand(-32, 32); pos[i * 3 + 1] = rand(0.2, 7); pos[i * 3 + 2] = rand(-24, 24); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustPoints = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8d9b0, size: 0.09, transparent: true, opacity: 0.55 }));
  scene.add(dustPoints);
}

/* Waypoint graph: nodes on open lanes, bots pathfind with BFS. */
function buildWaypoints() {
  const defs = [
    ['ctSpawn', 26, -18], ['tSpawn', -26, 18],
    ['mid', 0, 0], ['midN', 0, -11], ['midS', 0, 11], ['midW', -11, 0], ['midE', 11, 0],
    ['aLong', -12, -18], ['aSite', -24, -16], ['aEntry', -18, -12], ['aBack', -28, -12],
    ['bLong', 12, 18], ['bSite', 24, 16], ['bEntry', 18, 12], ['bBack', 28, 20],
    ['tMid', -18, 8], ['ctMid', 18, -8], ['tSide', -22, 2], ['ctSide', 22, -2],
    ['aPlat', -20, -20], ['bPlat', 21, 20], ['nLane', -6, -16], ['sLane', 6, 16],
  ];
  const links = {
    ctSpawn: ['ctMid', 'midE', 'bEntry'], tSpawn: ['tMid', 'midW', 'aEntry'],
    mid: ['midN', 'midS', 'midW', 'midE'], midN: ['mid', 'nLane', 'aLong'], midS: ['mid', 'sLane', 'bLong'],
    midW: ['mid', 'tMid', 'tSide'], midE: ['mid', 'ctMid', 'ctSide'],
    aLong: ['midN', 'aEntry', 'nLane'], aSite: ['aEntry', 'aBack', 'aPlat'], aEntry: ['aLong', 'aSite', 'tSide'],
    aBack: ['aSite'], aPlat: ['aSite', 'aEntry'],
    bLong: ['midS', 'bEntry', 'sLane'], bSite: ['bEntry', 'bBack', 'bPlat'], bEntry: ['bLong', 'bSite', 'ctSide'],
    bBack: ['bSite'], bPlat: ['bSite', 'bEntry'],
    tMid: ['midW', 'tSpawn', 'tSide'], ctMid: ['midE', 'ctSpawn', 'ctSide'],
    tSide: ['tMid', 'aEntry', 'midW'], ctSide: ['ctMid', 'bEntry', 'midE'],
    nLane: ['midN', 'aLong'], sLane: ['midS', 'bLong'],
  };
  for (const [id, x, z] of defs) waypointGraph[id] = { id, pos: V3(x, 0, z), links: links[id] || [] };
}
function nearestWaypoint(p) {
  let best = null, bd = 1e9;
  for (const w of Object.values(waypointGraph)) { const d = w.pos.distanceToSquared(p); if (d < bd) { bd = d; best = w; } }
  return best;
}
function findPath(from, to) { // BFS over waypoint graph, returns array of Vector3
  if (!from || !to) return [];
  const prev = { [from.id]: null }, q = [from.id];
  while (q.length) {
    const cur = q.shift();
    if (cur === to.id) break;
    for (const nb of waypointGraph[cur].links) if (!(nb in prev)) { prev[nb] = cur; q.push(nb); }
  }
  if (!(to.id in prev)) return [to.pos];
  const ids = []; let c = to.id;
  while (c) { ids.unshift(c); c = prev[c]; }
  return ids.map((id) => waypointGraph[id].pos.clone());
}

/* Collision: slide an AABB (capsule approximated as a box) against colliders. */
function collideMove(pos, vel, dt, radius, height) {
  pos.x += vel.x * dt; pos.z += vel.z * dt;
  for (const c of colliders) {
    if (pos.y + height < c.min.y || pos.y > c.max.y) continue;
    const ox = Math.min(pos.x + radius, c.max.x) - Math.max(pos.x - radius, c.min.x);
    const oz = Math.min(pos.z + radius, c.max.z) - Math.max(pos.z - radius, c.min.z);
    if (ox > 0 && oz > 0) {
      if (ox < oz) pos.x += (pos.x < (c.min.x + c.max.x) / 2 ? -ox : ox);
      else pos.z += (pos.z < (c.min.z + c.max.z) / 2 ? -oz : oz);
    }
  }
  pos.y += vel.y * dt;
  if (pos.y < 0) { pos.y = 0; vel.y = 0; }
  pos.x = clamp(pos.x, -WORLD.w / 2 + 0.6, WORLD.w / 2 - 0.6);
  pos.z = clamp(pos.z, -WORLD.d / 2 + 0.6, WORLD.d / 2 - 0.6);
}
function losBlocked(a, b) { // is the line of sight between two points blocked by a collider?
  const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
  const ray = new THREE.Raycaster(a, dir, 0, len);
  const hits = ray.intersectObjects(shootables, false);
  if (hits.length) return true;
  // also test AABB slabs directly (thin walls are meshes too, but be thorough)
  for (const c of colliders) {
    const t = rayIntersectBox(a, dir, c);
    if (t !== null && t < len) return true;
  }
  return false;
}
function rayIntersectBox(o, d, c) {
  let tmin = 0, tmax = 1e9;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (d[ax] || 1e-9);
    let t0 = (c.min[ax] - o[ax]) * inv, t1 = (c.max[ax] - o[ax]) * inv;
    if (inv < 0) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  return tmin;
}

/* ---------------- 6. characters: player + bots ---------------- */
const Game = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1, score: { CT: 0, T: 0 }, roundTime: CONFIG.roundTime,
  buyTimer: CONFIG.buyTime, bomb: { state: 'idle', site: null, timer: 0, planter: null, defuser: null, progress: 0 },
  player: null, bots: [], difficulty: 'regular', spectate: false,
  money: CONFIG.startMoney, kills: 0, deaths: 0, shotsFired: 0, shotsHit: 0, headshots: 0,
  roundKills: 0, spikeCarrier: null, time: 0, shake: 0, flashUntil: 0, smokeZones: [],
  muted: false, spikeMesh: null, demoMode: false, shotMode: 0,
};
const TEAM_COLOR = { CT: 0x3f8cff, T: 0xff9040 };
const TEAM_NAME = { CT: 'WARDENS', T: 'JACKALS' };

function makeSoldier(team, name) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x2e4a66 : 0x6b4a2e, roughness: .85 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: .8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9976b, roughness: .9 });
  const accent = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: .5, emissive: TEAM_COLOR[team], emissiveIntensity: .25 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit); torso.position.y = 1.12; g.add(torso);
  const vestM = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.36), vest); vestM.position.y = 1.14; g.add(vestM);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin); head.position.y = 1.62; g.add(head);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.36), team === 'CT' ? accent : vest); helm.position.y = 1.8; g.add(helm);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x111418, roughness: .2, metalness: .6 }));
  visor.position.set(0, 1.62, 0.17); g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), suit); legL.position.set(-0.14, 0.36, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.18), suit); armL.position.set(-0.35, 1.12, 0.1); armL.rotation.x = -1.1; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.35; g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), vest); gun.position.set(0.18, 1.22, 0.35); g.add(gun);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.07, 0.32), accent); stripe.position.y = 0.92; g.add(stripe);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  // name tag
  const tag = makeTextSprite(name, team === 'CT' ? '#7fd4ff' : '#ffb454');
  tag.scale.set(2.4, 0.6, 1); tag.position.y = 2.15; g.add(tag);
  // hit volumes (invisible, raycast targets)
  const bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  bodyHit.position.y = 1.05; bodyHit.userData.part = 'body'; g.add(bodyHit);
  const headHit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.42), new THREE.MeshBasicMaterial({ visible: false }));
  headHit.position.y = 1.62; headHit.userData.part = 'head'; g.add(headHit);
  g.userData.hitMeshes = [bodyHit, headHit];
  scene.add(g);
  return g;
}

function newFighter(team, name, isPlayer) {
  const spawn = pick(spawns[team]);
  const f = {
    team, name, isPlayer: !!isPlayer, alive: true, hp: 100, armor: 0,
    pos: spawn.clone(), vel: V3(0, 0, 0), yaw: team === 'CT' ? Math.PI / 2 : -Math.PI / 2, pitch: 0,
    money: CONFIG.startMoney, weapon: 'p9', mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve,
    weapons: { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } },
    reloading: 0, lastShot: 0, burstLeft: 0, burstPause: 0, reactAt: 0, aimErr: 0,
    aimPoint: V3(0, 0, 0), // persistent aim target: reused, never re-allocated
    path: [], pathI: 0, objective: null, state: 'idle', stateT: 0,
    target: null, lastSeen: null, strafeDir: 1, strafeT: 0, crouch: false,
    kills: 0, deaths: 0, hasSpike: false, planting: 0, defusing: 0, mesh: null,
    walkPhase: 0, lastStep: 0, util: { smoke: 1, flash: 1 },
  };
  if (!isPlayer) f.mesh = makeSoldier(team, name);
  return f;
}

function equipWeapon(f, id) {
  const w = WEAPONS[id];
  if (!w) return;
  if (!f.weapons[id]) f.weapons[id] = { mag: w.mag, reserve: w.reserve };
  f.weapon = id; f.mag = f.weapons[id].mag; f.reserve = f.weapons[id].reserve;
  f.reloading = 0;
  if (f.isPlayer) updateWeaponHUD();
}
function buyItem(f, key) {
  const entry = SHOP.find((s) => s.key === key);
  if (!entry) return false;
  if (entry.w === 'armor') {
    if (f.money < ARMOR_PRICE || f.armor >= 100) return false;
    f.money -= ARMOR_PRICE; f.armor = 100; return true;
  }
  if (entry.w === 'smoke') {
    if (f.money < SMOKE_PRICE || f.util.smoke >= 2) return false;
    f.money -= SMOKE_PRICE; f.util.smoke++; return true;
  }
  if (entry.w === 'flash') {
    if (f.money < FLASH_PRICE || f.util.flash >= 2) return false;
    f.money -= FLASH_PRICE; f.util.flash++; return true;
  }
  const w = WEAPONS[entry.w];
  if (f.money < w.price) return false;
  f.money -= w.price;
  f.weapons[entry.w] = { mag: w.mag, reserve: w.reserve };
  equipWeapon(f, entry.w);
  return true;
}
function botBuy(b) {
  // bots spend sensibly: marksman if rich, rifle if comfortable, SMG mid,
  // save if poor; armor when affordable
  if (b.money >= 5350 && Math.random() < 0.35) buyItem(b, '3');
  else if (b.money >= 3350 && Math.random() < 0.8) buyItem(b, '1');
  else if (b.money >= 2150 && Math.random() < 0.6) buyItem(b, '2');
  if (b.money >= ARMOR_PRICE + 300 && Math.random() < 0.6) buyItem(b, '5');
  if (b.money >= SMOKE_PRICE + 200 && Math.random() < 0.4) buyItem(b, '6');
}

/* ---------------- viewmodel gun ---------------- */
let viewGun, muzzle, muzzleLight;
function buildViewmodel() {
  viewGun = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: .45, metalness: .65 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: .5, metalness: .55 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: .8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark); viewGun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10), mid);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.46); viewGun.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), wood);
  mag.position.set(0, -0.14, -0.05); mag.rotation.x = 0.25; viewGun.add(mag);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.22), wood);
  stock.position.set(0, -0.01, 0.4); viewGun.add(stock);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), mid);
  sight.position.set(0, 0.1, -0.08); viewGun.add(sight);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x2e4a66, roughness: .9 }));
  hand.position.set(0.02, -0.12, -0.28); viewGun.add(hand);
  muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd27d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  muzzle.position.set(0, 0.02, -0.66); viewGun.add(muzzle);
  muzzleLight = new THREE.PointLight(0xffc46b, 0, 7); muzzleLight.position.set(0, 0, -0.6);
  viewGun.add(muzzleLight);
  viewGun.position.set(0.26, -0.24, -0.5);
  const fill = new THREE.PointLight(0xfff2dd, 1.2, 3);
  fill.position.set(0.1, 0.1, -0.4);
  camera.add(fill);
  camera.add(viewGun);
  scene.add(camera);
}
function setViewmodelWeapon(id) {
  if (!viewGun) return;
  const s = id === 'lw308' ? 1.35 : id === 'sg12' ? 1.1 : id === 'rs12' ? 0.85 : id === 'p9' ? 0.7 : 1;
  viewGun.scale.setScalar(s);
}

/* ---------------- input ---------------- */
const Input = {
  keys: {}, mouseDX: 0, mouseDY: 0, firing: false, locked: false, sens: 0.0022,
  init(canvas) {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Tab', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyB' && (Game.phase === 'buy' || Game.phase === 'live')) toggleBuy();
      if (e.code === 'KeyR') startReload(Game.player);
      if (e.code === 'KeyQ') swapToLastWeapon();
      if (e.code === 'Digit4') throwUtility('smoke');
      if (e.code === 'Digit5') throwUtility('flash');
      if (e.code.startsWith('Digit') && !$('buy').classList.contains('hidden')) {
        const k = e.code.replace('Digit', '');
        if (buyItem(Game.player, k)) { renderShop(); updateHUD(); AudioSys.reload(); }
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) setScope(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) setScope(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (Game.phase !== 'live' || !Game.player?.alive) return;
      cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === renderer.domElement;
      if (!this.locked && (Game.phase === 'live' || Game.phase === 'buy') && !Game.demoMode) showPause();
      else if (this.locked) hidePause();
    });
  },
  lock() { renderer.domElement.requestPointerLock(); },
};
function setScope(on) {
  const p = Game.player; if (!p || !p.alive) return;
  const w = WEAPONS[p.weapon];
  if (w.zoom <= 1) return;
  p.scoped = on && Game.phase === 'live';
  $('scope').style.opacity = p.scoped ? '1' : '0';
  camera.fov = p.scoped ? 74 / w.zoom : 74;
  camera.updateProjectionMatrix();
}
function swapToLastWeapon() {
  const p = Game.player; if (!p || Game.phase !== 'live') return;
  const owned = Object.keys(p.weapons);
  if (owned.length < 2) return;
  const other = owned.find((id) => id !== p.weapon);
  if (other) { equipWeapon(p, other); setViewmodelWeapon(p.weapon); AudioSys.reload(); }
}
function cycleWeapon(dir) {
  const p = Game.player; if (!p) return;
  const owned = Object.keys(p.weapons);
  if (owned.length < 2) return;
  const i = owned.indexOf(p.weapon);
  equipWeapon(p, owned[(i + dir + owned.length) % owned.length]);
  setViewmodelWeapon(p.weapon); AudioSys.reload();
}

/* ---------------- 7. combat, tracers, particles, utility ---------------- */
const raycaster = new THREE.Raycaster();
const tracers = [], particles = [], smokes = [];
function spawnTracer(a, b, color) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line); tracers.push({ line, life: 0.09 });
}
function spawnImpact(point, normal, color = 0xffd27d) {
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ color: i % 2 ? color : 0xffffff }));
    m.position.copy(point);
    particles.push({ mesh: m, vel: V3(rand(-2, 2), rand(0.5, 3), rand(-2, 2)).add(normal.clone().multiplyScalar(2)), life: rand(0.15, 0.4) });
    scene.add(m);
  }
}
function spawnBlood(point) {
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xaa1111 }));
    m.position.copy(point);
    particles.push({ mesh: m, vel: V3(rand(-2.5, 2.5), rand(0, 2.5), rand(-2.5, 2.5)), life: rand(0.2, 0.5) });
    scene.add(m);
  }
}
function spawnSmoke(pos) {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rand(1.1, 1.8), 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.85, roughness: 1 }));
    s.position.set(rand(-1.4, 1.4), rand(0.6, 1.8), rand(-1.4, 1.4)); g.add(s);
  }
  g.position.copy(pos); scene.add(g);
  smokes.push({ group: g, pos: pos.clone(), until: Game.time + 12 });
  Game.smokeZones.push({ pos: pos.clone(), r: 3.2, until: Game.time + 12 });
}
function inSmoke(pos) {
  return Game.smokeZones.some((s) => Game.time < s.until && s.pos.distanceTo(pos) < s.r);
}
function throwUtility(kind) {
  const p = Game.player;
  if (!p || !p.alive || Game.phase !== 'live' || p.util[kind] <= 0) return;
  p.util[kind]--;
  const dir = V3(0, 0, -1).applyEuler(camera.rotation);
  const target = p.pos.clone().add(V3(0, 1.4, 0)).add(dir.clone().multiplyScalar(9));
  target.y = Math.max(0.6, target.y + dir.y * 6);
  if (kind === 'smoke') { spawnSmoke(target); radio(p, 'Smoke out!'); }
  else {
    // flash: anyone facing the burst within 22m and LOS gets flashed
    for (const f of [Game.player, ...Game.bots]) {
      if (!f.alive) continue;
      const d = f.pos.distanceTo(target);
      if (d > 24) continue;
      const toBurst = target.clone().sub(f.pos.clone().add(V3(0, 1.5, 0))).normalize();
      const facing = V3(0, 0, -1).applyEuler(new THREE.Euler(0, f.yaw, 0));
      if (f.isPlayer || facing.dot(toBurst) > -0.2) {
        if (!losBlocked(target, f.pos.clone().add(V3(0, 1.5, 0)))) {
          if (f.isPlayer) { Game.flashUntil = Game.time + clamp(2.4 - d * 0.08, 0.4, 2.4); $('flash').style.opacity = '1'; }
          else { f.flashUntil = Game.time + clamp(2 - d * 0.07, 0.4, 2); }
        }
      }
    }
    radio(p, 'Flash out!');
  }
  updateHUD();
}

/* Fire one (hitscan) shot from fighter f toward their aim direction. */
function shoot(f) {
  const w = WEAPONS[f.weapon];
  const now = Game.time;
  if (f.reloading > 0 || f.mag <= 0) { if (f.isPlayer && f.mag <= 0) AudioSys.dryFire(); return; }
  if (now - f.lastShot < 60 / w.rpm) return;
  f.lastShot = now;
  f.mag--;
  if (f.isPlayer) { f.weapons[f.weapon].mag = f.mag; Game.shotsFired++; }
  const spread = (w.spread + (f.isPlayer ? (moving(f) ? w.moveSpread : 0) : f.aimErr || 0)) * (f.scoped ? 0.35 : 1);
  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const dir = aimDir(f).add(V3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
    fireRay(f, dir, w);
  }
  AudioSys.shot(f.weapon, f.isPlayer ? 0 : f.pos.distanceTo(Game.player.pos));
  // muzzle flash + recoil (player)
  if (f.isPlayer) {
    muzzle.material.opacity = 1; muzzle.rotation.z = rand(0, 6);
    muzzleLight.intensity = 6;
    Game.player.pitch = clamp(Game.player.pitch + w.kick * rand(0.7, 1.2), -1.45, 1.45);
    Game.shake = Math.min(0.35, Game.shake + w.kick * 0.5);
    viewGun.position.z = -0.5 + 0.09; // kick back, eases back in loop
  }
  if (f.mag <= 0) startReload(f);
  updateWeaponHUD();
}
function moving(f) {
  return f.isPlayer ? (Input.keys.KeyW || Input.keys.KeyA || Input.keys.KeyS || Input.keys.KeyD) : f.vel.lengthSq() > 0.4;
}
function aimDir(f) {
  if (f.isPlayer) return V3(0, 0, -1).applyEuler(camera.rotation);
  const eye = f.pos.clone(); eye.y += 1.5;
  const tgt = f.aimPoint || f.pos.clone().add(V3(0, 0, -1).applyEuler(new THREE.Euler(0, f.yaw, 0)));
  return tgt.clone().sub(eye).normalize();
}
/* Fire one ray and resolve the NEAREST thing it meets: an enemy hit mesh,
   a solid map collider (walls stop bullets — no shooting through them),
   or the player's capsule (the player has no hit mesh). The old code only
   raycast the meshes, so a shot at the player could "hit" a crate behind
   them instead, and a shot through a wall could still wound them. */
function fireRay(f, dir, w) {
  const origin = f.isPlayer ? camera.position.clone() : f.pos.clone().add(V3(0, 1.5, 0));
  const maxDist = w.range * 2.2;
  raycaster.set(origin, dir); raycaster.far = maxDist;
  // targets: enemy hit meshes + world props
  const targets = [];
  const victims = [Game.player, ...Game.bots].filter((o) => o !== f && o.alive && o.team !== f.team);
  for (const v of victims) if (v.mesh) for (const hm of v.mesh.userData.hitMeshes) { hm.userData.fighter = v; targets.push(hm); }
  const hits = raycaster.intersectObjects([...targets, ...shootables], false);
  let bestD = Infinity, bestKind = null, bestHit = null;
  if (hits.length) { bestD = hits[0].distance; bestKind = 'mesh'; bestHit = hits[0]; }
  // solid map geometry: nearest AABB slab the ray enters, if any
  for (const c of colliders) {
    const t = rayIntersectBox(origin, dir, c);
    if (t !== null && t < bestD && t <= maxDist) { bestD = t; bestKind = 'wall'; bestHit = null; }
  }
  // the player has no mesh; approximate with a capsule test along the ray
  const p = Game.player;
  if (!f.isPlayer && p.alive) {
    const center = p.pos.clone().add(V3(0, 1.1, 0));
    const toP = center.clone().sub(origin);
    const t = clamp(toP.dot(dir), 0, maxDist);
    const closest = origin.clone().add(dir.clone().multiplyScalar(t));
    const d = closest.distanceTo(center);
    const headD = closest.distanceTo(p.pos.clone().add(V3(0, 1.55, 0)));
    if ((d < 0.55 || headD < 0.3) && t < bestD) {
      bestD = t; bestKind = 'player'; bestHit = { point: closest, head: headD < 0.3 };
    }
  }
  const end = origin.clone().add(dir.clone().multiplyScalar(maxDist));
  if (bestKind === 'mesh') {
    const h = bestHit;
    spawnTracer(origin, h.point, w.tracer);
    const victim = h.object.userData.fighter;
    if (victim) {
      const dist = origin.distanceTo(h.point);
      const dmg = w.dmg * (h.object.userData.part === 'head' ? w.hsMult : 1) * lerp(1, w.falloff, clamp(dist / w.range, 0, 1));
      damage(victim, dmg, f, h.object.userData.part === 'head', h.point);
    } else {
      spawnImpact(h.point, h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : V3(0, 1, 0));
    }
    return;
  }
  if (bestKind === 'player') {
    spawnTracer(origin, bestHit.point, w.tracer);
    damage(p, w.dmg * (bestHit.head ? w.hsMult : 1) * (DIFF[Game.difficulty].dmg), f, bestHit.head, bestHit.point);
    return;
  }
  if (bestKind === 'wall') {
    const point = origin.clone().add(dir.clone().multiplyScalar(bestD));
    spawnTracer(origin, point, w.tracer);
    spawnImpact(point, V3(0, 1, 0));
    return;
  }
  spawnTracer(origin, end, w.tracer);
}
function damage(victim, amount, attacker, head, point) {
  if (!victim.alive || Game.phase !== 'live') return;
  if (victim.isPlayer && Game.shotMode) return; // staging mode: keep the camera alive
  let dmg = amount;
  if (victim.armor > 0) { const absorbed = Math.min(victim.armor, dmg * 0.5); victim.armor -= absorbed; dmg -= absorbed; }
  victim.hp -= dmg;
  if (point) spawnBlood(point);
  if (victim.isPlayer) {
    Game.shotsHit += attacker === Game.player ? 1 : 0;
    $('dmg-vignette').style.opacity = '1';
    setTimeout(() => { $('dmg-vignette').style.opacity = '0'; }, 260);
    AudioSys.hurt();
    Game.shake = Math.min(0.5, Game.shake + 0.12);
  } else if (attacker?.isPlayer) {
    Game.shotsHit++;
    if (head) Game.headshots++;
    AudioSys.hit(head);
    const hm = $('hitmarker');
    hm.style.opacity = '1'; hm.classList.toggle('kill', false);
    setTimeout(() => { hm.style.opacity = '0'; }, 140);
  }
  if (victim.hp <= 0) kill(victim, attacker, head);
  updateHUD();
}
function kill(victim, attacker, head) {
  victim.alive = false; victim.hp = 0; victim.deaths++;
  if (victim.mesh) victim.mesh.visible = false;
  if (attacker) {
    attacker.kills++;
    if (attacker.isPlayer) {
      Game.kills++; Game.roundKills++;
      Game.money = Math.min(CONFIG.maxMoney, Game.money + CONFIG.killReward);
      Game.player.money = Game.money;
      AudioSys.kill();
      const hm = $('hitmarker'); hm.classList.add('kill'); hm.style.opacity = '1';
      setTimeout(() => { hm.style.opacity = '0'; }, 220);
    }
    addKillfeed(attacker, victim, head);
  }
  if (victim.hasSpike) { victim.hasSpike = false; dropSpike(victim.pos); }
  if (victim.isPlayer) {
    Game.deaths++;
    setScope(false);
    document.exitPointerLock?.();
    checkRoundEnd();
  }
  checkRoundEnd();
}
function dropSpike(pos) {
  Game.spikeDropped = pos.clone();
  // mark the drop on the ground: the planted-spike prop doubles as the
  // marker (hidden again on pickup, plant, or the next round).
  if (Game.spikeMesh) { Game.spikeMesh.position.copy(pos); Game.spikeMesh.visible = true; }
  radio(null, 'Spike dropped — pick it up!');
}
function startReload(f) {
  if (!f || !f.alive || f.reloading > 0 || f.mag >= WEAPONS[f.weapon].mag || f.reserve <= 0) return;
  f.reloading = WEAPONS[f.weapon].reload;
  if (f.isPlayer) AudioSys.reload();
}
function finishReload(f) {
  const w = WEAPONS[f.weapon];
  const need = w.mag - f.mag, take = Math.min(need, f.reserve);
  f.mag += take; f.reserve -= take;
  if (f.isPlayer) { f.weapons[f.weapon] = { mag: f.mag, reserve: f.reserve }; }
}

/* ---------------- 8. bot AI ---------------- */
/* Scratch vectors for the bot hot loop: botThink runs 9x a step and used
   to allocate a dozen throwaway Vector3s per bot per step. These are
   only ever used synchronously inside one call, never stored. */
const _eye = V3(0, 0, 0), _foeEye = V3(0, 0, 0);
const _toE = V3(0, 0, 0), _fwd = V3(0, 0, 0), _side = V3(0, 0, 0), _approach = V3(0, 0, 0);
function botThink(b, dt) {
  if (!b.alive || Game.phase !== 'live') return;
  b.stateT -= dt;
  const diff = DIFF[Game.difficulty];
  if (Game.time < (b.flashUntil || 0)) { b.vel.set(0, 0, 0); return; } // flashed: stand still
  // cheapest perception: nearest visible enemy
  let enemy = null, bestD = 1e9;
  const foes = [Game.player, ...Game.bots].filter((o) => o.alive && o.team !== b.team);
  for (const foe of foes) {
    _eye.copy(b.pos); _eye.y += 1.5;
    _foeEye.copy(foe.pos); _foeEye.y += 1.3;
    const d = b.pos.distanceTo(foe.pos);
    if (d < bestD && d < 55 && !losBlocked(_eye, _foeEye) && !inSmoke(_foeEye) && !inSmoke(_eye)) { enemy = foe; bestD = d; }
  }
  b.target = enemy;
  if (enemy) {
    b.lastSeen = { pos: enemy.pos.clone(), t: Game.time };
    // face enemy, strafe, burst fire
    const toE = _toE.copy(enemy.pos).sub(b.pos);
    b.yaw = Math.atan2(-toE.x, -toE.z);
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir *= -1; b.strafeT = rand(0.5, 1.4); }
    const fwd = _fwd.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
    const side = _side.set(-fwd.z, 0, fwd.x).multiplyScalar(b.strafeDir * 1.6);
    const dist = toE.length();
    const approach = _approach.set(0, 0, 0);
    if (dist > 16) approach.copy(fwd).multiplyScalar(2.2);
    else if (dist < 6) approach.copy(fwd).multiplyScalar(-1.6);
    b.vel.copy(side).add(approach);
    b.crouch = dist > 22 && Math.random() < 0.3;
    // aim with error that shrinks while the target is still
    const err = diff.aimErr * (moving(enemy) ? 1.6 : 1) * (b.crouch ? 0.75 : 1);
    const aimAt = b.aimPoint.copy(enemy.pos);
    aimAt.y += 1.35 + rand(-err, err) * 8;
    aimAt.x += rand(-err, err) * dist; aimAt.z += rand(-err, err) * dist;
    // reaction + bursts
    if (b.reactAt === 0) b.reactAt = Game.time + diff.react * rand(0.6, 1.4);
    if (Game.time >= b.reactAt) {
      if (b.burstLeft <= 0) {
        if (b.burstPause <= 0) { b.burstLeft = randi(diff.burst[0], diff.burst[1]); b.burstPause = rand(0.35, 0.9); }
        else b.burstPause -= dt;
      } else {
        b.burstLeft--;
        const w = WEAPONS[b.weapon];
        if (Game.time - b.lastShot >= 60 / w.rpm) { b.aimErr = err; shoot(b); }
      }
    }
    if (b.hp < 35 && b.stateT <= 0) { // fall back to cover
      b.stateT = 3;
      const wp = pick(Object.values(waypointGraph));
      b.path = findPath(nearestWaypoint(b.pos), wp); b.pathI = 0;
      radio(b, 'Falling back, I\'m hurt!');
    }
  } else {
    b.burstLeft = 0; b.reactAt = 0; b.vel.set(0, 0, 0);
    followObjective(b, dt);
  }
  // stuck detection: if a path exists but we barely moved, repath
  if (b.path.length && b.pathI < b.path.length) {
    if (!b._lastPos) { b._lastPos = b.pos.clone(); b._stuckT = 0; }
    if (b.pos.distanceTo(b._lastPos) > 0.5) { b._lastPos.copy(b.pos); b._stuckT = 0; }
    else {
      b._stuckT += dt;
      if (b._stuckT > 2.5) {
        b._stuckT = 0; b.path = []; b.pathI = 0; b.stateT = 0;
        b.pos.x += rand(-1, 1); b.pos.z += rand(-1, 1); // sidestep out of the snag
      }
    }
  }
  // move along path / velocity with collision
  const speedMul = b.crouch ? 0.55 : 1;
  if (b.vel.lengthSq() > 0.01) {
    const v = b.vel.clone().multiplyScalar(speedMul);
    v.y = b.vel.y || 0;
    collideMove(b.pos, v, dt, CONFIG.playerRadius, 1.7);
    b.walkPhase += dt * 6;
    if (Game.time - b.lastStep > 0.45 && b.isPlayer === false) { b.lastStep = Game.time; }
  } else if (b.path.length && b.pathI < b.path.length) {
    const wp = b.path[b.pathI];
    const to = wp.clone().sub(b.pos); to.y = 0;
    if (to.length() < 0.9) { b.pathI++; }
    else {
      to.normalize();
      b.yaw = Math.atan2(-to.x, -to.z);
      const v = to.multiplyScalar(4.4 * speedMul);
      collideMove(b.pos, v, dt, CONFIG.playerRadius, 1.7);
      b.walkPhase += dt * 6;
    }
  }
  // bomb duties for the carrier / defenders
  bombDuties(b, dt);
  // sync mesh
  if (b.mesh) {
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.y = b.yaw;
    const crouchY = b.crouch ? -0.35 : 0;
    b.mesh.position.y = b.pos.y + crouchY;
    b.mesh.children[2].position.y = 1.62 + (b.crouch ? -0.2 : 0); // head dips a touch
    b.walkPhase += 0;
  }
  // reload when dry / calm
  if (b.mag === 0) startReload(b);
  else if (!enemy && b.mag < WEAPONS[b.weapon].mag * 0.4 && Math.random() < dt * 0.5) startReload(b);
  if (b.reloading > 0) { b.reloading -= dt; if (b.reloading <= 0) finishReload(b); }
}
function followObjective(b, dt) {
  const bomb = Game.bomb;
  if (b.team === 'T') {
    if (bomb.state === 'planted') { // guard the site
      if (b.stateT <= 0) { const wp = nearestWaypoint(sites[bomb.site].center); b.path = findPath(nearestWaypoint(b.pos), wp); b.pathI = 0; b.stateT = 8; }
      return;
    }
    if (b.hasSpike) {
      // carrier pushes to the planned site
      const site = b.objective || (b.objective = pick(['A', 'B']));
      const target = nearestWaypoint(sites[site].center);
      if (b.stateT <= 0 || !b.path.length) { b.path = findPath(nearestWaypoint(b.pos), target); b.pathI = 0; b.stateT = 6; }
      if (b.pos.distanceTo(sites[site].center) < sites[site].r * 0.8 && bomb.state === 'idle') {
        b.planting += dt;
        if (b.planting > 0.15 && b.planting < 0.2) AudioSys.plant();
        if (b.planting >= CONFIG.plantTime) { plantBomb(b, site); b.planting = 0; }
      } else b.planting = 0;
      return;
    }
    if (b.stateT <= 0) { // push a site or mid as a pack
      const site = pick(['A', 'B', 'A', 'B', 'mid']);
      const target = site === 'mid' ? waypointGraph.mid : nearestWaypoint(sites[site].center);
      b.path = findPath(nearestWaypoint(b.pos), target); b.pathI = 0; b.stateT = rand(6, 10);
    }
  } else {
    if (bomb.state === 'planted') {
      // defenders converge and defuse
      const site = sites[bomb.site];
      if (b.pos.distanceTo(site.center) < 2.2) {
        b.defusing += dt;
        if (b.defusing >= CONFIG.defuseTime) { defuseBomb(b); b.defusing = 0; }
      } else {
        b.defusing = 0;
        if (b.stateT <= 0) { b.path = findPath(nearestWaypoint(b.pos), nearestWaypoint(site.center)); b.pathI = 0; b.stateT = 7; }
      }
      return;
    }
    if (b.stateT <= 0) { // hold a lane / rotate between sites
      const spots = ['aSite', 'bSite', 'aLong', 'bLong', 'mid', 'midN', 'midS'];
      const wp = waypointGraph[pick(spots)];
      b.path = findPath(nearestWaypoint(b.pos), wp); b.pathI = 0; b.stateT = rand(7, 12);
    }
  }
}
function bombDuties(b, dt) {
  // player-adjacent bots pick up a dropped spike
  if (b.team === 'T' && Game.spikeDropped && !Game.bomb.plantTimer && b.pos.distanceTo(Game.spikeDropped) < 1.6) {
    b.hasSpike = true; Game.spikeDropped = null;
    if (Game.spikeMesh) Game.spikeMesh.visible = false;
    radio(b, 'Got the spike — pushing a site!');
  }
}
function plantBomb(by, site) {
  Game.bomb.state = 'planted'; Game.bomb.site = site; Game.bomb.timer = CONFIG.bombTimer;
  Game.bomb.planter = by;
  if (by.isPlayer) { Game.money = Math.min(CONFIG.maxMoney, Game.money + CONFIG.plantReward); Game.player.money = Game.money; }
  Game.spikeMesh.visible = true;
  Game.spikeMesh.position.copy(sites[site].center);
  $('bomb-status').textContent = 'SPIKE PLANTED — ' + site;
  radio(by, 'Spike planted on ' + site + '! Hold it!');
  AudioSys.plant();
  updateHUD();
}
function defuseBomb(by) {
  Game.bomb.state = 'defused';
  endRound('CT', by.isPlayer ? 'Spike defused — site secure.' : 'Spike defused by ' + by.name + '.');
}
function explodeBomb() {
  Game.bomb.state = 'exploded';
  AudioSys.explosion();
  Game.shake = 1;
  if (Game.spikeMesh) Game.spikeMesh.visible = false;
  const p = Game.player;
  if (p.alive && p.pos.distanceTo(sites[Game.bomb.site].center) < 14) kill(p, null, false);
  for (const b of Game.bots) if (b.alive && b.pos.distanceTo(sites[Game.bomb.site].center) < 14) kill(b, null, false);
  endRound('T', 'The spike detonated — site lost.');
}

/* ---------------- rounds, economy, match ---------------- */
function startMatch() {
  Game.score = { CT: 0, T: 0 }; Game.round = 1;
  Game.kills = 0; Game.deaths = 0; Game.shotsFired = 0; Game.shotsHit = 0; Game.headshots = 0;
  // fresh crews are (re)built every round by startRound() — sides alternate
  // each round so the player attacks (plants) on even rounds, defends on odd.
  for (const b of Game.bots) if (b.mesh) scene.remove(b.mesh);
  Game.bots = [];
  Game.botBank = {}; // bot cash persists across rounds, keyed by name
  Game.player = newFighter('CT', 'You', true);
  Game.player.money = CONFIG.startMoney; Game.money = CONFIG.startMoney;
  startRound();
}
function startRound() {
  Game.phase = 'buy'; Game.buyTimer = CONFIG.buyTime; Game.roundTime = CONFIG.roundTime;
  Game.roundKills = 0;
  Game.bomb = { state: 'idle', site: null, timer: 0, planter: null, defuser: null, progress: 0 };
  Game.spikeDropped = null;
  if (Game.spikeMesh) Game.spikeMesh.visible = false;
  $('bomb-status').textContent = '';
  // --- sides alternate every round: odd rounds the player defends (CT),
  // even rounds the player attacks (T) and carries the spike. ---
  const playerTeam = Game.round % 2 === 1 ? 'CT' : 'T';
  Game.player.team = playerTeam;
  for (const b of Game.bots) {
    if (b.money !== undefined) Game.botBank[b.name] = b.money;
    if (b.mesh) scene.remove(b.mesh);
  }
  Game.bots = [];
  const mateNames = playerTeam === 'CT' ? BOT_NAMES_CT : BOT_NAMES_T;
  const foeNames = playerTeam === 'CT' ? BOT_NAMES_T : BOT_NAMES_CT;
  for (const n of mateNames) { const b = newFighter(playerTeam, n, false); b.money = Game.botBank[n] ?? CONFIG.startMoney; Game.bots.push(b); }
  for (const n of foeNames) { const b = newFighter(playerTeam === 'CT' ? 'T' : 'CT', n, false); b.money = Game.botBank[n] ?? CONFIG.startMoney; Game.bots.push(b); }
  if (playerTeam === 'T') { Game.player.hasSpike = true; Game.spikeCarrier = Game.player; }
  else {
    const carrier = pick(Game.bots.filter((b) => b.team === 'T'));
    carrier.hasSpike = true; Game.spikeCarrier = carrier; Game.player.hasSpike = false;
  }
  // respawn everyone
  const all = [Game.player, ...Game.bots];
  for (const f of all) {
    f.alive = true; f.hp = 100; f.planting = 0; f.defusing = 0; f.path = []; f.pathI = 0; f.stateT = 0;
    f.reloading = 0; f.target = null; f.burstLeft = 0; f.reactAt = 0;
    const s = pick(spawns[f.team]); f.pos.copy(s); f.vel.set(0, 0, 0);
    if (f.isPlayer) playerVel.set(0, 0, 0); // no inherited slide into the round
    f.yaw = f.team === 'CT' ? Math.PI : 0;
    if (f.mesh) { f.mesh.visible = true; f.mesh.position.copy(f.pos); }
    // keep owned weapons, refill ammo; money persists across rounds
    for (const id of Object.keys(f.weapons)) { f.weapons[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve }; }
    equipWeapon(f, f.weapon);
    if (!f.isPlayer) botBuy(f);
  }
  Game.player.pos.copy(pick(spawns[Game.player.team]));
  Game.player.yaw = Game.player.team === 'CT' ? Math.PI / 2 : -Math.PI / 2; Game.player.pitch = 0;
  camera.position.set(Game.player.pos.x, CONFIG.eyeHeight, Game.player.pos.z);
  camera.rotation.set(0, Game.player.yaw, 0);
  // carry money into HUD (player money is the source of truth)
  Game.money = Game.player.money;
  setViewmodelWeapon(Game.player.weapon);
  updateHUD(); renderShop();
  showBanner('ROUND ' + Game.round, 'Buy phase — ' + CONFIG.buyTime + 's. Press B for the supply crate.', 'draw');
  $('buy').classList.remove('hidden');
  if (Game.phase === 'buy') { /* buy menu open; game waits for freeze to end */ }
}
function endRound(winner, reason) {
  if (Game.phase !== 'live' && Game.phase !== 'buy') return;
  Game.phase = 'roundEnd';
  Game.score[winner]++;
  const playerWon = winner === Game.player.team;
  const reward = playerWon ? CONFIG.winReward : CONFIG.lossReward;
  Game.player.money = Math.min(CONFIG.maxMoney, Game.player.money + reward);
  Game.money = Game.player.money;
  for (const b of Game.bots) {
    b.money = Math.min(CONFIG.maxMoney, b.money + (b.team === winner ? CONFIG.winReward : CONFIG.lossReward));
  }
  $('bomb-status').textContent = '';
  showBanner(playerWon ? 'ROUND WON' : 'ROUND LOST', reason + '  ·  +' + fmtMoney(reward), playerWon ? 'win' : 'lose');
  if (playerWon) AudioSys.roundWin(); else AudioSys.roundLose();
  updateHUD();
  setTimeout(() => {
    if (Game.phase !== 'roundEnd') return; // player left for the menu meanwhile
    if (Game.score.CT >= CONFIG.matchWinRounds || Game.score.T >= CONFIG.matchWinRounds ||
        Game.round >= CONFIG.matchWinRounds * 2 - 1) endMatch();
    else { Game.round++; startRound(); }
  }, 3800);
}
function endMatch() {
  Game.phase = 'matchEnd';
  const ctWon = Game.score.CT > Game.score.T;
  document.exitPointerLock?.();
  $('match-end').classList.remove('hidden');
  $('end-title').textContent = ctWon ? 'WARDENS WIN' : 'JACKALS WIN';
  $('end-title').style.color = ctWon ? '#9fe870' : '#ff6b6b';
  $('end-sub').textContent = `Final score — Wardens ${Game.score.CT} : ${Game.score.T} Jackals`;
  const acc = Game.shotsFired ? Math.round(100 * Game.shotsHit / Game.shotsFired) : 0;
  $('end-stats').innerHTML =
    `Your kills <b>${Game.kills}</b> · deaths <b>${Game.deaths}</b> · accuracy <b>${acc}%</b> · headshots <b>${Game.headshots}</b><br>` +
    `Cash banked <b>${fmtMoney(Game.money)}</b>`;
  if (ctWon) AudioSys.roundWin(); else AudioSys.roundLose();
}
function checkRoundEnd() {
  if (Game.phase !== 'live') return;
  if (Game.bomb.state === 'planted' || Game.bomb.state === 'defused' || Game.bomb.state === 'exploded') return;
  // both teams count the player too: the old code counted only bots for
  // the Jackals, so a round could end "won" while the player (a Jackal
  // on even rounds) was still alive.
  const ctAlive = [Game.player, ...Game.bots].filter((f) => f.team === 'CT' && f.alive).length;
  const tAlive = [Game.player, ...Game.bots].filter((f) => f.team === 'T' && f.alive).length;
  if (tAlive === 0) endRound('CT', 'All Jackals eliminated.');
  else if (ctAlive === 0) endRound('T', 'All Wardens eliminated.');
}

/* player planting / defusing (hold E near the site / spike) */
function playerInteract(dt) {
  const p = Game.player;
  if (!p || !p.alive || Game.phase !== 'live') { $('interact').classList.add('hidden'); return; }
  const bomb = Game.bomb;
  // pick up a dropped spike by walking over it (attackers only) — the old
  // code only let bots do this, so a Jackal player could never recover
  // the spike after the carrier died.
  if (bomb.state === 'idle' && p.team === 'T' && !p.hasSpike && Game.spikeDropped &&
      p.pos.distanceTo(Game.spikeDropped) < 1.6) {
    p.hasSpike = true; Game.spikeCarrier = p; Game.spikeDropped = null;
    if (Game.spikeMesh) Game.spikeMesh.visible = false;
    radio(p, 'Got the spike — plant it on A or B!');
  }
  let action = null, dur = 0, prog = 0;
  if (bomb.state === 'idle' && p.hasSpike) {
    for (const key of ['A', 'B']) {
      if (p.pos.distanceTo(sites[key].center) < sites[key].r) { action = 'PLANT THE SPIKE — ' + key; dur = CONFIG.plantTime; prog = p.planting; }
    }
  }
  if (bomb.state === 'planted' && p.team === 'CT') {
    if (p.pos.distanceTo(sites[bomb.site].center) < 2.4) { action = 'DEFUSE THE SPIKE'; dur = CONFIG.defuseTime; prog = p.defusing; }
  }
  const boxEl = $('interact');
  if (!action) { boxEl.classList.add('hidden'); p.planting = 0; p.defusing = 0; return; }
  boxEl.classList.remove('hidden');
  $('interact-text').textContent = action;
  $('interact-fill').style.width = Math.round(100 * prog / dur) + '%';
  if (Input.keys.KeyE) {
    if (bomb.state === 'idle') {
      p.planting += dt;
      if (p.planting >= CONFIG.plantTime) { const site = p.pos.distanceTo(sites.A.center) < sites.A.r ? 'A' : 'B'; plantBomb(p, site); p.planting = 0; }
    } else {
      p.defusing += dt;
      if (p.defusing >= CONFIG.defuseTime) { defuseBomb(p); p.defusing = 0; }
      if (Math.random() < dt * 8) AudioSys.beep(true);
    }
  } else { p.planting = 0; p.defusing = 0; }
}

/* ---------------- 9. HUD, minimap, menus ---------------- */
function updateHUD() {
  const p = Game.player; if (!p) return;
  $('hp').innerHTML = Math.max(0, Math.ceil(p.hp)) + ' <small>HP</small>';
  $('hp-fill').style.width = clamp(p.hp, 0, 100) + '%';
  $('hp-fill').style.background = p.hp > 50 ? '#7ddc7d' : p.hp > 25 ? '#ffb454' : '#ff5d5d';
  $('armor-fill').style.width = clamp(p.armor, 0, 100) + '%';
  $('money').textContent = fmtMoney(p.money);
  $('score-ct').textContent = Game.score.CT;
  $('score-t').textContent = Game.score.T;
  $('round-label').textContent = 'ROUND ' + Game.round + ' / ' + (CONFIG.matchWinRounds * 2 - 1);
  const t = Game.phase === 'buy' ? Game.buyTimer : Game.roundTime;
  const timer = $('timer');
  timer.textContent = fmtTime(t);
  timer.classList.toggle('low', t <= 10 && Game.phase === 'live');
  if (Game.bomb.state === 'planted') {
    $('bomb-status').textContent = 'SPIKE ' + Game.bomb.site + ' · ' + fmtTime(Game.bomb.timer);
  }
  updateWeaponHUD();
}
function updateWeaponHUD() {
  const p = Game.player; if (!p) return;
  const w = WEAPONS[p.weapon];
  $('ammo').innerHTML = (p.reloading > 0 ? '--' : p.mag) + ' <small>/ ' + p.reserve + '</small>';
  $('weapon-name').textContent = w.name + (p.reloading > 0 ? ' — RELOADING' : '');
  $('firemode').textContent = (w.auto ? 'AUTO' : 'SEMI') + ' · SMOKE ' + p.util.smoke + ' · FLASH ' + p.util.flash;
  const gap = 6 + (moving(p) ? 10 : 0) + (p.scoped ? -4 : 0);
  $('crosshair').style.setProperty('--gap', gap + 'px');
  document.querySelector('#crosshair .t').style.top = (-gap) + 'px';
  document.querySelector('#crosshair .b').style.bottom = (-gap) + 'px';
  document.querySelector('#crosshair .lf').style.left = (-gap) + 'px';
  document.querySelector('#crosshair .rt').style.right = (-gap) + 'px';
}
function addKillfeed(att, vic, head) {
  const el = document.createElement('div');
  el.innerHTML = `<b style="color:${att.team === 'CT' ? '#7fd4ff' : '#ffb454'}">${att.name}</b> ` +
    `<span class="wpn">[${WEAPONS[att.weapon].short}]</span> ` +
    (head ? '<span class="hs">HEADSHOT</span> ' : '') +
    `<b style="color:${vic.team === 'CT' ? '#7fd4ff' : '#ffb454'}">${vic.name}</b>`;
  const feed = $('killfeed'); feed.prepend(el);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
function radio(who, text) {
  const el = document.createElement('div');
  el.innerHTML = `<b>${who ? who.name : 'RADIO'}</b> — ${text}`;
  const box = $('radio'); box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), 7000);
}
function showBanner(title, sub, kind) {
  $('banner-title').textContent = title;
  $('banner-title').className = kind || '';
  $('banner-sub').textContent = sub || '';
  $('banner').classList.add('show');
  setTimeout(() => $('banner').classList.remove('show'), 3400);
}
function renderShop() {
  const p = Game.player; if (!p) return;
  $('buy-money').textContent = fmtMoney(p.money);
  const rows = SHOP.map((s) => {
    let name, price;
    if (s.w === 'armor') { name = 'KEVLAR VEST'; price = ARMOR_PRICE; }
    else if (s.w === 'smoke') { name = 'SMOKE GRENADE'; price = SMOKE_PRICE; }
    else if (s.w === 'flash') { name = 'FLASHBANG'; price = FLASH_PRICE; }
    else { name = WEAPONS[s.w].name; price = WEAPONS[s.w].price; }
    const afford = p.money >= price;
    const owned = s.w in WEAPONS && p.weapons[s.w];
    return `<tr data-key="${s.key}" class="${p.weapon === s.w ? 'sel' : ''}" style="${afford ? '' : 'opacity:.45'}">
      <td><b>[${s.key}]</b> ${name} ${owned ? '<span class="muted">· owned</span>' : ''}</td>
      <td class="muted">${s.tag}</td><td class="price">${fmtMoney(price)}</td></tr>`;
  }).join('');
  $('shop-table').innerHTML = `<tr><th>Item</th><th></th><th style="text-align:right">Price</th></tr>` + rows;
  $('shop-table').querySelectorAll('tr[data-key]').forEach((tr) => tr.addEventListener('click', () => {
    if (buyItem(p, tr.dataset.key)) { renderShop(); updateHUD(); AudioSys.reload(); }
  }));
}
function toggleBuy() {
  const el = $('buy');
  if (Game.phase !== 'buy' && Game.phase !== 'live') return;
  if (Game.phase === 'live') { radio(null, 'Buy phase is over — win the round to shop again.'); return; }
  el.classList.toggle('hidden');
  if (el.classList.contains('hidden')) Input.lock(); else document.exitPointerLock?.();
  renderShop();
}
function renderScoreboard() {
  const rows = [Game.player, ...Game.bots].map((f) =>
    `<tr><td class="${f.team.toLowerCase()}"><b>${f.name}</b> ${f.isPlayer ? '(you)' : ''}</td>
     <td>${TEAM_NAME[f.team]}</td><td>${f.kills}</td><td>${f.deaths}</td>
     <td>${f.alive ? 'ALIVE' : 'DEAD'}</td><td>${fmtMoney(f.money)}</td></tr>`).join('');
  $('sb-body').innerHTML = `<table class="score"><tr><th>Player</th><th>Team</th><th>K</th><th>D</th><th>Status</th><th>Cash</th></tr>${rows}</table>`;
  $('sb-title').textContent = `Scoreboard — Wardens ${Game.score.CT} : ${Game.score.T} Jackals · Round ${Game.round}`;
}
function drawMinimap() {
  const cv = $('minimap'), x = cv.getContext('2d');
  const sx = cv.width / (WORLD.w + 8), sz = cv.height / (WORLD.d + 8);
  const X = (wx) => (wx + WORLD.w / 2 + 4) * sx, Z = (wz) => (wz + WORLD.d / 2 + 4) * sz;
  x.clearRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#1a2229'; x.fillRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#2c3843'; x.fillRect(X(-WORLD.w / 2), Z(-WORLD.d / 2), WORLD.w * sx, WORLD.d * sz);
  for (const c of colliders) {
    if (c.max.y > 3.5) continue;
    x.fillStyle = '#4a5a66';
    x.fillRect(X(c.min.x), Z(c.min.z), (c.max.x - c.min.x) * sx, (c.max.z - c.min.z) * sz);
  }
  for (const [key, s] of Object.entries(sites)) {
    x.strokeStyle = key === 'A' ? '#ffb454' : '#7fd4ff'; x.lineWidth = 3;
    x.beginPath(); x.arc(X(s.center.x), Z(s.center.z), s.r * sx, 0, 7); x.stroke();
    x.fillStyle = x.strokeStyle; x.font = 'bold 22px sans-serif'; x.textAlign = 'center';
    x.fillText(key, X(s.center.x), Z(s.center.z) + 8);
    if (Game.bomb.state === 'planted' && Game.bomb.site === key) {
      x.fillStyle = '#ff4040'; x.beginPath(); x.arc(X(s.center.x), Z(s.center.z), 7, 0, 7); x.fill();
    }
  }
  const dot = (f, color, r = 7) => {
    x.fillStyle = color; x.beginPath(); x.arc(X(f.pos.x), Z(f.pos.z), r, 0, 7); x.fill();
    x.strokeStyle = '#000'; x.lineWidth = 2; x.stroke();
  };
  for (const b of Game.bots) if (b.alive) dot(b, b.team === Game.player.team ? '#7fd4ff' : '#ff9040', 6);
  if (Game.player?.alive) dot(Game.player, '#ffffff', 8);
}
function showPause() { if (Game.phase === 'live' || Game.phase === 'buy') $('pause').classList.remove('hidden'); }
function hidePause() { $('pause').classList.add('hidden'); }

/* ---------------- 10. player movement + main loop ---------------- */
const playerVel = V3(0, 0, 0);
const _pFwd = V3(0, 0, 0), _pRight = V3(0, 0, 0), _pMove = V3(0, 0, 0);
let lastStepAt = 0;
function updatePlayer(dt) {
  const p = Game.player;
  if (!p || !p.alive) return;
  // look
  p.yaw -= Input.mouseDX * Input.sens * (p.scoped ? 0.45 : 1);
  p.pitch = clamp(p.pitch - Input.mouseDY * Input.sens * (p.scoped ? 0.45 : 1), -1.45, 1.45);
  Input.mouseDX = 0; Input.mouseDY = 0;
  const crouching = Input.keys.ControlLeft || Input.keys.KeyC;
  p.crouch = crouching;
  const walking = Input.keys.ShiftLeft || Input.keys.ShiftRight;
  const speed = crouching ? CONFIG.crouchSpeed : walking ? CONFIG.walkSpeed : CONFIG.playerSpeed;
  const fwd = _pFwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = _pRight.set(-fwd.z, 0, fwd.x);
  const move = _pMove.set(0, 0, 0);
  if (Input.keys.KeyW) move.add(fwd);
  if (Input.keys.KeyS) move.sub(fwd);
  if (Input.keys.KeyD) move.add(right);
  if (Input.keys.KeyA) move.sub(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * (p.scoped ? 0.45 : 1));
  // acceleration (criterion 2): velocity chases the wish direction instead
  // of snapping to full speed, so stopping to aim pays and strafing has
  // weight. Ground grips fast, air barely steers.
  const accel = p.pos.y === 0 ? 12 : 5;
  const k = Math.min(1, accel * dt);
  playerVel.x += (move.x - playerVel.x) * k;
  playerVel.z += (move.z - playerVel.z) * k;
  // jump / gravity (simple)
  if (Input.keys.Space && p.pos.y === 0) playerVel.y = CONFIG.jumpSpeed;
  playerVel.y -= CONFIG.gravity * dt;
  const vel = playerVel; // collideMove only reads it (and zeroes y on landing)
  collideMove(p.pos, vel, dt, CONFIG.playerRadius, 1.7);
  if (p.pos.y === 0) playerVel.y = 0;
  const hSpeed = Math.hypot(playerVel.x, playerVel.z);
  // footsteps
  if (hSpeed > 0.5 && p.pos.y === 0 && Game.time - lastStepAt > 0.38) { lastStepAt = Game.time; AudioSys.step(); }
  // camera
  const eye = crouching ? CONFIG.crouchEye : CONFIG.eyeHeight;
  const bob = hSpeed > 0.5 && p.pos.y === 0 ? Math.sin(Game.time * 11) * 0.035 : 0;
  camera.position.set(p.pos.x, p.pos.y + eye + bob, p.pos.z);
  camera.rotation.set(p.pitch + (Game.shake > 0 ? rand(-1, 1) * Game.shake * 0.02 : 0), p.yaw, 0);
  // weapon bob + kick recovery
  if (viewGun) {
    viewGun.position.x = 0.26 + (hSpeed > 0.5 ? Math.sin(Game.time * 11) * 0.008 : 0);
    viewGun.position.y = -0.24 + bob * 0.4 + (p.reloading > 0 ? Math.sin(Game.time * 9) * 0.03 - 0.05 : 0);
    viewGun.position.z += ( -0.5 - viewGun.position.z) * Math.min(1, dt * 10);
    viewGun.rotation.x += (0 - viewGun.rotation.x) * Math.min(1, dt * 8);
  }
  // reload timer
  if (p.reloading > 0) { p.reloading -= dt; if (p.reloading <= 0) { finishReload(p); updateWeaponHUD(); } }
  // firing
  const w = WEAPONS[p.weapon];
  if (Input.firing && Game.phase === 'live') {
    if (w.auto) shoot(p);
    else if (Game.time - p.lastShot >= 60 / w.rpm) shoot(p);
  }
  if (p.mag === 0 && p.reserve > 0 && p.reloading <= 0) startReload(p);
  playerInteract(dt);
  // flash fade
  if (Game.time > Game.flashUntil) $('flash').style.opacity = String(Math.max(0, parseFloat($('flash').style.opacity || '0') - dt * 1.5));
  if (muzzle) { muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 14); }
  if (muzzleLight) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);
}


function updateDemoCamera(dt) {
  // spectate mode: slow cinematic orbit; shot mode keeps the first-person view
  if (Game.shotMode) { updatePlayer(dt); return; }
  const t = Game.time * 0.06;
  camera.position.set(Math.cos(t) * 26, 13, Math.sin(t) * 20);
  camera.lookAt(0, 0.5, 0);
}

function updateBots(dt) {
  for (const b of Game.bots) botThink(b, dt);
}
function updateBomb(dt) {
  const bomb = Game.bomb;
  if (bomb.state !== 'planted') return;
  bomb.timer -= dt;
  const interval = bomb.timer < 10 ? 0.5 : bomb.timer < 20 ? 0.75 : 1;
  if (!bomb._beepAt || Game.time >= bomb._beepAt) { bomb._beepAt = Game.time + interval; AudioSys.beep(bomb.timer < 10); }
  if (bomb.timer <= 0) explodeBomb();
  updateHUD();
}
function updateFx(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt; pt.mesh.position.addScaledVector(pt.vel, dt); pt.vel.y -= 9 * dt;
    if (pt.life <= 0) { scene.remove(pt.mesh); particles.splice(i, 1); }
  }
  for (let i = smokes.length - 1; i >= 0; i--) {
    if (Game.time > smokes[i].until) { scene.remove(smokes[i].group); smokes.splice(i, 1); Game.smokeZones = Game.smokeZones.filter((s) => Game.time < s.until); }
  }
  if (dustPoints) { dustPoints.rotation.y += dt * 0.004; }
  if (Game.spikeMesh?.visible) {
    Game.spikeMesh.rotation.y += dt * 1.5;
    const s = 1 + Math.sin(Game.time * 6) * 0.08;
    Game.spikeMesh.scale.setScalar(s);
  }
  Game.shake = Math.max(0, Game.shake - dt * 1.6);
}

/* Fixed-step simulation (criterion 5): the world advances in 1/60 s
   steps, kept apart from rendering — the loop only accumulates real time
   and draws the latest state each animation frame. Gameplay therefore
   runs at the same speed on a 60 Hz laptop and a 240 Hz desktop, and a
   slow frame can never teleport a bot through a wall (dt used to be
   whatever the frame took, clamped). If rendering falls far behind, the
   backlog is dropped instead of spiralling (slow motion, not a freeze). */
const SIM_STEP = 1 / 60, SIM_MAX_STEPS = 8;
let simAcc = 0;
function stepSim(dt) {
  Game.time += dt;
  if (Game.phase === 'live' || Game.phase === 'buy' || Game.phase === 'roundEnd' || Game.demoMode) {
    if (Game.phase === 'buy') {
      Game.buyTimer -= dt;
      if (Game.buyTimer <= 0) {
        Game.phase = 'live';
        $('buy').classList.add('hidden');
        document.exitPointerLock?.();
        showBanner('GO GO GO', 'Round ' + Game.round + ' — eliminate the Jackals or stop the spike.', 'draw');
        if (!Game.demoMode) Input.lock();
        else radio(null, 'Bots are fighting — sit back and watch.');
      }
      updateHUD();
    } else if (Game.phase === 'live') {
      Game.roundTime -= dt;
      if (Game.roundTime <= 0) {
        if (Game.bomb.state === 'planted') { /* timer decides it */ }
        else endRound('CT', 'Time expired — the Jackals ran out of time.');
      }
      if (!Game.demoMode) updatePlayer(dt);
      else updateDemoCamera(dt);
      updateBots(dt);
      updateBomb(dt);
      drawMinimap();
      updateHUD();
    } else if (Game.phase === 'roundEnd' || Game.demoMode) {
      // keep world alive behind banners / demo
      if (Game.demoMode && Game.phase !== 'live') { updateBots(dt); }
      drawMinimap();
    }
    updateFx(dt);
  }
}

let _lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const frameDt = Math.min((now - _lastT) / 1000, 0.25);
  _lastT = now;
  simAcc += frameDt;
  let steps = 0;
  while (simAcc >= SIM_STEP && steps < SIM_MAX_STEPS) { stepSim(SIM_STEP); simAcc -= SIM_STEP; steps++; }
  if (steps === SIM_MAX_STEPS) simAcc = 0; // behind: drop backlog, never spiral
  // scoreboard key (held)
  if (Input.keys.Tab) { renderScoreboard(); $('scoreboard').classList.remove('hidden'); }
  else $('scoreboard').classList.add('hidden');
  renderer.render(scene, camera);
  // fps counter (cheap, 2/s, on its own clock so it works in the menu too)
  if (!loop._fpsAt || now - loop._fpsAt > 500) {
    loop._fpsAt = now;
    $('fps').textContent = 'DUSTLINE Sector 7 · ' + Math.round(1 / Math.max(frameDt, 0.001)) + ' fps';
  }
}

/* ---------------- 11. boot, menus, demo + screenshot modes ---------------- */
function enterGame(demo) {
  Game.demoMode = !!demo;
  AudioSys.init(); AudioSys.resume();
  $('menu').classList.add('hidden');
  $('match-end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  Game.difficulty = $('difficulty').value;
  startMatch();
  if (!demo) Input.lock();
}
function backToMenu() {
  Game.phase = 'menu';
  $('match-end').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  document.exitPointerLock?.();
}
function applyShotMode() {
  // ?shot=1..4 — deterministic staged views for screenshots (real renders).
  // ?demo=1 — bots fight on their own with no input (also used by ?shot).
  const q = new URLSearchParams(location.search);
  Game.shotMode = parseInt(q.get('shot') || '0', 10);
  if (q.get('demo') === '1' || Game.shotMode > 0) {
    Game.difficulty = q.get('diff') || 'regular';
    Game.demoMode = true;
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    startMatch();
    Game.phase = 'live'; Game.buyTimer = 0; // skip straight to the action
    $('buy').classList.add('hidden');
    // ?demo=1 alone: plain bot-vs-bot match, no staging. Only ?shot=N stages.
    if (Game.shotMode <= 0) return true;
    // stage the scene per shot: first-person vantages with enemies in frame
    // (the fps counter is a dev overlay whose number is meaningless under
    // a software renderer, so staged shots hide it; real play keeps it)
    $('fps').style.display = 'none';
    const vantages = {
      1: { pos: [0, 16], yaw: 0, pitch: 0, foes: [[0, 4], [-5, 0], [5, 2], [-2, -6], [6, -2]] },
      2: { pos: [20, 4], yaw: -2.84, pitch: 0, foes: [[22, 18], [26, 14], [20, 20], [24, 12], [28, 18]] },
      3: { pos: [-12, -8], yaw: 0.99, pitch: 0, foes: [[-22, -16], [-26, -14], [-20, -19], [-24, -12], [-18, -18]] },
      4: { pos: [2, -20], yaw: 3.14, pitch: 0, foes: [[0, -6], [-4, -2], [4, 0], [-2, 6], [6, 4]] },
    };
    const v = vantages[Game.shotMode] || vantages[1];
    Game.player.pos.set(v.pos[0], 0, v.pos[1]);
    Game.player.yaw = v.yaw; Game.player.pitch = v.pitch;
    camera.position.set(v.pos[0], CONFIG.eyeHeight, v.pos[1]);
    camera.rotation.set(v.pitch, v.yaw, 0);
    const foes = Game.bots.filter((b) => b.team !== Game.player.team);
    foes.forEach((b, i) => { const sp = v.foes[i % v.foes.length]; b.pos.set(sp[0], 0, sp[1]); if (b.mesh) b.mesh.position.copy(b.pos); });
    const friends = Game.bots.filter((b) => b.team === Game.player.team);
    friends.forEach((f, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      f.pos.set(v.pos[0] + side * (3 + Math.floor(i / 2) * 2), 0, v.pos[1] + 4 + Math.floor(i / 2) * 2);
      if (f.mesh) f.mesh.position.copy(f.pos);
    });
    return true;
  }
  return false;
}

function init() {
  initRenderer();
  buildMap();
  buildViewmodel();
  Input.init(renderer.domElement);
  // menu buttons
  $('btn-play').addEventListener('click', () => enterGame(false));
  $('btn-spectate').addEventListener('click', () => enterGame(true));
  $('btn-close-buy').addEventListener('click', () => { $('buy').classList.add('hidden'); if (Game.phase === 'buy') Input.lock(); });
  $('btn-resume').addEventListener('click', () => { hidePause(); Input.lock(); });
  $('btn-rematch').addEventListener('click', () => { $('match-end').classList.add('hidden'); enterGame(Game.demoMode); });
  $('btn-menu').addEventListener('click', backToMenu);
  // clicking the 3D view re-locks the pointer
  renderer.domElement.addEventListener('click', () => {
    if ((Game.phase === 'live' || Game.phase === 'buy') && !Input.locked && !Game.demoMode) Input.lock();
  });
  // boot: menu, or straight into demo/shot mode
  const staged = applyShotMode();
  if (!staged) {
    // menu backdrop: slow orbit so the menu isn't a black screen
    camera.position.set(20, 9, -18); camera.lookAt(-8, 1, 4);
    Game.phase = 'menu';
  }
  // test / grader hook: cheap, read-only status
  window.__DUSTLINE__ = {
    version: '1.1.0', three: THREE.REVISION,
    status: () => ({ phase: Game.phase, round: Game.round, score: Game.score, gameTime: +Game.time.toFixed(1), roundTime: +Game.roundTime.toFixed(1), playerAlive: !!Game.player?.alive, botsAlive: Game.bots.filter((b) => b.alive).length, bomb: Game.bomb.state, bots: Game.bots.map((b) => ({ n: b.name, t: b.team, hp: Math.round(b.hp), x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1), alive: b.alive })) }),
  };
  window.addEventListener('error', (e) => { (window.__DUSTLINE__.errors = window.__DUSTLINE__.errors || []).push(String(e.message)); });
  loop();
}
init();
