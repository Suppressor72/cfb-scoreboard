# Adversarial review

Reviewed: 2026-09-05

## Scope and method

Reviewed all three existing project files: `README.md`, `docs/SPEC.md`, and
`docs/DATA.md`. This is a specification and data-contract review, not a runtime
code audit. The workspace contains no application source, package manifest,
tests, or Git metadata. No build or runtime tests could be run. External API
behavior was not verified; findings below follow from the local documents and
explicit hypothetical inputs, without assuming undocumented ESPN behavior.

Severity: **P1** blocks a core promised behavior; **P2** creates a material
functional or reliability gap. References use line numbers at review time.

## Findings

### F1 — P1: An open pregame day never automatically discovers kickoff

**References:** [DATA.md](DATA.md), lines 59–62;
[SPEC.md](SPEC.md), lines 60–63.

**Trigger:** Open a day before its first game starts and leave that tab selected.
Every cached game is `pre`, so the only defined automatic polling condition is
false. Cache expiry alone does not issue a request, and no tab change occurs.

**Impact:** The page can remain pregame indefinitely, missing live scores unless
the user refreshes manually. The same gap occurs between games when one finishes
before the next starts. A TTL for near-future games is also unspecified.

**Recommendation:** Define periodic revalidation for the current day while games
remain pending, with faster polling during live play. Define how forced polls
interact with the 60-second cache TTL so a 30-second poll actually fetches fresh
data. Revalidate when the page resumes from suspension.

**Acceptance scenario:** With a controlled clock and a provider that transitions
`pre → in → post`, leave the page open across kickoff and a gap between games.
It must discover each transition within a documented refresh bound without input.

### F2 — P1: Completed game widths cannot be computed from the provider contract

**References:** [SPEC.md](SPEC.md), lines 27–28;
[DATA.md](DATA.md), lines 76–85.

**Trigger:** Load a historical day directly. A completed `Game` supplies kickoff
and state but no final timestamp or elapsed wall-clock duration.

**Impact:** The renderer cannot place the required right edge at final time.
Two games with identical normalized fields but different finish times are
indistinguishable. Recording when the browser first observes `post` would not
recover a historical finish time and would vary with polling delays.

**Recommendation:** Establish an actual source for an optional `endUtc`, preserve
it in the contract, and define a clearly identified estimate when it is absent.
Do not require exact historical duration unless the data source can support it.

**Acceptance scenario:** Render a completed game on a fresh page load, both with
and without an end timestamp. Both cases must have deterministic, documented
widths, with an estimate distinguishable from a known finish time.

### F3 — P1: Concurrent games on a shared channel occupy the same space

**References:** [SPEC.md](SPEC.md), lines 19–28 and 56.

**Trigger:** Supply two games on ESPN+ with identical kickoff times, or two
non-televised games assigned to Other. Their horizontal intervals overlap and
the specification assigns both to the same row.

**Impact:** A literal implementation paints blocks over each other, hiding
scores and obstructing click targets. Collapsing Other with a count does not
specify how expanded games are made accessible, and does not address streaming
rows. The problem also applies to a broadcast game running into the next slot.

**Recommendation:** Specify collision handling, such as interval-packed subrows
within each channel, and define expanded/collapsed behavior for every row that
can contain concurrent games.

**Acceptance scenario:** Render three simultaneous games on one streaming
service and three in Other. Every game must remain individually discoverable
and selectable, including after expansion and filtering.

### F4 — P1: Conference filtering has no data in the normalized model

**References:** [SPEC.md](SPEC.md), lines 11–14;
[DATA.md](DATA.md), lines 76–93.

**Trigger:** Apply the Big Ten filter to a cross-conference matchup. `TeamResult`
contains neither conference membership nor a stable team identifier with which
to join a membership dataset.

**Impact:** The advertised filter cannot be implemented from the provider output.
Matching names or abbreviations would introduce an undeclared and fragile lookup
outside the promised provider boundary.

**Recommendation:** Preserve stable team IDs and normalized conference membership,
with a defined source and season context. Specify whether a matchup qualifies
when either team belongs to a selected conference and how unknown membership is
handled.

**Acceptance scenario:** Filter fixtures containing an in-conference game, a
cross-conference game, an unrelated game, and a team with unknown membership.
Results must follow the documented inclusion rule.

### F5 — P2: The popover requires fields discarded by the provider

**References:** [SPEC.md](SPEC.md), lines 41–42;
[DATA.md](DATA.md), lines 76–93.

**Trigger:** Open a game popover using only a normalized `Game`.

**Impact:** Team records, venue, and the ESPN gamecast URL cannot be rendered:
none exists in the provider interface. Accessing the raw ESPN response from UI
components would undermine the provider isolation required in DATA.md lines 8–10.

**Recommendation:** Add optional normalized record, venue, and gamecast URL
fields, define their mappings, and specify the UI treatment when they are absent.

**Acceptance scenario:** Render complete and sparse normalized fixtures without
raw provider data. Show available details and omit unavailable fields or links
without fabricating values.

### F6 — P2: Thursday–Monday tabs cannot satisfy the default-today rule all week

**References:** [SPEC.md](SPEC.md), lines 8–10;
[DATA.md](DATA.md), lines 53–55.

**Trigger:** Open the app on a Tuesday or Wednesday, or supply a game on either
day in the intended week.

**Impact:** Today has no corresponding tab, and those days are outside the
specified fetch window. There is no rule for the selected day or a way to reach
those games. The data document's “5–7 day” wording does not resolve the explicitly
Thursday-through-Monday range.

**Recommendation:** Define a seven-day week boundary and include every date, or
explicitly define off-window navigation and the default selection on those days.

**Acceptance scenario:** Initialize the app on each day of a week. The selected
date must exist and a fixture on Tuesday or Wednesday must be reachable.

### F7 — P2: Fetch failures have no defined state or stale-data treatment

**References:** [SPEC.md](SPEC.md), lines 48–63;
[DATA.md](DATA.md), lines 6–10 and 57–65.

**Trigger:** The first request fails, or a live refresh fails after scores have
already loaded. Rate limits and provider changes are expressly anticipated.

**Impact:** The defined UI states cannot distinguish unavailable data from an
empty schedule, or stale scores from successfully refreshed live scores. No
retry policy specifies how polling responds to repeated failure.

**Recommendation:** Specify an initial-load error with retry, preservation of
previous results on refresh failure, a visible last-success/stale indicator, and
bounded retries with backoff and rate-limit handling.

**Acceptance scenario:** Simulate initial failure, refresh failure, repeated
rate limiting, and recovery. Existing games must survive refresh failure, an
error must not become “no games,” and recovery must clear the stale state.

## Disposition

Seven design findings: four P1 and three P2. No implementation defects or
exploitable vulnerabilities were verified because there is no implementation.
Resolve these contract and behavior gaps before scaffolding the core grid and
data layer. The acceptance scenarios above are proposed future checks, not tests
that have been executed. No fixes were applied to the reviewed specifications.
