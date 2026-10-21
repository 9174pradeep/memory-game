'use strict';

/**
 * scripts/record-demo.js
 * ----------------------
 * Records an automated playthrough of the game and encodes it into
 * `docs/demo.mp4` and `docs/demo.gif`.
 *
 * The recording is produced with headless Chrome through the Chrome DevTools
 * Protocol: the screencast is captured while the script plays a complete
 * Medium game, and the frames are then muxed with ffmpeg.
 *
 * Requirements:
 *   - the game must be running (`npm start`)
 *   - Chrome / Chromium / Edge must be installed
 *   - ffmpeg must be available on the PATH (or set FFMPEG_PATH)
 *
 * Usage:
 *   node scripts/record-demo.js
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAGE_URL = process.env.DEMO_URL || 'http://localhost:3000';
const DEBUG_PORT = Number(process.env.DEBUG_PORT) || 9444;
const OUTPUT_DIR = path.join(__dirname, '..', 'docs');
const WIDTH = 1280;
const HEIGHT = 800;
const PLAYER_NAME = 'Prathamesh';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Locates a Chrome / Chromium / Edge binary.
 * @returns {string|null}
 */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Locates the ffmpeg binary.
 * @returns {string|null}
 */
function findFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = execFileSync(probe, ['ffmpeg'], { encoding: 'utf8' });
    const first = result.split(/\r?\n/).find((line) => line.trim().length > 0);
    return first ? first.trim() : null;
  } catch (err) {
    return null;
  }
}

/** Minimal Chrome DevTools Protocol client over the built-in WebSocket. */
class Cdp {
  /** @param {string} wsUrl */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  /** Connects to the debugger. */
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
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
        const handler = this.handlers.get(message.method);
        if (handler) handler(message.params);
      });
    });
  }

  /**
   * Registers an event handler.
   * @param {string} method
   * @param {Function} handler
   */
  on(method, handler) {
    this.handlers.set(method, handler);
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
      }, 30000);
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

/** Waits until the debugger endpoint is reachable. */
async function waitForDebugger() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (err) {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome debugger did not start in time.');
}

/**
 * Plays a complete Medium game in the page and returns the pairs to match.
 * @param {Cdp} cdp
 * @returns {Promise<number[][]>} the card indexes of every pair
 */
async function playGame(cdp) {
  await cdp.evaluate(`
    const input = document.getElementById('player-name');
    input.focus();
    input.value = '${PLAYER_NAME}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const radio = document.querySelector('input[name="difficulty"][value="medium"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('start-form').requestSubmit();
  `);
  await sleep(2200);

  const emojis = await cdp.evaluate(`
    return [...document.querySelectorAll('#board .card')].map((card) => card.dataset.emoji);
  `);

  const byEmoji = new Map();
  emojis.forEach((emoji, index) => {
    if (!byEmoji.has(emoji)) byEmoji.set(emoji, []);
    byEmoji.get(emoji).push(index);
  });
  const pairs = [...byEmoji.values()];

  // Reveal every face first so the board is visible in the recording.
  for (const indexes of pairs) {
    await cdp.evaluate(`document.querySelectorAll('#board .card')[${indexes[0]}].click();`);
    await sleep(260);
  }
  await sleep(900);

  // Then match every pair, one pair at a time.
  for (const indexes of pairs) {
    await cdp.evaluate(`document.querySelectorAll('#board .card')[${indexes[0]}].click();`);
    await sleep(520);
    await cdp.evaluate(`document.querySelectorAll('#board .card')[${indexes[1]}].click();`);
    await sleep(1000);
  }

  await sleep(2000);
  return pairs;
}

(async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome/Chromium/Edge binary found - skipping the recording.');
    process.exitCode = 0;
    return;
  }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.error('ffmpeg was not found - install it or set FFMPEG_PATH. Skipping the recording.');
    process.exitCode = 0;
    return;
  }

  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-frames-'));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const frames = [];
  let cdp = null;

  try {
    cdp = new Cdp(await waitForDebugger());
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });

    cdp.on('Page.screencastFrame', async (params) => {
      frames.push({ timestamp: params.metadata.timestamp, data: params.data });
      try {
        await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch (err) {
        /* ignore */
      }
    });

    await cdp.send('Page.navigate', { url: PAGE_URL });
    await sleep(2500);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 85,
      everyNthFrame: 1,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
    });
    await sleep(1500);

    await playGame(cdp);

    // Save the score and show the leaderboard.
    await cdp.evaluate(`
      const button = document.getElementById('btn-save');
      if (button && !button.disabled) button.click();
    `);
    await sleep(2200);
    await cdp.evaluate(`document.getElementById('btn-home').click();`);
    await sleep(2600);

    await cdp.send('Page.stopScreencast');
    await sleep(400);

    if (frames.length < 2) {
      throw new Error(`Only ${frames.length} frames were captured.`);
    }

    // Write the frames and a concat list with the real frame durations.
    const entries = [];
    for (let i = 0; i < frames.length; i += 1) {
      const name = `frame_${String(i + 1).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(frameDir, name), Buffer.from(frames[i].data, 'base64'));
      const next = i + 1 < frames.length ? frames[i + 1].timestamp : frames[i].timestamp + 0.2;
      entries.push({ name, duration: Math.max(next - frames[i].timestamp, 0.033) });
    }
    const concat = entries.map((e) => `file '${e.name}'\nduration ${e.duration.toFixed(3)}`).join('\n');
    const concatFile = path.join(frameDir, 'frames.txt');
    fs.writeFileSync(concatFile, `${concat}\nfile '${entries[entries.length - 1].name}'\n`);

    const mp4 = path.join(OUTPUT_DIR, 'demo.mp4');
    execFileSync(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', 'fps=20,scale=960:-2:flags=lanczos',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      mp4,
    ], { stdio: 'inherit' });

    const gif = path.join(OUTPUT_DIR, 'demo.gif');
    execFileSync(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', 'fps=8,scale=540:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
      '-loop', '0',
      gif,
    ], { stdio: 'inherit' });

    console.log(`Recorded ${frames.length} frames -> ${mp4} and ${gif}`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error('Recording failed:', err.message);
  process.exit(1);
});
