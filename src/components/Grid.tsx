import { useEffect, useMemo, useState } from "react";
import type { Game } from "../api/types";
import { normalizeHex, textColorFor } from "../lib/color";
import { formatTime } from "../lib/dates";
import type { Block, ChannelGroup } from "../selectors/lanes";
import { groupByChannel, timeWindow } from "../selectors/lanes";

const RAIL_PX = 92;
const PX_PER_MS = 0.00006; // ≈ 216px per hour, 756px per 3.5h game
const LANE_PX = 46;
const MIN_BLOCK_PX = 150; // readable floor — callout extends right of true start
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

export default function Grid(props: Props) {
  const { games, tz } = props;
  // Geometry clock, isolated from the 1s now-line clock (SPEC: stability)
  const [now30, setNow30] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow30(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => groupByChannel(games, now30), [games, now30]);
  const win = useMemo(() => timeWindow(groups), [groups]);
  const durationPx = Math.max((win.endMs - win.startMs) * PX_PER_MS, 720);
  const hasLive = games.some((g) => g.phase === "in");

  const ticks = useMemo(() => {
    const out: number[] = [];
    const first = Math.ceil(win.startMs / 3_600_000) * 3_600_000;
    for (let t = first; t <= win.endMs; t += 3_600_000) out.push(t);
    return out;
  }, [win]);

  const pos = (ms: number): number => (ms - win.startMs) * PX_PER_MS;

  return (
    <div className="grid-scroll" tabIndex={0} aria-label="Scoreboard grid by channel">
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
          <div className="grid-lines" aria-hidden="true" style={{ left: RAIL_PX, width: durationPx }}>
            {ticks.map((t) => (
              <span key={t} className="vline" style={{ left: pos(t) }} />
            ))}
            {hasLive && <NowLine winStart={win.startMs} winEnd={win.endMs} />}
          </div>
          {groups.map((group) => (
            <ChannelRow
              key={group.channel}
              group={group}
              pos={pos}
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
function NowLine({ winStart, winEnd }: { winStart: number; winEnd: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now < winStart || now > winEnd) return null;
  return <span className="now-line" style={{ left: (now - winStart) * PX_PER_MS }} />;
}

function ChannelRow({
  group,
  pos,
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
  tz,
  onSelectGame,
  selected,
}: {
  block: Block;
  pos: (ms: number) => number;
  tz: string;
  onSelectGame: (id: string) => void;
  selected: boolean;
}) {
  const g = block.game;
  const width = Math.max((block.endMs - block.startMs) * PX_PER_MS, MIN_BLOCK_PX);
  const live = g.phase === "in";
  const ppd =
    g.statusKind === "postponed" ? "PPD" : g.statusKind === "canceled" ? "CNCL" : null;

  const leader = live
    ? (g.home.score ?? 0) >= (g.away.score ?? 0)
      ? g.home
      : g.away
    : g.home;
  const bg = normalizeHex(leader.color);
  const fg = textColorFor(bg);

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
      style={{ left: pos(block.startMs), width, backgroundColor: bg, color: fg }}
      aria-label={`${g.away.name} at ${g.home.name}, ${statusText}`}
      onClick={() => onSelectGame(g.id)}
    >
      <span className={`block-team${g.phase === "post" && g.away.winner ? " won" : ""}`}>
        <TeamLine team={g.away} />
      </span>
      <span className={`block-team${g.phase === "post" && g.home.winner ? " won" : ""}`}>
        <TeamLine team={g.home} />
      </span>
      <span className="block-status">
        {live && <span className="pulse-dot" aria-hidden="true" />}
        {live ? `LIVE · ${statusText}` : statusText}
        {g.availability === "unknown" && g.phase === "pre" ? " · TV?" : ""}
      </span>
    </button>
  );
}

function TeamLine({ team }: { team: Game["home"] }) {
  return (
    <>
      {team.rank !== undefined && <span className="rank">#{team.rank}</span>}{" "}
      {team.abbreviation}
      {team.score !== undefined && <span className="score"> {team.score}</span>}
    </>
  );
}
