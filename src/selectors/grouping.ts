/**
 * Day grouping: assigns each game to exactly one local calendar day tab.
 * Time-valid games group by the user's timezone; TBD-time games keep their
 * provider (US Eastern) bucket date. See docs/DATA.md.
 */
import { localDateInTz } from "../lib/dates";
import type { Game } from "../api/types";

export function dayKeyOfGame(game: Game, tz: string): string | null {
  if (!game.kickoffUtc) return null;
  if (game.timeTbd) {
    // ESPN parks TBD-time games at T00:00Z whose UTC date component is the
    // intended provider bucket date — don't run it through tz math.
    return /^\d{4}-\d{2}-\d{2}/.exec(game.kickoffUtc)?.[0] ?? null;
  }
  const ms = Date.parse(game.kickoffUtc);
  if (Number.isNaN(ms)) return null;
  return localDateInTz(ms, tz);
}

export function gamesForDay(games: Game[], day: string, tz: string): Game[] {
  return games.filter((g) => dayKeyOfGame(g, tz) === day);
}

/** Games with no trustworthy kickoff time — rendered in the "Time TBA" strip. */
export function timeTbaGames(games: Game[], day: string, tz: string): Game[] {
  return games.filter((g) => g.timeTbd && dayKeyOfGame(g, tz) === day);
}
