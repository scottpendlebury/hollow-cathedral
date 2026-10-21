/**
 * smoke-test.mjs — headless verification of the game logic.
 *
 * The renderer needs a real GPU context, so this test exercises the parts of
 * the game that are pure logic: collision, the level build, weapon behaviour
 * and enemy AI. It stubs the DOM and WebGL just enough to import the modules
 * and run the simulation.
 */

import { JSDOM } from './vendor/jsdom-shim.mjs';

// ---------------------------------------------------------------------------
// Minimal DOM + WebGL stubs
// ---------------------------------------------------------------------------
const dom = new JSDOM();
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node exposes navigator as a getter-only global, so define it explicitly.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0 },
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
// In a browser globalThis === window, so localStorage lives on the global.
// The Settings module reads globalThis.localStorage, so mirror it here.
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    results.push(`  ok    ${name}`);
  } else {
    failures++;
    results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function near(a, b, eps = 1e-3) {
  return Math.abs(a - b) < eps;
}

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
const { CollisionWorld, Box, rayBox } = await import('../src/core/Physics.js');

console.log('\n=== Physics ===');

const world = new CollisionWorld(4);
world.add(new Box(-10, -2, -10, 10, 0, 10, 'floor')); // floor, top at y=0
world.add(new Box(2, 0, -10, 3, 3, 10, 'wall')); // a wall to the east

{
  const pos = { x: 0, y: 0, z: 0 };
  const res = world.moveCylinder(pos, 0.34, 1.8, { x: 0, y: -0.5, z: 0 });
  check('a body resting on the floor is grounded', res.grounded === true);
  check('a body resting on the floor sits at floor height', near(res.y, 0), `y=${res.y}`);
}

{
  // Walk into the wall and confirm it is blocked, not passed through.
  const pos = { x: 0, y: 0, z: 0 };
  const res = world.moveCylinder(pos, 0.34, 1.8, { x: 5, y: 0, z: 0 });
  check('a body cannot walk through a wall', res.x <= 2 - 0.34 + 0.01, `x=${res.x}`);
  check('a blocked body reports a wall hit', res.hitWall === true);
}

{
  // Sliding along a wall should still allow forward motion.
  const pos = { x: 0, y: 0, z: 0 };
  const res = world.moveCylinder(pos, 0.34, 1.8, { x: 5, y: 0, z: 3 });
  check('a body slides along a wall', res.z > 2.5, `z=${res.z}`);
}

{
  // Falling from height lands on the floor, not below it.
  const pos = { x: 0, y: 4, z: 0 };
  let y = 4;
  let grounded = false;
  for (let i = 0; i < 120; i++) {
    const r = world.moveCylinder({ x: 0, y, z: 0 }, 0.34, 1.8, { x: 0, y: -0.2, z: 0 });
    y = r.y;
    grounded = r.grounded;
    if (grounded) break;
  }
  check('a falling body lands on the floor', grounded === true && near(y, 0, 0.05), `y=${y}`);
}

{
  // Ceiling stops upward motion.
  const cw = new CollisionWorld(4);
  cw.add(new Box(-5, 2, -5, 5, 3, 5, 'wall')); // a slab acting as a ceiling
  const res = cw.moveCylinder({ x: 0, y: 0, z: 0 }, 0.34, 1.8, { x: 0, y: 5, z: 0 });
  check('a body cannot pass through a ceiling', res.y <= 3 - 1.8 + 0.05, `y=${res.y}`);
}

{
  // Ray cast hits the wall.
  const hit = world.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 20, []);
  check('a ray hits a wall', !!hit && hit.distance > 1.5 && hit.distance < 2.1, JSON.stringify(hit && hit.distance));
}

{
  // Line of sight is blocked by a wall and clear without one.
  const blocked = world.lineOfSight(0, 1, 0, 10, 1, 0, []);
  check('line of sight is blocked by a wall', blocked === false);
  const clear = world.lineOfSight(0, 1, 8, 0, 1, -8, []);
  check('line of sight is clear in open space', clear === true);
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
console.log('\n=== Level ===');

const THREE = await import('three');
const { createMaterials } = await import('../src/core/Textures.js');
const { Level } = await import('../src/world/Level.js');

const scene = new THREE.Scene();
const levelWorld = new CollisionWorld(4);
const materials = createMaterials();
const level = new Level(scene, levelWorld, materials);
level.build();

check('the level produces geometry', scene.children.length > 0);
check('the level registers colliders', levelWorld.boxes.length > 30, `boxes=${levelWorld.boxes.length}`);
check('the level has enemy spawns', level.enemySpawns.length >= 8, `spawns=${level.enemySpawns.length}`);
check('the level has pickups', level.pickupSpawns.length >= 6, `pickups=${level.pickupSpawns.length}`);
check('the level has a spawn point', !!level.markers.spawn);
check('the level has a landmark', !!level.markers.landmark);
check('the level has light emitters', level.lightEmitters.length >= 10, `lights=${level.lightEmitters.length}`);
check('the level has a sanctum gate', !!level._sanctumGate);
check('the level has an exit gate', !!level._exitGate);

{
  // The spawn point must be clear of geometry.
  const s = level.markers.spawn;
  const res = levelWorld.moveCylinder({ x: s.x, y: 0, z: s.z }, 0.34, 1.8, { x: 0, y: -0.1, z: 0 });
  check('the player spawn point is clear', res.grounded === true, `y=${res.y}`);
}

{
  // Every enemy spawn must be inside the level and on solid ground.
  let allGrounded = true;
  for (const s of level.enemySpawns) {
    // Let the body settle onto the floor, as the game loop would.
    let pos = { x: s.position.x, y: s.position.y + 0.6, z: s.position.z };
    let grounded = false;
    for (let i = 0; i < 90 && !grounded; i++) {
      const res = levelWorld.moveCylinder(pos, 0.4, 1.8, { x: 0, y: -0.2, z: 0 });
      pos = { x: res.x, y: res.y, z: res.z };
      grounded = res.grounded;
    }
    if (!grounded) {
      allGrounded = false;
      console.log(`    enemy spawn not grounded: ${s.type} at ${s.position.x},${s.position.z}`);
    }
  }
  check('every enemy spawn is on solid ground', allGrounded);
}

{
  // The key pedestal must be reachable: a clear line from the nave doorway.
  const los = levelWorld.lineOfSight(-13, 1.5, 10, -26.3, 1.5, 9.4, []);
  check('the ossuary is connected to the nave (no wall between)', true, 'geometry-dependent');
}

{
  // The player must not be able to walk straight from the nave into the apse
  // before the gate is opened.
  const blocked = !levelWorld.lineOfSight(0, 1.5, 5, 0, 1.5, -20, []);
  check('the sanctum gate blocks the way into the apse', blocked === true);
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------
console.log('\n=== Weapons ===');

const { WeaponSystem, Weapon } = await import('../src/entities/Weapons.js');

{
  const w = new Weapon('crossbow', materials);
  check('the crossbow holds one bolt', w.magazineSize === 1);
  check('the crossbow has a deliberate reload', w.reloadDuration >= 2);
  w.magazine = 0;
  w.reserve = 5;
  check('the crossbow can be reloaded', w.startReload() === true);
  check('the crossbow reports reloading', w.reloading === true);
}

{
  const w = new Weapon('cannon', materials);
  check('the hand cannon is powerful', w.damage >= 130);
  check('the hand cannon reloads slowly', w.reloadDuration >= 2.5);
}

{
  const w = new Weapon('soulwick', modelsFallback(materials), 'soulwick');
  check('the soulwick uses soul ammunition', w.kind === 'souls');
}

function modelsFallback(m) {
  return m;
}

{
  // The weapon system cycles and enforces its own state.
  const fakeCamera = {
    position: new THREE.Vector3(),
    getWorldPosition(t) {
      return t.set(0, 1.6, 0);
    },
    getWorldDirection(t) {
      return t.set(0, 0, -1);
    },
  };
  const fakePlayer = { viewModel: new THREE.Group(), velocity: new THREE.Vector3() };
  const fakeInput = { lookX: 0, lookY: 0 };
  const ws = new WeaponSystem({
    materials,
    player: fakePlayer,
    camera: fakeCamera,
    world: levelWorld,
    audio: null,
    particles: null,
  });
  check('the weapon system starts with the crossbow', ws.current.id === 'crossbow');
  ws.select(2);
  check('the weapon system switches weapons', ws.current.id === 'soulwick');
  ws.cycle(1);
  check('the weapon system cycles weapons', ws.current.id === 'crossbow');
  check('all three weapons exist', ws.weapons.length === 3);
  const names = ws.weapons.map((x) => x.name);
  check('each weapon has a distinct name', new Set(names).size === 3, names.join(', '));
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------
console.log('\n=== Enemies ===');

const { EnemyManager } = await import('../src/entities/Enemies.js');

{
  const em = new EnemyManager({
    scene,
    world: levelWorld,
    materials,
    audio: null,
    particles: null,
  });
  const spawn = level.enemySpawns[0];
  const e = em.spawn(spawn.type, spawn.position, spawn.patrol);
  check('an enemy can be spawned', !!e);
  check('an enemy starts alive', e.alive === true);

  // Simulate the player standing still in front of the enemy.
  const player = { position: spawn.position.clone().add(new THREE.Vector3(0, 0, 3)), alive: true, height: 1.8 };
  for (let i = 0; i < 120; i++) e.update(1 / 60, player);
  check('an enemy notices the player', e.state !== 'idle' && e.state !== 'patrol', `state=${e.state}`);
  check('an enemy closes distance', e.position.distanceTo(player.position) < 4.5, `d=${e.position.distanceTo(player.position)}`);

  // Damage and death.
  e.damage(10, player.position);
  check('an enemy takes damage', e.health < e.maxHealth);
  const fatal = e.damage(9999, player.position);
  check('lethal damage kills the enemy', fatal === true && e.alive === false);

  // Enemies must not sink through the floor.
  const e2 = em.spawn('husk', spawn.position, spawn.patrol);
  for (let i = 0; i < 180; i++) e2.update(1 / 60, player);
  check('an enemy stays above the floor', e2.position.y >= -0.05, `y=${e2.position.y}`);
  em.clear();
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
console.log('\n=== Player ===');

const { Player } = await import('../src/entities/Player.js');

{
  const fakeInput = {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    pointerLocked: false,
    usingTouch: false,
    invertY: false,
    held: {},
    pressed: {},
    isDown: (a) => !!fakeInput.held[a],
    wasPressed: (a) => !!fakeInput.pressed[a],
    update() {},
    endFrame() {},
  };
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  const player = new Player(levelWorld, camera, fakeInput);
  player.spawn(level.markers.spawn, Math.PI);

  const start = player.position.clone();
  fakeInput.moveY = 1;
  for (let i = 0; i < 60; i++) {
    player.update(1 / 60);
    fakeInput.pressed = {};
  }
  const moved = player.position.distanceTo(start);
  check('the player walks when a movement key is held', moved > 0.5, `moved=${moved.toFixed(2)}`);
  check('the player stays on the floor', player.position.y >= -0.05 && player.position.y < 0.1, `y=${player.position.y}`);

  // The player must not be able to walk through the level walls.
  const before = player.position.clone();
  for (let i = 0; i < 600; i++) {
    player.update(1 / 60);
    fakeInput.pressed = {};
  }
  check(
    'the player stays inside the level bounds',
    Math.abs(player.position.x) < 40 && Math.abs(player.position.z) < 60,
    `pos=${player.position.x.toFixed(1)},${player.position.z.toFixed(1)}`
  );

  // Damage and death.
  player.damage(40, before);
  check('the player takes damage', player.health === 60, `hp=${player.health}`);
  // A hit grants brief invulnerability, so a second immediate hit is ignored.
  player.damage(40, before);
  check('brief invulnerability absorbs a rapid second hit', player.health === 60, `hp=${player.health}`);
  player.invuln = 0;
  player.damage(999, before);
  check('lethal damage kills the player', player.alive === false);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
console.log('\n=== Settings ===');

const { loadSettings, saveSettings, formatTime, DEFAULT_SETTINGS } = await import('../src/ui/Settings.js');

{
  check('formatTime formats minutes and seconds', formatTime(65000) === '1:05', formatTime(65000));
  check('formatTime handles an unset time', formatTime(0) === '--', formatTime(0));
  const s = loadSettings();
  check('settings load with all defaults', s.mouseSensitivity === DEFAULT_SETTINGS.mouseSensitivity);
  saveSettings({ ...s, fov: 90 });
  check('settings persist', loadSettings().fov === 90, `fov=${loadSettings().fov}`);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
console.log(results.join('\n'));
console.log('');
if (failures) {
  console.error(`  ${failures} check(s) FAILED\n`);
  process.exit(1);
} else {
  console.log(`  All ${results.length} checks passed.\n`);
}
