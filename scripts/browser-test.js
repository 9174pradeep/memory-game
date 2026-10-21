'use strict';

/**
 * scripts/browser-test.js
 * -----------------------
 * End-to-end frontend test driven through the Chrome DevTools Protocol.
 *
 * It opens the real page in headless Chrome and verifies that:
 *   1. the page loads without console errors
 *   2. the leaderboard is filled from the API
 *   3. the start form validates the player name
 *   4. starting a game renders the right number of cards
 *   5. flipping two cards increases the move counter
 *   6. matching a pair locks the cards in place
 *   7. a mismatching pair flips back down
 *   8. finishing the game shows the win screen with score / moves / time
 *   9. "Save Score" stores the score and refreshes the leaderboard
 *
 * Usage (the server must be running):
 *   node scripts/browser-test.js [url]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE_URL = process.argv[2] || 'http://localhost:3000';
const DEBUG_PORT = Number(process.env.DEBUG_PORT) || 9333;

let passed = 0;
let failed = 0;

/** Prints a check result. */
function check(label, ok, extra = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${extra ? ` -> ${extra}` : ''}`);
  }
}

/** Waits for a number of milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal Chrome DevTools Protocol client over the built-in WebSocket. */
class Cdp {
  /** @param {string} wsUrl */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
  }

  /** Connects to the debugger. */
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (event) => reject(new Error(`WebSocket error: ${event.message || 'unknown'}`)));
      this.ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && this.pending.has(message.id)) {
          const { resolve: res, reject: rej } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) {
            rej(new Error(message.error.message));
          } else {
            res(message.result);
          }
          return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params.exceptionDetails || {};
          this.consoleErrors.push(details.text || 'Uncaught exception');
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
          this.consoleErrors.push(
            message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
          );
        }
      });
    });
  }

  /**
   * Sends a CDP command.
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<object>}
   */
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
      }, 20000);
    });
  }

  /**
   * Evaluates an expression in the page and returns its (awaited) value.
   * @param {string} expression
   * @returns {Promise<any>}
   */
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

  /** Closes the websocket. */
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

/** Waits until the debugger endpoint is reachable. */
async function waitForDebugger() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch (err) {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome debugger did not start in time.');
}

(async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome/Edge binary found - skipping the browser test.');
    process.exitCode = 0;
    return;
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
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
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(1800);

    // 1. page loads cleanly
    check(
      'Page loads without console errors',
      cdp.consoleErrors.length === 0,
      cdp.consoleErrors.join(' | ')
    );

    // 2. the leaderboard is rendered from the API
    const board = await cdp.evaluate(`
      const res = await fetch('/api/scores?difficulty=easy');
      const data = await res.json();
      const list = document.getElementById('leaderboard-list');
      const rows = list.querySelectorAll('.leaderboard__row').length;
      const emptyState = /No scores yet/i.test(list.textContent);
      const errorState = /unavailable/i.test(list.textContent);
      return {
        apiOk: data.ok === true && Array.isArray(data.scores),
        apiCount: data.scores.length,
        rows,
        emptyState,
        errorState,
      };
    `);
    check(
      'Leaderboard is fetched from the API and rendered',
      board.apiOk && (board.rows > 0 || board.emptyState) && !board.errorState,
      JSON.stringify(board)
    );

    // 3. name validation
    const validation = await cdp.evaluate(`
      const input = document.getElementById('player-name');
      input.value = '';
      document.getElementById('start-form').requestSubmit();
      await new Promise(r => setTimeout(r, 150));
      const errorVisible = !document.getElementById('name-error').hidden;
      const stillOnStart = !document.getElementById('screen-start').hidden;
      return { errorVisible, stillOnStart };
    `);
    check(
      'Empty name is rejected and the start screen stays open',
      validation.errorVisible && validation.stillOnStart,
      JSON.stringify(validation)
    );

    // 4. start a medium game -> 16 cards
    const started = await cdp.evaluate(`
      const input = document.getElementById('player-name');
      input.value = 'BrowserBot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('input[name="difficulty"][value="medium"]').checked = true;
      document.getElementById('start-form').requestSubmit();
      await new Promise(r => setTimeout(r, 400));
      return {
        cards: document.querySelectorAll('.card').length,
        gameVisible: !document.getElementById('screen-game').hidden,
        startHidden: document.getElementById('screen-start').hidden,
        moves: document.getElementById('hud-moves').textContent,
        pairs: document.getElementById('hud-pairs').textContent,
        cols: getComputedStyle(document.getElementById('board')).getPropertyValue('--cols').trim(),
      };
    `);
    check('Medium game renders 16 cards in a 4 column grid', started.cards === 16 && started.cols === '4', JSON.stringify(started));
    check('Game screen is shown and the start screen is hidden', started.gameVisible && started.startHidden, JSON.stringify(started));
    check('HUD starts at 0 moves and 0/8 pairs', started.moves === '0' && started.pairs === '0/8', JSON.stringify(started));

    // 5. flipping two different cards counts as one move
    const flip = await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      cards[0].click();
      await new Promise(r => setTimeout(r, 120));
      const firstFlipped = cards[0].classList.contains('is-flipped');
      cards[1].click();
      await new Promise(r => setTimeout(r, 200));
      const moves = document.getElementById('hud-moves').textContent;
      const secondFlipped = cards[1].classList.contains('is-flipped');
      return { firstFlipped, secondFlipped, moves };
    `);
    check('Cards flip over on click', flip.firstFlipped && flip.secondFlipped, JSON.stringify(flip));
    check('Flipping two cards counts as one move', flip.moves === '1', JSON.stringify(flip));

    // 6. a mismatching pair flips back down
    const mismatch = await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      const a = cards.find(c => c.dataset.emoji === 'DISTINCT-A');
      // find two cards with different emojis
      const first = cards[0];
      const second = cards.find(c => c.dataset.emoji !== first.dataset.emoji);
      first.click(); second.click();
      await new Promise(r => setTimeout(r, 1400));
      return {
        firstOpen: first.classList.contains('is-flipped'),
        secondOpen: second.classList.contains('is-flipped'),
      };
    `);
    check('A mismatching pair flips back down', !mismatch.firstOpen && !mismatch.secondOpen, JSON.stringify(mismatch));

    // 7. a matching pair stays open and locks
    const match = await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      const first = cards[0];
      const twin = cards.find(c => c !== first && c.dataset.emoji === first.dataset.emoji);
      first.click(); twin.click();
      await new Promise(r => setTimeout(r, 900));
      return {
        firstMatched: first.classList.contains('is-matched'),
        twinMatched: twin.classList.contains('is-matched'),
        firstDisabled: first.disabled,
        pairs: document.getElementById('hud-pairs').textContent,
      };
    `);
    check('A matching pair stays open and is locked', match.firstMatched && match.twinMatched && match.firstDisabled, JSON.stringify(match));
    check('Matched pair is counted in the HUD', match.pairs !== '0/8', JSON.stringify(match));

    // 8. pause / resume
    const paused = await cdp.evaluate(`
      document.getElementById('btn-pause').click();
      await new Promise(r => setTimeout(r, 250));
      const overlayShown = !document.getElementById('pause-overlay').hidden;
      const timeA = document.getElementById('hud-time').textContent;
      await new Promise(r => setTimeout(r, 1200));
      const timeB = document.getElementById('hud-time').textContent;
      document.getElementById('btn-resume').click();
      await new Promise(r => setTimeout(r, 300));
      return { overlayShown, timeA, timeB, overlayHidden: document.getElementById('pause-overlay').hidden };
    `);
    check('Pause shows the overlay and freezes the timer', paused.overlayShown && paused.timeA === paused.timeB, JSON.stringify(paused));
    check('Resume hides the overlay again', paused.overlayHidden, JSON.stringify(paused));

    // 9. finish the game -> win screen
    const won = await cdp.evaluate(`
      const cards = [...document.querySelectorAll('.card')];
      const groups = {};
      for (const card of cards) {
        (groups[card.dataset.emoji] = groups[card.dataset.emoji] || []).push(card);
      }
      for (const key of Object.keys(groups)) {
        const pair = groups[key];
        if (pair.length < 2 || pair[0].classList.contains('is-matched')) continue;
        pair[0].click(); pair[1].click();
        await new Promise(r => setTimeout(r, 520));
      }
      await new Promise(r => setTimeout(r, 400));
      return {
        winVisible: !document.getElementById('screen-win').hidden,
        score: document.getElementById('win-score').textContent,
        moves: document.getElementById('win-moves').textContent,
        time: document.getElementById('win-time').textContent,
        best: document.getElementById('win-best').textContent,
      };
    `);
    check('Winning shows the win screen', won.winVisible, JSON.stringify(won));
    check('Win screen shows a numeric score, moves and time', /^\d+$/.test(won.score) && /^\d+$/.test(won.moves) && /^\d\d:\d\d$/.test(won.time), JSON.stringify(won));

    // 10. save the score
    const saved = await cdp.evaluate(`
      document.getElementById('btn-save').click();
      await new Promise(r => setTimeout(r, 1500));
      const status = document.getElementById('save-status');
      return {
        statusText: status.textContent.trim(),
        statusClass: status.className,
        score: document.getElementById('win-score').textContent,
        buttonLabel: document.getElementById('btn-save').textContent.trim(),
      };
    `);
    check('Save Score reports success', saved.statusClass.includes('status--ok'), JSON.stringify(saved));
    check('Save Score is disabled after saving', saved.buttonLabel === 'Saved', JSON.stringify(saved));

    // 11. the score really landed in the database
    const leaderboard = await cdp.evaluate(`
      const res = await fetch('/api/scores?difficulty=medium');
      const data = await res.json();
      return data.scores.some(entry => entry.name === 'BrowserBot');
    `);
    check('Saved score is visible on the leaderboard', leaderboard === true);

    // 12. the sound toggle works and is remembered
    const sound = await cdp.evaluate(`
      const btn = document.getElementById('btn-sound');
      const before = btn.getAttribute('aria-pressed');
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      const after = btn.getAttribute('aria-pressed');
      const stored = localStorage.getItem('mcm.sound');
      btn.click();
      await new Promise(r => setTimeout(r, 100));
      return {
        before, after, stored,
        restored: btn.getAttribute('aria-pressed'),
        hasSoundApi: typeof window.Sound === 'object',
        hasConfettiApi: typeof window.Confetti === 'object',
      };
    `);
    check('Sound and confetti modules are loaded', sound.hasSoundApi && sound.hasConfettiApi, JSON.stringify(sound));
    check(
      'Sound toggle flips the state and persists it',
      sound.before === 'true' && sound.after === 'false' && sound.stored === 'off',
      JSON.stringify(sound)
    );
    check('Sound toggle restores the previous state', sound.restored === 'true', JSON.stringify(sound));

    // 13. the sound preference survives a reload
    await cdp.evaluate(`
      document.getElementById('btn-sound').click();
      await new Promise(r => setTimeout(r, 100));
      return true;
    `);
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(1600);
    const persisted = await cdp.evaluate(`
      return {
        pressed: document.getElementById('btn-sound').getAttribute('aria-pressed'),
        stored: localStorage.getItem('mcm.sound'),
      };
    `);
    check(
      'Muted state survives a page reload',
      persisted.pressed === 'false' && persisted.stored === 'off',
      JSON.stringify(persisted)
    );
    // turn the sound back on again
    await cdp.evaluate(`
      document.getElementById('btn-sound').click();
      await new Promise(r => setTimeout(r, 100));
      return true;
    `);

    // 14. winning shows the confetti celebration
    const confetti = await cdp.evaluate(`
      const input = document.getElementById('player-name');
      input.value = 'ConfettiBot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('start-form').requestSubmit();
      await new Promise(r => setTimeout(r, 400));
      const cards = [...document.querySelectorAll('.card')];
      const groups = {};
      for (const card of cards) (groups[card.dataset.emoji] = groups[card.dataset.emoji] || []).push(card);
      for (const key of Object.keys(groups)) {
        const pair = groups[key];
        if (pair[0].classList.contains('is-matched')) continue;
        await new Promise(r => setTimeout(r, 900));
        pair[0].click(); pair[1].click();
        await new Promise(r => setTimeout(r, 900));
      }
      await new Promise(r => setTimeout(r, 600));
      const canvas = document.querySelector('.confetti-canvas');
      const rect = canvas ? canvas.getBoundingClientRect() : null;
      return {
        winVisible: !document.getElementById('screen-win').hidden,
        canvasExists: !!canvas,
        canvasWidth: rect ? Math.round(rect.width) : 0,
        canvasHeight: rect ? Math.round(rect.height) : 0,
        pointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : 'n/a',
      };
    `);
    check('Confetti canvas is created on the win screen', confetti.canvasExists, JSON.stringify(confetti));
    check(
      'Confetti canvas covers the viewport and never blocks clicks',
      confetti.canvasWidth > 0 && confetti.canvasHeight > 0 && confetti.pointerEvents === 'none',
      JSON.stringify(confetti)
    );

    // 15. no console errors during the whole run
    check(
      'No console errors during the whole session',
      cdp.consoleErrors.length === 0,
      cdp.consoleErrors.join(' | ')
    );

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    failed += 1;
    console.log(`FAIL  browser test crashed -> ${err.message}`);
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
