# Contributing to Memory Card Match

Thanks for taking the time to contribute! 🎴

This project is a small full-stack game: a vanilla JavaScript frontend, an
Express API and a SQLite database. Contributions of all sizes are welcome —
from a typo fix to a new difficulty.

## Getting started

```bash
git clone <your-fork-url>
cd memory-game
npm install
npm start
```

The game is then available on <http://localhost:3000>. The SQLite database is
created automatically in `backend/data/` on first run.

### Using Node version manager

The project ships a `.nvmrc` (Node 22 LTS):

```bash
nvm install && nvm use
```

## Code style

- **2 spaces** for indentation (enforced by `.editorconfig`).
- **ES modules free** — the backend uses CommonJS, the frontend is plain
  browser JavaScript. No build step, ever.
- **Comments explain *why*, not *what***. Every module and non-obvious
  function has a JSDoc block.
- Keep the frontend framework-free. The whole point of the project is that it
  runs with zero build tooling.
- Line length: 100 characters is a comfortable upper bound.

Run the linter before you push:

```bash
npm run lint
```

> The project requires **Node.js 22 or newer** (Node 18 and 20 are end of
> life). `npm run lint:fix` repairs most issues automatically.

## Making a change

1. Create a branch: `git checkout -b feature/my-change`
2. Make your change, keeping the commit small and focused.
3. Make sure the whole test suite passes:

   ```bash
   npm run lint
   npm run test:all
   ```

   The API tests need the server running (`npm start`) in another terminal.
   The browser tests need Chrome, Chromium or Edge; if no browser is installed
   they are skipped automatically. Set `CHROME_PATH` to point at a specific
   browser binary if you have several installed.

4. Commit with a clear message and open a pull request.

### Commit messages

Use the conventional style:

```
feat: add a daily challenge mode
fix: do not count a paused game towards the timer
docs: document the score formula
chore: bump express to 5.x
```

## Adding a difficulty

The difficulty settings live in two places that must stay in sync:

- `backend/scoring.js` — the authoritative configuration used for scoring and
  anti-cheat.
- `frontend/game.js` — `DIFFICULTIES`, used for the board layout and for the
  live score preview.

`GET /api/scores/config` exposes the server configuration to the frontend, so
the preview cannot drift far from the real formula — but the layout columns
and rows are only defined on the client.

## Reporting bugs

Open an issue using the **Bug report** template and include:

- the difficulty and what you did,
- what you expected to happen,
- what actually happened,
- your browser / Node version,
- the relevant part of the console output.

## Pull requests

- Keep the diff focused on one topic.
- Update `README.md` if you change the API, the score formula or the setup
  steps.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- Fill in the pull request template so reviewers know what to check.

## Code of conduct

Be respectful and constructive. Assume good intent, and keep discussion
focused on the code.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
