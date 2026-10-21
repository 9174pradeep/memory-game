'use strict';

/**
 * db.js
 * -----
 * SQLite persistence layer for Memory Card Match.
 *
 * Uses better-sqlite3 (synchronous, fast, zero-config embedded DB).
 * The database file lives in `backend/data/memory.db` and is created
 * automatically on first run. The `data` folder is git-ignored.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/** Absolute path of the folder that holds the SQLite file. */
const DATA_DIR = path.join(__dirname, 'data');
/** Absolute path of the SQLite file itself. */
const DB_FILE = path.join(DATA_DIR, 'memory.db');

// Make sure the folder exists before SQLite tries to create the file.
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_FILE);

// WAL mode gives better read/write concurrency; foreign_keys is enabled for safety.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Creates the `scores` table and its indexes if they do not exist yet.
 * Called once during server boot (see server.js).
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      difficulty    TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
      moves         INTEGER NOT NULL,
      time_seconds  INTEGER NOT NULL,
      score         INTEGER NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Leaderboard queries always filter by difficulty and sort by score DESC.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scores_difficulty_score
      ON scores (difficulty, score DESC, time_seconds ASC, id ASC);
  `);
}

/**
 * Inserts a finished game into the leaderboard.
 * @param {{name: string, difficulty: string, moves: number, timeSeconds: number, score: number}} game
 * @returns {object} the inserted row (including its new id)
 */
function insertScore(game) {
  const stmt = db.prepare(`
    INSERT INTO scores (name, difficulty, moves, time_seconds, score)
    VALUES (@name, @difficulty, @moves, @time_seconds, @score)
  `);
  const info = stmt.run({
    name: game.name,
    difficulty: game.difficulty,
    moves: game.moves,
    time_seconds: game.timeSeconds,
    score: game.score,
  });

  return getScoreById(info.lastInsertRowid);
}

/**
 * Fetches a single score row by id (used right after an insert).
 * @param {number} id
 * @returns {object|null}
 */
function getScoreById(id) {
  return db.prepare('SELECT * FROM scores WHERE id = ?').get(id) ?? null;
}

/**
 * Returns the top `limit` scores for a difficulty, best first.
 * Ties are broken by fastest time, then by the earliest submission.
 * @param {string} difficulty 'easy' | 'medium' | 'hard'
 * @param {number} limit
 * @returns {Array<object>}
 */
function getTopScores(difficulty, limit = 10) {
  return db
    .prepare(
      `SELECT id, name, difficulty, moves, time_seconds AS timeSeconds, score, created_at AS createdAt
         FROM scores
        WHERE difficulty = ?
        ORDER BY score DESC, time_seconds ASC, id ASC
        LIMIT ?`
    )
    .all(difficulty, limit);
}

/**
 * Aggregate statistics for the whole database (all difficulties).
 * @returns {{totalGames: number, averageScore: number, bestScore: number}}
 */
function getStats() {
  const row = db
    .prepare(
      `SELECT COUNT(*)                AS totalGames,
              COALESCE(AVG(score), 0)  AS averageScore,
              COALESCE(MAX(score), 0)  AS bestScore
         FROM scores`
    )
    .get();

  return {
    totalGames: Number(row.totalGames),
    averageScore: Math.round(Number(row.averageScore)),
    bestScore: Number(row.bestScore),
  };
}

/** Per-difficulty breakdown of games played and average score. */
function getStatsByDifficulty() {
  return db
    .prepare(
      `SELECT difficulty,
              COUNT(*)               AS totalGames,
              COALESCE(AVG(score), 0) AS averageScore,
              COALESCE(MAX(score), 0) AS bestScore
         FROM scores
        GROUP BY difficulty`
    )
    .all()
    .map((row) => ({
      difficulty: row.difficulty,
      totalGames: Number(row.totalGames),
      averageScore: Math.round(Number(row.averageScore)),
      bestScore: Number(row.bestScore),
    }));
}

module.exports = {
  db,
  initSchema,
  insertScore,
  getScoreById,
  getTopScores,
  getStats,
  getStatsByDifficulty,
};
