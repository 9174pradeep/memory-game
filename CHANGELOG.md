# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Security headers** — every response now carries `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy` and a strict `Content-Security-Policy`;
  the `X-Powered-By` header is disabled.
- **Linting** — ESLint 10 with a flat config that gives the backend (Node /
  CommonJS) and the frontend (browser) their own environments.
- **Project scaffolding** — `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
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
- **Game** — face-down card matching with three difficulties: Easy (4×3, 6
  pairs), Medium (4×4, 8 pairs) and Hard (6×4, 12 pairs).
- **Score** — server-side formula rewarding fewer moves and less time, with a
  perfect-play bonus and a per-difficulty multiplier. The client never sends
  a score.
- **Frontend** — start / game / win screens, live timer, move counter,
  personal best per difficulty, smooth 3D CSS flip animation, green glow on a
  match and a gentle shake on a mismatch.
- **Pause & restart** — the timer freezes with the game and the tab is
  auto-paused when it loses focus.
- **Leaderboard** — top 10 per difficulty with Easy / Medium / Hard tabs.
- **Sound effects** — Web Audio synthesised flip / match / mismatch / win /
  error sounds with a persistent mute toggle. No audio assets required.
- **Confetti** — canvas celebration on the win screen, respecting
  `prefers-reduced-motion`.
- **Backend** — Express REST API (`/api/scores`, `/api/stats`, `/api/health`,
  `/api/scores/config`) with SQLite persistence via `better-sqlite3`.
- **Anti-cheat** — server-side validation of name length, difficulty, move
  counts and durations; impossible games are rejected, client-supplied scores
  are ignored.
- **Robustness** — CORS, rate limiting on score submissions, JSON error
  responses with proper status codes, and a frontend that stays fully playable
  when the API is unreachable.
- **Accessibility** — full keyboard play (Tab / Enter / Space), WAI-ARIA
  leaderboard tabs, focus management, live regions and XSS-safe name
  rendering via `textContent`.
- **Tests** — API smoke tests, headless Chrome end-to-end tests and a
  keyboard / offline resilience suite.

[Unreleased]: https://github.com/OWNER/memory-game/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/OWNER/memory-game/releases/tag/v1.0.0
