/**
 * Real store (fetcher injected) — generation/coalescing/staleness behavior
 * that the mocked-store scheduler test can't cover.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWeek,
  refreshWeek,
  resetStoreForTests,
} from "../src/state/store";
import type { Snapshot } from "../src/api/types";
import { ScoreboardFetchError } from "../src/api/espn";

const TZ = "America/New_York";

function snap(): Snapshot {
  const iso = new Date().toISOString();
  return { games: [], fetchedAt: iso, lastSuccessAt: iso, coverage: "complete", warnings: [] };
}

describe("store", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("stores a successful snapshot", async () => {
    const s = snap();
    const fetcher = vi.fn(async () => s);
    await refreshWeek("2026-09-10", TZ, { fetcher });
    expect(getWeek("2026-09-10").state).toBe("ok");
    expect(getWeek("2026-09-10").snapshot).toBe(s);
  });

  it("coalesces concurrent requests for the same week (A7)", async () => {
    let release!: (s: Snapshot) => void;
    const fetcher = vi.fn(
      () => new Promise<Snapshot>((res) => (release = res)),
    );
    const p1 = refreshWeek("2026-09-10", TZ, { fetcher });
    const p2 = refreshWeek("2026-09-10", TZ, { fetcher });
    release(snap());
    await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("skips non-forced refreshes inside the 30s TTL", async () => {
    const fetcher = vi.fn(async () => snap());
    await refreshWeek("2026-09-10", TZ, { fetcher });
    await refreshWeek("2026-09-10", TZ, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await refreshWeek("2026-09-10", TZ, { fetcher, force: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good snapshot when a refresh fails (F7/A10)", async () => {
    let fail = false;
    const fetcher = vi.fn(async () => {
      if (fail) {
        throw new ScoreboardFetchError({
          type: "http",
          message: "HTTP 503",
          status: 503,
          retryable: true,
        });
      }
      return snap();
    });
    await refreshWeek("2026-09-10", TZ, { fetcher });
    const good = getWeek("2026-09-10").snapshot;
    fail = true;
    await refreshWeek("2026-09-10", TZ, { fetcher, force: true });
    const state = getWeek("2026-09-10");
    expect(state.state).toBe("error");
    expect(state.error?.type).toBe("http");
    expect(state.snapshot).toBe(good); // stale, not empty
  });

  it("wraps non-typed throwables as network errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    await refreshWeek("2026-09-10", TZ, { fetcher });
    expect(getWeek("2026-09-10").error?.type).toBe("network");
  });

  it("bounds the cache to three weeks (LRU)", async () => {
    const fetcher = vi.fn(async () => snap());
    for (const week of ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24"]) {
      await refreshWeek(week, TZ, { fetcher, force: true });
    }
    expect(getWeek("2026-09-03").state).toBe("idle"); // evicted
    expect(getWeek("2026-09-24").state).toBe("ok");
  });
});
