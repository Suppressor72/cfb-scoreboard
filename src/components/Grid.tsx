import { useEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../api/types";
import { normalizeHex, teamTint } from "../lib/color";
import { leadingTeamId, teamMeta } from "../lib/display";
import { formatTime } from "../lib/dates";
import { uiScale } from "../lib/uiScale";
import type { Block, ChannelGroup } from "../selectors/lanes";
import { groupByChannel, timeWindow } from "../selectors/lanes";
import TeamLogo from "./TeamLogo";

const RAIL_PX = 92;
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
  onSelectGame: (id: string, origin: { x: number; y: number }) => void;
  selectedGameId: string | null;
  /** ESPN Analytics favorite per game id (pre-game predictor / live WP). */
  predictions: Map<string, import("../api/types").WinProb | null>;
  /** User's persisted channel sequence (empty = default order). */
  channelOrder: string[];
  onReorderChannels: (order: string[]) => void;
}

/**
 * TV-guide grid. The horizontal scale keeps a fixed time aspect — one hour
 * across equals 1.25× one lane height — compressing below that only when
 * the day would overflow the container (floor: ~43px/hour, then it scrolls).
 */
export default function Grid(props: Props) {
  const { games, tz } = props;
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Grabbing cursor for the whole page while a drag is active
  useEffect(() => {
    if (dragging === null) return;
    document.body.classList.add("dnd-grabbing");
    return () => document.body.classList.remove("dnd-grabbing");
  }, [dragging]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // The observer only triggers re-renders; the width is read synchronously
  // from the element at render time so it can never go stale.
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setResizeTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  void resizeTick;

  // Lane geometry is a pure function of the schedule — no time clock needed
  const groups = useMemo(
    () => groupByChannel(games, props.channelOrder),
    [games, props.channelOrder],
  );

  const handleDrop = (targetChannel: string): void => {
    if (dragging === null || dragging === targetChannel) {
      setDragging(null);
      setDropTarget(null);
      return;
    }
    // Move the dragged channel to the target's position in the visible order
    const order = groups.map((g) => g.channel);
    const from = order.indexOf(dragging);
    const to = order.indexOf(targetChannel);
    if (from >= 0 && to >= 0) {
      order.splice(to, 0, order.splice(from, 1)[0]);
      props.onReorderChannels(order);
    }
    setDragging(null);
    setDropTarget(null);
  };

  const win = useMemo(() => timeWindow(groups), [groups]);
  const durationMs = Math.max(win.endMs - win.startMs, 3_600_000);

  // All geometry in scaled pixels so JS dimensions match the scaled CSS.
  // Time aspect: one hour across = 1.25× one lane height. The day
  // compresses below that only when it would overflow the container, down
  // to a readability floor below which horizontal scrolling returns.
  // Scale and width are read at render time (resize observer re-renders).
  const scale = uiScale();
  const railPx = RAIL_PX * scale;
  const lanePx = LANE_PX * scale;
  const aspectPxPerMs = (lanePx * 1.25) / 3_600_000;
  const containerWidth = scrollRef.current?.clientWidth ?? 0;
  const fitPxPerMs =
    containerWidth > railPx + 100 * scale
      ? (containerWidth - railPx - 8 * scale) / durationMs
      : aspectPxPerMs;
  const pxPerMs = Math.max(MIN_PX_PER_MS * scale, Math.min(aspectPxPerMs, fitPxPerMs));
  const durationPx = durationMs * pxPerMs;
  const hourPx = pxPerMs * 3_600_000;
  const minBlockPx = Math.max(56, Math.min(165, hourPx * 1.3)) * scale;
  const hasLive = games.some((g) => g.phase === "in");

  const tickStepHours =
    hourPx >= 55 * scale ? 1 : hourPx >= 28 * scale ? 2 : 4;
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
      <div className="grid-inner" style={{ minWidth: railPx + durationPx }}>
        <div className="grid-header">
          <div className="rail-space" style={{ width: railPx }} />
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
            style={{ left: railPx, width: durationPx }}
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
              railPx={railPx}
              lanePx={LANE_PX * scale}
              logoSize={16 * scale}
              tz={tz}
              focusChannel={props.focusChannel}
              expanded={props.expandedChannels}
              onToggleChannel={props.onToggleChannel}
              onToggleExpand={props.onToggleExpand}
              onSelectGame={props.onSelectGame}
              selectedGameId={props.selectedGameId}
              predictions={props.predictions}
              dragging={dragging}
              dropTarget={dropTarget}
              onDragChannel={setDragging}
              onDropTarget={setDropTarget}
              onDropChannel={handleDrop}
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
  railPx,
  lanePx,
  logoSize,
  tz,
  focusChannel,
  expanded,
  onToggleChannel,
  onToggleExpand,
  onSelectGame,
  selectedGameId,
  predictions,
  dragging,
  dropTarget,
  onDragChannel,
  onDropTarget,
  onDropChannel,
}: {
  group: ChannelGroup;
  pos: (ms: number) => number;
  pxPerMs: number;
  minBlockPx: number;
  railPx: number;
  lanePx: number;
  logoSize: number;
  tz: string;
  focusChannel: string | null;
  expanded: Set<string>;
  onToggleChannel: (channel: string | null) => void;
  onToggleExpand: (channel: string) => void;
  onSelectGame: (id: string, origin: { x: number; y: number }) => void;
  selectedGameId: string | null;
  predictions: Map<string, import("../api/types").WinProb | null>;
  dragging: string | null;
  dropTarget: string | null;
  onDragChannel: (channel: string | null) => void;
  onDropTarget: (channel: string | null) => void;
  onDropChannel: (target: string) => void;
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
      }${dragging === group.channel ? " dragging" : ""}${
        dropTarget === group.channel && dragging !== null ? " drop-target" : ""
      }`}
      role="group"
      aria-label={`${group.channel} schedule`}
      onDragOver={(e) => {
        if (dragging === null || dragging === group.channel) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDropTarget(group.channel);
      }}
      onDragLeave={() => onDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDropChannel(group.channel);
      }}
    >
      <div className={`channel-rail${focused ? " focused" : ""}`} style={{ width: railPx }}>
        <span
          className="channel-grab"
          draggable
          aria-hidden="true"
          title="Drag to reorder channels"
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", group.channel);
            e.dataTransfer.effectAllowed = "move";
            onDragChannel(group.channel);
          }}
          onDragEnd={() => {
            onDragChannel(null);
            onDropTarget(null);
          }}
        >
          ⠿
        </span>
        <button
          type="button"
          className="channel-name"
          aria-pressed={focused}
          title={focused ? "Clear channel focus" : "Focus this channel"}
          onClick={() => onToggleChannel(focused ? null : group.channel)}
        >
          {group.channel}
        </button>
      </div>
      <div className="channel-lanes">
        {lanes.map((lane, i) => (
          <div className="lane" key={i} style={{ height: lanePx }}>
            {lane.map((block) => (
              <GameBlock
                key={block.game.id}
                block={block}
                pos={pos}
                pxPerMs={pxPerMs}
                minBlockPx={minBlockPx}
                logoSize={logoSize}
                tz={tz}
                onSelectGame={onSelectGame}
                selected={selectedGameId === block.game.id}
                winProb={predictions.get(block.game.id) ?? null}
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
        {!collapsed && collapsible && (
          <button
            type="button"
            className="expand-chip"
            onClick={() => onToggleExpand(group.channel)}
          >
            Show fewer
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
  logoSize,
  tz,
  onSelectGame,
  selected,
  winProb,
}: {
  block: Block;
  pos: (ms: number) => number;
  pxPerMs: number;
  minBlockPx: number;
  logoSize: number;
  tz: string;
  onSelectGame: (id: string, origin: { x: number; y: number }) => void;
  selected: boolean;
  winProb: import("../api/types").WinProb | null;
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

  // Quarter-by-quarter columns (1 2 3 4 [OT…] T), shown once play begins.
  // Canceled/postponed games never have linescores, so they skip the table.
  const periodCount = Math.max(
    4,
    g.home.linescores?.length ?? 0,
    g.away.linescores?.length ?? 0,
  );
  const showLinescore =
    g.phase === "in" || !!(g.home.linescores?.length || g.away.linescores?.length);
  const leaderId = leadingTeamId(g);

  // ESPN Analytics favorite: predictor before kickoff, live WP during —
  // never once the game is final
  let predText: string | null = null;
  if (winProb && winProb.pct > 0 && g.phase !== "post") {
    const team =
      winProb.teamId === g.home.id ? g.home : winProb.teamId === g.away.id ? g.away : null;
    if (team) predText = `${team.abbreviation} ${winProb.pct}%`;
  }

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
      onClick={(e) => onSelectGame(g.id, { x: e.clientX, y: e.clientY })}
    >
      <span className="block-status">
        {live && <span className="pulse-dot" aria-hidden="true" />}
        {live ? `LIVE · ${statusText}` : statusText}
        {predText && <span className="pred"> · {predText}</span>}
        {g.availability === "unknown" && g.phase === "pre" ? " · TV?" : ""}
      </span>
      <span className={`block-team${g.phase === "post" && g.away.winner ? " won" : ""}`}>
        <TeamLine team={g.away} logoSize={logoSize} />
      </span>
      <span className={`block-team${g.phase === "post" && g.home.winner ? " won" : ""}`}>
        <TeamLine team={g.home} logoSize={logoSize} />
      </span>
      {showLinescore && (
        <span className="block-linescore">
          <span className="ls-row ls-head">
            {Array.from({ length: periodCount }, (_, i) => (
              <span key={i}>{i < 4 ? i + 1 : i === 4 ? "OT" : `${i - 3}OT`}</span>
            ))}
            <span className="ls-total">T</span>
          </span>
          {[g.away, g.home].map((t) => (
            <span
              key={t.id}
              className={`ls-row${t.winner || t.id === leaderId ? " won" : ""}`}
            >
              {Array.from({ length: periodCount }, (_, i) => (
                <span key={i}>{t.linescores?.[i] ?? ""}</span>
              ))}
              <span className="ls-total">{t.score ?? ""}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function TeamLine({ team, logoSize }: { team: Game["home"]; logoSize: number }) {
  const meta = teamMeta(team);
  return (
    <span className="team-name">
      <TeamLogo team={team} size={logoSize} />
      {team.abbreviation}
      {team.rank !== undefined && <span className="rank">#{team.rank}</span>}
      {meta && <span className="team-meta">{meta}</span>}
    </span>
  );
}
