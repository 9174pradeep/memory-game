# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report it privately through GitHub's
[Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
page ("Report a vulnerability" on the Security tab of the repository).

Include:

- a description of the issue and its impact,
- steps to reproduce,
- the affected file(s) or endpoint,
- any suggested mitigation.

You can expect an initial response within 7 days. If the report is accepted,
a fix and a new release will be coordinated with you, and you will be credited
in the advisory unless you prefer otherwise.

## Security considerations of this project

The game is a small self-hosted app, but these points are handled deliberately:

- **Scores are computed server-side.** The API payload only carries
  `name`, `difficulty`, `moves` and `timeSeconds`; a client-supplied `score`
  field is ignored entirely.
- **Input validation and anti-cheat.** Name length (1–15 characters),
  difficulty, move counts and durations are validated. Physically impossible
  games (fewer moves than pairs) and implausible values are rejected.
- **XSS.** Player names are rendered with `textContent` only — `innerHTML` is
  never used for user data.
- **SQL injection.** All database access uses prepared statements with bound
  parameters.
- **Rate limiting.** `POST /api/scores` is limited to 30 submissions per
  minute per IP; reads are not throttled.
- **Payload size.** JSON bodies are capped at 16 KB.
- **Security headers.** The Express app sets `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `X-XSS-Protection: 0` (the legacy auditor is intentionally disabled in
  favour of CSP) and a strict `Content-Security-Policy` (no inline scripts, no
  external origins). The `X-Powered-By` header is disabled.
- **Static file serving** is limited to the `frontend/` directory.

## Hardening for production

The project is built for local play and small self-hosting. If you expose it
to the public internet, also consider:

- terminating TLS in front of the app,
- restricting CORS to the origins you actually use,
- putting a reverse proxy (nginx / Caddy) in front of Node,
- running the app as a non-root user.
