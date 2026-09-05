# Data Source: ESPN Public Scoreboard API

ESPN's site API is free, requires no key, and returns everything this app needs:
teams, ranks, scores, game status, start times, broadcast assignments, venue,
records, and gamecast links.

> **Note:** This API is undocumented and unofficial. It has been stable for
> years and is used widely by hobby projects, but it could change or rate-limit
> at any time. All ESPN knowledge is isolated behind a single provider module
> (see [Module boundaries](#module-boundaries)) so a replacement can be added
> without touching the UI. See [Fallback provider](#fallback-provider) for why
> CFBD is *not* a drop-in replacement.

## Verified behavior

Probed 2026-09-05 with `scripts/probe_espn.py` (curl transport). Facts below
are observed, not assumed:

- **CORS is permissive.** Every response carries `Access-Control-Allow-Origin:
  *`, so a static site on GitHub Pages can call the API directly from the
  browser. (One edge observation: the API 403s some non-browser clients —
  Python urllib and PowerShell were denied while curl succeeded. Denial of one
  client does not imply browser denial, but it proves the edge does filter by
  client fingerprint. A deployed-origin smoke test remains a release gate.)
- **No truncation on busy days.** Saturday 2026-09-12 returned 80 events with
  the default limit; `limit=400` returned the same 80. We still pass
  `limit=300` on range queries as cheap insurance.
- **Range queries work.** `dates=20260903-20260907` returned a superset of the
  individual-date queries for those dates (zero events missing, zero overlap).
  One range request per week window is enough.
- **Date bucketing is US-Eastern-ish.** A query for `20260905` includes games
  kicking off as late as `2026-09-06T02:30Z` (7:30pm PT Saturday) and has zero
  ID overlap with `20260906` (whose earliest game is 20:00Z Sunday). So a game
  belongs to the provider date of its US Eastern kickoff, not its UTC date.
  Because the exact rule is inferred, the app never trusts a single provider
  date to equal a local day — see [Local days and timezones](#local-days-and-timezones).
- **`groups` filter works server-side and matches either competitor.**
  `groups=5` returns all games involving a Big Ten team, including
  cross-conference games (e.g. `UNT(151) @ IU(5)`).
- **FCS games are included** in unfiltered results (e.g. `MERC @ NMSU`).
  Filtering FCS out is our choice, not the API's.

## Endpoint

```
GET https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=YYYYMMDD-YYYYMMDD&limit=300
```

Optional `groups=ID` filters to games involving a conference/group.
Verified `conferenceId` values (probed against 2026-09-05 games; `src/api/conferences.ts`
is the canonical map): ACC=1, Big 12=4, Big Ten=5, **SEC=8**, Pac-12=9,
C-USA=12, MAC=15, Mountain West=17, FBS Independents=18, Sun Belt=37, CAA=48,
American=151. Unknown IDs bucket under "Other conferences" and never match a
conference filter. (An early draft carried SEC=7 from memory — it silently
broke the SEC filter until probed. Lesson applied: probe, don't recall.) The app fetches **unfiltered** range data
and filters client-side; `groups` is documented because it composes with
ranges if we ever need to shrink payloads.

## Field mapping (per event in `events[]`)

| ESPN field | Normalized to | Notes |
|---|---|---|
| `id` | `game.id` | stable; dedupe key across overlapping date queries |
| `date` | `kickoffUtc` | ISO 8601 Zulu; convert to user's local time for display |
| `competitions[].timeValid` / `dateValid` | `timeTbd` | ESPN parks TBD-time games at `T00:00Z`; when `timeValid` is false, treat time-of-day as unknown |
| `status.type.state` | `phase` | `"pre"`, `"in"`, `"post"` |
| `status.type.name` | `statusKind` | `STATUS_SCHEDULED`, `STATUS_IN_PROGRESS`, `STATUS_HALFTIME`, `STATUS_END_OF_REG`, `STATUS_FINAL`, `STATUS_FINAL_OT` (and postponed/canceled variants); unknown names map to `unknown`, never crash |
| `status.type.completed` | `completed` | boolean |
| `status.type.shortDetail` | `statusDetail` | "Q3 8:12", "Final/OT", "Halftime" |
| `competitors[].homeAway` | role | home/away |
| `competitors[].team.displayName` / `abbreviation` | names | |
| `competitors[].team.id` | `team.id` | stable team id; conference join key |
| `competitors[].team.conferenceId` | `team.conference` | **present on every competitor** (160/160 in probe); map to name via static table, absent → unknown |
| `competitors[].curatedRank.current` | `rank` | 1–25 ranked, 99 unranked, **can be absent** → unranked |
| `competitors[].score` | `score` | ⚠️ present as `0` pre-game; expose as `undefined` while `phase === "pre"` so the UI never shows a fake 0–0 |
| `competitors[].winner` | `winner` | present on the winner when final; a canceled game implies no winner |
| `competitors[].records[]` | `record` | entry with `name === "overall"`, e.g. `"2-0"`; absent → omitted |
| `team.logo` / `color` / `alternateColor` | branding | brand color for blocks |
| `competitions[].venue.fullName` + `address` | `venue` | optional |
| `competitions[].broadcasts[]` | `broadcasts` | list of `{market, names[]}` — see below |
| `links[]` where `rel` includes `summary` | `gamecastUrl` | `https://www.espn.com/...`; validate scheme+host before use |

**No end time exists anywhere in the payload.** Completed-game width is always
an estimate (see SPEC, "Block geometry").

### Broadcasts

`broadcasts` is a list of `{ market, names[] }`. A single entry can carry both
TV and streaming names (observed: `["ABC","Disney+"]`, `["ACC Network","ACCNX"]`,
`["ESPN","Disney+"]`). Markets observed: `national`; others (regional, home
market, Spanish-language) may appear. Normalization:

- Flatten to `BroadcastAssignment[]`: `{ source: string, kind: "tv" | "stream" | "unknown" }`.
  `kind` comes from a static name→kind table (ESPN+, Disney+, ACCNX, SECN+,
  B1G+, Peacock, … → stream; ESPN/2/U, SECN, BTN, ACCN, FOX, FS1, CBS, CBSSN,
  NBC, CW, … → tv; unmapped → unknown).
- `game.primaryBroadcast` = deterministic pick: first national TV assignment,
  else first national assignment of any kind, else first assignment, else
  `null` with `availability: "unknown"`.
- **An empty `broadcasts` list is not proof a game isn't televised** — it is
  `availability: "unknown"`. Only a deliberate future enhancement would mark
  "confirmed none". The "Televised only" filter shows games with at least one
  known-TV assignment; unknown-availability games are shown with a "TV?" hint,
  not hidden.
- The grid is a *national* schedule with a primary channel; it is not a
  per-market listings feed. All assignments appear in the game popover.

## Local days and timezones

Provider date buckets ≠ user-local days. Rules:

- App state stores the **local calendar date + IANA timezone**.
- A local day `[localMidnight, nextLocalMidnight)` is converted to its UTC
  interval (DST-aware — a "day" is not always 24h).
- The week window maps to a covering **provider** (Eastern) date range plus
  ±1 day of safety margin; all events are deduped by `id`, then grouped to
  local days by `kickoffUtc` **only when `timeValid`**, else by the provider
  date.
- One fetch per week window covers all seven day tabs; switching tabs reads
  the cache, not the network.
- Overnight games stay on their kickoff date's tab. If a game from yesterday
  is still live, today's tab shows a one-line carryover link.
- Horizontal geometry uses epoch milliseconds; labels use
  `Intl.DateTimeFormat` with the stored timezone.

## Refresh policy

One scheduler owns all fetching (no per-component timers), driven by the
**unfiltered** snapshot + wall clock, so filtered-out live games still trigger
refreshes:

| Condition (selected day, visible page) | Behavior |
|---|---|
| Any live game, or kickoff within 15 min | Fetch every 30s, bypassing cache freshness |
| No live games but pending games today, or day is empty | Revalidate every 2 min (discovers schedule changes, kickoff, and empty→scheduled days) |
| All-final past day, or future day | Revalidate on selection if snapshot older than 15 min |
| Last live game just completed | One extra refresh ~2 min later (picks up final/corrections), then historical policy |
| Hidden tab / `document.hidden` | Pause polling; force revalidate on `visibilitychange` / `online` (covers sleep/wake) |
| Manual refresh | Force fetch, coalesced with any in-flight request |

**Kickoff discovery bound:** with the page open, a scheduled game's `pre → in`
transition is reflected within one polling interval plus request latency.

### Caching

- In-memory cache keyed by `(provider, "week", weekStartDate, schemaVersion)`;
  bounded to the current and adjacent week windows.
- Filters never trigger fetches; they re-read cached snapshots.

## Errors, staleness, and validation

- **Typed failures:** `network`, `timeout`, `http` (with status), `parse`,
  `schema`. Each carries `retryable` and optional `retryAfterMs`.
- **Refresh failure keeps the last good snapshot.** UI shows a stale banner
  with last-success time; scores stay visible. An error is never rendered as
  "no games today".
- **Retry policy:** transient failures (network/timeout/5xx/429) retry with
  jittered backoff 30s → 60s → 120s, capped at 5 min; honor `Retry-After`.
  Non-retryable denials (403/404) stop auto-retry and surface an error with a
  manual retry button. Rate-limit cooldown suspends the 30s live cadence
  rather than hammering.
- **Runtime validation at the boundary:** the adapter treats the response as
  `unknown`; validates ids, timestamps, roles, finite scores, optional fields.
  Valid events from a partially malformed response are kept, with
  `coverage: "partial"` and a count of rejected events; an invalid envelope is
  a `schema` error.
- **Request ordering:** all requests flow through the coordinator with a
  generation counter; obsolete responses (stale tab, superseded poll) are
  dropped even when abort arrives late. In-flight requests for the same key
  are deduplicated.
- **Corrections:** scores/states are not forced to be monotonic — ESPN
  legitimately corrects downward.
- **Deletion safety:** games are removed from cache only by a complete,
  authoritative (non-partial) snapshot; partial responses can add/update but
  never delete.

## Module boundaries

```
UI (React) → selectors (pure: filters, local dates, lanes)
           → store (snapshots + freshness/error state)
scheduler (one owner of timers/requests) → provider contract
ESPN adapter (validation + normalization) → transport (fetch)
```

- UI consumes normalized `Snapshot` objects + freshness state only; components
  never see ESPN JSON paths and never own timers.
- Filter/date/lane math is pure and unit-tested without network.

## Fallback provider

**Deferred — not a v1 feature.** CFBD was initially described here as an easy
free fallback; review corrected this:

- CFBD authenticates with a bearer key. Any app-owned key must live in a
  server-side gateway — build-time Vite env vars are public to every visitor.
- Per CFBD's published tiers (verify at integration), live scoreboard access
  begins above the free tier, so CFBD cannot restore *live scores* for free.
- A CFBD adapter could not guarantee parity (broadcasts, end times, ranks).

If ESPN access from browsers ever breaks, the migration path is a small
serverless gateway (shared cache, secret storage, fixed upstream routes,
never an open proxy), keeping the UI contract unchanged. Reassess only on
trigger: sustained 429s/denials, edge fingerprint filtering of browsers, or
traffic that makes per-client polling inappropriate.

## Provider contract (v1)

```ts
type Phase = "pre" | "in" | "post";
type StatusKind =
  | "scheduled" | "live" | "halftime" | "end_of_reg"
  | "final" | "final_ot"
  | "delayed" | "postponed" | "canceled"
  | "unknown";

interface BroadcastAssignment {
  source: string;                     // "ABC", "ESPN+", "Disney+"
  kind: "tv" | "stream" | "unknown";  // static name→kind table
}

interface TeamResult {
  id: string;                         // stable ESPN team id
  name: string; abbreviation: string;
  logo?: string; color?: string;
  rank?: number;                      // 1–25 AP; absent = unranked
  record?: string;                    // "2-0"; absent = unknown
  conference?: string;                // normalized name; absent = unknown
  score?: number;                     // defined only when phase !== "pre"
  winner?: boolean;                   // only when final, never on canceled
}

interface Game {
  id: string;
  kickoffUtc: string | null;          // null = date unknown/TBD
  timeTbd: boolean;                   // true = date known, time unknown
  phase: Phase;
  statusKind: StatusKind;
  statusDetail: string;
  home: TeamResult; away: TeamResult;
  broadcasts: BroadcastAssignment[];  // all assignments; may be empty
  primaryBroadcast: string | null;    // deterministic pick (see above)
  availability: "tv" | "stream" | "unknown";  // from primary/any assignment
  venue?: { name: string; city?: string };
  gamecastUrl?: string;               // validated https espn.com link
  endUtc?: null;                      // reserved; ESPN provides no end time
}

interface Snapshot {
  games: Game[];
  fetchedAt: string;                  // local clock
  lastSuccessAt: string;
  coverage: "complete" | "partial";   // partial = some events rejected
  warnings: string[];
}

// fetchWeek(weekStart: string /* local date */, tz: string, signal: AbortSignal): Promise<Snapshot>
```
