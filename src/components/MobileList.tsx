import type { Game } from "../api/types";
import { formatTime } from "../lib/dates";
import { normalizeHex } from "../lib/color";
import { leadingTeamId, teamMeta } from "../lib/display";
import TeamLogo from "./TeamLogo";

/** Compact chronological list — first-class narrow-screen view (SPEC.md). */
export default function MobileList({
  games,
  tz,
  predictions,
  onSelectGame,
}: {
  games: Game[];
  tz: string;
  predictions: Map<string, import("../api/types").WinProb | null>;
  onSelectGame: (id: string, origin: { x: number; y: number }) => void;
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
        const leaderId = leadingTeamId(g);
        const leader = live
          ? (g.home.score ?? 0) >= (g.away.score ?? 0)
            ? g.home
            : g.away
          : g.home;
        const bg = normalizeHex(leader.color);
        const wp = predictions.get(g.id) ?? null;
        let predText = "";
        if (wp && wp.pct > 0 && g.phase !== "post") {
          const team =
            wp.teamId === g.home.id ? g.home : wp.teamId === g.away.id ? g.away : null;
          if (team) predText = ` · ${team.abbreviation} ${wp.pct}%`;
        }
        return (
          <li key={g.id}>
            <button
              type="button"
              className="mobile-card"
              style={bg ? { borderLeftColor: bg } : undefined}
              onClick={(e) => onSelectGame(g.id, { x: e.clientX, y: e.clientY })}
            >
              <span className="mobile-when">
                {g.timeTbd
                  ? "TBA"
                  : kickoff !== null
                    ? formatTime(kickoff, tz)
                    : "TBA"}
              </span>
              <span className="mobile-matchup">
                <MobileTeam team={g.away} leader={g.away.id === leaderId} />
                <MobileTeam team={g.home} leader={g.home.id === leaderId} />
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
                {predText && <span className="pred">{predText}</span>}
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

function MobileTeam({ team, leader }: { team: Game["away"]; leader: boolean }) {
  const meta = teamMeta(team);
  return (
    <span className={`mobile-team${team.winner ? " won" : ""}${leader ? " ahead" : ""}`}>
      <TeamLogo team={team} size={16} />
      {team.abbreviation}
      {team.rank !== undefined && <span className="rank">#{team.rank}</span>}
      {meta && <span className="team-meta">{meta}</span>}
      {team.score !== undefined && <span className="score"> {team.score}</span>}
    </span>
  );
}
