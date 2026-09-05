# Review response

Response to [ADVERSARIAL_REVIEW.md](ADVERSARIAL_REVIEW.md) (findings F1–F7)
and [ARCHITECTURE_ASSESSMENT.md](ARCHITECTURE_ASSESSMENT.md) (A1–A13).
Disposition: **13 findings adopted into the v1 specs, 3 adopted as explicitly
deferred work with triggers, 2 accepted with corrections.** DATA.md and
SPEC.md have been rewritten accordingly; this file records why.

New empirical evidence (from `scripts/probe_espn.py`, run 2026-09-05) resolved
several findings whose facts were unknown at review time — notably that
`access-control-allow-origin: *` is present, conference IDs ship on every
competitor, and per-date buckets are US-Eastern-based.

## Adversarial review findings

| # | Finding | Disposition | Action taken |
|---|---|---|---|
| F1 | Pregame day never discovers kickoff | **Adopt** | DATA.md refresh policy: 2-min revalidation for pending/empty days, 30s near/live, scheduler runs off the unfiltered snapshot; visibility/online recovery; explicit kickoff-discovery bound |
| F2 | Completed-game widths uncomputable | **Adopt, with correction** | There is no end-time source in ESPN's payload (verified), so per the review's own escape hatch ("do not require exact historical duration unless the source can support it"), all right edges are *labeled estimates* (3h30m / 4h OT); `endUtc` reserved as `null` for a future provider. No "distinguish estimate from actual" UI needed since actuals never occur |
| F3 | Concurrent games on one channel overlap | **Adopt** | SPEC.md: greedy interval-packed lanes per channel (deterministic sort → stable across polls), expand/collapse generalized to every multi-lane channel, min-width callouts for zero-width intervals |
| F4 | Conference filter has no data | **Adopt — resolved empirically** | Probe: `team.conferenceId` present on 160/160 competitors; `groups=ID` verified server-side with either-team semantics. Contract gains `team.conference` via static id→name map; unknown membership defined as never-matching |
| F5 | Popover fields discarded by provider | **Adopt — resolved empirically** | `records[]` (overall), `venue`, and summary `links[]` all verified present; added as optional fields with absent-behavior defined |
| F6 | Thu–Mon tabs break default-today | **Adopt** | SPEC.md: 7-day Thursday→Wednesday window anchored to most recent Thursday; today always has a tab; prev/next week navigation |
| F7 | No failure/stale states | **Adopt** | DATA.md typed errors, keep-last-snapshot, backoff w/ Retry-After, 429 cooldown; SPEC.md state table distinguishes error/empty/filtered/partial/offline |

## Architecture assessment findings

| # | Finding | Disposition | Action taken |
|---|---|---|---|
| A1 | Contract can't support the UI (F2/F4/F5) | **Adopt** | Provider contract expanded (broadcast list, conference, record, venue, link, structured status, optional scores, partial coverage) |
| A2 | Polling can't discover live games (F1) | **Adopt** | One scheduler owns timers/requests; cadence from unfiltered snapshot + wall clock; UI never owns timers |
| A3 | Date selection conflated with provider dates | **Adopt** | DATA.md "Local days and timezones": local date + IANA tz, covering provider range ±1 day, dedupe by id, filter locally; overnight carryover; epoch geometry. Bucketing probed as Eastern-based, but the defensive covering rule stays regardless |
| A4 | Grid is not a complete layout algorithm | **Adopt** | Packed lanes + min-width interaction surface + stable bounds + overnight extension, applied to all channel types |
| A5 | Browser API availability unproven | **Accept with correction** | Probe result: responses carry `access-control-allow-origin: *`, and default limit returned all 80 games of a busy Saturday (no truncation); range queries verified. The review's "Access Denied" was its sandbox's client fingerprint being filtered (Python urllib reproduces it here; curl succeeds) — evidence the edge filters *clients*, not browsers. Residual risk is folded into the release gate: post-deploy smoke test fetches live data from the Pages origin |
| A6 | CFBD fallback not free/browser-only | **Adopt as correction** | DATA.md "Fallback provider" rewritten: deferred, gateway-only if ever, tier/key constraints recorded, parity matrix required, reassess-on-trigger only. Original text oversold it |
| A7 | Async races can overwrite newer data | **Adopt** | Single coordinator, generation counter, drop-late writes, in-flight dedupe |
| A8 | No runtime validation / incomplete lifecycle | **Adopt** | DATA.md: unknown-at-boundary validation, partial-vs-invalid envelope rules, structured `StatusKind` incl. delayed/postponed/canceled, no fake 0 scores (verified pre-game scores arrive as literal `0`), no winner on canceled, partial snapshots can't delete |
| A9 | Broadcast normalization loses information | **Adopt** | `BroadcastAssignment[]` with kind table; deterministic primary pick; empty ≠ untelevised (`availability: "unknown"` + "TV?" hint); all assignments in popover; "national schedule, not a listings feed" framing |
| A10 | Failure/freshness not observable | **Adopt** | Header freshness/stale/error status; typed failures; bounded diagnostics counts; distinct empty-vs-error-vs-partial states |
| A11 | Unbounded aggregate polling budget | **Adopt the mitigations, defer the gateway** | v1: visibility-aware cadence, dedupe, backoff. Gateway only on the documented triggers (sustained denial, adoption at scale) — building one now for a hobby scoreboard is premature |
| A12 | Accessibility/mobile need structure | **Adopt** | SPEC.md: blocks are buttons, non-modal popover w/ focus management, ARIA tabs, first-class narrow-screen list view, reduced-motion, contrast-checked brand colors, text-not-color state, sparse live-region announcements |
| A13 | Deployment/trust boundaries unspecified | **Adopt** | SPEC.md deployment contract: Vite base, query/hash URLs, CI gates, smoke test, rollback, sanitized fixtures, validated external URLs, versioned untrusted localStorage |

## Pushback and deviations

1. **A5 severity.** The assessment called browser availability unproven after a
   sandbox-local denial. A permissive CORS header is directly observable and
   is how browsers decide; the denial demonstrated client filtering, not
   origin policy. We downgrade residual risk from "P1 gate on feasibility" to
   "standard post-deploy smoke test" — while keeping A5's harder points that
   *were* legitimate (completeness, group semantics), now settled by probe.
2. **F2's "actual end-time source."** Searched the payload; none exists. Rather
   than carry a two-mode UI for a case that cannot occur with ESPN, estimates
   are the only mode, documented as such, with `endUtc` reserved in the
   contract for a future provider.
3. **Proportionality.** The full gateway/database/synthetic-monitoring program
   is out of scope for a public hobby scoreboard; deferred with explicit
   triggers rather than rejected. Several assessment decisions already
   deferred themselves (A6, A11); we codified the triggers.
4. **One simplification vs. the assessment:** week-tab summaries poll on the
   same scheduler at the slower cadence rather than a separate summary
   pipeline — one coordinator, per A2/A7's own "don't create a second
   cache/polling system" rule.

## Verification log

Evidence backing the dispositions above (probe of 2026-09-05, regenerated via
`python scripts/probe_espn.py` run through curl — see script header):

- `access-control-allow-origin: *` on all five fetched responses.
- 2026-09-12: 80 events at default limit, 80 at `limit=400`.
- `dates=20260903-20260907` ⊇ union of individual-date queries; zero missing.
- `dates=20260905` includes kickoffs through `2026-09-06T02:30Z`; zero ID
  overlap with `dates=20260906` (earliest 20:00Z) — Eastern-style buckets.
- `conferenceId` on 160/160 competitors; `groups=5` returns either-team Big
  Ten games incl. cross-conference (`UNT(151) @ IU(5)`).
- `records`, `venue`, summary `links`, `broadcasts[{market,names[]}]` all
  present; `names[]` mixes TV + streaming (e.g. `["ABC","Disney+"]`).
- Pre-game `score` arrives as `0` — contract must not expose it (see A8).
- Python urllib 403s while curl succeeds — edge filters by client, supporting
  the A5 correction above.
