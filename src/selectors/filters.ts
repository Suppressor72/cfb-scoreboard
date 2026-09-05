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
 * - Selection chips (Top 25 + conferences) are ADDITIVE: a game shows when it
 *   matches ANY selected group — Top 25 ∪ Big Ten, not their intersection.
 * - Top 25: either team ranked; Conference: either team's conference matches
 *   (unknown membership never matches).
 * - Televised only is a restriction applied on top of the selection: keep
 *   games with a known TV assignment; unknown-availability games are NOT
 *   hidden (missing broadcasts ≠ not televised) — UI hints "TV?"
 */
export function applyFilters(games: Game[], f: Filters): Game[] {
  const hasSelection = f.top25 || f.conferences.length > 0;
  return games.filter((g) => {
    if (hasSelection) {
      const top25Match =
        f.top25 && (g.home.rank !== undefined || g.away.rank !== undefined);
      const conferenceMatch = f.conferences.some(
        (c) => g.home.conference === c || g.away.conference === c,
      );
      if (!top25Match && !conferenceMatch) return false;
    }
    if (f.televisedOnly && g.availability !== "tv" && g.availability !== "unknown") {
      return false;
    }
    return true;
  });
}
