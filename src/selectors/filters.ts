/** Pure client-side filters — a filter change must never trigger a fetch. */
import type { Game } from "../api/types";

export interface Filters {
  top25: boolean;
  conferences: string[];
  televisedOnly: boolean;
}

export const NO_FILTERS: Filters = {
  top25: false,
  conferences: [],
  televisedOnly: false,
};

export function hasActiveFilters(f: Filters): boolean {
  return f.top25 || f.conferences.length > 0 || f.televisedOnly;
}

/**
 * Inclusion rules (docs/SPEC.md "Filters"):
 * - Top 25: either team ranked
 * - Conference: either team's conference matches (unknown membership never matches)
 * - Televised only: keep games with a known TV assignment; unknown-availability
 *   games are NOT hidden (missing broadcasts ≠ not televised) — UI hints "TV?"
 */
export function applyFilters(games: Game[], f: Filters): Game[] {
  return games.filter((g) => {
    if (f.top25 && !(g.home.rank !== undefined || g.away.rank !== undefined)) {
      return false;
    }
    if (
      f.conferences.length > 0 &&
      !f.conferences.some(
        (c) => g.home.conference === c || g.away.conference === c,
      )
    ) {
      return false;
    }
    if (f.televisedOnly && g.availability !== "tv" && g.availability !== "unknown") {
      return false;
    }
    return true;
  });
}
