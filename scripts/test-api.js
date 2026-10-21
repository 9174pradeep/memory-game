'use strict';

/**
 * scripts/test-api.js
 * --------------------
 * End-to-end smoke test for the Memory Card Match API.
 *
 * Usage (the server must be running):
 *   node scripts/test-api.js [baseUrl]
 *
 * Every endpoint is exercised with a valid AND an invalid request.
 * Exits with code 1 as soon as an expectation fails.
 *
 * The requests use node:http with "Connection: close" on purpose: the global
 * fetch() keeps sockets alive, which makes a forced process.exit() on Windows
 * trigger a libuv assertion.
 */

const http = require('http');
const { URL } = require('url');

const BASE_URL = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';
const BASE = new URL(BASE_URL);

let passed = 0;
let failed = 0;

/**
 * Performs a single HTTP request.
 * @param {string} method
 * @param {string} path
 * @param {object|null} body
 * @returns {Promise<{status: number, text: string, json: object|null}>}
 */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === null || body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      Accept: 'application/json',
      Connection: 'close',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }

    const req = http.request(
      {
        hostname: BASE.hostname,
        port: BASE.port || 80,
        path,
        method,
        headers,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(text);
          } catch (err) {
            json = null;
          }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Sends a request and checks the status code and the response body.
 * @param {string} method
 * @param {string} path
 * @param {object|null} body
 * @param {{expectedStatus: number, check?: Function, label: string}} expectation
 * @returns {Promise<object|null>} the parsed body of the response
 */
async function run(method, path, body, expectation) {
  let response;
  try {
    response = await request(method, path, body);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${expectation.label} -> request failed: ${err.message}`);
    return null;
  }

  const statusOk = response.status === expectation.expectedStatus;
  const bodyOk = expectation.check ? expectation.check(response.json) : true;

  if (statusOk && bodyOk) {
    passed += 1;
    console.log(`PASS  ${expectation.label} (${response.status})`);
  } else {
    failed += 1;
    console.log(
      `FAIL  ${expectation.label} -> expected status ${expectation.expectedStatus}, got ${response.status}`
    );
    console.log(`      body: ${response.text.slice(0, 300)}`);
  }
  return response.json;
}

(async () => {
  console.log(`Testing API at ${BASE_URL}\n`);

  // --- health -------------------------------------------------------------
  await run('GET', '/api/health', null, {
    label: 'GET /api/health returns healthy',
    expectedStatus: 200,
    check: (p) => p && p.ok === true && p.status === 'healthy',
  });

  // --- stats --------------------------------------------------------------
  await run('GET', '/api/stats', null, {
    label: 'GET /api/stats returns aggregates',
    expectedStatus: 200,
    check: (p) => p && p.ok === true && typeof p.totalGames === 'number' && typeof p.averageScore === 'number',
  });

  // --- config -------------------------------------------------------------
  await run('GET', '/api/scores/config', null, {
    label: 'GET /api/scores/config returns difficulty config',
    expectedStatus: 200,
    check: (p) => p && p.difficulties && p.difficulties.easy && p.difficulties.hard,
  });

  // --- valid score submission ---------------------------------------------
  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'easy', moves: 8, timeSeconds: 30 }, {
    label: 'POST /api/scores stores a valid game',
    expectedStatus: 201,
    check: (p) => p && p.ok === true && p.score && typeof p.score.score === 'number' && p.score.score >= 0,
  });

  // The server must ignore any client supplied score.
  await run('POST', '/api/scores', { name: 'Cheater', difficulty: 'easy', moves: 6, timeSeconds: 1, score: 999999 }, {
    label: 'POST /api/scores ignores a client supplied score',
    expectedStatus: 201,
    check: (p) => p && p.score.score < 999999,
  });

  // A hostile name is stored verbatim; the frontend renders it with
  // textContent, so it can never be interpreted as markup.
  await run('POST', '/api/scores', { name: '<img src=x>', difficulty: 'easy', moves: 7, timeSeconds: 12 }, {
    label: 'POST /api/scores accepts a name containing markup characters',
    expectedStatus: 201,
    check: (p) => p && p.score.name === '<img src=x>',
  });

  // --- invalid submissions -------------------------------------------------
  await run('POST', '/api/scores', { name: '', difficulty: 'easy', moves: 8, timeSeconds: 30 }, {
    label: 'POST /api/scores rejects an empty name',
    expectedStatus: 400,
    check: (p) => p && p.ok === false && typeof p.error === 'string',
  });

  await run('POST', '/api/scores', { name: 'ThisNameIsWayTooLong', difficulty: 'easy', moves: 8, timeSeconds: 30 }, {
    label: 'POST /api/scores rejects a name longer than 15 chars',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'impossible', moves: 8, timeSeconds: 30 }, {
    label: 'POST /api/scores rejects an unknown difficulty',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'easy', moves: 2, timeSeconds: 30 }, {
    label: 'POST /api/scores rejects impossible moves (fewer than pairs)',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'hard', moves: 9999, timeSeconds: 30 }, {
    label: 'POST /api/scores rejects implausible move counts',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'easy', moves: 8, timeSeconds: -5 }, {
    label: 'POST /api/scores rejects a negative time',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'easy', moves: 8, timeSeconds: 99999 }, {
    label: 'POST /api/scores rejects an implausible duration',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { name: 'Tester', difficulty: 'easy', moves: 'many', timeSeconds: 30 }, {
    label: 'POST /api/scores rejects a non-numeric move count',
    expectedStatus: 400,
  });

  await run('POST', '/api/scores', { difficulty: 'easy', moves: 8, timeSeconds: 30 }, {
    label: 'POST /api/scores rejects a missing name',
    expectedStatus: 400,
  });

  // --- leaderboard --------------------------------------------------------
  await run('GET', '/api/scores?difficulty=easy', null, {
    label: 'GET /api/scores returns the easy leaderboard',
    expectedStatus: 200,
    check: (p) => p && Array.isArray(p.scores) && p.scores.length <= 10,
  });

  await run('GET', '/api/scores?difficulty=medium', null, {
    label: 'GET /api/scores returns the medium leaderboard',
    expectedStatus: 200,
  });

  await run('GET', '/api/scores?difficulty=hard', null, {
    label: 'GET /api/scores returns the hard leaderboard',
    expectedStatus: 200,
  });

  await run('GET', '/api/scores', null, {
    label: 'GET /api/scores without a difficulty is rejected',
    expectedStatus: 400,
  });

  await run('GET', '/api/scores?difficulty=nonsense', null, {
    label: 'GET /api/scores with an invalid difficulty is rejected',
    expectedStatus: 400,
  });

  // --- unknown route -------------------------------------------------------
  await run('GET', '/api/does-not-exist', null, {
    label: 'Unknown API routes return a JSON 404',
    expectedStatus: 404,
    check: (p) => p && p.ok === false,
  });

  // --- static frontend -----------------------------------------------------
  try {
    const page = await request('GET', '/', null);
    if (page.status === 200 && page.text.includes('Memory Card Match') && page.text.includes('game.js')) {
      passed += 1;
      console.log('PASS  GET / serves the frontend (index.html)');
    } else {
      failed += 1;
      console.log(`FAIL  GET / did not serve the expected frontend HTML (status ${page.status})`);
    }
  } catch (err) {
    failed += 1;
    console.log(`FAIL  GET / failed: ${err.message}`);
  }

  for (const asset of ['/style.css', '/game.js']) {
    try {
      const res = await request('GET', asset, null);
      const ok = res.status === 200 && res.text.length > 0;
      if (ok) {
        passed += 1;
        console.log(`PASS  GET ${asset} is served`);
      } else {
        failed += 1;
        console.log(`FAIL  GET ${asset} -> status ${res.status}`);
      }
    } catch (err) {
      failed += 1;
      console.log(`FAIL  GET ${asset} failed: ${err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
})();
