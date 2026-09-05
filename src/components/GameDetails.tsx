import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Game, TeamResult, WinProb } from "../api/types";
import { formatTime } from "../lib/dates";
import { leadingTeamId, teamMeta } from "../lib/display";
import { uiScale } from "../lib/uiScale";
import TeamLogo from "./TeamLogo";

/**
 * Non-modal game details, floating with its top-left at the click point
 * (clamped to the viewport). Escape closes; focus starts on the close
 * button.
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
  const leaderId = leadingTeamId(game);

  const periodLabel = (i: number): string => {
    if (i < 4) return String(i + 1);
    return i === 4 ? "OT" : `${i - 3}OT`;
  };

  const teamRow = (t: TeamResult): ReactNode => (
    <tr key={t.id}>
      <th scope="row">
        <span className="details-team">
          <TeamLogo team={t} size={22 * uiScale()} />
          <span className="details-team-block">
            <span className="details-team-name">
              {t.name}
              {t.rank !== undefined ? <span className="rank"> #{t.rank}</span> : null}
            </span>
            {teamMeta(t) ? <span className="record">{teamMeta(t)}</span> : null}
          </span>
        </span>
      </th>
      {hasPeriods &&
        Array.from({ length: periodCount }, (_, i) => (
          <td key={i} className="period-cell">
            {t.linescores?.[i] ?? ""}
          </td>
        ))}
      <td className={`score-cell${t.winner || t.id === leaderId ? " leading" : ""}`}>
        {t.score !== undefined ? t.score : game.phase === "pre" ? "–" : ""}
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
  winProb,
  origin,
  onClose,
}: {
  game: Game;
  tz: string;
  winProb: WinProb | null;
  origin: { x: number; y: number } | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: origin?.x ?? 40,
    top: origin?.y ?? 40,
  });

  // Clamp so the panel never leaves the viewport (measure after mount)
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(pos.left, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(pos.top, window.innerHeight - rect.height - 8)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kickoff = game.kickoffUtc ? Date.parse(game.kickoffUtc) : null;

  // Win probability for both sides, favorite first (pre-game and live only)
  let predLine: ReactNode = null;
  if (winProb && winProb.pct > 0 && game.phase !== "post") {
    const fav =
      winProb.teamId === game.home.id
        ? game.home
        : winProb.teamId === game.away.id
          ? game.away
          : null;
    if (fav) {
      const other = fav === game.home ? game.away : game.home;
      predLine = (
        <p className="details-pred">
          {game.phase === "in" ? "Win probability" : "Matchup predictor"}:{" "}
          <b>
            {fav.abbreviation} {winProb.pct}%
          </b>{" "}
          · {other.abbreviation} {100 - winProb.pct}%
        </p>
      );
    }
  }

  return (
    <div className="details-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={panelRef}
        className="details-panel"
        style={{ left: pos.left, top: pos.top }}
        role="dialog"
        aria-modal="false"
        aria-label={`${game.away.name} at ${game.home.name} details`}
      >
        <div className="details-close-row">
          <button type="button" className="details-close" ref={closeRef} onClick={onClose}>
            Close ✕
          </button>
        </div>
        <Linescore game={game} />
        <p>
          {game.timeTbd
            ? "Kickoff time TBA"
            : kickoff !== null
              ? formatTime(kickoff, tz)
              : "Date TBA"}{" "}
          · {game.statusDetail || game.statusKind}
        </p>
        {predLine}
        {game.odds && (
          <p>
            {game.odds.details || "Line"}
            {game.odds.overUnder !== undefined ? ` · O/U ${game.odds.overUnder}` : ""}
            {game.odds.provider ? ` · ${game.odds.provider}` : ""}
          </p>
        )}
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
