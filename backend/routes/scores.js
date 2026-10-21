'use strict';

/**
 * routes/scores.js
 * ----------------
 * Leaderboard endpoints.
 *
 *   POST /api/scores             -> save a finished game (server computes score)
 *   GET  /api/scores?difficulty= -> top 10 scores for a difficulty
 *   GET  /api/scores/config      -> public scoring configuration (for the UI preview)
 *
 * The POST endpoint never accepts a client supplied score.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { insertScore, getTopScores } = require('../db');
const { computeScore, getPublicConfig } = require('../scoring');
const { validateScorePayload, validateDifficultyQuery } = require('../validate');

const router = express.Router();

/** How many entries the leaderboard shows per difficulty. */
const LEADERBOARD_SIZE = 10;

/**
 * Rate limiter for score submissions only - reads (the leaderboard) must
 * never be throttled, otherwise the UI would break for slow clients.
 * 30 submissions per minute is far above what a human player needs
 * (one submission per finished game) while still blocking spam.
 */
const scoreLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many score submissions. Please wait a minute and try again.',
  },
});

/**
 * POST /api/scores
 * Body: { name, difficulty, moves, timeSeconds }
 * Response 201: { ok: true, score: {...} }
 */
router.post('/', scoreLimiter, (req, res, next) => {
  try {
    const { name, difficulty, moves, timeSeconds } = validateScorePayload(req.body);

    // The score is derived here on the server - the client cannot influence it.
    const score = computeScore(difficulty, moves, timeSeconds);

    const saved = insertScore({ name, difficulty, moves, timeSeconds, score });

    res.status(201).json({
      ok: true,
      score: {
        id: saved.id,
        name: saved.name,
        difficulty: saved.difficulty,
        moves: saved.moves,
        timeSeconds: saved.time_seconds,
        score: saved.score,
        createdAt: saved.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/scores?difficulty=easy
 * Response 200: { ok: true, difficulty, scores: [...] }
 */
router.get('/', (req, res, next) => {
  try {
    const difficulty = validateDifficultyQuery(req.query.difficulty);
    const scores = getTopScores(difficulty, LEADERBOARD_SIZE).map((row) => ({
      id: row.id,
      name: row.name,
      difficulty: row.difficulty,
      moves: row.moves,
      timeSeconds: row.timeSeconds,
      score: row.score,
      createdAt: row.createdAt,
    }));

    res.json({ ok: true, difficulty, limit: LEADERBOARD_SIZE, scores });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/scores/config
 * Public scoring parameters so the frontend can preview scores with exactly
 * the same formula the server uses.
 */
router.get('/config', (req, res) => {
  res.json({ ok: true, ...getPublicConfig() });
});

module.exports = router;
