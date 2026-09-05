/**
 * Normalized provider contract — the only shape UI code may consume.
 * Mirrors docs/DATA.md "Provider contract (v1)". UI never sees ESPN JSON.
 */

export type Phase = "pre" | "in" | "post";

export type StatusKind =
  | "scheduled"
  | "live"
  | "halftime"
  | "end_of_reg"
  | "final"
  | "final_ot"
  | "delayed"
  | "postponed"
  | "canceled"
  | "unknown";

export interface BroadcastAssignment {
  source: string; // "ABC", "ESPN+", "Disney+"
  kind: "tv" | "stream" | "unknown"; // from the static name→kind table
}

/** What the grid knows about TV availability. Unknown ≠ not televised. */
export type Availability = "tv" | "stream" | "unknown";

export interface TeamResult {
  id: string; // stable provider team id (conference join key)
  name: string;
  abbreviation: string;
  logo?: string; // validated https espn CDN URL (standard variant)
  logoDark?: string; // dark-background variant, derived from the team id
  color?: string;
  rank?: number; // 1–25 AP; absent = unranked
  record?: string; // "2-0"; absent = unknown
  conference?: string; // normalized name; absent = unknown
  /** Defined only when phase !== "pre" — ESPN sends literal 0 pre-game. */
  score?: number;
  /** Points per completed period (Q1–Q4, then OTs). ESPN sends strings. */
  linescores?: number[];
  /** Only when final; never on canceled/postponed. */
  winner?: boolean;
}

export interface Game {
  id: string;
  /** ISO 8601 kickoff. Null only if even the date is unknown. */
  kickoffUtc: string | null;
  /** True = date known, time-of-day not trustworthy (ESPN parks these at T00:00Z ET). */
  timeTbd: boolean;
  phase: Phase;
  statusKind: StatusKind;
  statusDetail: string; // "Q3 8:12", "Final/OT", "Halftime"
  home: TeamResult;
  away: TeamResult;
  broadcasts: BroadcastAssignment[]; // all assignments; may be empty
  primaryBroadcast: string | null; // deterministic pick, see DATA.md
  availability: Availability;
  venue?: { name: string; city?: string };
  gamecastUrl?: string; // validated https espn.com link
  /** Reserved — ESPN provides no end time; all right edges are estimates. */
  endUtc?: null;
}

export interface Snapshot {
  games: Game[];
  fetchedAt: string; // local clock, ISO
  lastSuccessAt: string;
  coverage: "complete" | "partial"; // partial = some events rejected
  warnings: string[];
}
