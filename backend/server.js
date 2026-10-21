'use strict';

/**
 * server.js
 * ---------
 * Express application for Memory Card Match.
 *
 * Responsibilities:
 *   - JSON API under /api (scores, stats, health)
 *   - static hosting of the vanilla JS frontend
 *   - CORS, JSON body parsing, rate limiting on score submissions
 *   - consistent JSON error responses with proper status codes
 */

const path = require('path');
const express = require('express');
const cors = require('cors');

const { initSchema } = require('./db');
const { ValidationError } = require('./validate');
const scoresRouter = require('./routes/scores');
const statsRouter = require('./routes/stats');

const app = express();

/** Port the server listens on (override with PORT env variable). */
const PORT = Number(process.env.PORT) || 3000;
/** Folder with the static frontend files. */
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Allows the game to be played from a different origin (e.g. the frontend
// opened from a file:// page or another dev server) during development.
app.use(cors());

// Do not advertise the framework.
app.disable('x-powered-by');

/**
 * Baseline security headers. There is no helmet dependency - the small set of
 * headers that actually matters here is written by hand.
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // The legacy XSS auditor is disabled on purpose - CSP below is the modern
  // replacement (see https://developer.mozilla.org/docs/Web/HTTP/Headers/X-XSS-Protection).
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self' http://localhost:3000",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
});

// Parse JSON bodies with a size limit to avoid abuse.
app.use(express.json({ limit: '16kb' }));

// Only parse urlencoded bodies for form style posts (not used by the game,
// but harmless and keeps the API forgiving).
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// Minimal structured request log (skipped while testing).
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    res.on('finish', () => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
    });
    next();
  });
}

// Rate limiting for score submissions is defined next to the route it
// protects (backend/routes/scores.js) so that only POST /api/scores is
// throttled and reading the leaderboard is never rate limited.

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

/**
 * GET /api/health
 * Liveness probe - also used by the frontend to detect whether the API is up.
 */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/scores', scoresRouter);
app.use('/api/stats', statsRouter);

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------

app.use(
  express.static(FRONTEND_DIR, {
    extensions: ['html'],
    maxAge: '1h',
    setHeaders(res, filePath) {
      // index.html must never be cached, otherwise updates are hard to spot.
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// Unknown API routes -> JSON 404 (never HTML).
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Any other route -> serve the single page app (index.html).
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

// Malformed JSON body -> express.json() throws a SyntaxError with status 400.
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ValidationError) {
    return res.status(err.status).json({
      ok: false,
      error: err.message,
      ...(err.field ? { field: err.field } : {}),
    });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'Request body must be valid JSON.' });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Request body is too large.' });
  }

  console.error('[error]', err);
  res.status(500).json({ ok: false, error: 'Internal server error.' });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initSchema();

const server = app.listen(PORT, () => {
  console.log('--------------------------------------------------');
  console.log('  Memory Card Match is running');
  console.log(`  Game:   http://localhost:${PORT}`);
  console.log(`  API:    http://localhost:${PORT}/api/health`);
  console.log('--------------------------------------------------');
});

// Graceful shutdown so the SQLite file is closed cleanly.
function shutdown(signal) {
  console.log(`\n${signal} received - shutting down.`);
  server.close(() => process.exit(0));
  // Fallback: force exit if connections keep the server alive.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
