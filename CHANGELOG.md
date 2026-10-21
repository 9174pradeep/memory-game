# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Demo** â€” an automatically recorded playthrough of the game
  (`docs/demo.mp4` and `docs/demo.gif`) plus `scripts/record-demo.js`, which
  regenerates both with headless Chrome and ffmpeg.
- **Project overview** in the README with the project description, my role,
  the tools and technologies used, and links to the playable game, the
  repository and the demo.
- **Security headers** â€” every response now carries `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy` and a strict `Content-Security-Policy`;
  the `X-Powered-By` header is disabled.
- **Linting** â€” ESLint 10 with a flat config that gives the backend (Node /
  CommonJS) and the frontend (browser) their own environments.
- **Project scaffolding** â€” `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CHANGELOG.md`, `.editorconfig`, `.nvmrc`, Dependabot, issue and pull-request
  templates, plus GitHub Actions workflows for CI and tagged releases.

### Changed
- `frontend/game.js` is now wrapped in an IIFE, so nothing leaks into the
  global scope.
- The browser test suites now find Chrome, Chromium or Edge on Windows, macOS
  and Linux, and accept a `CHROME_PATH` override.
- `npm run test:all` runs the linter first.

## [1.0.0] - 2026-10-21

### Added
- **Game** â€” face-down card matching with three difficulties: Easy (4Ã—3, 6
  pairs), Medium (4Ã—4, 8 pairs) and Hard (6Ã—4, 12 pairs).
- **Score** â€” server-side formula rewarding fewer moves and less time, with a
  perfect-play bonus and a per-difficulty multiplier. The client never sends
  a score.
- **Frontend** â€” start / game / win screens, live timer, move counter,
  personal best per difficulty, smooth 3D CSS flip animation, green glow on a
  match and a gentle shake on a mismatch.
- **Pause & restart** â€” the timer freezes with the game and the tab is
  auto-paused when it loses focus.
- **Leaderboard** â€” top 10 per difficulty with Easy / Medium / Hard tabs.
- **Sound effects** â€” Web Audio synthesised flip / match / mismatch / win /
  error sounds with a persistent mute toggle. No audio assets required.
- **Confetti** â€” canvas celebration on the win screen, respecting
  `prefers-reduced-motion`.
- **Backend** â€” Express REST API (`/api/scores`, `/api/stats`, `/api/health`,
  `/api/scores/config`) with SQLite persistence via `better-sqlite3`.
- **Anti-cheat** â€” server-side validation of name length, difficulty, move
  counts and durations; impossible games are rejected, client-supplied scores
  are ignored.
- **Robustness** â€” CORS, rate limiting on score submissions, JSON error
  responses with proper status codes, and a frontend that stays fully playable
  when the API is unreachable.
- **Accessibility** â€” full keyboard play (Tab / Enter / Space), WAI-ARIA
  leaderboard tabs, focus management, live regions and XSS-safe name
  rendering via `textContent`.
- **Tests** â€” API smoke tests, headless Chrome end-to-end tests and a
  keyboard / offline resilience suite.

[Unreleased]: https://github.com/9174pradeep/memory-game/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/9174pradeep/memory-game/releases/tag/v1.0.0
