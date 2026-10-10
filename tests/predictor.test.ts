import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGameInsights } from "../src/api/predictor";
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

describe("fetchGameInsights", () => {
  it("parses the pre-game matchup predictor", async () => {
    const transport = async () => ({ status: 200, body: PRE_SUMMARY });
    const { wp, drive } = await fetchGameInsights("401900100", undefined, transport);
    expect(wp).toEqual({ teamId: "201", pct: 84 });
    expect(drive).toBeNull(); // pre-game: no current drive
  });

  it("parses the live win probability from the newest play", async () => {
    const transport = async () => ({ status: 200, body: LIVE_SUMMARY });
    const { wp } = await fetchGameInsights("401900101", undefined, transport);
    expect(wp).toEqual({ teamId: "201", pct: 97 }); // home 0.969
  });

  it("picks the away side when it leads", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      winprobability: [{ homeWinPercentage: 0.18, tiePercentage: 0.02 }],
    };
    const transport = async () => ({ status: 200, body });
    const { wp } = await fetchGameInsights("x", undefined, transport);
    expect(wp).toEqual({ teamId: "2483", pct: 80 });
  });

  it("returns no analytics when none exist (final)", async () => {
    const transport = async () => ({ status: 200, body: { boxscore: {} } });
    const { wp } = await fetchGameInsights("x", undefined, transport);
    expect(wp).toBeNull();
  });

  it("throws typed errors on HTTP failures", async () => {
    const transport = async () => ({ status: 404, body: { code: 404 } });
    await expect(fetchGameInsights("x", undefined, transport)).rejects.toMatchObject({
      type: "http",
      status: 404,
      retryable: false,
    });
  });

  it("excludes punt distance when the new drive opens with the punt play", async () => {
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "2483" }, // AWAY receiving — drives toward 0 (left)
          start: { yardLine: 45 }, // punt origin (misleading)
          plays: [
            { type: { text: "Punt" }, start: { down: 4, distance: 8, yardLine: 45 }, end: { down: 1, distance: 10, yardLine: 13 } },
            { type: { text: "Rush" }, start: { down: 1, distance: 10, yardLine: 13 }, end: { down: 2, distance: 6, yardLine: 16, shortDownDistanceText: "2nd & 6" } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive).toEqual({
      possessionTeamId: "2483",
      startAbs: 13, // where the punt landed, not the 45 origin
      ballAbs: 16,
      downDistance: "2nd & 6",
      firstDowns: [], // the punt's 4th->1st transition is not a first down
    });
  });

  it("synthesizes the interception flip with 1st & 10 the other way", async () => {
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "201" }, // HOME threw it; data hasn't swapped drives yet
          start: { yardLine: 30 },
          plays: [
            { type: { text: "Pass Reception" }, start: { down: 1, distance: 10, yardLine: 30 }, end: { down: 2, distance: 4, yardLine: 36 } },
            { type: { text: "Pass Interception Return" }, isTurnover: true, start: { down: 2, distance: 4, yardLine: 36 }, end: { down: 1, distance: 10, yardLine: 55 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive).toEqual({
      possessionTeamId: "2483", // away defense takes over
      startAbs: 55,
      ballAbs: 55,
      downDistance: "1st & 10",
      firstDowns: [],
    });
  });

  it("turnover inside the 10 synthesizes 1st & Goal", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      drives: {
        current: {
          team: { id: "2483" }, // AWAY fumbled it away in scoring range
          plays: [
            { type: { text: "Fumble Return Defense" }, isTurnover: true, start: { down: 2, distance: 5, yardLine: 92 }, end: { down: 1, distance: 10, yardLine: 96 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive).toEqual({
      possessionTeamId: "201",
      startAbs: 96,
      ballAbs: 96,
      downDistance: "1st & Goal", // 4 yards from the away goal
      firstDowns: [],
    });
  });

  it("a scoring play emits a score banner instead of a drive", async () => {
    // Real shape from TULN@ARMY: TD play ends at yardLine 0 (the goal line
    // scored on), which previously dragged the ball spot into the endzone
    // and stretched the line across the field.
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "2483" }, // away scored
          start: { yardLine: 42 },
          plays: [
            { type: { text: "Rush" }, start: { down: 1, distance: 10, yardLine: 42 }, end: { down: 2, distance: 6, yardLine: 46 } },
            { type: { text: "Passing Touchdown" }, scoringPlay: true, period: { number: 4 }, start: { down: 3, distance: 4, yardLine: 39 }, end: { down: -1, yardLine: 0 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.score).toEqual({
      text: "TOUCHDOWN",
      atAbs: 0, // scored on the away-goal endzone (left)
      teamId: "2483",
      period: 4,
    });
  });

  it("a pick-six scores for the DEFENSE (drive stays under the offense)", async () => {
    // ESPN keeps the interception-return TD inside the offense's drive, so
    // possessionTeamId is the team that THREW it — the points belong to the
    // other side.
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "201" }, // HOME threw the pick-six
          start: { yardLine: 30 },
          plays: [
            { type: { text: "Pass Interception Return Touchdown" }, isTurnover: true, scoringPlay: true, period: { number: 4 }, start: { down: 3, distance: 8, yardLine: 34 }, end: { down: -1, yardLine: 100 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.score?.text).toBe("TOUCHDOWN");
    expect(drive?.score?.teamId).toBe("2483"); // the AWAY defense scored
    expect(drive?.score?.atAbs).toBe(100);
    expect(drive?.score?.period).toBe(4);
  });

  it("a made field goal emits a FIELD GOAL banner", async () => {
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "201" },
          plays: [
            { type: { text: "Field Goal Good" }, scoringPlay: true, period: { number: 2 }, start: { down: 4, distance: 5, yardLine: 95 }, end: { down: -1, yardLine: 100 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.score?.text).toBe("FIELD GOAL");
    expect(drive?.score?.teamId).toBe("201");
  });

  it("a missed field goal is NOT a score", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      drives: {
        current: {
          team: { id: "201" },
          plays: [
            { type: { text: "Field Goal Missed" }, scoringPlay: false, period: { number: 4 }, start: { down: 4, distance: 12, yardLine: 80 }, end: { down: 4, distance: 12, yardLine: 80 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.score).toBeUndefined(); // no banner, no quarter highlight
  });

  it("a safety scores for the OTHER team", async () => {
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "201" }, // home got safetied
          plays: [
            { type: { text: "Safety" }, scoringPlay: true, period: { number: 2 }, start: { down: 2, distance: 8, yardLine: 1 }, end: { down: -1, yardLine: 0 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.score?.text).toBe("SAFETY");
    expect(drive?.score?.teamId).toBe("2483"); // away is awarded the points
  });

  it("ignores a bogus goal-line drive start after a possession change", async () => {
    // New drive after a turnover: ESPN's drive.start says 0 (goal line) but
    // the first scrimmage play snapped at 42 — the line must start at 42,
    // not stretch from the endzone.
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "2483" },
          start: { yardLine: 0 }, // bogus
          plays: [
            { type: { text: "Rush" }, start: { down: 1, distance: 10, yardLine: 42 }, end: { down: 2, distance: 3, yardLine: 45, shortDownDistanceText: "2nd & 3" } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.startAbs).toBe(42);
    expect(drive?.ballAbs).toBe(45);
  });

  it("a genuine goal-line drive start still draws the long line", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      drives: {
        current: {
          team: { id: "201" },
          start: { yardLine: 1 },
          plays: [
            { type: { text: "Rush" }, start: { down: 1, distance: 10, yardLine: 1 }, end: { down: 2, distance: 6, yardLine: 5, shortDownDistanceText: "2nd & 6" } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.startAbs).toBe(1);
    expect(drive?.ballAbs).toBe(5);
  });

  it("a fumble the offense keeps is not a possession change", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      drives: {
        current: {
          team: { id: "201" },
          start: { yardLine: 30 },
          plays: [
            { type: { text: "Fumble Return Offense" }, start: { down: 2, distance: 5, yardLine: 36 }, end: { down: 2, distance: 5, yardLine: 39, shortDownDistanceText: "2nd & 2" } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive?.possessionTeamId).toBe("201"); // still their drive
    expect(drive?.ballAbs).toBe(39);
    expect(drive?.downDistance).toBe("2nd & 2");
  });

  it("a new drive opening with an interception return starts at the return spot", async () => {
    const body = {
      header: LIVE_SUMMARY.header,
      drives: {
        current: {
          team: { id: "2483" }, // away intercepted
          start: { yardLine: 36 }, // INT origin (misleading)
          plays: [
            { type: { text: "Pass Interception Return" }, start: { down: 3, distance: 8, yardLine: 36 }, end: { down: 1, distance: 10, yardLine: 18 } },
            { type: { text: "Rush" }, start: { down: 1, distance: 10, yardLine: 18 }, end: { down: 2, distance: 7, yardLine: 21, shortDownDistanceText: "2nd & 7" } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive).toEqual({
      possessionTeamId: "2483",
      startAbs: 18, // return landing, not the 36 origin
      ballAbs: 21,
      downDistance: "2nd & 7",
      firstDowns: [],
    });
  });

  it("synthesizes the flipped possession when the drive ends with a punt", async () => {
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "201" }, // HOME punted; data hasn't swapped drives yet
          start: { yardLine: 40 },
          plays: [
            { type: { text: "Pass Reception" }, start: { down: 1, distance: 10, yardLine: 40 }, end: { down: 2, distance: 7, yardLine: 47 } },
            { type: { text: "Punt" }, start: { down: 4, distance: 7, yardLine: 47 }, end: { down: 1, distance: 10, yardLine: 87 } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    expect(drive).toEqual({
      possessionTeamId: "2483", // the away team receives
      startAbs: 87, // at the landing spot
      ballAbs: 87,
      downDistance: "1st & 10",
      firstDowns: [],
    });
  });

  it("parses the live drive chart: ball spot, down/distance, first downs", async () => {
    const body = {
      header: LIVE_SUMMARY.header, // away 2483, home 201
      drives: {
        current: {
          team: { id: "201" }, // HOME has the ball -> arrow points right
          start: { yardLine: 75 },
          plays: [
            { type: { text: "Kickoff" }, start: { down: 1, distance: 10, yardLine: 35 }, end: { down: 1, distance: 10, yardLine: 75 } },
            { type: { text: "Pass Reception" }, start: { down: 1, distance: 10, yardLine: 75 }, end: { down: 2, distance: 6, yardLine: 69 } },
            { type: { text: "Pass Reception" }, start: { down: 2, distance: 6, yardLine: 69 }, end: { down: 1, distance: 10, yardLine: 52 } },
            { type: { text: "Timeout" }, start: { down: 1, distance: 10, yardLine: 52 }, end: { down: 1, distance: 10, yardLine: 52 } },
            { type: { text: "Rush" }, start: { down: 1, distance: 10, yardLine: 52 }, end: { down: 2, distance: 3, yardLine: 59, shortDownDistanceText: "2nd & 3" } },
          ],
        },
      },
    };
    const transport = async () => ({ status: 200, body });
    const { drive } = await fetchGameInsights("x", undefined, transport);
    // Timeout skipped: ball + down/distance come from the last real play
    expect(drive).toEqual({
      possessionTeamId: "201",
      startAbs: 75, // drive-level start.yardLine
      ballAbs: 59,
      downDistance: "2nd & 3",
      firstDowns: [52], // down 2 -> 1 conversion only
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
    const spy = vi.spyOn(mod, "fetchGameInsights").mockImplementation(async (id: string) => {
      fetched.push(id);
      return { wp: wpFor(), drive: null };
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
    const spy = vi.spyOn(mod, "fetchGameInsights").mockImplementation(async (id: string) => {
      fetched.push(id);
      return { wp: { teamId: "201", pct: 60 }, drive: null };
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
      .spyOn(mod, "fetchGameInsights")
      .mockImplementation(async () => {
        if (fail) throw new Error("boom");
        return { wp: { teamId: "201", pct: 55 }, drive: null };
      });
    await syncPredictors([liveGame]);
    expect(getPrediction(liveGame.id)).toEqual({ teamId: "201", pct: 55 });
    fail = true;
    await syncPredictors([liveGame], { nowMs: Date.now() + 10 * 60_000 }); // past TTL
    expect(getPrediction(liveGame.id)).toEqual({ teamId: "201", pct: 55 });
    spy.mockRestore();
  });
});
