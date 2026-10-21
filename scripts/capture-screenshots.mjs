/**
 * capture-screenshots.mjs — renders the documentation screenshots.
 *
 * Drives headless Chromium through the level and writes a set of stills to
 * docs/screenshots. Run with the preview server up:
 *
 *   npm run build && npm run preview
 *   node scripts/capture-screenshots.mjs
 */

import { launch } from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;

function findChromium() {
  const base = join(process.env.HOME || '/root', '.hermes/tools');
  if (!existsSync(base)) return null;
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('chromium-')) continue;
    for (const candidate of [
      join(base, entry, 'chrome-linux/chrome'),
      join(base, entry, 'chrome-linux64/chrome'),
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
mkdirSync(OUT, { recursive: true });

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
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__hollowCathedral !== undefined', {
  timeout: 60000,
  polling: 250,
});

// Stop the animation loop; the script drives frames explicitly.
await page.evaluate(() => {
  const g = window.__hollowCathedral;
  if (g._raf) cancelAnimationFrame(g._raf);
  g._raf = 0;
});

/** Renders one frame at a given pose and writes it to disk. */
async function shot(name, setup) {
  await page.evaluate((s) => {
    const g = window.__hollowCathedral;
    if (s.start) {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.textContent.includes('BEGIN THE DESCENT')
      );
      if (b) b.click();
    }
    // Enemies are pinned after every update. Their AI otherwise walks them
    // into the camera during the warm-up, and the shot ends up being a face
    // full of teeth rather than a scene.
    const pinEnemies = () => {
      if (!s.enemies) return;
      const live = g.enemies.enemies.filter((e) => e.alive);
      const byType = {};
      live.forEach((e) => {
        if (!byType[e.type]) byType[e.type] = e;
      });
      const heroes = [byType.husk, byType.archer, byType.knight].filter(Boolean);
      const spots = s.spots || [
        [-2.6, 3.4],
        [0.5, 2.2],
        [2.9, 3.6],
      ];

      // Park everyone else well down the nave, out of frame.
      live.forEach((e, i) => {
        if (heroes.includes(e)) return;
        e.position.set(-4 + (i % 3) * 4, 0, 24 + Math.floor(i / 3) * 2.5);
        e.velocity.set(0, 0, 0);
      });

      heroes.forEach((e, i) => {
        const spot = spots[i] || spots[0];
        e.position.set(spot[0], 0, spot[1]);
        e.velocity.set(0, 0, 0);
        // Face the camera, which sits back along +Z from the group.
        e.yaw = Math.PI + (spot[0] > 0 ? 0.16 : spot[0] < 0 ? -0.16 : 0);
      });
    };
    pinEnemies();
    if (s.weapon !== undefined) {
      g.weapons.select(s.weapon);
      g.weapons.switching = 0;
    }
    if (s.pause) g.pause();

    const frames = s.warm || 22;
    for (let i = 0; i < frames; i++) {
      if (s.pos) {
        g.player.position.set(s.pos[0], s.pos[1], s.pos[2]);
        g.player.yaw = s.yaw;
        g.player.pitch = s.pitch || 0;
      }
      g._update(1 / 60);
      pinEnemies();
    }
    if (s.pos) {
      g.player.position.set(s.pos[0], s.pos[1], s.pos[2]);
      g.player.yaw = s.yaw;
      g.player.pitch = s.pitch || 0;
    }
    g._update(1 / 60);
    pinEnemies();
    g._update(1 / 60);
  }, setup);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('  wrote', name);
}

await shot('00-title', { start: false });
await shot('01-nave', { start: true, pos: [0, 0, 28], yaw: 0, pitch: -0.03 });
await shot('02-saint', { pos: [0, 0, 23.5], yaw: 0, pitch: 0.05 });
await shot('03-ossuary', { pos: [-15, 0, 10], yaw: 1.62 });
await shot('04-apse', { pos: [0, 0, -3.5], yaw: 0, pitch: -0.01 });
await shot('05-combat', { enemies: true, pos: [0, 0, 9.2], yaw: 0, pitch: -0.02, warm: 26 });
await shot('06-cannon', { weapon: 1, pos: [0, 0, 20], yaw: 0, pitch: -0.02 });
await shot('07-soulwick', { weapon: 2, pos: [0, 0, 20], yaw: 0, pitch: -0.02 });
await shot('08-pause', { pause: true });

// --- Mobile ---------------------------------------------------------------
// A landscape phone, with the touch controls shown.
const mobile = await browser.newPage();
await mobile.setViewport({
  width: 844,
  height: 390,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await mobile.setUserAgent(
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
);
await mobile.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await mobile.waitForFunction('window.__hollowCathedral !== undefined', {
  timeout: 60000,
  polling: 250,
});
await mobile.evaluate(() => {
  const g = window.__hollowCathedral;
  if (g._raf) cancelAnimationFrame(g._raf);
  g._raf = 0;
  const b = [...document.querySelectorAll('button')].find((x) =>
    x.textContent.includes('BEGIN THE DESCENT')
  );
  if (b) b.click();
  for (let i = 0; i < 24; i++) {
    g.player.position.set(0, 0, 9.2);
    g.player.yaw = 0;
    g.player.pitch = -0.02;
    g._update(1 / 60);
  }
});
await mobile.screenshot({ path: join(OUT, 'm5-touch-landscape.png') });
console.log('  wrote m5-touch-landscape');

await browser.close();
console.log('\n  Screenshots written to docs/screenshots/\n');
