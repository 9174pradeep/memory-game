'use strict';

/**
 * validate.js
 * -----------
 * Request payload validation for the score API.
 *
 * Everything the client sends is treated as untrusted:
 *   - name must be a 1-15 character string (after trimming)
 *   - difficulty must be one of easy / medium / hard
 *   - moves and timeSeconds must be finite, non-negative numbers
 *   - anti-cheat: impossible move counts / durations are rejected
 */

const { getConfig, LIMITS } = require('./scoring');

/** Maximum length of a player name (in characters, not bytes). */
const MAX_NAME_LENGTH = 15;
/** Minimum length of a player name. */
const MIN_NAME_LENGTH = 1;

/**
 * Error carrying an HTTP status code, thrown by the validators and turned
 * into a JSON error response by the express error handler.
 */
class ValidationError extends Error {
  /**
   * @param {string} message human readable reason
   * @param {number} [status=400] HTTP status code
   * @param {string} [field] offending field name
   */
  constructor(message, status = 400, field = undefined) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
    if (field) this.field = field;
  }
}

/**
 * Normalises and validates the body of a score submission.
 *
 * @param {unknown} body raw request body
 * @returns {{name: string, difficulty: string, moves: number, timeSeconds: number}}
 * @throws {ValidationError} when the payload is invalid or impossible
 */
function validateScorePayload(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.', 400);
  }

  // --- name -------------------------------------------------------------
  if (typeof body.name !== 'string') {
    throw new ValidationError('Field "name" is required and must be a string.', 400, 'name');
  }
  // Strip control characters that could pollute the leaderboard output.
  const name = stripControlChars(body.name).trim();
  if (name.length < MIN_NAME_LENGTH) {
    throw new ValidationError('Field "name" must not be empty.', 400, 'name');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Field "name" must be at most ${MAX_NAME_LENGTH} characters.`, 400, 'name');
  }

  // --- difficulty -------------------------------------------------------
  if (typeof body.difficulty !== 'string') {
    throw new ValidationError('Field "difficulty" is required and must be a string.', 400, 'difficulty');
  }
  const difficulty = body.difficulty.trim().toLowerCase();
  const config = getConfig(difficulty);
  if (!config) {
    throw new ValidationError('Field "difficulty" must be one of: easy, medium, hard.', 400, 'difficulty');
  }

  // --- numeric fields ---------------------------------------------------
  const moves = toNumber(body.moves);
  if (moves === null) {
    throw new ValidationError('Field "moves" must be a number.', 400, 'moves');
  }
  if (!Number.isInteger(moves)) {
    throw new ValidationError('Field "moves" must be a whole number.', 400, 'moves');
  }

  const timeSeconds = toNumber(body.timeSeconds);
  if (timeSeconds === null) {
    throw new ValidationError('Field "timeSeconds" must be a number.', 400, 'timeSeconds');
  }
  if (!Number.isInteger(timeSeconds)) {
    throw new ValidationError('Field "timeSeconds" must be a whole number.', 400, 'timeSeconds');
  }

  // --- anti-cheat -------------------------------------------------------
  // Every pair needs at least one move, so fewer moves than pairs is
  // physically impossible -> the request is rejected instead of stored.
  const minMoves = config.pairs * LIMITS.MIN_MOVES_FACTOR;
  if (moves < minMoves) {
    throw new ValidationError(
      `Impossible game: ${config.label} needs at least ${minMoves} moves.`,
      400,
      'moves'
    );
  }

  // Absurdly high move counts are rejected as well (typos / tampering).
  const maxMoves = config.pairs * LIMITS.MAX_MOVES_FACTOR;
  if (moves > maxMoves) {
    throw new ValidationError(
      `Implausible game: ${config.label} cannot take more than ${maxMoves} moves.`,
      400,
      'moves'
    );
  }

  if (timeSeconds < 0) {
    throw new ValidationError('Field "timeSeconds" must not be negative.', 400, 'timeSeconds');
  }
  if (timeSeconds > LIMITS.MAX_TIME_SECONDS) {
    throw new ValidationError(
      `Implausible game time: a game cannot take more than ${LIMITS.MAX_TIME_SECONDS} seconds.`,
      400,
      'timeSeconds'
    );
  }

  return { name, difficulty, moves, timeSeconds };
}

/**
 * Validates the `difficulty` query parameter used by the leaderboard.
 * @param {unknown} value
 * @returns {string} a valid difficulty key
 * @throws {ValidationError}
 */
function validateDifficultyQuery(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('Query parameter "difficulty" is required.', 400, 'difficulty');
  }
  const difficulty = value.trim().toLowerCase();
  if (!getConfig(difficulty)) {
    throw new ValidationError('Query parameter "difficulty" must be one of: easy, medium, hard.', 400, 'difficulty');
  }
  return difficulty;
}

/**
 * Removes ASCII control characters (0x00-0x1F and 0x7F) from a string so that
 * a name can never contain invisible characters that would pollute the
 * leaderboard. Written as a loop instead of a regex to keep the intent
 * obvious and to avoid escape-sequence confusion.
 * @param {string} value
 * @returns {string}
 */
function stripControlChars(value) {
  let out = '';
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      out += char;
    }
  }
  return out;
}

/**
 * Converts a value to a finite number, or null when that is not possible.
 * Accepts numbers and numeric strings (JSON bodies always send numbers,
 * but query strings do not).
 * @param {unknown} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

module.exports = {
  ValidationError,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  validateScorePayload,
  validateDifficultyQuery,
  stripControlChars,
  toNumber,
};
