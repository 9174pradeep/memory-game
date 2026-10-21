'use strict';

/**
 * scripts/resilience-test.js
 * --------------------------
 * Two extra frontend checks that need browser automation:
 *
 *   A. Keyboard play - Tab moves focus onto the cards and Enter / Space flip
 *      them (the cards are real <button> elements).
 *   B. Offline resilience - every /api/* request is blocked inside the browser.
 *      The game must still start, still be playable and must show friendly
 *      messages instead of crashing.
 *
 * Usage (the server must be running):
 *   node scripts/resilience-test.js [url]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE_URL = process.argv[2] || 'http://localhost:3000';
const DEBUG_PORT = Number(process.env.DEBUG_PORT) || 9334;

let passed = 0;
let failed = 0;

function check(label, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${extra ? ` -> ${extra}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns the WebSocket implementation to use.
 *
 * Node.js only ships a global `WebSocket` from v22 onwards, but the project
 * supports Node 18+, so the `ws` package is used as a fallback.
 * @returns {Function}
 */
function getWebSocket() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }
  try {
    return require('ws');
  } catch (err) {
    throw new Error(
      'No WebSocket implementation found. Use Node.js 22+ or run "npm install" to get the "ws" package.',
      { cause: err }
    );
  }
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const WebSocketImpl = getWebSocket();
      this.ws = new WebSocketImpl(this.wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('WebSocket error')));
      this.ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && this.pending.has(message.id)) {
          const { resolve: res, reject: rej } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) rej(new Error(message.error.message));
          else res(message.result);
          return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
          const d = message.params.exceptionDetails || {};
          this.consoleErrors.push(d.text || 'Uncaught exception');
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
          this.consoleErrors.push(
            message.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
          );
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout for ${method}`));
        }
      }, 90000);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    }
    return result.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch (err) {
      /* ignore */
    }
  }
}

/**
 * Locates a Chrome / Chromium / Edge binary on Windows, macOS or Linux.
 * Set the CHROME_PATH environment variable to override the detection.
 * @returns {string|null}
 */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function waitForDebugger() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (err) {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome debugger did not start in time.');
}

/**
 * Sends a raw key event to the page.
 * @param {Cdp} cdp
 * @param {string} key
 * @param {string} code
 * @param {number} windowsVirtualKeyCode
 */
async function pressKey(cdp, key, code, windowsVirtualKeyCode, text) {
  const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

(async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome/Edge binary found - skipping the resilience test.');
    process.exitCode = 0;
    return;
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-chrome2-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;

  try {
    const wsUrl = await waitForDebugger();
    cdp = new Cdp(wsUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    // ================= A. KEYBOARD PLAY =================
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(1600);

    await cdp.evaluate(`
      const input = document.getElementById('player-name');
      input.value = 'KeyBot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('input[name="difficulty"][value="easy"]').checked = true;
      document.getElementById('start-form').requestSubmit();
      await new Promise(r => setTimeout(r, 400));

      // Pick two cards with DIFFERENT emojis, so the pair is a mismatch and
      // neither card gets locked (a matched pair would become disabled).
      const cards = [...document.querySelectorAll('.card')];
      const first = cards[0];
      const second = cards.find(c => c !== first && c.dataset.emoji !== first.dataset.emoji);
      first.focus();
      window.__keyFirst = first.dataset.index;
      window.__keySecond = second.dataset.index;
      return true;
    `);

    const focused = await cdp.evaluate(`
      return { tag: document.activeElement.tagName, cls: document.activeElement.className };
    `);
    check('Cards are focusable (real <button> elements)', focused.tag === 'BUTTON' && focused.cls.includes('card'), JSON.stringify(focused));

    // Enter flips the focused card.
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    await sleep(250);
    const afterEnter = await cdp.evaluate(`
      const card = document.activeElement;
      return { flipped: card.classList.contains('is-flipped'), label: card.getAttribute('aria-label') };
    `);
    check('Enter flips the focused card', afterEnter.flipped === true, JSON.stringify(afterEnter));
    check('The flipped card announces its face', /card showing/i.test(afterEnter.label), JSON.stringify(afterEnter));

    // Space flips the second (different) card.
    await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      cards.find(c => c.dataset.index === window.__keySecond).focus();
      return true;
    `);
    await pressKey(cdp, ' ', 'Space', 32, ' ');
    await sleep(250);
    const afterSpace = await cdp.evaluate(`
      const card = document.activeElement;
      return { flipped: card.classList.contains('is-flipped'), label: card.getAttribute('aria-label') };
    `);
    check('Space flips the focused card', afterSpace.flipped === true, JSON.stringify(afterSpace));

    // Tab moves focus to the next card. The board must be free of locked
    // (disabled) cards first, so wait for the mismatch to resolve.
    await sleep(1500);
    await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      cards.find(c => c.dataset.index === window.__keyFirst).focus();
      return true;
    `);
    await pressKey(cdp, 'Tab', 'Tab', 9);
    await sleep(200);
    const afterTab = await cdp.evaluate(`
      const active = document.activeElement;
      return { isCard: active.classList.contains('card'), index: active.dataset.index };
    `);
    check('Tab moves focus to the next card', afterTab.isCard === true, JSON.stringify(afterTab));

    // The accessibility label tells the player what is on the card.
    const aria = await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      const card = cards.find(c => c.dataset.index === window.__keyFirst);
      return { label: card.getAttribute('aria-label'), role: card.tagName };
    `);
    check('Cards expose an accessible label', /hidden card|card showing|matched/i.test(aria.label), JSON.stringify(aria));
    check('Cards are exposed as buttons', aria.role === 'BUTTON', JSON.stringify(aria));

    // ================= B. OFFLINE RESILIENCE =================
    // Block every API call, then reload the page.
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/*'] });
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(2200);

    const offline = await cdp.evaluate(`
      const leaderboardText = document.getElementById('leaderboard-list').textContent;
      const statsHidden = document.getElementById('stats-bar').hidden;

      // The game must still start and be playable.
      const input = document.getElementById('player-name');
      input.value = 'OfflineBot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('start-form').requestSubmit();
      await new Promise(r => setTimeout(r, 400));

      const cards = [...document.querySelectorAll('.card')];
      cards[0].click();
      await new Promise(r => setTimeout(r, 120));
      cards[1].click();
      await new Promise(r => setTimeout(r, 250));

      const moves = document.getElementById('hud-moves').textContent;
      const gameVisible = !document.getElementById('screen-game').hidden;

      // Wait for the mismatch animation to finish so the board is free again.
      await new Promise(r => setTimeout(r, 1200));
      return {
        leaderboardText: leaderboardText.trim().slice(0, 90),
        statsHidden,
        cardCount: cards.length,
        moves,
        gameVisible,
      };
    `);
    check('Leaderboard shows a friendly message when the API is down', /unavailable/i.test(offline.leaderboardText), JSON.stringify(offline));
    check('Stats bar hides when the API is down', offline.statsHidden === true, JSON.stringify(offline));
    check('Game is fully playable without the API', offline.cardCount === 12 && offline.moves === '1' && offline.gameVisible, JSON.stringify(offline));

    const saveOffline = await cdp.evaluate(`
      // force the win screen to test the offline save path
      const cards = [...document.querySelectorAll('.card')];
      const groups = {};
      for (const card of cards) (groups[card.dataset.emoji] = groups[card.dataset.emoji] || []).push(card);
      for (const key of Object.keys(groups)) {
        const pair = groups[key];
        if (pair[0].classList.contains('is-matched')) continue;
        // The board must be free before the next pair is clicked, so wait
        // longer than the mismatch animation (750ms) plus the match delay.
        await new Promise(r => setTimeout(r, 900));
        pair[0].click(); pair[1].click();
        await new Promise(r => setTimeout(r, 900));
      }
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('btn-save').click();
      await new Promise(r => setTimeout(r, 9000));
      const status = document.getElementById('save-status');
      return {
        winVisible: !document.getElementById('screen-win').hidden,
        statusText: status.textContent.trim().slice(0, 120),
        statusClass: status.className,
      };
    `);
    check('Save Score fails gracefully when the API is down', saveOffline.statusClass.includes('status--error'), JSON.stringify(saveOffline));
    check('The win screen still works without the API', saveOffline.winVisible === true, JSON.stringify(saveOffline));

    check(
      'No uncaught errors while the API is down',
      cdp.consoleErrors.length === 0,
      cdp.consoleErrors.join(' | ')
    );

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    failed += 1;
    console.log(`FAIL  resilience test crashed -> ${err.message}`);
    console.log(`      console errors: ${cdp ? cdp.consoleErrors.join(' | ') : 'n/a'}`);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (err) {
      /* ignore */
    }
  }
})();
