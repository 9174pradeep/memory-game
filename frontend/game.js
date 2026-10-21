'use strict';

/**
 * game.js
 * -------
 * Memory Card Match - front-end logic (vanilla JavaScript, no frameworks).
 *
 * Structure:
 *   1. Constants & configuration
 *   2. Small DOM / storage helpers
 *   3. API layer (graceful degradation when the server is unreachable)
 *   4. Screen management
 *   5. Start screen
 *   6. Game screen (board, flipping, timer, pause, restart)
 *   7. Win screen & score saving
 *   8. Leaderboard & stats
 *   9. Bootstrap
 *
 * Security note: player names are ALWAYS rendered with textContent, never with
 * innerHTML, so a hostile name can never be interpreted as markup.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. Constants & configuration
     ========================================================================== */

  /** The 12 emoji available as card faces (2 cards each). */
  const EMOJIS = ['🍎', '🐶', '🚀', '⚽', '🎸', '🌈', '🍕', '🦋', '🔥', '🎲', '🌙', '🍩'];

  /**
   * Difficulty configuration.
   * `pairs` / `cols` / `rows` describe the board.
   * The scoring values mirror backend/scoring.js exactly so the client can show
   * a live preview; the SERVER value is always the authoritative one that gets
   * stored (the client never sends a score).
   */
  const DIFFICULTIES = {
    easy: {
      label: 'Easy',
      pairs: 6,
      cols: 4,
      rows: 3,
      base: 1000,
      perfectBonus: 500,
      movePenalty: 25,
      timeFactor: 5,
      multiplier: 1.0,
    },
    medium: {
      label: 'Medium',
      pairs: 8,
      cols: 4,
      rows: 4,
      base: 1500,
      perfectBonus: 800,
      movePenalty: 30,
      timeFactor: 6,
      multiplier: 1.25,
    },
    hard: {
      label: 'Hard',
      pairs: 12,
      cols: 6,
      rows: 4,
      base: 2000,
      perfectBonus: 1200,
      movePenalty: 35,
      timeFactor: 7,
      multiplier: 1.5,
    },
  };

  /** Delay before a matching pair is locked in (lets the flip animation finish). */
  const MATCH_DELAY_MS = 380;
  /** Delay before mismatching cards flip back (lets the player see the pair). */
  const MISMATCH_DELAY_MS = 750;
  /** Timeout for API requests in milliseconds. */
  const API_TIMEOUT_MS = 8000;

  /** localStorage keys. */
  const STORAGE_NAME_KEY = 'mcm.playerName';
  const STORAGE_BEST_PREFIX = 'mcm.best.';

  /**
   * Base URL for API calls.
   * When the page is opened directly from disk (file://) relative URLs do not
   * work, so we fall back to the local Express server.
   */
  const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

  /** Mutable game state. */
  const state = {
    name: '',
    difficulty: 'easy',
    deck: [],
    firstCard: null,
    secondCard: null,
    locked: false,
    finished: false,
    paused: false,
    moves: 0,
    timer: {
      running: false,
      startedAt: 0,
      accumulatedMs: 0,
      intervalId: null,
    },
    /** Scoring parameters, possibly refreshed from the server. */
    scoring: DIFFICULTIES,
  };

  /* ==========================================================================
     2. DOM / storage helpers
     ========================================================================== */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /** Cached element references. */
  const els = {
    screens: {
      start: $('#screen-start'),
      game: $('#screen-game'),
      win: $('#screen-win'),
    },
    startForm: $('#start-form'),
    nameInput: $('#player-name'),
    nameError: $('#name-error'),
    board: $('#board'),
    pauseOverlay: $('#pause-overlay'),
    hud: {
      time: $('#hud-time'),
      moves: $('#hud-moves'),
      pairs: $('#hud-pairs'),
      best: $('#hud-best'),
    },
    win: {
      score: $('#win-score'),
      moves: $('#win-moves'),
      time: $('#win-time'),
      best: $('#win-best'),
      sub: $('#win-sub'),
      save: $('#btn-save'),
      playAgain: $('#btn-play-again'),
      home: $('#btn-home'),
      status: $('#save-status'),
    },
    leaderboard: $('#leaderboard-list'),
    tabs: $$('.tab'),
    statsBar: $('#stats-bar'),
    statTotal: $('#stat-total'),
    statAverage: $('#stat-average'),
    btnPause: $('#btn-pause'),
    btnRestart: $('#btn-restart'),
    btnResume: $('#btn-resume'),
    btnSound: $('#btn-sound'),
    soundIcon: $('#sound-icon'),
  };

  /**
   * Reads a value from localStorage; returns null when unavailable or corrupt.
   * @param {string} key
   * @returns {string|null}
   */
  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      // Private browsing modes can throw on access - never break the game for it.
      return null;
    }
  }

  /**
   * Writes a value to localStorage, ignoring quota / privacy errors.
   * @param {string} key
   * @param {string} value
   */
  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* ignore - storage is a nice-to-have, not a requirement */
    }
  }

  /**
   * Formats a duration in seconds as MM:SS (or H:MM:SS for very long games).
   * @param {number} totalSeconds
   * @returns {string}
   */
  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
  }

  /**
   * Shuffles an array in place using the Fisher-Yates algorithm.
   * @param {Array} array
   * @returns {Array} the same array
   */
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /* ==========================================================================
     3. API layer
     ========================================================================== */

  /**
   * Performs a JSON request against the API.
   * Throws an Error with a friendly message when the API is unreachable or
   * answers with an error status.
   * @param {string} path e.g. '/api/scores'
   * @param {object} [options] fetch options
   * @returns {Promise<object>} parsed JSON body
   */
  async function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        method,
        headers,
        signal: controller.signal,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (err) {
        payload = null;
      }

      if (!response.ok) {
        const error = new Error(
          (payload && payload.error) || `The server responded with status ${response.status}.`
        );
        error.status = response.status;
        throw error;
      }

      return payload;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('The server took too long to respond.', { cause: err });
      }
      if (err instanceof TypeError) {
        throw new Error('Could not reach the server.', { cause: err });
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  /* ==========================================================================
     4. Screen management
     ========================================================================== */

  /**
   * Shows exactly one screen.
   * @param {'start'|'game'|'win'} name
   */
  function showScreen(name) {
    Object.entries(els.screens).forEach(([key, element]) => {
      const active = key === name;
      element.hidden = !active;
      element.classList.toggle('screen--active', active);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ==========================================================================
     5. Start screen
     ========================================================================== */

  /**
   * Validates the player name entered on the start screen.
   * @returns {boolean} true when the name is acceptable
   */
  function validateName() {
    const value = els.nameInput.value.trim();
    if (value.length === 0) {
      showNameError('Please enter a name to continue.');
      return false;
    }
    if (value.length > 15) {
      showNameError('The name must be at most 15 characters long.');
      return false;
    }
    hideNameError();
    return true;
  }

  /**
   * Displays a validation message under the name field.
   * @param {string} message
   */
  function showNameError(message) {
    els.nameError.textContent = message;
    els.nameError.hidden = false;
    els.nameInput.setAttribute('aria-invalid', 'true');
  }

  /** Hides the name validation message. */
  function hideNameError() {
    els.nameError.hidden = true;
    els.nameInput.removeAttribute('aria-invalid');
  }

  /**
   * Handles the start form submission.
   * @param {SubmitEvent} event
   */
  function handleStart(event) {
    event.preventDefault();
    if (!validateName()) {
      els.nameInput.focus();
      return;
    }

    state.name = els.nameInput.value.trim();
    state.difficulty = $('input[name="difficulty"]:checked').value;
    writeStorage(STORAGE_NAME_KEY, state.name);

    startNewGame();
    showScreen('game');
    // Move focus into the board so keyboard players can start right away.
    els.board.focus();
  }

  /* ==========================================================================
     6. Game screen
     ========================================================================== */

  /**
   * Builds a shuffled deck of card objects for a difficulty.
   * @param {number} pairs number of pairs
   * @returns {Array<{id: number, emoji: string}>}
   */
  function buildDeck(pairs) {
    const deck = [];
    EMOJIS.slice(0, pairs).forEach((emoji, index) => {
      deck.push({ id: index * 2, emoji });
      deck.push({ id: index * 2 + 1, emoji });
    });
    return shuffle(deck);
  }

  /**
   * Creates the DOM element for a single card.
   * The emoji is written with textContent (never innerHTML).
   * @param {{id: number, emoji: string}} card
   * @param {number} index position on the board
   * @returns {HTMLButtonElement}
   */
  function createCardElement(card, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.dataset.index = String(index);
    button.dataset.emoji = card.emoji;
    button.setAttribute('aria-label', `Hidden card ${index + 1}`);

    const inner = document.createElement('div');
    inner.className = 'card__inner';

    const back = document.createElement('div');
    back.className = 'card__face card__face--back';
    back.setAttribute('aria-hidden', 'true');

    const front = document.createElement('div');
    front.className = 'card__face card__face--front';
    front.setAttribute('aria-hidden', 'true');
    front.textContent = card.emoji;

    inner.append(back, front);
    button.append(inner);
    return button;
  }

  /**
   * Renders the board for the current difficulty and deck.
   */
  function renderBoard() {
    const config = DIFFICULTIES[state.difficulty];
    els.board.style.setProperty('--cols', String(config.cols));
    els.board.style.setProperty('--rows', String(config.rows));
    els.board.replaceChildren();

    const fragment = document.createDocumentFragment();
    state.deck.forEach((card, index) => {
      fragment.append(createCardElement(card, index));
    });
    els.board.append(fragment);
  }

  /**
   * Starts a fresh game with the current difficulty.
   */
  function startNewGame() {
    const config = DIFFICULTIES[state.difficulty];

    state.deck = buildDeck(config.pairs);
    state.firstCard = null;
    state.secondCard = null;
    state.locked = false;
    state.finished = false;
    state.paused = false;
    state.moves = 0;

    els.pauseOverlay.hidden = true;
    els.btnPause.textContent = 'Pause';

    // A new game clears any celebration that is still on screen.
    if (window.Confetti) {
      window.Confetti.stop();
    }

    renderBoard();
    startTimer();
    updateHud();

    if (window.Sound) {
      window.Sound.start();
    }
  }

  /**
   * Computes the elapsed playing time in milliseconds.
   * @returns {number}
   */
  function elapsedMs() {
    const timer = state.timer;
    if (!timer.running) {
      return timer.accumulatedMs;
    }
    return timer.accumulatedMs + (Date.now() - timer.startedAt);
  }

  /**
   * Starts the game timer.
   */
  function startTimer() {
    const timer = state.timer;
    timer.accumulatedMs = 0;
    timer.running = true;
    timer.startedAt = Date.now();
    if (timer.intervalId) {
      window.clearInterval(timer.intervalId);
    }
    timer.intervalId = window.setInterval(updateTimerDisplay, 200);
  }

  /** Freezes the timer and keeps the accumulated time. */
  function pauseTimer() {
    const timer = state.timer;
    if (!timer.running) {
      return;
    }
    timer.accumulatedMs = elapsedMs();
    timer.running = false;
    if (timer.intervalId) {
      window.clearInterval(timer.intervalId);
      timer.intervalId = null;
    }
  }

  /** Continues a paused timer. */
  function resumeTimer() {
    const timer = state.timer;
    if (timer.running) {
      return;
    }
    timer.startedAt = Date.now();
    timer.running = true;
    timer.intervalId = window.setInterval(updateTimerDisplay, 200);
  }

  /** Stops the timer completely (used when the game is won). */
  function stopTimer() {
    pauseTimer();
  }

  /** Updates the timer display in the HUD. */
  function updateTimerDisplay() {
    els.hud.time.textContent = formatTime(elapsedMs() / 1000);
  }

  /**
   * Updates every HUD value (time, moves, pairs, personal best).
   */
  function updateHud() {
    els.hud.moves.textContent = String(state.moves);
    els.hud.pairs.textContent = `${countMatchedPairs()}/${DIFFICULTIES[state.difficulty].pairs}`;
    updateTimerDisplay();

    const best = getPersonalBest(state.difficulty);
    els.hud.best.textContent = best ? String(best.score) : '-';
  }

  /**
   * Counts how many pairs have been matched.
   * @returns {number}
   */
  function countMatchedPairs() {
    return $$('.card.is-matched', els.board).length / 2;
  }

  /**
   * Returns the stored personal best for a difficulty.
   * @param {string} difficulty
   * @returns {{score: number, moves: number, timeSeconds: number}|null}
   */
  function getPersonalBest(difficulty) {
    const raw = readStorage(STORAGE_BEST_PREFIX + difficulty);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.score === 'number') {
        return parsed;
      }
    } catch (err) {
      /* corrupted entry - ignore it */
    }
    return null;
  }

  /**
   * Stores a new personal best when the given score beats the stored one.
   * @param {string} difficulty
   * @param {{score: number, moves: number, timeSeconds: number}} result
   * @returns {boolean} true when a new best was stored
   */
  function storePersonalBest(difficulty, result) {
    const current = getPersonalBest(difficulty);
    if (current && current.score >= result.score) {
      return false;
    }
    writeStorage(
      STORAGE_BEST_PREFIX + difficulty,
      JSON.stringify({
        score: result.score,
        moves: result.moves,
        timeSeconds: result.timeSeconds,
      })
    );
    return true;
  }

  /**
   * Handles a click on the board (event delegation).
   * Cards are <button> elements, so Enter / Space trigger a click natively and
   * the game is fully keyboard playable.
   * @param {MouseEvent} event
   */
  function handleBoardClick(event) {
    const card = event.target.closest('.card');
    if (!card) {
      return;
    }
    flipCard(card);
  }

  /**
   * Flips a card and evaluates the pair.
   * @param {HTMLElement} card the .card button element
   */
  function flipCard(card) {
    if (state.locked || state.paused || state.finished) {
      return;
    }
    if (card.classList.contains('is-flipped') || card.classList.contains('is-matched')) {
      return;
    }
    if (state.firstCard === card) {
      return;
    }

    revealCard(card);

    if (!state.firstCard) {
      state.firstCard = card;
      return;
    }

    state.secondCard = card;
    state.moves += 1;
    state.locked = true;
    updateHud();

    const isMatch = state.firstCard.dataset.emoji === card.dataset.emoji;

    if (isMatch) {
      window.setTimeout(() => {
        applyMatch(state.firstCard, state.secondCard);
        state.locked = false;
        state.firstCard = null;
        state.secondCard = null;
        checkForWin();
      }, MATCH_DELAY_MS);
    } else {
      window.setTimeout(() => {
        applyMismatch(state.firstCard, state.secondCard);
        state.locked = false;
        state.firstCard = null;
        state.secondCard = null;
      }, MISMATCH_DELAY_MS);
    }
  }

  /**
   * Visually reveals a card.
   * @param {HTMLElement} card
   */
  function revealCard(card) {
    card.classList.add('is-flipped');
    card.setAttribute('aria-label', `Card showing ${card.dataset.emoji}`);
    if (window.Sound) {
      window.Sound.flip();
    }
  }

  /**
   * Locks a matching pair in place with a green glow.
   * @param {HTMLElement} first
   * @param {HTMLElement} second
   */
  function applyMatch(first, second) {
    [first, second].forEach((card) => {
      card.classList.remove('is-flipped', 'is-mismatch');
      card.classList.add('is-matched');
      card.disabled = true;
      card.setAttribute('aria-label', `Matched ${card.dataset.emoji}`);
    });
    if (window.Sound) {
      window.Sound.match();
    }
    updateHud();
  }

  /**
   * Shakes a mismatching pair and flips it back down.
   * @param {HTMLElement} first
   * @param {HTMLElement} second
   */
  function applyMismatch(first, second) {
    [first, second].forEach((card) => {
      card.classList.add('is-mismatch');
      card.setAttribute('aria-label', `Not a match, ${card.dataset.emoji}`);
    });

    if (window.Sound) {
      window.Sound.mismatch();
    }

    window.setTimeout(() => {
      [first, second].forEach((card) => {
        card.classList.remove('is-flipped', 'is-mismatch');
        card.setAttribute('aria-label', 'Hidden card');
      });
    }, 420);
  }

  /**
   * Ends the game when every pair has been found.
   */
  function checkForWin() {
    const config = DIFFICULTIES[state.difficulty];
    if (countMatchedPairs() < config.pairs) {
      return;
    }

    state.finished = true;
    stopTimer();
    updateHud();
    showWinScreen();
  }

  /**
   * Pauses or resumes the game.
   */
  function togglePause() {
    if (state.finished) {
      return;
    }

    if (state.paused) {
      state.paused = false;
      els.pauseOverlay.hidden = true;
      els.btnPause.textContent = 'Pause';
      resumeTimer();
      return;
    }

    state.paused = true;
    pauseTimer();
    els.pauseOverlay.hidden = false;
    els.btnPause.textContent = 'Resume';
  }

  /* ==========================================================================
     7. Win screen & score saving
     ========================================================================== */

  /**
   * Computes the score preview using the same formula as the server
   * (see backend/scoring.js). The stored score is always recomputed by the
   * server - this value is only a live preview for the player.
   * @param {string} difficulty
   * @param {number} moves
   * @param {number} timeSeconds
   * @returns {number}
   */
  function previewScore(difficulty, moves, timeSeconds) {
    const config = state.scoring[difficulty] || DIFFICULTIES[difficulty];
    const extraMoves = Math.max(0, moves - config.pairs);
    let raw = config.base;
    if (moves === config.pairs) {
      raw += config.perfectBonus;
    }
    raw -= config.movePenalty * extraMoves;
    raw -= config.timeFactor * timeSeconds;
    return Math.max(0, Math.round(raw * config.multiplier));
  }

  /**
   * Fills the win screen with the results of the finished game.
   */
  function showWinScreen() {
    const timeSeconds = Math.floor(elapsedMs() / 1000);
    const score = previewScore(state.difficulty, state.moves, timeSeconds);

    els.win.moves.textContent = String(state.moves);
    els.win.time.textContent = formatTime(timeSeconds);
    els.win.score.textContent = String(score);
    els.win.status.textContent = '';
    els.win.status.className = 'status';
    els.win.save.disabled = false;
    els.win.save.textContent = 'Save Score';

    const best = getPersonalBest(state.difficulty);
    els.win.best.textContent = best ? String(best.score) : '-';

    const config = DIFFICULTIES[state.difficulty];
    const perfect = state.moves === config.pairs;
    els.win.sub.textContent = perfect
      ? `Perfect game on ${config.label} - every pair found on the first try!`
      : `${config.label} cleared with ${state.moves} moves.`;

    // Keep the local personal best up to date even before the score is saved.
    storePersonalBest(state.difficulty, { score, moves: state.moves, timeSeconds });
    const updatedBest = getPersonalBest(state.difficulty);
    els.win.best.textContent = updatedBest ? String(updatedBest.score) : '-';

    showScreen('win');
    els.win.save.focus();

    if (window.Sound) {
      window.Sound.win();
    }
    if (window.Confetti) {
      window.Confetti.burst();
    }
  }

  /**
   * Sends the finished game to the server, which computes the official score.
   */
  async function saveScore() {
    const timeSeconds = Math.floor(elapsedMs() / 1000);
    els.win.save.disabled = true;
    els.win.save.textContent = 'Saving...';
    els.win.status.className = 'status';

    try {
      const payload = await apiFetch('/api/scores', {
        method: 'POST',
        body: JSON.stringify({
          name: state.name,
          difficulty: state.difficulty,
          moves: state.moves,
          timeSeconds,
        }),
      });

      const officialScore = payload && payload.score ? payload.score.score : 0;

      els.win.score.textContent = String(officialScore);
      storePersonalBest(state.difficulty, {
        score: officialScore,
        moves: state.moves,
        timeSeconds,
      });
      const savedBest = getPersonalBest(state.difficulty);
      els.win.best.textContent = savedBest ? String(savedBest.score) : '-';

      els.win.status.textContent = `Score saved! ${officialScore} points on the ${DIFFICULTIES[state.difficulty].label} board.`;
      els.win.status.className = 'status status--ok';
      els.win.save.textContent = 'Saved';
      els.win.save.disabled = true;

      loadLeaderboard(state.difficulty);
      loadStats();
    } catch (err) {
      els.win.status.textContent = `Could not save the score: ${err.message} The game itself still works offline.`;
      els.win.status.className = 'status status--error';
      els.win.save.disabled = false;
      els.win.save.textContent = 'Save Score';
      if (window.Sound) {
        window.Sound.error();
      }
    }
  }

  /* ==========================================================================
     8. Leaderboard & stats
     ========================================================================== */

  /**
   * Loads and renders the leaderboard for a difficulty.
   * @param {string} difficulty
   */
  async function loadLeaderboard(difficulty) {
    els.leaderboard.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'muted';
    loading.textContent = 'Loading leaderboard...';
    els.leaderboard.append(loading);

    try {
      const payload = await apiFetch(`/api/scores?difficulty=${encodeURIComponent(difficulty)}`);
      renderLeaderboard(payload.scores || [], difficulty);
    } catch (err) {
      renderLeaderboardError(err.message);
    }
  }

  /**
   * Renders the leaderboard rows.
   * @param {Array<object>} scores
   * @param {string} difficulty
   */
  function renderLeaderboard(scores, difficulty) {
    els.leaderboard.replaceChildren();

    if (!scores.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No scores yet - be the first to finish this board!';
      els.leaderboard.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    scores.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'leaderboard__row';
      if (entry.name === state.name && entry.difficulty === difficulty) {
        row.classList.add('leaderboard__row--me');
      }

      const rank = document.createElement('span');
      rank.className = 'leaderboard__rank';
      rank.textContent = `#${index + 1}`;

      const name = document.createElement('span');
      name.className = 'leaderboard__name';
      // textContent -> a malicious name can never inject markup.
      name.textContent = entry.name;

      const meta = document.createElement('span');
      meta.className = 'leaderboard__meta';
      meta.textContent = `${entry.moves} moves - ${formatTime(entry.timeSeconds)}`;

      const score = document.createElement('span');
      score.className = 'leaderboard__score';
      score.textContent = `${entry.score} pts`;

      row.append(rank, name, meta, score);
      fragment.append(row);
    });

    els.leaderboard.append(fragment);
  }

  /**
   * Renders a friendly error inside the leaderboard area.
   * @param {string} message
   */
  function renderLeaderboardError(message) {
    els.leaderboard.replaceChildren();

    const box = document.createElement('div');
    box.className = 'muted';

    const title = document.createElement('p');
    title.textContent = 'Leaderboard unavailable.';
    box.append(title);

    const detail = document.createElement('p');
    detail.textContent = `${message} Start the backend with "npm start" to see the leaderboard.`;
    box.append(detail);

    els.leaderboard.append(box);
  }

  /**
   * Loads the global statistics (total games, average score).
   */
  async function loadStats() {
    try {
      const payload = await apiFetch('/api/stats');
      els.statsBar.hidden = false;
      els.statTotal.textContent = String(payload.totalGames ?? 0);
      els.statAverage.textContent = String(payload.averageScore ?? 0);
    } catch (err) {
      // Statistics are optional - the game stays playable without them.
      els.statsBar.hidden = true;
    }
  }

  /**
   * Refreshes the scoring parameters from the server so the preview always
   * matches the server formula. Falls back to the built-in values.
   */
  async function loadScoringConfig() {
    try {
      const payload = await apiFetch('/api/scores/config');
      if (payload && payload.difficulties) {
        const merged = { ...DIFFICULTIES };
        Object.entries(payload.difficulties).forEach(([key, cfg]) => {
          merged[key] = { ...DIFFICULTIES[key], ...cfg };
        });
        state.scoring = merged;
      }
    } catch (err) {
      /* offline - keep the local mirror */
    }
  }

  /**
   * Switches the visible leaderboard tab.
   * @param {string} difficulty
   */
  function selectTab(difficulty) {
    els.tabs.forEach((tab) => {
      const active = tab.dataset.difficulty === difficulty;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    const activeTab = els.tabs.find((tab) => tab.dataset.difficulty === difficulty);
    if (activeTab) {
      els.leaderboard.setAttribute('aria-labelledby', activeTab.id);
    }
    loadLeaderboard(difficulty);
  }

  /* ==========================================================================
     9. Bootstrap
     ========================================================================== */

  /**
   * Reflects the current sound state in the toggle button (icon + aria-pressed).
   */
  function updateSoundButton() {
    if (!els.btnSound) {
      return;
    }
    const on = Boolean(window.Sound && window.Sound.enabled);
    els.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.btnSound.title = on ? 'Turn sound effects off' : 'Turn sound effects on';
    if (els.soundIcon) {
      els.soundIcon.textContent = on ? '🔊' : '🔇';
    }
  }

  /**
   * Toggles the sound effects and remembers the choice.
   */
  function toggleSound() {
    if (!window.Sound) {
      return;
    }
    window.Sound.toggle();
    updateSoundButton();
  }

  /** Wires up every event listener. */
  function bindEvents() {
    els.startForm.addEventListener('submit', handleStart);
    els.nameInput.addEventListener('input', hideNameError);

    if (els.btnSound) {
      els.btnSound.addEventListener('click', toggleSound);
    }

    els.board.addEventListener('click', handleBoardClick);

    els.btnPause.addEventListener('click', togglePause);
    els.btnResume.addEventListener('click', togglePause);
    els.btnRestart.addEventListener('click', () => {
      startNewGame();
      els.board.focus();
    });

    els.win.save.addEventListener('click', saveScore);
    els.win.playAgain.addEventListener('click', () => {
      startNewGame();
      showScreen('game');
      els.board.focus();
    });
    els.win.home.addEventListener('click', () => {
      showScreen('start');
      loadLeaderboard(state.difficulty);
      loadStats();
      els.nameInput.focus();
    });

    els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.difficulty));
      // Left / right arrow keys move between tabs (WAI-ARIA tabs pattern).
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
          return;
        }
        event.preventDefault();
        const order = els.tabs.map((item) => item.dataset.difficulty);
        const current = order.indexOf(tab.dataset.difficulty);
        const nextIndex =
          event.key === 'ArrowRight'
            ? (current + 1) % order.length
            : (current - 1 + order.length) % order.length;
        const nextTab = els.tabs.find((item) => item.dataset.difficulty === order[nextIndex]);
        selectTab(order[nextIndex]);
        nextTab.focus();
      });
    });

    // Pause the game when the tab is hidden so the timer is never exploited.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !state.paused && !state.finished) {
        togglePause();
      }
    });
  }

  /** Runs the initial setup. */
  async function init() {
    bindEvents();

    // The board is focusable so keyboard users land on it when a game starts.
    els.board.setAttribute('tabindex', '-1');

    const savedName = readStorage(STORAGE_NAME_KEY);
    if (savedName) {
      els.nameInput.value = savedName;
    }

    // Show the stored sound preference (default: on).
    updateSoundButton();

    const initialDifficulty = state.difficulty;
    selectTab(initialDifficulty);
    loadStats();
    loadScoringConfig();
  }

  /* Kick everything off once the DOM is ready. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
