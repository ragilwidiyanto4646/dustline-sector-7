/* ============================================================================
   DUSTLINE // Sector 7 — world.js
   The renderer, the lights, the sky, the map and the collision model.
   Everything solid in the yard registers an axis-aligned collider here;
   movement (main.js), bullets (combat.js) and bot sight (ai.js) all read
   the same colliders, so a wall that blocks a bot also stops a bullet.

   Hot-path note (criterion 5): losBlocked() used to allocate a fresh
   THREE.Raycaster and two throwaway vectors on every call — and botThink
   calls it once per visible foe, per bot, per fixed step. It now reuses
   one module-level raycaster and one scratch direction, so the sight
   check allocates nothing at all.
   ========================================================================== */
import * as THREE from 'three';
import { $, V3, clamp, rand } from './util.js';
import { Game } from './state.js';
import { TEX, buildTextures, makeTextSprite } from './textures.js';

export let renderer, scene, camera, sunLight, dustPoints;
export const WORLD = { w: 64, d: 48 }; // playable yard, x in [-32,32], z in [-24,24]

export function initRenderer() {
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

/* ---------------- colliders + map ---------------- */
/* Colliders are axis-aligned boxes: {min:Vector3, max:Vector3}. */
export const colliders = [];
export const shootables = []; // meshes raycast can hit (walls, crates) — for impact FX
export function addCollider(cx, cz, w, h, d, y0 = 0) {
  colliders.push({ min: V3(cx - w / 2, y0, cz - d / 2), max: V3(cx + w / 2, y0 + h, cz + d / 2) });
}
export function box(w, h, d, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = opts.shadow !== false; m.receiveShadow = true;
  scene.add(m); return m;
}
function makeMat(tex, color = 0xffffff, rough = 0.9) {
  return new THREE.MeshStandardMaterial({ map: tex, color, roughness: rough, metalness: 0.04 });
}

export const sites = {
  A: { name: 'A — FOUNDRY', center: V3(-24, 0, -17), r: 5.5 },
  B: { name: 'B — DEPOT', center: V3(24, 0, 17), r: 5.5 },
};
export const spawns = {
  CT: [V3(26, 0, -19), V3(28, 0, -16), V3(24, 0, -20), V3(28, 0, -21), V3(22, 0, -17)],
  T: [V3(-27, 0, 19), V3(-29, 0, 16), V3(-25, 0, 21), V3(-29, 0, 21), V3(-23, 0, 18)],
};
export let waypointGraph = {}; // id -> {pos, links:[ids]}
export function buildMap() {
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

export function buildDust() {
  const n = 350, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rand(-32, 32); pos[i * 3 + 1] = rand(0.2, 7); pos[i * 3 + 2] = rand(-24, 24); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustPoints = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8d9b0, size: 0.09, transparent: true, opacity: 0.55 }));
  scene.add(dustPoints);
}

/* Waypoint graph: nodes on open lanes, bots pathfind with BFS. */
export function buildWaypoints() {
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
export function nearestWaypoint(p) {
  let best = null, bd = 1e9;
  for (const w of Object.values(waypointGraph)) { const d = w.pos.distanceToSquared(p); if (d < bd) { bd = d; best = w; } }
  return best;
}
export function findPath(from, to) { // BFS over waypoint graph, returns array of Vector3
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
export function collideMove(pos, vel, dt, radius, height) {
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

/* Scratch state for losBlocked: one raycaster and one direction, reused
   by every sight check in the game, so the check allocates nothing. */
const _losRay = new THREE.Raycaster();
const _losDir = V3(0, 0, 0);
export function losBlocked(a, b) { // is the line of sight between two points blocked by a collider?
  _losDir.copy(b).sub(a);
  const len = _losDir.length();
  if (len < 1e-6) return false;
  _losDir.normalize();
  _losRay.set(a, _losDir); _losRay.far = len;
  if (_losRay.intersectObjects(shootables, false).length) return true;
  // also test AABB slabs directly (thin walls are meshes too, but be thorough)
  for (const c of colliders) {
    const t = rayIntersectBox(a, _losDir, c);
    if (t !== null && t < len) return true;
  }
  return false;
}
export function rayIntersectBox(o, d, c) {
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
