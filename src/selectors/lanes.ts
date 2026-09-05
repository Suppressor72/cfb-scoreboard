/**
 * Grid layout: channel row-groups with interval-packed lanes.
 * Packing is deterministic (sort by kickoff, then id) so 30s polls never
 * reshuffle lanes. All right edges after kickoff are labeled estimates —
 * ESPN provides no end times (docs/SPEC.md "Block geometry").
 */
import { OTHER_CHANNEL, channelInfo } from "../api/channels";
import type { Game } from "../api/types";

export interface Block {
  game: Game;
  startMs: number;
  endMs: number;
}

const BASE_DURATION_MS = 3.5 * 3_600_000; // scheduled + live + final estimate
const OT_DURATION_MS = 4 * 3_600_000; // final with OT estimate

/**
 * Block geometry: the right edge always follows the *schedule* — a game's
 * slot is kickoff + estimated duration regardless of live state (the
 * now-line shows progress through the slot). Live games never stretch or
 * shrink to "now."
 */
export function blockBounds(game: Game): Block | null {
  if (!game.kickoffUtc || game.timeTbd) return null; // TBA strip, not the axis
  const start = Date.parse(game.kickoffUtc);
  if (Number.isNaN(start)) return null;
  const duration = game.statusKind === "final_ot" ? OT_DURATION_MS : BASE_DURATION_MS;
  return { game, startMs: start, endMs: start + duration };
}

export interface ChannelGroup {
  channel: string;
  kind: "tv" | "stream" | "other";
  lanes: Block[][];
}

/**
 * Greedy interval packing: each game goes into the first lane whose last
 * block ends at/before its start; a new lane is appended when none fits.
 */
export function groupByChannel(games: Game[]): ChannelGroup[] {
  const byChannel = new Map<string, Block[]>();
  for (const game of games) {
    const block = blockBounds(game);
    if (!block) continue;
    const channel = game.primaryBroadcast ?? OTHER_CHANNEL;
    const list = byChannel.get(channel);
    if (list) list.push(block);
    else byChannel.set(channel, [block]);
  }

  const groups: ChannelGroup[] = [];
  for (const [channel, blocks] of byChannel) {
    blocks.sort((a, b) => a.startMs - b.startMs || a.game.id.localeCompare(b.game.id));
    const lanes: Block[][] = [];
    const laneEnds: number[] = [];
    for (const block of blocks) {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (laneEnds[i] <= block.startMs) {
          lanes[i].push(block);
          laneEnds[i] = block.endMs;
          placed = true;
          break;
        }
      }
      if (!placed) {
        lanes.push([block]);
        laneEnds.push(block.endMs);
      }
    }
    groups.push({ channel, kind: channelInfo(channel).kind, lanes });
  }

  groups.sort(
    (a, b) =>
      channelInfo(a.channel).order - channelInfo(b.channel).order ||
      a.channel.localeCompare(b.channel),
  );
  return groups;
}

export function timeWindow(groups: ChannelGroup[]): { startMs: number; endMs: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const group of groups) {
    for (const lane of group.lanes) {
      for (const block of lane) {
        start = Math.min(start, block.startMs);
        end = Math.max(end, block.endMs);
      }
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    const now = Date.now();
    return { startMs: now, endMs: now + 12 * 3_600_000 };
  }
  const pad = 30 * 60_000;
  return { startMs: start - pad, endMs: end + pad };
}
