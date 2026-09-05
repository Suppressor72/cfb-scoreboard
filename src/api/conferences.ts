/**
 * ESPN conferenceId → name. Only IDs verified against live payloads are
 * mapped (see docs/DATA.md "Verified behavior" — re-verified 2026-09-05);
 * everything else renders as an unknown conference (never matches a
 * conference filter). SEC is 8: an early draft carried 7 from memory and
 * silently broke the SEC filter until probed.
 */
export const CONFERENCE_BY_ID: Record<string, string> = {
  "1": "ACC",
  "4": "Big 12",
  "5": "Big Ten",
  "8": "SEC",
  "9": "Pac-12",
  "12": "C-USA",
  "15": "MAC",
  "17": "Mountain West",
  "18": "FBS Independents",
  "37": "Sun Belt",
  "48": "CAA",
  "151": "American",
};

/** Conference chips shown in the filter bar (SPEC.md). */
export const FILTER_CONFERENCES = ["Big Ten", "SEC", "Big 12", "ACC"] as const;
