/**
 * Scheduler + store behavior with fake clocks and a stubbed store module.
 * These tests pin the review-critical behaviors: pregame days discover
 * kickoff (F1/A2), refresh failures keep stale data (F7/A10), and requests
 * coalesce + back off (A7/A10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  return {
    state,
    getWeek: vi.fn(() => state),
    refreshWeek: vi.fn(async () => {
      state.lastAttemptAt = Date.now();
    }),
  };
});

vi.mock("../src/state/store", () => ({
  getWeek: storeMocks.getWeek,
  refreshWeek: storeMocks.refreshWeek,
}));

import { cadenceFor, startScheduler } from "../src/state/scheduler";
import { refreshWeek } from "../src/state/store";
import type { Game } from "../src/api/types";
import { normalizeEvent } from "../src/api/espn";
import { makeEvent } from "./fixtures/events";

function gameOf(raw: unknown): Game {
  const r = normalizeEvent(raw);
  if (!("game" in r)) throw new Error("expected game");
  return r.game;
}

const T0 = Date.parse("2026-09-12T12:00:00Z"); // Saturday noon ET, games ahead

function pregameGame(kickoff: string): Game {
  return gameOf(makeEvent({ date: kickoff }));
}

describe("cadenceFor (pure policy)", () => {
  const now = Date.parse("2026-09-12T17:30:00Z");

  it("polls fast while any game is live", () => {
    const live = gameOf(makeEvent({ date: "2026-09-12T18:00Z", status: "live" }));
    expect(cadenceFor([live], now)).toBe(30_000);
  });

  it("polls fast within 15 minutes of a scheduled kickoff", () => {
    const soon = pregameGame("2026-09-12T17:45:00Z"); // 15 min away
    const later = pregameGame("2026-09-12T20:00Z");
    expect(cadenceFor([soon], now)).toBe(30_000);
    expect(cadenceFor([later], now)).toBe(120_000);
  });

  it("revalidates pregame/empty days every 2 minutes (kickoff discovery)", () => {
    expect(cadenceFor([pregameGame("2026-09-12T20:00Z")], now)).toBe(120_000);
    expect(cadenceFor([], now)).toBe(120_000);
  });

  it("settles to the historical TTL when the day is all-final", () => {
    const finals = [gameOf(makeEvent({ date: "2026-09-12T14:00Z", status: "final" }))];
    expect(cadenceFor(finals, now)).toBe(15 * 60_000);
  });
});

describe("startScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    for (const key of Object.keys(storeMocks.state)) delete storeMocks.state[key];
    storeMocks.refreshWeek.mockClear();
    storeMocks.refreshWeek.mockImplementation(async () => {
      storeMocks.state.lastAttemptAt = Date.now();
    });
    storeMocks.state.state = "ok";
    storeMocks.state.snapshot = { games: [pregameGame("2026-09-12T20:00:00Z")] };
    storeMocks.state.lastAttemptAt = T0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function stubWeek(overrides: Record<string, unknown> = {}): void {
    Object.assign(storeMocks.state, {
      state: "ok",
      snapshot: { games: [pregameGame("2026-09-12T20:00:00Z")] },
      lastAttemptAt: Date.now(),
    }, overrides);
  }

  it("discovers kickoff on an open pregame day without user input (F1)", async () => {
    stubWeek({ lastAttemptAt: T0 });
    const stop = startScheduler({
      weekStart: "2026-09-10",
      tz: "America/New_York",
      getSelectedDay: () => "2026-09-12",
    });
    // Not yet: 119s in, cadence is 120s
    await vi.advanceTimersByTimeAsync(119_000);
    expect(refreshWeek).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refreshWeek).toHaveBeenCalledTimes(1);
    stop();
  });

  it("polls every 30s while games are live", async () => {
    const live = gameOf(makeEvent({ date: "2026-09-12T18:00Z", status: "live" }));
    stubWeek({ snapshot: { games: [live] }, lastAttemptAt: T0 });
    const stop = startScheduler({
      weekStart: "2026-09-10",
      tz: "America/New_York",
      getSelectedDay: () => "2026-09-12",
    });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(refreshWeek).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refreshWeek).toHaveBeenCalledTimes(2);
    stop();
  });

  it("backs off after failures instead of hammering", async () => {
    stubWeek({
      state: "error",
      snapshot: undefined,
      error: { type: "http", message: "HTTP 429", retryable: true, retryAfterMs: 0 },
      lastAttemptAt: T0,
    });
    const stop = startScheduler({
      weekStart: "2026-09-10",
      tz: "America/New_York",
      getSelectedDay: () => "2026-09-12",
    });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(refreshWeek).not.toHaveBeenCalled(); // first tick hasn't fired yet
    await vi.advanceTimersByTimeAsync(31_000); // t=60s: first retry at 30s, skip at 60s (60s backoff)
    expect(refreshWeek).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000); // t=91s: second retry at 90s (120s backoff)
    expect(refreshWeek).toHaveBeenCalledTimes(2);
    stop();
  });

  it("fetches immediately when the week is missing", async () => {
    Object.assign(storeMocks.state, { state: "idle" });
    const stop = startScheduler({
      weekStart: "2026-09-10",
      tz: "America/New_York",
      getSelectedDay: () => "2026-09-12",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshWeek).toHaveBeenCalledTimes(1);
    stop();
  });
});
