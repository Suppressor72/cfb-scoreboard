import { useEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../api/types";
import { normalizeHex, teamTint } from "../lib/color";
import { formatTime } from "../lib/dates";
import type { Block, ChannelGroup } from "../selectors/lanes";
import { groupByChannel, timeWindow } from "../selectors/lanes";
import TeamLogo from "./TeamLogo";

const RAIL_PX = 92;
const FALLBACK_PX_PER_MS = 0.00006; // ≈216px/hour, used before first measure
const MIN_PX_PER_MS = 0.000012; // ≈43px/hour floor — beyond this, scroll
const LANE_PX = 64;
const COLLAPSE_LANES = 2;

interface Props {
  games: Game[];
  tz: string;
  focusChannel: string | null;
  expandedChannels: Set<string>;
  onToggleChannel: (channel: string | null) => void;
  onToggleExpand: (channel: string) => void;
  onSelectGame: (id: string) => void;
  selectedGameId: string | null;
}

/**
 * TV-guide grid. The horizontal scale is responsive: the whole day is
 * compressed to fit the container width so there is no left/right
 * scrolling, with a density floor below which scrolling returns.
 */
export default function Grid(props: Props) {
  const { games, tz } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lane geometry is a pure function of the schedule — no time clock needed
  const groups = useMemo(() => groupByChannel(games), [games]);
  const win = useMemo(() => timeWindow(groups), [groups]);
  const durationMs = Math.max(win.endMs - win.startMs, 3_600_000);

  const pxPerMs =
    containerWidth > RAIL_PX + 100
      ? Math.max(MIN_PX_PER_MS, (containerWidth - RAIL_PX - 8) / durationMs)
      : FALLBACK_PX_PER_MS;
  const durationPx = durationMs * pxPerMs;
  const hourPx = pxPerMs * 3_600_000;
  const minBlockPx = Math.max(56, Math.min(165, hourPx * 1.3));
  const hasLive = games.some((g) => g.phase === "in");

  const tickStepHours = hourPx >= 55 ? 1 : hourPx >= 28 ? 2 : 4;
  const ticks = useMemo(() => {
    const stepMs = tickStepHours * 3_600_000;
    const out: number[] = [];
    const first = Math.ceil(win.startMs / stepMs) * stepMs;
    for (let t = first; t <= win.endMs; t += stepMs) out.push(t);
    return out;
  }, [win, tickStepHours]);

  const pos = (ms: number): number => (ms - win.startMs) * pxPerMs;

  return (
    <div className="grid-scroll" ref={scrollRef} tabIndex={0} aria-label="Scoreboard grid by channel">
      <div className="grid-inner" style={{ minWidth: RAIL_PX + durationPx }}>
        <div className="grid-header">
          <div className="rail-space" style={{ width: RAIL_PX }} />
          <div className="axis" style={{ width: durationPx }}>
            {ticks.map((t) => (
              <span key={t} className="tick" style={{ left: pos(t) }}>
                {formatTime(t, tz)}
              </span>
            ))}
          </div>
        </div>
        <div className="grid-body">
          <div
            className="grid-lines"
            aria-hidden="true"
            style={{ left: RAIL_PX, width: durationPx }}
          >
            {ticks.map((t) => (
              <span key={t} className="vline" style={{ left: pos(t) }} />
            ))}
            {hasLive && <NowLine winStart={win.startMs} winEnd={win.endMs} pxPerMs={pxPerMs} />}
          </div>
          {groups.map((group) => (
            <ChannelRow
              key={group.channel}
              group={group}
              pos={pos}
              pxPerMs={pxPerMs}
              minBlockPx={minBlockPx}
              tz={tz}
              focusChannel={props.focusChannel}
              expanded={props.expandedChannels}
              onToggleChannel={props.onToggleChannel}
              onToggleExpand={props.onToggleExpand}
              onSelectGame={props.onSelectGame}
              selectedGameId={props.selectedGameId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Own 1s clock — re-renders only the line, never the grid. */
function NowLine({
  winStart,
  winEnd,
  pxPerMs,
}: {
  winStart: number;
  winEnd: number;
  pxPerMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now < winStart || now > winEnd) return null;
  return <span className="now-line" style={{ left: (now - winStart) * pxPerMs }} />;
}

function ChannelRow({
  group,
  pos,
  pxPerMs,
  minBlockPx,
  tz,
  focusChannel,
  expanded,
  onToggleChannel,
  onToggleExpand,
  onSelectGame,
  selectedGameId,
}: {
  group: ChannelGroup;
  pos: (ms: number) => number;
  pxPerMs: number;
  minBlockPx: number;
  tz: string;
  focusChannel: string | null;
  expanded: Set<string>;
  onToggleChannel: (channel: string | null) => void;
  onToggleExpand: (channel: string) => void;
  onSelectGame: (id: string) => void;
  selectedGameId: string | null;
}) {
  const collapsible = group.lanes.length > COLLAPSE_LANES;
  const collapsed = collapsible && !expanded.has(group.channel);
  const lanes = collapsed ? group.lanes.slice(0, COLLAPSE_LANES) : group.lanes;
  const hiddenCount = collapsed
    ? group.lanes.slice(COLLAPSE_LANES).reduce((n, lane) => n + lane.length, 0)
    : 0;
  const focused = focusChannel === group.channel;

  return (
    <div
      className={`channel-row${focusChannel && !focused ? " dimmed" : ""}${
        group.kind === "stream" ? " stream-row" : ""
      }`}
      role="group"
      aria-label={`${group.channel} schedule`}
    >
      <button
        type="button"
        className={`channel-rail${focused ? " focused" : ""}`}
        style={{ width: RAIL_PX }}
        aria-pressed={focused}
        title={focused ? "Clear channel focus" : "Focus this channel"}
        onClick={() => onToggleChannel(focused ? null : group.channel)}
      >
        {group.channel}
      </button>
      <div className="channel-lanes">
        {lanes.map((lane, i) => (
          <div className="lane" key={i} style={{ height: LANE_PX }}>
            {lane.map((block) => (
              <GameBlock
                key={block.game.id}
                block={block}
                pos={pos}
                pxPerMs={pxPerMs}
                minBlockPx={minBlockPx}
                tz={tz}
                onSelectGame={onSelectGame}
                selected={selectedGameId === block.game.id}
              />
            ))}
          </div>
        ))}
        {collapsed && hiddenCount > 0 && (
          <button
            type="button"
            className="expand-chip"
            onClick={() => onToggleExpand(group.channel)}
          >
            +{hiddenCount} more game{hiddenCount === 1 ? "" : "s"} on {group.channel}
          </button>
        )}
      </div>
    </div>
  );
}

function GameBlock({
  block,
  pos,
  pxPerMs,
  minBlockPx,
  tz,
  onSelectGame,
  selected,
}: {
  block: Block;
  pos: (ms: number) => number;
  pxPerMs: number;
  minBlockPx: number;
  tz: string;
  onSelectGame: (id: string) => void;
  selected: boolean;
}) {
  const g = block.game;
  const width = Math.max((block.endMs - block.startMs) * pxPerMs, minBlockPx);
  const live = g.phase === "in";
  const ppd =
    g.statusKind === "postponed" ? "PPD" : g.statusKind === "canceled" ? "CNCL" : null;

  // Border/tint color: leading team live, winner when final, home pre-game
  const accentTeam = live
    ? (g.home.score ?? 0) >= (g.away.score ?? 0)
      ? g.home
      : g.away
      : g.phase === "post"
        ? ((g.home.winner ? g.home : g.away.winner ? g.away : g.home) as typeof g.home)
        : g.home;
  const accent = normalizeHex(accentTeam.color);
  // Tint is a gradient layered over the opaque panel background so the
  // vertical time gridlines never show through the block
  const tint = accent ? teamTint(accent) : undefined;

  const statusText = ppd
    ? ppd
    : g.phase === "pre"
      ? formatTime(block.startMs, tz)
      : g.phase === "in"
        ? g.statusDetail || "Live"
        : g.statusKind === "final_ot"
          ? g.statusDetail || "Final/OT"
          : "Final";

  return (
    <button
      type="button"
      className={`game-block${live ? " live" : ""}${ppd ? " ppd" : ""}${selected ? " selected" : ""}`}
      style={{
        left: pos(block.startMs),
        width,
        borderColor: accent,
        backgroundImage: tint ? `linear-gradient(${tint}, ${tint})` : undefined,
      }}
      aria-label={`${g.away.name} at ${g.home.name}, ${statusText}`}
      onClick={() => onSelectGame(g.id)}
    >
      <span className="block-status">
        {live && <span className="pulse-dot" aria-hidden="true" />}
        {live ? `LIVE · ${statusText}` : statusText}
        {g.availability === "unknown" && g.phase === "pre" ? " · TV?" : ""}
      </span>
      <span className={`block-team${g.phase === "post" && g.away.winner ? " won" : ""}`}>
        <TeamLine team={g.away} />
      </span>
      <span className={`block-team${g.phase === "post" && g.home.winner ? " won" : ""}`}>
        <TeamLine team={g.home} />
      </span>
    </button>
  );
}

function TeamLine({ team }: { team: Game["home"] }) {
  return (
    <>
      <span className="team-name">
        <TeamLogo team={team} size={16} />
        {team.abbreviation}
        {team.rank !== undefined && <span className="rank">#{team.rank}</span>}
      </span>
      {team.score !== undefined && <span className="score">{team.score}</span>}
    </>
  );
}
