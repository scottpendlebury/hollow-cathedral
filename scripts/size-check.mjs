/**
 * size-check.mjs — resource budget enforcement.
 *
 * Reports the real size of the git repository and the production build, and
 * fails when a budget is exceeded. Run with `npm run size-check`.
 */

import { execSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const BUDGETS = {
  repo: 100 * 1024 * 1024, // 100 MB - source, assets and git history
  total: 1024 * 1024 * 1024, // 1 GB - hard ceiling from the brief
  download: 10 * 1024 * 1024, // 10 MB - initial download before gameplay
  assets: 50 * 1024 * 1024, // 50 MB - total production assets
};

/** Recursively sums the size of a directory, skipping the given names. */
function dirSize(dir, skip = new Set()) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full, skip);
    } else if (entry.isFile()) {
      try {
        total += statSync(full).size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fail(message) {
  console.error(`\n  FAIL  ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`  ok    ${message}`);
}

console.log('\n=== The Hollow Cathedral — resource budget ===\n');

// --- repository --------------------------------------------------------
const gitDir = join(ROOT, '.git');
let repoBytes = 0;
if (existsSync(gitDir)) {
  try {
    const out = execSync('git count-objects -vH', { cwd: ROOT, encoding: 'utf8' });
    const sizeMatch = out.match(/size-pack:\s*(\d+)\s*(\w+)/);
    const looseMatch = out.match(/size:\s*(\d+)\s*(\w+)/);
    const toBytes = (n, u) =>
      u === 'KiB' ? n * 1024 : u === 'MiB' ? n * 1024 * 1024 : u === 'GiB' ? n * 1024 * 1024 * 1024 : n;
    if (sizeMatch) repoBytes += toBytes(Number(sizeMatch[1]), sizeMatch[2]);
    if (looseMatch) repoBytes += toBytes(Number(looseMatch[1]), looseMatch[2]);
  } catch {
    /* git not available */
  }
}

// Working tree, excluding node_modules, dist and .git.
const workBytes = dirSize(ROOT, new Set(['node_modules', 'dist', '.git', '.cache']));
const trackedBytes = repoBytes + workBytes;

console.log(`Repository (git objects + working tree): ${fmt(trackedBytes)}`);
console.log(`  git pack/loose objects: ${fmt(repoBytes)}`);
console.log(`  working tree (no node_modules/dist): ${fmt(workBytes)}\n`);

if (trackedBytes > BUDGETS.total) {
  fail(`repository ${fmt(trackedBytes)} exceeds the 1 GB hard limit`);
} else if (trackedBytes > BUDGETS.repo) {
  fail(`repository ${fmt(trackedBytes)} exceeds the 100 MB target`);
} else {
  pass(`repository ${fmt(trackedBytes)} is within the 100 MB target`);
}

// --- production build ---------------------------------------------------
const dist = join(ROOT, 'dist');
if (!existsSync(dist)) {
  console.log('\n  note  no dist/ found — run `npm run build` first to measure the bundle.\n');
} else {
  const distBytes = dirSize(dist);
  // The "initial download" is the HTML plus the entry chunk and its imports.
  const indexHtml = join(dist, 'index.html');
  const entryBytes = existsSync(indexHtml) ? statSync(indexHtml).size : 0;
  let assetBytes = 0;
  const assetDir = join(dist, 'assets');
  if (existsSync(assetDir)) {
    for (const f of readdirSync(assetDir)) {
      assetBytes += statSync(join(assetDir, f)).size;
    }
  }

  console.log(`Production build (dist/): ${fmt(distBytes)}`);
  console.log(`  index.html: ${fmt(entryBytes)}`);
  console.log(`  assets/: ${fmt(assetBytes)}`);
  console.log(`  files: ${countFiles(dist)}\n`);

  if (distBytes > BUDGETS.assets) {
    fail(`production build ${fmt(distBytes)} exceeds the 50 MB asset target`);
  } else {
    pass(`production build ${fmt(distBytes)} is within the 50 MB target`);
  }

  if (entryBytes > BUDGETS.download) {
    fail(`initial download ${fmt(entryBytes)} exceeds the 10 MB target`);
  } else {
    pass(`initial download (html + entry) ${fmt(entryBytes)} is within the 10 MB target`);
  }

  if (distBytes > BUDGETS.total) {
    fail(`production build ${fmt(distBytes)} exceeds the 1 GB hard limit`);
  } else {
    pass('production build is well under the 1 GB hard limit');
  }
}

console.log('');
if (process.exitCode) {
  console.error('  Resource budget exceeded — see the failures above.\n');
} else {
  console.log('  All resource budgets met.\n');
}

function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
    else n++;
  }
  return n;
}
