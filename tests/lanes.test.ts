import { describe, expect, it } from "vitest";
import { blockBounds, groupByChannel } from "../src/selectors/lanes";
import { dayKeyOfGame, gamesForDay } from "../src/selectors/grouping";
import type { Game } from "../src/api/types";
import { makeEvent, tbdEvent } from "./fixtures/events";
import { normalizeEvent } from "../src/api/espn";

const NOW = Date.parse("2026-09-12T21:30:00Z"); // Saturday 5:30pm ET

function gameOf(raw: unknown): Game {
  const r = normalizeEvent(raw);
  if (!("game" in r)) throw new Error("expected game");
  return r.game;
}

function withBroadcast(names: string[], date: string, id: string): Game {
  return gameOf(
    makeEvent({
      id,
      date,
      broadcasts: [{ market: "national", names }],
    }),
  );
}

describe("blockBounds (geometry estimates)", () => {
  it("gives scheduled and final games 3.5h estimates", () => {
    const g = gameOf(makeEvent({ date: "2026-09-12T16:00Z" }));
    const b = blockBounds(g, NOW)!;
    expect(b.startMs).toBe(Date.parse("2026-09-12T16:00:00Z"));
    expect(b.endMs - b.startMs).toBe(3.5 * 3_600_000);
  });

  it("gives final-OT games a 4h estimate", () => {
    const g = gameOf(makeEvent({ date: "2026-09-12T16:00Z", status: "final_ot" }));
    const b = blockBounds(g, NOW)!;
    expect(b.endMs - b.startMs).toBe(4 * 3_600_000);
  });

  it("sizes live games to now with a 20-minute readable floor", () => {
    const kickedOffAt = Date.parse("2026-09-12T21:20:00Z"); // 10 min ago
    const g = gameOf(makeEvent({ date: "2026-09-12T21:20Z", status: "live" }));
    const b = blockBounds(g, NOW);
    expect(b?.endMs).toBe(kickedOffAt + 20 * 60_000); // floor wins over now
    const earlier = gameOf(makeEvent({ date: "2026-09-12T18:00Z", status: "live" }));
    expect(blockBounds(earlier, NOW)?.endMs).toBe(NOW); // now wins for 3.5h-old game
  });

  it("keeps TBD-time games off the axis", () => {
    expect(blockBounds(gameOf(tbdEvent), NOW)).toBeNull();
  });
});

describe("groupByChannel (packed lanes)", () => {
  it("stacks simultaneous games on one channel into separate lanes", () => {
    const games = [
      withBroadcast(["ESPN+"], "2026-09-12T18:00Z", "a"),
      withBroadcast(["ESPN+"], "2026-09-12T18:00Z", "b"),
      withBroadcast(["ESPN+"], "2026-09-12T18:00Z", "c"),
    ];
    const groups = groupByChannel(games, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].channel).toBe("ESPN+");
    expect(groups[0].lanes).toHaveLength(3);
    // deterministic: sorted by (kickoff, id)
    expect(groups[0].lanes.map((lane) => lane[0].game.id)).toEqual(["a", "b", "c"]);
  });

  it("packs sequential games into one lane (end == next start)", () => {
    const games = [
      withBroadcast(["ABC"], "2026-09-12T16:00Z", "a"), // ends 19:30
      withBroadcast(["ABC"], "2026-09-12T19:30Z", "b"), // starts exactly at end
    ];
    const groups = groupByChannel(games, NOW);
    expect(groups[0].lanes).toHaveLength(1);
    expect(groups[0].lanes[0].map((b) => b.game.id)).toEqual(["a", "b"]);
  });

  it("splits a channel when a game overlaps the next slot", () => {
    const games = [
      withBroadcast(["ABC"], "2026-09-12T16:00Z", "a"), // 16:00–19:30
      withBroadcast(["ABC"], "2026-09-12T19:00Z", "b"), // overlaps by 30 min
    ];
    expect(groupByChannel(games, NOW)[0].lanes).toHaveLength(2);
  });

  it("orders channels: broadcast nets, cable, streams, Other", () => {
    const games = [
      withBroadcast(["Disney+"], "2026-09-12T16:00Z", "s"),
      withBroadcast([], "2026-09-12T16:00Z", "o"), // no broadcast → Other
      withBroadcast(["ABC"], "2026-09-12T16:00Z", "a"),
      withBroadcast(["ESPN"], "2026-09-12T16:00Z", "e"),
    ];
    const names = groupByChannel(games, NOW).map((g) => g.channel);
    expect(names).toEqual(["ABC", "ESPN", "Disney+", "Other"]);
  });

  it("is stable across recomputation with identical input", () => {
    const games = [
      withBroadcast(["ESPN+"], "2026-09-12T18:00Z", "a"),
      withBroadcast(["ESPN+"], "2026-09-12T18:00Z", "b"),
    ];
    const first = groupByChannel(games, NOW).map((g) => g.lanes.map((l) => l.map((b) => b.game.id)));
    const second = groupByChannel(games, NOW).map((g) => g.lanes.map((l) => l.map((b) => b.game.id)));
    expect(second).toEqual(first);
  });
});

describe("day grouping", () => {
  it("groups time-valid games by the user's local day", () => {
    const g = gameOf(makeEvent({ date: "2026-09-06T02:30:00Z" })); // Sat 7:30pm PT
    expect(dayKeyOfGame(g, "America/Los_Angeles")).toBe("2026-09-05");
    expect(dayKeyOfGame(g, "Pacific/Honolulu")).toBe("2026-09-05");
    expect(gamesForDay([g], "2026-09-05", "America/Los_Angeles")).toEqual([g]);
    expect(gamesForDay([g], "2026-09-06", "America/Los_Angeles")).toEqual([]);
  });

  it("groups TBD-time games by their provider bucket date (UTC date component)", () => {
    const g = gameOf(tbdEvent); // parked at 2026-09-12T00:00Z
    expect(dayKeyOfGame(g, "America/Los_Angeles")).toBe("2026-09-12");
    expect(dayKeyOfGame(g, "America/New_York")).toBe("2026-09-12");
  });
});
