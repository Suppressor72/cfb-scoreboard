import type { Game } from "../api/types";
import { formatTime } from "../lib/dates";
import { normalizeHex } from "../lib/color";
import TeamLogo from "./TeamLogo";

/** Compact chronological list — first-class narrow-screen view (SPEC.md). */
export default function MobileList({
  games,
  tz,
  onSelectGame,
}: {
  games: Game[];
  tz: string;
  onSelectGame: (id: string) => void;
}) {
  const sorted = [...games].sort((a, b) => {
    const ka = a.kickoffUtc ? Date.parse(a.kickoffUtc) : Infinity;
    const kb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : Infinity;
    return ka - kb || a.id.localeCompare(b.id);
  });

  if (sorted.length === 0) return null;

  return (
    <ul className="mobile-list">
      {sorted.map((g) => {
        const kickoff = g.kickoffUtc ? Date.parse(g.kickoffUtc) : null;
        const live = g.phase === "in";
        const leader = live
          ? (g.home.score ?? 0) >= (g.away.score ?? 0)
            ? g.home
            : g.away
          : g.home;
        const bg = normalizeHex(leader.color);
        return (
          <li key={g.id}>
            <button
              type="button"
              className="mobile-card"
              style={bg ? { borderLeftColor: bg } : undefined}
              onClick={() => onSelectGame(g.id)}
            >
              <span className="mobile-when">
                {g.timeTbd
                  ? "TBA"
                  : kickoff !== null
                    ? formatTime(kickoff, tz)
                    : "TBA"}
              </span>
              <span className="mobile-matchup">
                <MobileTeam team={g.away} />
                <MobileTeam team={g.home} />
              </span>
              <span className={`mobile-status${live ? " live" : ""}`}>
                {live && <span className="pulse-dot" aria-hidden="true" />}
                {g.phase === "pre"
                  ? "Scheduled"
                  : g.phase === "in"
                    ? g.statusDetail || "Live"
                    : g.statusKind === "final_ot"
                      ? g.statusDetail || "Final/OT"
                      : "Final"}
              </span>
              <span className="mobile-channel">
                {g.primaryBroadcast ?? (g.availability === "unknown" ? "TV?" : "Other")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MobileTeam({ team }: { team: Game["away"] }) {
  return (
    <span className={`mobile-team${team.winner ? " won" : ""}`}>
      <TeamLogo team={team} size={16} />
      {team.rank !== undefined && <span className="rank">#{team.rank}</span>}
      {team.abbreviation}
      {team.score !== undefined && <span className="score"> {team.score}</span>}
    </span>
  );
}
