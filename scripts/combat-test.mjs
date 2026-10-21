/**
 * combat-test.mjs — verifies the combat maths without a browser.
 *
 * Checks the enemy raycast against analytic ground truth, the weapon damage
 * model, the enemy AI state machine and the projectile system.
 */

import { JSDOM } from './vendor/jsdom-shim.mjs';

const dom = new JSDOM();
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0 },
  configurable: true,
  writable: true,
});
globalThis.localStorage = dom.window.localStorage;

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) results.push(`  ok    ${name}`);
  else {
    failures++;
    results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const THREE = await import('three');
const { CollisionWorld, Box } = await import('../src/core/Physics.js');
const { createMaterials } = await import('../src/core/Textures.js');
const { EnemyManager } = await import('../src/entities/Enemies.js');
const { WeaponSystem } = await import('../src/entities/Weapons.js');
const { ProjectileSystem } = await import('../src/entities/Projectiles.js');

const materials = createMaterials();
const scene = new THREE.Scene();
const world = new CollisionWorld(4);
// A flat floor and a wall 20m to the east.
world.add(new Box(-50, -2, -50, 50, 0, 50, 'floor'));
world.add(new Box(-50, 0, -20, 50, 10, -19, 'wall')); // a wall to the north

// ---------------------------------------------------------------------------
console.log('\n=== Enemy raycast ===');

const em = new EnemyManager({
  scene,
  world,
  materials,
  audio: null,
  particles: null,
});

{
  // An enemy directly in front, 10m away, dead centre of the view.
  const e = em.spawn('husk', new THREE.Vector3(0, 0, -10), [new THREE.Vector3(0, 0, -10)]);
  const origin = { x: 0, y: 1.2, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const hit = em.raycast(origin, dir, 50);
  check('a ray aimed at an enemy hits it', !!hit, hit ? `d=${hit.distance}` : 'no hit');
  check('the hit distance is correct', hit && Math.abs(hit.distance - 9.5) < 0.6, `d=${hit && hit.distance}`);
  check('the hit names the right enemy', hit && hit.enemy === e);
}

{
  // A ray aimed well above the enemy should miss.
  const miss = em.raycast({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0.6, z: -0.8 }, 50);
  check('a ray above the enemy misses', !miss, miss ? `d=${miss.distance}` : 'missed');
}

{
  // A ray pointed the wrong way should miss.
  const miss = em.raycast({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 }, 50);
  check('a ray pointing away misses', !miss);
}

{
  // A wall in front of the enemy should win. Clear the arena first so the
  // only candidate is the one behind the wall.
  em.clear();
  const blocked = em.spawn('husk', new THREE.Vector3(0, 0, -30), [new THREE.Vector3(0, 0, -30)]);
  const origin = { x: 0, y: 1.2, z: 0 };
  const dir = { x: 0, y: 0, z: -1 };
  const wall = world.raycast(origin, dir, 50, []);
  const hit = em.raycast(origin, dir, wall ? wall.distance : 50);
  check('a wall in front of an enemy blocks the shot', !hit, hit ? `hit at ${hit.distance}` : 'blocked');
  check(
    'the wall is detected at the right distance',
    wall && Math.abs(wall.distance - 19) < 0.5,
    `d=${wall && wall.distance}`
  );
  blocked.damage(9999, origin);
}

{
  // A dead enemy must not be hittable.
  const dead = em.spawn('husk', new THREE.Vector3(5, 0, -10), [new THREE.Vector3(5, 0, -10)]);
  dead.damage(9999, { x: 5, y: 1, z: 0 });
  const hit = em.raycast({ x: 5, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 50);
  check('a dead enemy cannot be shot', !hit);
}

em.clear();

// ---------------------------------------------------------------------------
console.log('\n=== Weapon damage model ===');

{
  // A weapon system wired to the enemy manager, firing at a real enemy.
  const em2 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const e = em2.spawn('husk', new THREE.Vector3(0, 0, -10), [new THREE.Vector3(0, 0, -10)]);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
  camera.position.set(0, 1.5, 0);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(0); // look down -Z
  camera.updateMatrixWorld(true);

  const player = { viewModel: new THREE.Group(), velocity: new THREE.Vector3() };
  let hitInfo = null;
  const ws = new WeaponSystem({
    materials,
    player,
    camera,
    world,
    audio: null,
    particles: null,
    enemies: em2,
    onHit: (point, normal, damage, weapon, didHit, enemyHit) => {
      hitInfo = { didHit, enemyHit };
      if (enemyHit) enemyHit.enemy.damage(damage, camera.position);
    },
  });

  ws.weapons[0].magazine = 1;
  ws.weapons[0].cooldown = 0;
  ws.weapons[0].reloading = false;
  const hpBefore = e.health;
  ws.tryFire();

  check('firing at an enemy reports an enemy hit', !!(hitInfo && hitInfo.enemyHit), hitInfo ? 'no enemy hit' : 'none');
  check('firing damages the enemy', e.health < hpBefore, `hp=${e.health} from ${hpBefore}`);
  check(
    'the crossbow (58 damage) kills a 55 hp husk',
    !e.alive,
    `hp=${e.health}`
  );

  // The Game layer's onHit callback must forward the enemyHit argument.
  // If it does not, the trace resolves but no damage is ever applied, which
  // is invisible in every other test. This asserts the whole chain.
  {
    const emX = new EnemyManager({ scene, world, materials, audio: null, particles: null });
    const eX = emX.spawn('husk', new THREE.Vector3(0, 0, -10), [new THREE.Vector3(0, 0, -10)]);
    const camX = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    camX.position.set(0, 1.2, 0);
    camX.rotation.set(0, 0, 0);
    camX.updateMatrixWorld(true);
    const playerX = { viewModel: new THREE.Group(), velocity: new THREE.Vector3() };

    // Mirror the Game's own callback shape exactly.
    let receivedEnemyHit = null;
    const wsX = new WeaponSystem({
      materials,
      player: playerX,
      camera: camX,
      world,
      audio: null,
      particles: null,
      enemies: emX,
      onHit: (point, normal, damage, weapon, didHit, enemyHit) => {
        receivedEnemyHit = enemyHit;
        if (!didHit || !enemyHit) return;
        enemyHit.enemy.damage(damage, camX.position);
      },
    });
    wsX.weapons[0].magazine = 1;
    wsX.weapons[0].cooldown = 0;
    const hpX = eX.health;
    wsX.tryFire();
    check('the onHit callback receives the enemyHit argument', !!receivedEnemyHit, String(receivedEnemyHit));
    check('damage reaches the enemy through the callback', eX.health < hpX, `hp=${eX.health} from ${hpX}`);
    emX.clear();
  }

  // A tougher target takes the full hit without dying.
  const em2b = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const knight = em2b.spawn('knight', new THREE.Vector3(0, 0, -10), [new THREE.Vector3(0, 0, -10)]);
  camera.position.set(0, 1.2, 0);
  camera.rotation.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  const hpKnight = knight.health;
  const ws2 = new WeaponSystem({
    materials,
    player,
    camera,
    world,
    audio: null,
    particles: null,
    enemies: em2b,
    onHit: (p, n, d, w, didHit, enemyHit) => {
      if (enemyHit) enemyHit.enemy.damage(d, camera.position);
    },
  });
  ws2.weapons[0].magazine = 1;
  ws2.weapons[0].cooldown = 0;
  ws2.tryFire();
  check(
    'the crossbow deals its full 58 damage to a tougher target',
    Math.abs(hpKnight - knight.health - 58) < 0.001,
    `dealt=${hpKnight - knight.health}`
  );
  em2b.clear();
  em2.clear();
}

{
  // The hand cannon should be lethal to a husk.
  const em3 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const e = em3.spawn('husk', new THREE.Vector3(0, 0, -10), [new THREE.Vector3(0, 0, -10)]);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
  camera.position.set(0, 1.5, 0);
  camera.rotation.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  const player = { viewModel: new THREE.Group(), velocity: new THREE.Vector3() };
  const ws = new WeaponSystem({
    materials,
    player,
    camera,
    world,
    audio: null,
    particles: null,
    enemies: em3,
    onHit: (p, n, d, w, didHit, enemyHit) => {
      if (enemyHit) enemyHit.enemy.damage(d, camera.position);
    },
  });
  ws.select(1);
  ws.switching = 0; // the swap animation briefly blocks the trigger
  ws.weapons[1].magazine = 1;
  ws.weapons[1].cooldown = 0;
  ws.tryFire();
  check('the hand cannon kills a husk in one shot', !e.alive, `hp=${e.health}`);
  em3.clear();
}

// ---------------------------------------------------------------------------
console.log('\n=== Enemy AI ===');

{
  const em4 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const e = em4.spawn('husk', new THREE.Vector3(0, 0, 0), [new THREE.Vector3(0, 0, 0)]);
  const player = { position: new THREE.Vector3(0, 0, -8), alive: true, height: 1.8 };

  // The player is in the open, so the enemy notices them at once.
  e.update(1 / 60, player);
  const initialState = e.state;
  check('an enemy reacts to a visible player', initialState === 'alert', `state=${initialState}`);

  // Give it time to notice and reach the player.
  for (let i = 0; i < 300; i++) e.update(1 / 60, player);
  check('an enemy notices the player', e.state !== 'idle', `state=${e.state}`);
  check(
    'an enemy closes on the player',
    e.position.distanceTo(player.position) < 6,
    `d=${e.position.distanceTo(player.position).toFixed(2)}`
  );
  check('an enemy stays on the floor', e.position.y > -0.05 && e.position.y < 0.1, `y=${e.position.y}`);

  // It should eventually attack.
  let attacked = false;
  const origAttack = e.onAttack;
  e.onAttack = (dmg, from) => {
    attacked = true;
    if (origAttack) origAttack(dmg, from);
  };
  for (let i = 0; i < 400 && !attacked; i++) e.update(1 / 60, player);
  check('an enemy attacks the player', attacked, `state=${e.state}`);
  em4.clear();
}

{
  // The archer should keep its distance rather than walking into the player.
  const em5 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const e = em5.spawn('archer', new THREE.Vector3(0, 0, 0), [new THREE.Vector3(0, 0, 0)]);
  const player = { position: new THREE.Vector3(0, 0, -14), alive: true, height: 1.8 };
  for (let i = 0; i < 400; i++) e.update(1 / 60, player);
  const d = e.position.distanceTo(player.position);
  check('an archer keeps its distance', d > 4, `d=${d.toFixed(2)}`);
  em5.clear();
}

{
  // The knight is tougher than a husk.
  const em6 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const k = em6.spawn('knight', new THREE.Vector3(0, 0, 0), [new THREE.Vector3(0, 0, 0)]);
  const h = em6.spawn('husk', new THREE.Vector3(3, 0, 0), [new THREE.Vector3(3, 0, 0)]);
  check('the knight has more health than a husk', k.maxHealth > h.maxHealth, `${k.maxHealth} vs ${h.maxHealth}`);
  check('the knight deals more damage than a husk', k.stats.damage > h.stats.damage);
  check('the knight is slower than a husk', k.stats.chaseSpeed < h.stats.chaseSpeed);
  em6.clear();
}

{
  // A boss is tougher still.
  const em7 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const boss = em7.spawn('knight', new THREE.Vector3(0, 0, 0), [new THREE.Vector3(0, 0, 0)], { boss: true });
  check('a boss has more health than a normal knight', boss.maxHealth > 300, `hp=${boss.maxHealth}`);
  em7.clear();
}

// ---------------------------------------------------------------------------
console.log('\n=== Projectiles ===');

{
  const ps = new ProjectileSystem({ scene, world, materials, audio: null, particles: null });
  const em8 = new EnemyManager({ scene, world, materials, audio: null, particles: null });
  const e = em8.spawn('husk', new THREE.Vector3(0, 0, -12), [new THREE.Vector3(0, 0, -12)]);
  const player = { position: new THREE.Vector3(0, 0, 0), alive: true, height: 1.8 };

  let hitEnemy = false;
  ps.spawn({
    origin: new THREE.Vector3(0, 1.2, 0),
    target: new THREE.Vector3(0, 1.2, -12),
    speed: 20,
    damage: 30,
    hostile: false,
    onHit: (point, normal, p, hitPlayer, enemy) => {
      if (enemy) hitEnemy = true;
    },
  });
  for (let i = 0; i < 60; i++) ps.update(1 / 60, player, em8.enemies);
  check('a soul projectile can hit an enemy', hitEnemy);
  em8.clear();
  ps.clear();
}

// ---------------------------------------------------------------------------
console.log('\n=== Result ===');
console.log(results.join('\n'));
console.log('');
if (failures) {
  console.error(`  ${failures} check(s) FAILED\n`);
  process.exit(1);
} else {
  console.log(`  All ${results.length} combat checks passed.\n`);
}
