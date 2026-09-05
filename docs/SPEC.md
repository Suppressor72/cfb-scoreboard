# UI / Layout Specification

Overall shape: single-page app, four zones, top to bottom:

1. **Header** — app title, refresh status ("Live · updated 12s ago" / "Stale ·
   last updated 4 min ago" / error state), manual refresh button.
2. **Day tabs** — seven consecutive days (see below) + previous/next week arrows.
3. **Filter bar** — chips, multi-select, **additive within the selection
   group** (see Filters), persisted to localStorage (versioned; corrupt/missing
   storage must never block startup).
4. **The grid** — the TV-guide scoreboard.

## Day tabs and the week window

- The week window is **Thursday → Wednesday** (7 days), anchored to the most
  recent Thursday. Every calendar day belongs to exactly one window, so
   **today always has a tab** — including Tuesday/Wednesday midweek games.
- Days with no scheduled games render **no tab** once the week's data has
  loaded (all seven show while loading); the selected day always keeps its
  tab so deep-links stay coherent.
- Default tab: today. A "Today" shortcut appears when the user has navigated
  elsewhere.
- Prev/next arrows shift the window by 7 days (history and future schedules
  both reachable). This app-defined navigation week is independent of ESPN's
  season/week numbering and is labeled by dates, not "Week N".
- Tab badges: live-game count while live, subtle "done" tick when all games
  final.
- Overnight games stay on their kickoff date's tab; if yesterday's game is
  still live, today's tab shows a one-line carryover ("Still live: HAW 21 —
  UNLV 17, Q4") linking to yesterday's tab.

## Filters

- `Top 25` — game included when **either** team is ranked.
- Conference chips (`Big Ten`, `SEC`, `Big 12`, `ACC`, + an "Other
  conferences" rollup) — included when **either** team's conference matches.
  Unknown membership keeps the game visible under no conference chip and never
  matches a conference filter.
- **Selection chips are additive (union):** Top 25 + Big Ten shows all Top 25
  games *plus* all Big Ten games — never the intersection.
- `Televised only` — at least one broadcast assignment of kind `tv` (known
  streaming counts separately; see "Broadcast rows"). Games with unknown
  availability are *not* hidden by this filter — they show a "TV?" hint.
- Zero matches → empty state naming the active filters with a one-click
  "clear filters" action (distinct from a day with no games at all).

## The grid

- **Rows = channel groups.** A channel group is a lane stack under one label,
  ordered: broadcast networks (ABC, CBS, FOX, NBC), cable (ESPN, ESPN2, ESPNU,
  FS1, BTN, ACCN, SECN, CBSSN, …), streaming (ESPN+, Disney+, Peacock,
  B1G+, …), and finally **"Other"** for no/unknown broadcast. Channel order
  from a static table; unmapped names slot after their kind group
  alphabetically.
- A game's row is decided by its `primaryBroadcast` (deterministic pick per
  DATA.md). All other assignments appear in the popover.
- **Collision handling — packed lanes:** games are sorted by
  `(kickoff, id)`; each game goes into the first existing lane whose last
  game ends at/before its kickoff; a new lane is appended when none fits
  (greedy interval packing, stable across refreshes because ordering is
  deterministic). A channel group renders as 1 lane when its games never
  overlap, or N stacked lanes when they do — three simultaneous ESPN+ games
  become three thin lanes, never overlapping blocks.
- **Row collapse:** any channel group with more than 2 lanes renders
  collapsed to 2 lanes with a "+N more" chip; expanding shows all lanes. This
  applies to *every* channel (streaming rows included), not just "Other".
- **Horizontal axis = time**, user's local timezone, epoch-ms geometry.
  Hour ticks (half-hour on dense days), labeled both edges of the scroll
  range. Window covers all games on the selected day, extended past midnight
  for overnight finishers. A "now" line renders only on days with live games
  and is an isolated element (its clock does not re-render the grid).
- Sticky channel rail on the left; horizontal scroll when the day exceeds the
  viewport.

### Block geometry

ESPN provides no end times, so every right edge after kickoff is a **labeled
estimate**:

| Phase | Left edge | Right edge |
|---|---|---|
| Scheduled | kickoff | kickoff + 3h30m |
| Live | kickoff | kickoff + 3h30m — the slot follows the *schedule*, never "now"; the now-line shows progress through the slot |
| Final / Final-OT | kickoff | kickoff + 3h30m / 4h00m |
| Postponed/canceled | scheduled slot | hatched block, "PPD"/"CNCL" |

- **Minimum readable width:** block content (two abbreviations + status) has a
  fixed minimum width rendered as a callout extending right of the true start
  point, so a game that just kicked off never collapses to a zero-width
  target. The true interval stays visible via the block's edge ticks.
- **Stability across polls:** lane assignment and block bounds are recomputed
  only from the deterministic sort — a 30s poll never reshuffles lanes or
  re-anchors scroll mid-read.

### Block contents

- Team abbreviations with rank suffix (`MICH #4`, `OSU`), brand-color border
  (leading team's color live/home team pre-game; computed contrast, neutral
  fallback when brand color fails WCAG AA), scores per team when defined,
  status line: kickoff time (pre), quarter+clock or "HALF" (live), "Final"
  (post). Winner renders bold after completion; postponed/canceled render
  hatched with text, never implying a winner.
- Live indicator: dot + the word "LIVE" (not color alone), static under
  `prefers-reduced-motion`.

### Interactions

- Every block is a **focusable button**; activating it opens a **non-modal**
  popover: full team names, records, venue, *all* broadcast assignments,
  status, and the gamecast link (external, validated https). Escape closes;
  focus returns to the block; focus is preserved across poll re-renders.
- Clicking a channel label focuses that channel (dims others); clicking again
  clears. Focus mode is a visual state only — it never removes games from the
  a11y tree or DOM order.

## Responsive and accessible behavior

- **Narrow screens (< ~720px):** the grid is replaced by a compact
  chronological list (same snapshots, same filters, same selectors): one card
  per game — time, matchup, score, status, primary channel. This is a
  first-class view, not a degraded one.
- Tabs implement the WAI-ARIA tabs pattern (arrow-key navigation, explicit
  selected state). The grid uses semantic sections (channel = heading + list
  of game buttons), not an ARIA grid role.
- Live region announces score changes sparingly (changed games only, not the
  whole grid). All state (live/winner/final) is available as text.
- Team logos lazy-load with broken-image fallbacks.

## States

| State | Presentation |
|---|---|
| First load of a week | Skeleton lane rows per channel |
| Initial fetch error | Error panel with retry (never "no games") |
| Refresh failure | Keep scores, stale banner "last updated Xm ago", auto-retry per DATA.md backoff |
| Rate-limited (429) | Cadence suspended per DATA.md; banner notes paused updates |
| Partial payload | Games render; footnote "N games skipped due to provider data issues" |
| Offline | Detected via `online` events; banner; auto-resume |
| No games on day | Distinct message from filtered-empty; suggests adjacent days |
| No filter matches | Names active filters + "clear filters" |
| TBD kickoff | Listed in a "Time TBA" strip below the grid for that day (grouped by primary channel), not on the time axis |
| Postponed/canceled | Hatched block + text; no winner |

## Refresh behavior (mirror of DATA.md policy)

- Scheduler-driven only (see DATA.md): 30s while live/±15min of kickoff, 2min
  for pending/empty days, 15min TTL for settled days, paused when hidden,
  forced on visibility/online recovery.
- Manual refresh coalesces with in-flight requests.
- Header shows fetch status and last-success time.

## Non-goals (for now)

- Play-by-play, box scores, betting lines (link out to ESPN gamecast)
- Per-market regional listings (national schedule only)
- User accounts (localStorage preferences only)
- A backend/gateway (added only on the triggers documented in DATA.md)

## Visual direction

Dark theme first (brand colors pop on dark chrome), neutral chrome so team
colors carry the palette. Clean sans-serif. "Broadcast graphics package," not
"dashboard."

## Deployment contract (GitHub Pages)

- Vite `base` set to the repository path; asset URLs relative so the build
  works from the Pages subpath.
- Shareable day/week state lives in the URL query or hash — no server route
  rewrites assumed.
- CI: clean install with committed lockfile → typecheck → tests → production
  build → deploy artifact → post-deploy smoke test (app shell loads **and**
  one live API fetch succeeds from the deployed origin). Prior artifact
  retained for rollback.
- Repo hygiene: sanitized fixtures only (no personal data, no credentials);
  external content (team text, logos, links) rendered as data with validated
  URLs — never injected as HTML.
