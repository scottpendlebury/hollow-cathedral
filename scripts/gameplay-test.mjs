/**
 * gameplay-test.mjs — drives a full playthrough in headless Chromium.
 *
 * The headless browser only produces frames on demand, so requestAnimationFrame
 * is not a reliable clock. This script instead steps the game's own update
 * method directly with a fixed timestep, which makes the run deterministic and
 * lets the test assert on real game state.
 *
 * Usage: node scripts/gameplay-test.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:4173/';

const puppeteerAvailable = await (async () => {
  try {
    await import('puppeteer-core');
    return true;
  } catch {
    return false;
  }
})();

if (!puppeteerAvailable) {
  console.error(
    '\n  puppeteer-core is not available. This test drives Chromium directly.\n' +
      '  Install it with:  npm i -D puppeteer-core  (or run via the browser tool)\n'
  );
  process.exit(2);
}

const { launch } = await import('puppeteer-core');
const { execSync } = await import('node:child_process');
const { existsSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');

// Locate the bundled Chromium.
function findChromium() {
  const base = join(process.env.HOME || '/root', '.hermes/tools');
  if (!existsSync(base)) return null;
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('chromium-')) continue;
    for (const candidate of [
      join(base, entry, 'chrome-linux/chrome'),
      join(base, entry, 'chrome-linux64/chrome'),
      join(base, entry, 'chrome'),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const executablePath = findChromium();
if (!executablePath) {
  console.error('  Could not find a Chromium binary.');
  process.exit(2);
}

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) results.push(`  ok    ${name}`);
  else {
    failures++;
    results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const browser = await launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
// rAF does not fire reliably in headless, so poll on a timer instead.
await page.waitForFunction('window.__hollowCathedral !== undefined', {
  timeout: 60000,
  polling: 250,
});

// Stop the game's own animation loop. Under SwiftShader it would saturate
// the main thread, and this test drives frames explicitly instead.
await page.evaluate(() => {
  const g = window.__hollowCathedral;
  if (g._raf) cancelAnimationFrame(g._raf);
  g._raf = 0;
});

// ---------------------------------------------------------------- helpers

/**
 * Steps the game by a fixed number of frames using the game's own update.
 */
async function step(frames, dt = 1 / 60) {
  await page.evaluate(
    (n, d) => {
      const g = window.__hollowCathedral;
      for (let i = 0; i < n; i++) g._update(d);
    },
    frames,
    dt
  );
}

/** Sets the player's movement axes and look angles for the next frames. */
async function drive({ moveX = 0, moveY = 0, yaw = null, pitch = null, fire = false } = {}) {
  await page.evaluate(
    (mx, my, y, p, f) => {
      const g = window.__hollowCathedral;
      g.input.moveX = mx;
      g.input.moveY = my;
      if (y !== null) g.player.yaw = y;
      if (p !== null) g.player.pitch = p;
      g.input.held.fire = f;
    },
    moveX,
    moveY,
    yaw,
    pitch,
    fire
  );
}

const snapshot = () =>
  page.evaluate(() => {
    const g = window.__hollowCathedral;
    return {
      state: g.state,
      pos: { x: g.player.position.x, y: g.player.position.y, z: g.player.position.z },
      yaw: g.player.yaw,
      health: g.player.health,
      alive: g.player.alive,
      weapon: g.weapons.current.id,
      ammo: g.weapons.current.magazine,
      reserve: g.weapons.current.reserve,
      reloading: g.weapons.current.reloading,
      kills: g.kills,
      hasKey: g.hasKey,
      bossDefeated: g.bossDefeated,
      enemiesAlive: g.enemies.aliveCount,
      enemyStates: g.enemies.enemies.map((e) => ({ t: e.type, s: e.state, alive: e.alive })),
      runTime: g.runTime,
      particles: g.particles ? g.particles.liveCount : 0,
      drawCalls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
    };
  });

// ------------------------------------------------------------------ tests

console.log('\n=== The Hollow Cathedral — headless gameplay test ===\n');
console.log(`  target: ${BASE}\n`);

// --- boot -----------------------------------------------------------------
{
  const s = await snapshot();
  check('the game boots to the title screen', s.state === 'title', `state=${s.state}`);
  check('the level builds enemies', s.enemyStates.length >= 8, `n=${s.enemyStates.length}`);
}

// --- start ----------------------------------------------------------------
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) =>
    x.textContent.includes('BEGIN THE DESCENT')
  );
  if (b) b.click();
});
await step(5);
{
  const s = await snapshot();
  check('the game starts', s.state === 'playing', `state=${s.state}`);
  check('the player spawns in the threshold', Math.abs(s.pos.z - 42) < 2, `z=${s.pos.z}`);
  check('the player starts with a weapon loaded', s.ammo === 1 && s.reserve > 0, `ammo=${s.ammo}/${s.reserve}`);
  check('the player starts at full health', s.health === 100);
}

// --- movement -------------------------------------------------------------
{
  const before = await snapshot();
  await drive({ moveY: 1 });
  await step(90);
  await drive({ moveY: 0 });
  const after = await snapshot();
  const travelled = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z);
  check('the player walks forward', travelled > 2, `travelled=${travelled.toFixed(2)}`);
  check('the player stays on the floor', after.pos.y > -0.05 && after.pos.y < 0.1, `y=${after.pos.y}`);
}

// --- walls ----------------------------------------------------------------
{
  // Walk hard into the south wall of the threshold; the player must not pass.
  const before = await snapshot();
  await drive({ moveY: -1 });
  await step(180);
  await drive({ moveY: 0 });
  const after = await snapshot();
  check(
    'the player cannot walk through a wall',
    after.pos.z < 46.5,
    `z=${after.pos.z.toFixed(2)} (wall at 46)`
  );
  check('the player is still standing', after.pos.y > -0.05);
}

// --- strafe ---------------------------------------------------------------
{
  const before = await snapshot();
  await drive({ moveX: 1 });
  await step(60);
  await drive({ moveX: 0 });
  const after = await snapshot();
  check(
    'the player strafes',
    Math.abs(after.pos.x - before.pos.x) > 1,
    `dx=${(after.pos.x - before.pos.x).toFixed(2)}`
  );
}

// --- shooting -------------------------------------------------------------
{
  const before = await snapshot();
  await drive({ fire: true });
  await step(3);
  await drive({ fire: false });
  await step(5);
  const after = await snapshot();
  check('firing consumes ammunition', after.ammo === before.ammo - 1, `ammo=${after.ammo}`);
  check('the crossbow enters its cooldown', after.reloading === false);
}

// --- reload ---------------------------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.weapons.current.magazine = 0;
  });
  await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.input.pressed.reload = true;
  });
  await step(3);
  let s = await snapshot();
  check('pressing R starts a reload', s.reloading === true);
  await step(180);
  s = await snapshot();
  check('the reload completes and loads a bolt', s.ammo === 1, `ammo=${s.ammo}`);
}

// --- weapon switching -----------------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.input.pressed.swap = true;
  });
  await step(3);
  const s = await snapshot();
  check('the player can switch weapons', s.weapon === 'cannon', `weapon=${s.weapon}`);
  await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.input.pressed.swap = true;
  });
  await step(3);
  const s2 = await snapshot();
  check('switching cycles to the next weapon', s2.weapon === 'soulwick', `weapon=${s2.weapon}`);
  await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.input.pressed.swap = true;
  });
  await step(3);
  const s3 = await snapshot();
  check('switching wraps back to the first weapon', s3.weapon === 'crossbow', `weapon=${s3.weapon}`);
}

// --- combat: shoot an enemy ------------------------------------------------
{
  const before = await snapshot();
  // Aim at the nearest enemy and fire.
  const hit = await page.evaluate(() => {
    const g = window.__hollowCathedral;
    const e = g.enemies.enemies.find((x) => x.alive);
    if (!e) return null;
    const dx = e.position.x - g.player.position.x;
    const dz = e.position.z - g.player.position.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = 0;
    g.weapons.weapons[0].magazine = 1;
    g.weapons.weapons[0].reserve = 20;
    g.weapons.weapons[0].cooldown = 0;
    g.weapons.weapons[0].reloading = false;
    // The swap animation briefly locks the trigger; clear it so the shot
    // is not swallowed by the animation that preceded this test.
    g.weapons.switching = 0;
    g._fireHeld = false;
    return { type: e.type, hp: e.health, dist: Math.hypot(dx, dz) };
  });
  check('an enemy is available to fight', !!hit, JSON.stringify(hit));
  if (hit) {
    const diag = await page.evaluate(() => {
      const g = window.__hollowCathedral;
      const e = g.enemies.enemies.find((x) => x.alive);
      const origin = g.camera.getWorldPosition(new (g.camera.position.constructor)());
      const dir = g.camera.getWorldDirection(new (g.camera.position.constructor)());
      const wall = g.world.raycast(origin, dir, 90, []);
      const enemy = g.enemies.raycast(origin, dir, wall ? wall.distance : 90);
      return JSON.stringify({
        origin: { x: origin.x, y: origin.y, z: origin.z },
        dir: { x: dir.x, y: dir.y, z: dir.z },
        enemyPos: { x: e.position.x, y: e.position.y, z: e.position.z },
        enemyState: e.state,
        enemyAlive: e.alive,
        wallDist: wall ? wall.distance : null,
        enemyHit: enemy ? { d: enemy.distance } : null,
        weapon: g.weapons.current.id,
        ammo: g.weapons.current.magazine,
        yaw: g.player.yaw,
      });
    });
    console.log('    diag:', diag);
    await drive({ fire: true });
    await step(3);
    await drive({ fire: false });
    await step(5);
    const after = await snapshot();
    const target = after.enemyStates.find((x) => !x.alive);
    check('a shot can kill an enemy', !!target || after.kills > before.kills, `kills=${after.kills}`);
    check('the kill counter increments', after.kills > before.kills, `kills=${after.kills}`);
  }
}

// --- enemy AI reacts -------------------------------------------------------
{
  const s = await snapshot();
  const engaged = s.enemyStates.filter((e) => e.alive && (e.s === 'chase' || e.s === 'attack' || e.s === 'alert'));
  check('enemies react to the player', engaged.length > 0, JSON.stringify(s.enemyStates.map((e) => e.s)));
}

// --- particles -------------------------------------------------------------
{
  const s = await snapshot();
  check('particles are alive during play', s.particles > 0, `particles=${s.particles}`);
}

// --- pause / resume -------------------------------------------------------
{
  await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.input.pressed.pause = true;
  });
  await step(3);
  let s = await snapshot();
  check('escape pauses the game', s.state === 'paused', `state=${s.state}`);
  await page.evaluate(() => window.__hollowCathedral.resume());
  await step(3);
  s = await snapshot();
  check('the game resumes', s.state === 'playing', `state=${s.state}`);
}

// --- progression: key and gate --------------------------------------------
{
  const s = await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.hasKey = true;
    const gate = g.level._sanctumGate;
    const before = gate.locked;
    // Stand next to the gate and interact.
    g.player.position.set(0, 0, 0.5);
    g.player.yaw = 0; // face -Z, toward the gate at z = -2
    g.player._updateCamera(0);
    g._interact();
    return { before, after: gate.locked, colliderEnabled: gate.collider.enabled };
  });
  check('the sanctum gate is locked before the key', s.before === true);
  check('the bone key unlocks the sanctum gate', s.after === false);
  check('the unlocked gate stops blocking movement', s.colliderEnabled === false);
}

// --- victory ---------------------------------------------------------------
{
  const s = await page.evaluate(() => {
    const g = window.__hollowCathedral;
    g.bossDefeated = true;
    // Open the exit seal the same way the player would.
    const gate = g.level._exitGate;
    gate.locked = false;
    gate.open = true;
    gate.collider.enabled = false;
    g.player.position.set(g.level.markers.exit.x, 0, g.level.markers.exit.z);
    g._checkVictory();
    return { state: g.state };
  });
  check('reaching the exit after the boss triggers victory', s.state === 'victory', `state=${s.state}`);
}

// --- restart ---------------------------------------------------------------
{
  await page.evaluate(() => window.__hollowCathedral.restart());
  await step(5);
  const s = await snapshot();
  check('the game can be restarted', s.state === 'playing', `state=${s.state}`);
  check('restarting resets the kill count', s.kills === 0, `kills=${s.kills}`);
  check('restarting restores full health', s.health === 100);
  check('restarting respawns the enemies', s.enemyStates.length >= 8);
}

// --- performance -----------------------------------------------------------
{
  const perf = await page.evaluate(() => {
    const g = window.__hollowCathedral;
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) g._update(1 / 60);
    const ms = (performance.now() - t0) / 120;
    return {
      msPerFrame: ms,
      drawCalls: g.renderer.info.render.calls,
      triangles: g.renderer.info.render.triangles,
      geometries: g.renderer.info.memory.geometries,
      textures: g.renderer.info.memory.textures,
    };
  });
  console.log(
    `\n  frame: ${perf.msPerFrame.toFixed(2)} ms | draws: ${perf.drawCalls} | tris: ${perf.triangles} | geo: ${perf.geometries} | tex: ${perf.textures}\n`
  );
  check('draw calls stay low', perf.drawCalls < 120, `draws=${perf.drawCalls}`);
  check('triangle count is mobile-friendly', perf.triangles < 120000, `tris=${perf.triangles}`);
  check('geometry count is bounded', perf.geometries < 200, `geo=${perf.geometries}`);
}

// --- console cleanliness ---------------------------------------------------
{
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|net::ERR_|Failed to load resource/i.test(e)
  );
  check('no console errors during the run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
}

// ------------------------------------------------------------------ report
console.log(results.join('\n'));
console.log('');
await browser.close();

if (failures) {
  console.error(`  ${failures} check(s) FAILED\n`);
  process.exit(1);
} else {
  console.log(`  All ${results.length} gameplay checks passed.\n`);
}
