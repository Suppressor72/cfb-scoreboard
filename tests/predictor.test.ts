import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWinProb } from "../src/api/predictor";
import { getPrediction, resetPredictorsForTests, syncPredictors } from "../src/state/predictor";
import type { Game, WinProb } from "../src/api/types";
import { normalizeEvent } from "../src/api/espn";
import { makeEvent } from "./fixtures/events";

function gameOf(raw: unknown): Game {
  const r = normalizeEvent(raw);
  if (!("game" in r)) throw new Error("expected game");
  return r.game;
}

const preGame = gameOf(makeEvent({ id: "401900100", date: "2026-09-12T23:30Z" }));
const liveGame = gameOf(makeEvent({ id: "401900101", date: "2026-09-12T19:00Z", status: "live" }));
const finalGame = gameOf(makeEvent({ id: "401900102", date: "2026-09-12T12:00Z", status: "final" }));

const PRE_SUMMARY = {
  predictor: {
    header: "Matchup Predictor",
    homeTeam: { id: "201", gameProjection: "84.1" },
    awayTeam: { id: "2483", gameProjection: "15.9" },
  },
};

const LIVE_SUMMARY = {
  header: {
    competitions: [
      {
        competitors: [
          { homeAway: "away", team: { id: "2483" } },
          { homeAway: "home", team: { id: "201" } },
        ],
      },
    ],
  },
  winprobability: [
    { homeWinPercentage: 0.4, tiePercentage: 0.0, playId: "1" },
    { homeWinPercentage: 0.969, tiePercentage: 0.0, playId: "2" },
  ],
};

describe("fetchWinProb", () => {
  it("parses the pre-game matchup predictor", async () => {
    const transport = async () => ({ status: 200, body: PRE_SUMMARY });
    const wp = await fetchWinProb("401900100", undefined, transport);
    expect(wp).toEqual({ teamId: "201", pct: 84 });
  });

  it("parses the live win probability from the newest play", async () => {
    const transport = async () => ({ status: 200, body: LIVE_SUMMARY });
    const wp = await fetchWinProb("401900101", undefined, transport);
    expect(wp).toEqual({ teamId: "201", pct: 97 }); // home 0.969
  });

  it("picks the away side when it leads", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      winprobability: [{ homeWinPercentage: 0.18, tiePercentage: 0.02 }],
    };
    const transport = async () => ({ status: 200, body });
    const wp = await fetchWinProb("x", undefined, transport);
    expect(wp).toEqual({ teamId: "2483", pct: 80 });
  });

  it("returns null when no analytics exist (final)", async () => {
    const transport = async () => ({ status: 200, body: { boxscore: {} } });
    expect(await fetchWinProb("x", undefined, transport)).toBeNull();
  });

  it("throws typed errors on HTTP failures", async () => {
    const transport = async () => ({ status: 404, body: { code: 404 } });
    await expect(fetchWinProb("x", undefined, transport)).rejects.toMatchObject({
      type: "http",
      status: 404,
      retryable: false,
    });
  });
});

describe("predictor cache", () => {
  beforeEach(() => {
    resetPredictorsForTests();
  });

  it("syncs pre/live games only, in bounded batches", async () => {
    const fetched: string[] = [];
    const wpFor = (): WinProb => ({ teamId: "201", pct: 70 });
    const mod = await import("../src/api/predictor");
    const spy = vi.spyOn(mod, "fetchWinProb").mockImplementation(async (id: string) => {
      fetched.push(id);
      return wpFor();
    });

    const many = [preGame, liveGame, finalGame];
    await syncPredictors(many);
    expect(fetched).toEqual([liveGame.id, preGame.id]); // final skipped, live first
    expect(getPrediction(preGame.id)).toEqual({ teamId: "201", pct: 70 });

    // within TTL: no refetch
    await syncPredictors(many);
    expect(fetched).toHaveLength(2);
    spy.mockRestore();
  });

  it("burst drains the whole queue; maintenance batches are capped", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      gameOf(makeEvent({ id: `burst${i}`, date: "2026-09-12T16:00Z" })),
    );
    const fetched: string[] = [];
    const mod = await import("../src/api/predictor");
    const spy = vi.spyOn(mod, "fetchWinProb").mockImplementation(async (id: string) => {
      fetched.push(id);
      return { teamId: "201", pct: 60 };
    });

    await syncPredictors(many, { burst: true });
    expect(fetched).toHaveLength(20); // everything, not 8

    fetched.length = 0;
    const more = Array.from({ length: 12 }, (_, i) =>
      gameOf(makeEvent({ id: `maint${i}`, date: "2026-09-12T16:00Z" })),
    );
    await syncPredictors(more);
    expect(fetched).toHaveLength(8); // maintenance stays bounded
    spy.mockRestore();
  });

  it("keeps the last value when a refresh fails", async () => {
    const mod = await import("../src/api/predictor");
    let fail = false;
    const spy = vi
      .spyOn(mod, "fetchWinProb")
      .mockImplementation(async () => {
        if (fail) throw new Error("boom");
        return { teamId: "201", pct: 55 };
      });
    await syncPredictors([liveGame]);
    expect(getPrediction(liveGame.id)).toEqual({ teamId: "201", pct: 55 });
    fail = true;
    await syncPredictors([liveGame], { nowMs: Date.now() + 10 * 60_000 }); // past TTL
    expect(getPrediction(liveGame.id)).toEqual({ teamId: "201", pct: 55 });
    spy.mockRestore();
  });
});
