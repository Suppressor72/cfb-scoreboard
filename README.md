# CFB Scoreboard

A college football scoreboard with a TV-guide layout: channels are rows, time runs left-to-right, and each game is a block spanning its kickoff-to-final window on the channel that broadcast it.

## Features

- **TV-guide grid** — one row-group per channel (ABC, ESPN, FOX, BTN, ...), games positioned by start time and sized by duration. Concurrent games on a channel stack into packed lanes instead of overlapping.
- **Streaming rows** — ESPN+, Disney+, Peacock, B1G+, etc. get their own row-groups; non-televised games group in an "Other" row at the bottom.
- **Day tabs** — a seven-day window (Thursday→Wednesday) defaulting to today, with previous/next week navigation.
- **Filters** — Top 25, conferences (Big Ten, SEC, ...), televised only.
- **Live scores** — scheduler-driven polling (30s live / 2min pending / 15min settled) with stale/error states that keep the last good data visible.

## Data

Scores and broadcast info come from ESPN's free public scoreboard API (no key, CORS-open — verified empirically; see [docs/DATA.md](docs/DATA.md)). `scripts/probe_espn.py` regenerates the evidence.

## Tech Stack

- React 18 + Vite + TypeScript
- Deployed as a static site on GitHub Pages (no backend; a gateway is a documented deferred option, not part of v1)

## Project Layout

- `docs/SPEC.md` — UI/layout specification
- `docs/DATA.md` — data source details, field mapping, refresh/error policy, provider contract
- `docs/ARCHITECTURE_ASSESSMENT.md` — external architecture assessment (A1–A13)
- `docs/ADVERSARIAL_REVIEW.md` — external spec review (F1–F7)
- `docs/REVIEW_RESPONSE.md` — disposition of every review finding
- `scripts/probe_espn.py` — ESPN API verification probe
- `src/` — application code (to be scaffolded)

## Development

```bash
npm install
npm run dev
```

## Status

Spec phase — reviewed, revised, and empirically verified. Application code to follow.
