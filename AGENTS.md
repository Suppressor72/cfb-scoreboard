# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A static college football scoreboard web app with a TV-guide layout: channels
are rows, time runs left-to-right, each game is a block sized by its window.
Data comes from ESPN's free public scoreboard API, fetched client-side.
React 18 + Vite + TypeScript, deployed to GitHub Pages. No backend in v1.

## Read first

1. `docs/SPEC.md` — UI/layout specification (authoritative for behavior)
2. `docs/DATA.md` — data source, refresh/error policy, provider contract
   (authoritative for the data layer)
3. `docs/REVIEW_RESPONSE.md` — why the specs look the way they do; check it
   before reopening a question the review already settled

If code and docs disagree, the docs win: either fix the code, or change the
docs in the same commit and say so in the message.

## Hard rules

These exist because spec review (see `docs/ADVERSARIAL_REVIEW.md`) found the
naive versions defective. Violating them reintroduces known bugs:

- **UI components never see ESPN JSON.** All data flows through the provider
  contract in `docs/DATA.md`. The adapter validates and normalizes at the
  boundary — responses are `unknown` until proven otherwise; valid events are
  kept from partially malformed payloads and marked `coverage: "partial"`.
- **One scheduler owns every timer and request.** Components never call
  `fetch` or `setInterval`. Cadence follows the table in `docs/DATA.md` and is
  computed from the *unfiltered* snapshot, so filtered-out live games still
  refresh.
- **Scores are optional.** ESPN sends pre-game scores as literal `0` — never
  expose them while `phase === "pre"`. Canceled games have no winner.
- **No end times exist in the source.** Every post-kickoff right edge is a
  labeled estimate per SPEC "Block geometry"; `endUtc` stays reserved/null.
- **Lane packing stays deterministic** (sort by kickoff, then id) so a 30s
  poll never reshuffles lanes or breaks scroll position.
- **Requests carry generation checks.** Obsolete responses are dropped even
  when abort arrives late; partial snapshots can add/update but never delete.
- **Empty broadcasts ≠ not televised.** `availability: "unknown"` is a real
  state, distinct from confirmed-none.
- **Local days use local-date + IANA-timezone math** (DST-aware, epoch-ms
  geometry). Never assume a day is 24 hours or that a provider date equals a
  local day; ESPN buckets by US Eastern date.

## Conventions

- TypeScript strict. Keep selectors (filters, date grouping, lane packing)
  pure and unit-tested — no network, no React imports.
- Scheduler tests use fake clocks. Adapter tests use sanitized recorded
  fixtures (no credentials, no personal data); trim payloads rather than
  committing megabyte JSON files.
- `scripts/probe_espn.py` regenerates the API evidence in `docs/DATA.md`
  ("Verified behavior"). If a change assumes new ESPN behavior, re-run the
  probe and update that section in the same commit. Note: fetch via curl —
  Python's urllib gets 403'd by the edge (client fingerprint filtering).
- CI gates per SPEC "Deployment contract": typecheck → tests → production
  build → deploy → post-deploy smoke test. Vite `base` must remain correct
  for the GitHub Pages subpath.

## Commands

Not yet scaffolded. After scaffolding: `npm run dev` (dev server), `npm run
build` (production build), `npm test`, `npm run typecheck`. Keep this section
updated when scripts change.
