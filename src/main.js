/**
 * main.js — entry point.
 *
 * Boots the game, wires up the touch controls on mobile and reports any
 * fatal error to the player rather than leaving a black screen.
 */

import { Game } from './core/Game.js';
import { TouchControls } from './mobile/TouchControls.js';
import { loadSettings } from './ui/Settings.js';

const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

function setBootStatus(text) {
  if (bootStatus) bootStatus.textContent = text;
}

function hideBoot() {
  if (!boot) return;
  boot.classList.add('hidden');
  setTimeout(() => boot.remove(), 800);
}

function showFatal(message) {
  if (!boot) return;
  boot.classList.remove('hidden');
  boot.innerHTML = '';
  const h = document.createElement('h1');
  h.textContent = 'The Cathedral Remains Sealed';
  const p = document.createElement('p');
  p.className = 'err';
  p.textContent = message;
  boot.appendChild(h);
  boot.appendChild(p);
}

async function main() {
  setBootStatus('Raising the dead…');

  const app = document.getElementById('app');
  const uiRoot = document.getElementById('ui-root');
  if (!app) throw new Error('Missing #app container.');

  let game;
  try {
    game = new Game({ container: app, uiRoot });
    game.init();
  } catch (err) {
    console.error(err);
    showFatal(
      `${err && err.message ? err.message : 'Unknown error'}. ` +
        'This game needs WebGL. Try a different browser, or enable hardware acceleration.'
    );
    return;
  }

  // ---- mobile controls -------------------------------------------------
  const settings = loadSettings();
  if (TouchControls.isTouchDevice()) {
    setBootStatus('Binding the glass…');
    const controls = new TouchControls(document.body, {
      onMove: (x, y) => {
        game.input.setVirtualMove(x, y);
      },
      onButton: (action, down) => {
        game.input.setVirtualButton(action, down);
      },
      onPause: () => {
        if (game.state === 'playing') game.pause();
        else if (game.state === 'paused') game.resume();
      },
    });
    controls.setEnabled(false);
    game.touchControls = controls;

    // Mobile play never uses pointer lock; the canvas handles look instead.
    game.input.usingTouch = true;

    // The overlay is only live while the player is actually in the level.
    // Without this the on-screen controls exist but ignore every touch.
    // The body class lets the HUD stylesheet move the ammo readout clear
    // of the on-screen action cluster.
    document.body.classList.add('tc-active');

    const syncTouchControls = () => {
      const playing = game.state === 'playing';
      controls.setEnabled(playing);
      controls.setVisible(playing);
    };
    game.onStateChange = syncTouchControls;
    syncTouchControls();
  }

  // ---- start ------------------------------------------------------------
  game.startLoop();
  setTimeout(hideBoot, 260);

  // Expose for debugging and automated testing.
  window.__hollowCathedral = game;

  window.addEventListener('beforeunload', () => game.dispose());
}

main();
