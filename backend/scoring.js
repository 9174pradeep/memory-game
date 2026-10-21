'use strict';

/**
 * scoring.js
 * ----------
 * The ONLY place where scores are calculated.
 *
 * The client never sends a score: the API payload contains just
 * { name, difficulty, moves, timeSeconds } and the server derives the score
 * itself. A tampered client therefore cannot inflate a leaderboard entry.
 *
 * ---------------------------------------------------------------------------
 * SCORE FORMULA
 * ---------------------------------------------------------------------------
 * For each difficulty we define:
 *
 *   pairs         = number of matching pairs on the board
 *   base          = points awarded for finishing the game
 *   perfectBonus  = extra points when the game was played flawlessly
 *   movePenalty   = points deducted for every move above the theoretical minimum
 *   timeFactor    = points deducted per second of play
 *   multiplier    = difficulty scaling applied to the final value
 *
 *   raw   = base
 *         + perfectBonus            (only when moves === pairs)
 *         - movePenalty * (moves - pairs)
 *         - timeFactor  * timeSeconds
 *
 *   score = round(raw * multiplier) , clamped to a minimum of 0
 *
 * Rationale:
 *   - `base` grows with difficulty because larger boards are harder.
 *   - `perfectBonus` rewards the theoretical best possible game (every pair
 *     matched on the first try, i.e. exactly `pairs` moves).
 *   - `movePenalty` punishes wasted flips: each extra move costs points, so
 *     fewer moves always means a higher score.
 *   - `timeFactor` punishes slow play: each extra second costs points, so a
 *     shorter time always means a higher score.
 *   - `multiplier` scales everything up for harder difficulties, where the
 *     same performance is worth more.
 *
 * The result is always an integer >= 0.
 */

/** Per-difficulty tuning values. `pairs` is also the minimum legal move count. */
const DIFFICULTY_CONFIG = {
  easy: {
    label: 'Easy',
    pairs: 6,
    base: 1000,
    perfectBonus: 500,
    movePenalty: 25,
    timeFactor: 5,
    multiplier: 1.0,
  },
  medium: {
    label: 'Medium',
    pairs: 8,
    base: 1500,
    perfectBonus: 800,
    movePenalty: 30,
    timeFactor: 6,
    multiplier: 1.25,
  },
  hard: {
    label: 'Hard',
    pairs: 12,
    base: 2000,
    perfectBonus: 1200,
    movePenalty: 35,
    timeFactor: 7,
    multiplier: 1.5,
  },
};

/** Difficulty identifiers in a stable order (used by the UI tabs). */
const DIFFICULTIES = ['easy', 'medium', 'hard'];

/** Hard limits used for anti-cheat validation. */
const LIMITS = {
  /** A move may never be worth less than one move per pair. */
  MIN_MOVES_FACTOR: 1,
  /**
   * A very generous upper bound: each pair needs at least one move, and a
   * player realistically needs at most a handful of attempts per pair.
   * 4 attempts per pair keeps absurd values (e.g. 999999) out of the DB.
   */
  MAX_MOVES_FACTOR: 4,
  /** Longest plausible single game: 2 hours. */
  MAX_TIME_SECONDS: 7200,
};

/**
 * Returns the configuration for a difficulty.
 * @param {string} difficulty
 * @returns {object|null} config or null when the difficulty is unknown
 */
function getConfig(difficulty) {
  return DIFFICULTY_CONFIG[difficulty] ?? null;
}

/**
 * Computes the final score for a finished game.
 * The same function is used for the stored value and for the API preview.
 *
 * @param {string} difficulty 'easy' | 'medium' | 'hard'
 * @param {number} moves number of two-card flips performed
 * @param {number} timeSeconds elapsed game time in seconds
 * @returns {number} integer score >= 0
 */
function computeScore(difficulty, moves, timeSeconds) {
  const config = getConfig(difficulty);
  if (!config) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }

  const safeMoves = Math.max(0, Number(moves) || 0);
  const safeTime = Math.max(0, Number(timeSeconds) || 0);

  // Moves below the pair count are impossible and are rejected upstream,
  // but clamp here anyway so the helper can never return a negative value.
  const extraMoves = Math.max(0, safeMoves - config.pairs);

  let raw = config.base;
  if (safeMoves === config.pairs) {
    raw += config.perfectBonus;
  }
  raw -= config.movePenalty * extraMoves;
  raw -= config.timeFactor * safeTime;

  const score = Math.round(raw * config.multiplier);
  return Math.max(0, score);
}

/**
 * Public, JSON-safe description of the difficulty configuration.
 * The frontend uses it to render a live score preview that always matches
 * the server formula.
 * @returns {object}
 */
function getPublicConfig() {
  const difficulties = {};
  for (const key of DIFFICULTIES) {
    const cfg = DIFFICULTY_CONFIG[key];
    difficulties[key] = {
      label: cfg.label,
      pairs: cfg.pairs,
      base: cfg.base,
      perfectBonus: cfg.perfectBonus,
      movePenalty: cfg.movePenalty,
      timeFactor: cfg.timeFactor,
      multiplier: cfg.multiplier,
      minMoves: cfg.pairs,
      maxMoves: cfg.pairs * LIMITS.MAX_MOVES_FACTOR,
      maxTimeSeconds: LIMITS.MAX_TIME_SECONDS,
    };
  }
  return { difficulties, order: DIFFICULTIES, limits: LIMITS };
}

module.exports = {
  DIFFICULTY_CONFIG,
  DIFFICULTIES,
  LIMITS,
  getConfig,
  computeScore,
  getPublicConfig,
};
