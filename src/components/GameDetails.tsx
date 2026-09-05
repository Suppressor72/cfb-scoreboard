import { useEffect, useRef } from "react";
import type { Game } from "../api/types";
import { formatTime } from "../lib/dates";
import TeamLogo from "./TeamLogo";

/**
 * Non-modal game details. Escape closes; focus starts on the close button
 * and returns to it (the grid button keeps its own focus on reopen).
 */
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
        <table className="details-table">
          <tbody>
            {[game.away, game.home].map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="details-team">
                    <TeamLogo team={t} size={22} />
                    {t.name}
                    {t.rank !== undefined ? ` #${t.rank}` : ""}
                    {t.record ? ` (${t.record})` : ""}
                  </span>
                </td>
                <td className="score-cell">
                  {t.score !== undefined ? t.score : game.phase === "pre" ? "–" : ""}
                  {t.winner ? " ✔" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
