import type { Game } from "../api/types";

/**
 * Team id currently leading a live game, or null when tied/not live.
 * Used to green the leader's total like the winner's on final games.
 */
export function leadingTeamId(g: Game): string | null {
  if (g.phase !== "in") return null;
  const h = g.home.score ?? 0;
  const a = g.away.score ?? 0;
  return h > a ? g.home.id : a > h ? g.away.id : null;
}

/**
 * ESPN-style team metadata line: overall record, conference record, and
 * designated conference — e.g. "(2-0, 1-0 SEC)". Missing pieces drop out.
 */
export function teamMeta(t: {
  record?: string;
  conferenceRecord?: string;
  conference?: string;
}): string | undefined {
  const records = [t.record, t.conferenceRecord].filter(
    (r): r is string => r !== undefined,
  );
  if (records.length === 0 && !t.conference) return undefined;
  const left = records.length > 0 ? records.join(", ") : "";
  return `(${[left, t.conference].filter(Boolean).join(" ")})`;
}
