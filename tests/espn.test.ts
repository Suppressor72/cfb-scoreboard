import { describe, expect, it } from "vitest";
import {
  espnStatusKind,
  fetchScoreboardRange,
  normalizeEvent,
  parseScoreboard,
} from "../src/api/espn";
import {
  canceledEvent,
  finalEvent,
  finalOtEvent,
  liveEvent,
  makeEnvelope,
  makeEvent,
  malformedEvent,
  noBroadcastEvent,
  streamOnlyEvent,
  tbdEvent,
} from "./fixtures/events";
import type { Game } from "../src/api/types";

function gameOf(raw: unknown): Game {
  const result = normalizeEvent(raw);
  if (!("game" in result)) throw new Error(`expected game, got error: ${result.error}`);
  return result.game;
}

describe("normalizeEvent", () => {
  it("normalizes a scheduled event without exposing pre-game zeros", () => {
    const result = normalizeEvent(makeEvent());
    expect("game" in result).toBe(true);
    if (!("game" in result)) return;
    const g = result.game;
    expect(g.phase).toBe("pre");
    expect(g.statusKind).toBe("scheduled");
    expect(g.kickoffUtc).toBe("2026-09-12T16:00:00.000Z");
    expect(g.timeTbd).toBe(false);
    // away score is the string "0" in the fixture — must not surface
    expect(g.away.score).toBeUndefined();
    expect(g.home.score).toBeUndefined();
    expect(g.endUtc).toBeNull();
  });

  it("prefers national TV for the primary broadcast and maps availability", () => {
    const g = gameOf(makeEvent());
    expect(g.primaryBroadcast).toBe("ABC"); // not Disney+, which is a stream
    expect(g.availability).toBe("tv");
    expect(g.broadcasts.map((b) => b.source)).toEqual(["ABC", "Disney+"]);
    expect(g.broadcasts[1].kind).toBe("stream");
  });

  it("keeps roles, ranks, records, conference, venue, and gamecast link", () => {
    const g = gameOf(makeEvent());
    expect(g.away.abbreviation).toBe("ORE");    expect(g.home.abbreviation).toBe("OKST");
    expect(g.away.rank).toBe(12);
    expect(g.home.rank).toBeUndefined(); // curatedRank 99 = unranked
    expect(g.away.conference).toBe("Big Ten"); // conferenceId 5
    expect(g.home.conference).toBe("Big 12"); // conferenceId 4
    expect(g.away.record).toBe("1-0");
    expect(g.venue?.name).toBe("Boone Pickens Stadium");
    expect(g.gamecastUrl).toMatch(/^https:\/\/www\.espn\.com\//);
  });

  it("exposes scores and status detail for live games (string scores)", () => {
    const g = gameOf(liveEvent);
    expect(g.phase).toBe("in");
    expect(g.statusKind).toBe("live");
    expect(g.statusDetail).toBe("Q3 8:12");
    expect(g.away.score).toBe(17); // parsed from the string "17" ESPN sends
    expect(g.home.score).toBe(10);
  });

  it("maps per-period linescores, including OT periods", () => {
    const live = gameOf(liveEvent);
    expect(live.away.linescores).toEqual([7, 10]);
    expect(live.home.linescores).toEqual([3, 7]);
    const ot = gameOf(finalOtEvent);
    expect(ot.away.linescores).toEqual([10, 7, 14, 10, 3]); // 5th period = OT
    expect(ot.away.linescores?.reduce((a, b) => a + b, 0)).toBe(ot.away.score);
  });

  it("keeps winners on final games", () => {
    const g = gameOf(finalEvent);
    expect(g.phase).toBe("post");
    expect(g.statusKind).toBe("final");
    expect(g.away.winner).toBe(true);
    expect(g.home.winner).toBeUndefined();
  });

  it("suppresses winner on canceled games even if the raw payload lies", () => {
    const g = gameOf(canceledEvent);
    expect(g.statusKind).toBe("canceled");
    expect(g.away.winner).toBeUndefined();
    expect(g.home.winner).toBeUndefined();
  });

  it("marks TBD-time games and keeps them off the time axis contract", () => {
    const g = gameOf(tbdEvent);
    expect(g.timeTbd).toBe(true);
  });

  it("classifies stream-only games", () => {
    const g = gameOf(streamOnlyEvent);
    expect(g.primaryBroadcast).toBe("ACCNX");
    expect(g.availability).toBe("stream");
  });

  it("treats empty broadcasts as unknown availability, not untelevised", () => {
    const g = gameOf(noBroadcastEvent);
    expect(g.broadcasts).toEqual([]);
    expect(g.primaryBroadcast).toBeNull();
    expect(g.availability).toBe("unknown");
  });

  it("validates logo URLs and derives the dark-background variant", () => {
    const g = gameOf(makeEvent());
    expect(g.home.logo).toBe("https://a.espncdn.com/i/teamlogos/ncaa/500/201.png");
    expect(g.home.logoDark).toBe(
      "https://a.espncdn.com/i/teamlogos/ncaa/500-dark/201.png",
    );
    // Foreign/non-HTTPS logo URLs are rejected, never rendered
    const raw = makeEvent();
    const home = (
      raw.competitions as { competitors: { team: Record<string, unknown> }[] }[]
    )[0].competitors.find((c) => c.team.id === "201");
    if (!home) throw new Error("fixture home competitor missing");
    home.team.logo = "http://evil.example/logo.png";
    const g2 = gameOf(raw);
    expect(g2.home.logo).toBeUndefined();
    expect(g2.home.logoDark).toBeDefined(); // derived from the id, still fine
  });

  it("rejects malformed events with an error instead of throwing", () => {
    const result = normalizeEvent(malformedEvent);
    expect("error" in result).toBe(true);
  });

  it("maps unknown status names to unknown, never crashes", () => {
    const raw = makeEvent();
    (raw.status as { type: { name: string } }).type.name = "STATUS_WAT";
    expect(gameOf(raw).statusKind).toBe("unknown");
    expect(gameOf(makeEvent()).statusKind).toBe("scheduled");
  });
});

describe("parseScoreboard", () => {
  it("returns null for an invalid envelope", () => {
    expect(parseScoreboard({ nope: true })).toBeNull();
    expect(parseScoreboard(null)).toBeNull();
    expect(parseScoreboard({ events: "not-an-array" })).toBeNull();
  });

  it("keeps valid events from a partially malformed payload", () => {
    const parsed = parseScoreboard(
      makeEnvelope([finalEvent, malformedEvent, liveEvent]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.games).toHaveLength(2);
    expect(parsed?.warnings).toHaveLength(1);
    expect(parsed?.warnings[0]).toContain("401900008");
  });
});

describe("fetchScoreboardRange", () => {
  it("builds compact ESPN dates (YYYYMMDD), not dashed ISO dates", async () => {
    let seenUrl = "";
    const transport = async (url: string) => {
      seenUrl = url;
      return { status: 200, body: makeEnvelope([]) };
    };
    await fetchScoreboardRange("2026-09-02", "2026-09-10", undefined, transport);
    expect(seenUrl).toContain("dates=20260902-20260910&limit=300");
  });

  it("surfaces rate limits as retryable with retry-after", async () => {
    const transport = async () => ({ status: 429, body: {}, retryAfterMs: 60_000 });
    await expect(
      fetchScoreboardRange("2026-09-11", "2026-09-19", undefined, transport),
    ).rejects.toMatchObject({ type: "http", status: 429, retryable: true, retryAfterMs: 60_000 });
  });

  it("treats access denial as non-retryable", async () => {
    const transport = async () => ({ status: 403, body: {} });
    await expect(
      fetchScoreboardRange("2026-09-11", "2026-09-19", undefined, transport),
    ).rejects.toMatchObject({ type: "http", status: 403, retryable: false });
  });

  it("rejects a 200 with a bad envelope as a schema error", async () => {
    const transport = async () => ({ status: 200, body: { html: "denied" } });
    await expect(
      fetchScoreboardRange("2026-09-11", "2026-09-19", undefined, transport),
    ).rejects.toMatchObject({ type: "schema", retryable: false });
  });
});

describe("espnStatusKind", () => {
  it("maps known ESPN status names", () => {
    expect(espnStatusKind("STATUS_HALFTIME")).toBe("halftime");
    expect(espnStatusKind("STATUS_POSTPONED")).toBe("postponed");
    expect(espnStatusKind("STATUS_FINAL_OT")).toBe("final_ot");
    expect(espnStatusKind("garbage")).toBe("unknown");
    expect(espnStatusKind(undefined)).toBe("unknown");
  });
});
