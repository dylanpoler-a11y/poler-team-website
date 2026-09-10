/* 1015 Stillwater — walkable interior tour.
 *
 * The model is a GLB built in Blender from the traced architectural plan set.
 * Walking is constrained by nav.json, which carries the same plan geometry the
 * model was built from: the polygons you may stand in, the voids you may not,
 * and the interior wall segments with the door gaps in them. That means walking
 * is exact rather than approximate -- no physics engine, no collision meshes.
 *
 * Coordinates: plan data is [X, Z] in FEET, +Z toward the waterfront, heights in
 * relative feet with 0 at the first-floor slab. Blender exported +Y-up, so
 *     three(x, y, z) = (X_ft, height_ft, -Z_ft) * FT
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Level } from './nav.js';

const FT = 0.3048;
const LEVEL_ORDER = ['understory', 'first', 'second'];
const EYE_LERP = 0.18;         // how quickly the eye settles to a new level
const WALK_FPS = 4.6;          // feet per second
const RUN_MULT = 2.1;
const LOOK_SENS = 0.0026;
const PITCH_LIMIT = Math.PI / 2 - 0.08;

const toScene = (x, z, h) => new THREE.Vector3(x * FT, h * FT, -z * FT);
const toPlan = (v) => [v.x / FT, -v.z / FT];

/* ------------------------------------------------------------------- scene */

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;

const scene = new THREE.Scene();
const HORIZON = 0xd9dfe0;   // haze the bay fades into
scene.fog = new THREE.Fog(HORIZON, 90, 620);

// Far planes must clear the sky dome (r=900) or the top of the sky clips to black
// -- which, seen through a floor-to-ceiling window, looks like a wall.
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2400);
const orbitCam = new THREE.PerspectiveCamera(38, 1, 0.5, 2400);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sun = new THREE.DirectionalLight(0xfff3e2, 1.9);
sun.position.set(-40, 70, 40);
scene.add(sun, new THREE.HemisphereLight(0xcfe2f2, 0x8a8578, 0.75));

/* Sky. A flat background colour reads as fog, not sky, and this house is mostly
 * glass pointed at the water -- what is behind the glass is half the picture.
 * A gradient dome costs one mesh and no texture payload. */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x5b86ad) },
      mid: { value: new THREE.Color(0xa8c4d6) },
      low: { value: new THREE.Color(HORIZON) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top, mid, low;
      void main(){
        float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = h < 0.5 ? mix(low, mid, smoothstep(0.34, 0.5, h))
                         : mix(mid, top, smoothstep(0.5, 0.86, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
);
sky.frustumCulled = false;
scene.add(sky);

const orbit = new OrbitControls(orbitCam, canvas);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI / 2.05;
orbit.enabled = false;

/* -------------------------------------------------------------------- state */

let lastRoom = '';

const state = {
  mode: 'walk',
  levels: [], byId: {}, level: null,
  yaw: Math.PI, pitch: -0.04,
  pos: { x: 12, z: 20 },
  eyeY: 0, targetEyeY: 0,
  keys: new Set(),
  goal: null, path: [], cut: null,
  floorMeshes: [], levelGroups: {}, roof: null, model: null,
  ready: false,
};

const el = {
  loading: document.getElementById('loading'),
  levels: document.getElementById('levels'),
  places: document.getElementById('places'),
  room: document.getElementById('room'),
  hint: document.getElementById('hint'),
  recenter: document.getElementById('recenter'),
  vert: document.getElementById('vert'),
  up: document.getElementById('go-up'),
  down: document.getElementById('go-down'),
  walk: document.getElementById('mode-walk'),
  orbit: document.getElementById('mode-orbit'),
};

/* Preset viewpoints, by level id and room name as they appear in the plan data. */
const PLACES = [
  { level: 'first',  room: 'Foyer',           yaw: 0 },
  { level: 'first',  room: 'Great Room',      yaw: 0 },
  { level: 'first',  room: 'Kitchen',         yaw: 0 },
  { level: 'first',  room: 'Family Room',     yaw: 0 },
  { level: 'second', room: 'Master Bedroom',  yaw: 0 },
  { level: 'second', room: 'Master Terrace',  yaw: 0 },
  { level: 'second', room: 'Bedroom #2',      yaw: Math.PI },
  { level: 'understory', room: 'Two Car Garage', yaw: Math.PI },
];
const START = { level: 'first', room: 'Great Room', yaw: 0 };

/* ------------------------------------------------------------------ loading */

async function boot() {
  const [nav, gltf] = await Promise.all([
    fetch('model/nav.json').then((r) => r.json()),
    new GLTFLoader().loadAsync('model/stillwater.glb'),
  ]);

  state.levels = nav.levels.map((l) => new Level(l));
  state.levels.forEach((l) => { state.byId[l.id] = l; });

  scene.add(gltf.scene);
  state.model = gltf.scene;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = true;
    const name = o.name.toLowerCase();
    for (const id of ['understory', 'first', 'second']) {
      if (name.endsWith(id) || name.includes('-' + id)) {
        (state.levelGroups[id] ||= []).push(o);
      }
    }
    if (name === 'roof') state.roof = o;
    if (name.startsWith('slab') || name.startsWith('site') || name.startsWith('pool')) {
      state.floorMeshes.push(o);
    }
    if (o.material && /^water/.test(o.material.name)) {
      o.material.roughness = 0.08;
      o.material.metalness = 0.55;   // picks up the environment so it moves
      o.material.envMapIntensity = 1.6;
    }
    if (o.material && o.material.name === 'glass') {
      o.material.transparent = true;
      o.material.opacity = 0.38;   // clear glass is invisible from inside; the
      o.material.color.setHex(0xbcd3d6);  // frames plus a tint make it read
      o.material.roughness = 0.04;
      o.material.metalness = 0;
      o.material.side = THREE.DoubleSide;
      o.material.depthWrite = false;
    }
  });

  buildChrome();
  goTo(START.level, START.room, START.yaw);
  frameOrbit();
  state.ready = true;
  el.loading.classList.add('gone');
  setTimeout(() => el.hint.classList.add('fade'), 9000);
}

function frameOrbit() {
  // Frame the building, not the site: the bay plate is ~550 m across and would
  // put the camera in orbit. (The old 1400 m ground plane did exactly this.)
  const box = new THREE.Box3();
  state.model.traverse((o) => {
    if (o.isMesh && !/^(site|bay|land|street)/.test(o.name)) {
      box.expandByObject(o);
    }
  });
  if (box.isEmpty()) box.setFromObject(state.model);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.5;
  orbit.target.copy(c);
  orbitCam.position.set(c.x + r * 1.3, c.y + r * 0.78, c.z + r * 1.5);
  orbit.update();
}

/* ---------------------------------------------------------------- interface */

function buildChrome() {
  for (const lv of state.levels) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = lv.label.split('/')[0].trim();
    b.dataset.level = lv.id;
    b.onclick = () => enterLevel(lv.id);
    el.levels.append(b);
  }
  for (const p of PLACES) {
    const lv = state.byId[p.level];
    if (!lv || !lv.rooms.some((r) => r.name === p.room)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.room;
    b.onclick = () => goTo(p.level, p.room, p.yaw);
    el.places.append(b);
  }
  el.up.onclick = () => changeLevel(1);
  el.down.onclick = () => changeLevel(-1);
  el.walk.onclick = () => setMode('walk');
  el.orbit.onclick = () => setMode('orbit');
  el.recenter.onclick = () => goTo(state.level.id, null);
}

/** Stairs and the elevator are the only way between levels while walking, so the
 *  prompt only shows when you are actually standing on one. */
function updateStairPrompt() {
  const lv = state.level;
  const on = lv.onStair(state.pos.x, state.pos.z);
  const i = LEVEL_ORDER.indexOf(lv.id);
  el.vert.hidden = !on;
  el.up.hidden = !on || i >= LEVEL_ORDER.length - 1;
  el.down.hidden = !on || i <= 0;
  if (on) {
    if (!el.up.hidden) el.up.textContent = 'Go up to ' + state.byId[LEVEL_ORDER[i + 1]].label.split('/')[0].trim();
    if (!el.down.hidden) el.down.textContent = 'Go down to ' + state.byId[LEVEL_ORDER[i - 1]].label.split('/')[0].trim();
  }
}

/** Step to the level above or below, landing on its stair. */
function changeLevel(dir) {
  const i = LEVEL_ORDER.indexOf(state.level.id) + dir;
  const next = state.byId[LEVEL_ORDER[i]];
  if (!next) return;
  const stair = next.stairs[0];
  if (stair) {
    const c = stair.reduce((a, p) => [a[0] + p[0] / stair.length, a[1] + p[1] / stair.length], [0, 0]);
    const cell = next.nearestCell(c);
    if (cell) { state.pos.x = cell[0] * 0.5; state.pos.z = cell[1] * 0.5; }
  }
  state.goal = null;
  state.path = [];
  enterLevel(next.id);
  announce(next.label.split('/')[0].trim());
}

function setMode(mode) {
  state.mode = mode;
  // "See the whole house" should show the whole house. Entering orbit resets the
  // cutaway to the top; the floor chips then slice down from there.
  if (mode === 'orbit') state.cut = LEVEL_ORDER[LEVEL_ORDER.length - 1];
  orbit.enabled = mode === 'orbit';
  el.walk.classList.toggle('on', mode === 'walk');
  el.orbit.classList.toggle('on', mode === 'orbit');
  el.places.style.display = mode === 'walk' ? '' : 'none';
  el.hint.classList.toggle('fade', mode !== 'walk');
  applyVisibility();
}

/** Orbit mode cuts away the levels above the one you picked; walking shows the
 *  whole building, because from inside you want a ceiling over your head. */
function applyVisibility() {
  const order = LEVEL_ORDER;
  const cutId = state.mode === 'orbit' && state.cut ? state.cut
              : (state.level ? state.level.id : 'first');
  const here = order.indexOf(cutId);
  const all = state.mode === 'walk';
  for (const id of order) {
    const visible = all || order.indexOf(id) <= here;
    (state.levelGroups[id] || []).forEach((m) => { m.visible = visible; });
  }
  if (state.roof) state.roof.visible = all || here >= order.length - 1;
}

function enterLevel(id) {
  const lv = state.byId[id];
  if (!lv) return;
  state.level = lv;
  state.cut = id;
  state.targetEyeY = lv.eye_ft;
  for (const b of el.levels.children) b.classList.toggle('on', b.dataset.level === id);
  if (!lv.standable(state.pos.x, state.pos.z)) goTo(id, null);
  applyVisibility();
}

function goTo(levelId, roomName, yaw) {
  const lv = state.byId[levelId];
  if (!lv) return;
  let target = null;
  if (roomName) target = lv.rooms.find((r) => r.name === roomName);
  if (!target) target = lv.rooms.find((r) => lv.standable(r.c[0], r.c[1])) || lv.rooms[0];
  if (!target) return;
  state.pos.x = target.c[0];
  state.pos.z = target.c[1];
  state.goal = null;
  state.path = [];
  state.eyeY = lv.eye_ft;
  if (yaw !== undefined) { state.yaw = yaw; state.pitch = -0.04; }
  enterLevel(levelId);
  setMode('walk');
  lastRoom = target.name;
  announce(target.name);
}

let announceTimer = null;
function announce(text) {
  el.room.textContent = text;
  el.room.classList.add('show');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => el.room.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------- input */

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  state.keys.add(e.code);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
    state.goal = null;
    state.path = [];
  }
});
addEventListener('keyup', (e) => state.keys.delete(e.code));
addEventListener('blur', () => state.keys.clear());

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'walk') return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  // A pointer can be gone by the time we get here (a flick, a synthetic
  // event); capture is an optimisation, not a requirement.
  try { canvas.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  state.yaw -= dx * LOOK_SENS;
  state.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch - dy * LOOK_SENS));
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const tap = drag.moved < 9;
  drag = null;
  canvas.classList.remove('dragging');
  if (tap && state.mode === 'walk') tapToWalk(e);
});
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });

const ray = new THREE.Raycaster();
function tapToWalk(e) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(state.floorMeshes, false);
  if (!hits.length) return;
  const [x, z] = toPlan(hits[0].point);
  const path = state.level.route([state.pos.x, state.pos.z], [x, z]);
  if (path && path.length > 1) { state.path = path.slice(1); state.goal = state.path.shift(); }
}

/* -------------------------------------------------------------------- loop */

let last = performance.now();


function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state.mode === 'orbit') {
    orbit.update();
    renderer.render(scene, orbitCam);
    return;
  }
  if (!state.ready) { renderer.render(scene, camera); return; }

  const k = state.keys;
  let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

  let speed = WALK_FPS * (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_MULT : 1);

  if (state.goal) {
    const gx = state.goal.x - state.pos.x, gz = state.goal.z - state.pos.z;
    const d = Math.hypot(gx, gz);
    if (d < 0.5) {
      state.goal = state.path.length ? state.path.shift() : null;
    } else {
      const step = Math.min(speed * dt, d);
      const moved = state.level.step(state.pos, (gx / d) * step, (gz / d) * step);
      if (moved) {
        state.pos = moved;
        // turn toward where we are going, but smoothly, so the view does not snap
        const want = Math.atan2(-gx, gz);
        let turn = ((want - state.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        state.yaw += turn * Math.min(1, dt * 5);
      } else { state.goal = null; state.path = []; }
    }
  } else if (fwd || strafe) {
    const len = Math.hypot(fwd, strafe) || 1;
    const s = (speed * dt) / len;
    // yaw 0 looks toward -Z in three space, which is +Z on the plan
    const sinY = Math.sin(state.yaw), cosY = Math.cos(state.yaw);
    const dx = (-sinY * fwd + cosY * strafe) * s;
    const dz = (-cosY * fwd - sinY * strafe) * s;
    const moved = state.level.step(state.pos, dx, -dz);
    if (moved) state.pos = moved;
  }

  updateStairPrompt();

  state.eyeY += (state.targetEyeY - state.eyeY) * EYE_LERP;
  camera.position.copy(toScene(state.pos.x, state.pos.z, state.eyeY));
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotation.order = 'YXZ';
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;

  const room = state.level.nearestRoom(state.pos.x, state.pos.z);
  if (room && room.name !== lastRoom) { lastRoom = room.name; announce(room.name); }

  el.recenter.hidden = state.level.standable(state.pos.x, state.pos.z);
  renderer.render(scene, camera);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  // A hidden or zero-height viewport makes the framebuffer incomplete and every
  // draw call for that frame fails; keep the last good size instead.
  if (w < 1 || h < 1) return;
  renderer.setSize(w, h, false);
  camera.aspect = orbitCam.aspect = w / h;
  camera.updateProjectionMatrix();
  orbitCam.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
requestAnimationFrame(tick);
boot().catch((err) => {
  console.error(err);
  el.loading.innerHTML = '<p>The model could not load. ' + err.message + '</p>';
});
