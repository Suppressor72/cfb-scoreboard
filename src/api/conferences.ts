/**
 * ESPN conferenceId → name. Only IDs verified against live payloads are
 * mapped (see docs/DATA.md "Verified behavior"); everything else renders as
 * an unknown conference (never matches a conference filter).
 */
export const CONFERENCE_BY_ID: Record<string, string> = {
  "1": "ACC",
  "4": "Big 12",
  "5": "Big Ten",
  "7": "SEC",
  "9": "Pac-12",
  "15": "MAC",
  "18": "FBS Independents",
  "37": "Sun Belt",
  "151": "American",
};

/** Conference chips shown in the filter bar (SPEC.md). */
export const FILTER_CONFERENCES = ["Big Ten", "SEC", "Big 12", "ACC"] as const;
