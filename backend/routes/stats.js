'use strict';

/**
 * routes/stats.js
 * ---------------
 * Aggregate statistics about all recorded games.
 *
 *   GET /api/stats -> { ok, totalGames, averageScore, bestScore, byDifficulty }
 */

const express = require('express');

const { getStats, getStatsByDifficulty } = require('../db');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const totals = getStats();
    const byDifficulty = getStatsByDifficulty();

    res.json({
      ok: true,
      totalGames: totals.totalGames,
      averageScore: totals.averageScore,
      bestScore: totals.bestScore,
      byDifficulty,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
