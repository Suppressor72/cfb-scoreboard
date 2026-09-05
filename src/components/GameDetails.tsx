import { useEffect, useRef, type ReactNode } from "react";
import type { Game, TeamResult } from "../api/types";
import { formatTime } from "../lib/dates";
import { teamMeta } from "../lib/display";
import TeamLogo from "./TeamLogo";

/**
 * Non-modal game details. Escape closes; focus starts on the close button
 * and returns to it (the grid button keeps its own focus on reopen).
 */

/**
 * ESPN-style linescore: one row per team with points by quarter (OT columns
 * when they exist) and the total on the right. Falls back to a simple
 * two-line total when no per-period data exists (e.g. pre-game).
 */
function Linescore({ game }: { game: Game }) {
  const { away, home } = game;
  const hasPeriods = !!(away.linescores?.length || home.linescores?.length);
  const periodCount = hasPeriods
    ? Math.max(away.linescores?.length ?? 0, home.linescores?.length ?? 0)
    : 0;

  const periodLabel = (i: number): string => {
    if (i < 4) return String(i + 1);
    return i === 4 ? "OT" : `${i - 3}OT`;
  };

  const teamRow = (t: TeamResult): ReactNode => (
    <tr key={t.id}>
      <th scope="row">
        <span className="details-team">
          <TeamLogo team={t} size={22} />
          <span className="details-team-name">
            {t.name}
            <span className="record"> {teamMeta(t) ?? ""}</span>
          </span>
          {t.rank !== undefined ? <span className="rank">#{t.rank}</span> : null}
        </span>
      </th>
      {hasPeriods &&
        Array.from({ length: periodCount }, (_, i) => (
          <td key={i} className="period-cell">
            {t.linescores?.[i] ?? ""}
          </td>
        ))}
      <td className="score-cell">
        {t.score !== undefined ? t.score : game.phase === "pre" ? "–" : ""}
        {t.winner ? " ✔" : ""}
      </td>
    </tr>
  );

  return (
    <table className="details-table">
      {hasPeriods && (
        <thead>
          <tr>
            <th scope="col" aria-label="Team" />
            {Array.from({ length: periodCount }, (_, i) => (
              <th key={i} scope="col" className="period-cell">
                {periodLabel(i)}
              </th>
            ))}
            <th scope="col" className="score-cell">
              T
            </th>
          </tr>
        </thead>
      )}
      <tbody>
        {[away, home].map(teamRow)}
      </tbody>
    </table>
  );
}
export default function GameDetails({
  game,
  tz,
  onClose,
}: {
  game: Game;
  tz: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kickoff = game.kickoffUtc ? Date.parse(game.kickoffUtc) : null;

  return (
    <div className="details-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section
        className="details-panel"
        role="dialog"
        aria-modal="false"
        aria-label={`${game.away.name} at ${game.home.name} details`}
      >
        <button type="button" className="details-close" ref={closeRef} onClick={onClose}>
          Close ✕
        </button>
        <h2>
          {game.away.name} at {game.home.name}
        </h2>
        <Linescore game={game} />
        <p>
          {game.timeTbd
            ? "Kickoff time TBA"
            : kickoff !== null
              ? formatTime(kickoff, tz)
              : "Date TBA"}{" "}
          · {game.statusDetail || game.statusKind}
        </p>
        <p>
          {game.broadcasts.length > 0
            ? game.broadcasts.map((b) => b.source).join(" · ")
            : "No broadcast listed"}
        </p>
        {game.venue && (
          <p>
            {game.venue.name}
            {game.venue.city ? `, ${game.venue.city}` : ""}
          </p>
        )}
        {game.gamecastUrl && (
          <p>
            <a href={game.gamecastUrl} target="_blank" rel="noopener noreferrer">
              ESPN gamecast ↗
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
