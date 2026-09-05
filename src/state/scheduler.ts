/**
 * The one scheduler that owns every timer and request trigger (AGENTS.md
 * hard rule). Cadence comes from the *unfiltered* snapshot + wall clock, so
 * filtered-out live games still refresh, and an open pregame day discovers
 * kickoff without user input (review finding F1/A2).
 *
 *   live game or kickoff within 15 min  → 30s
 *   pending games today / empty day     → 2 min   (discovers schedule changes)
 *   settled day                         → 15 min TTL on access
 *   hidden page                         → paused; forced on visibility/online
 *   failures                            → backoff 30s→60s→120s, cap 5 min,
 *                                          honoring Retry-After
 */
import type { Game } from "../api/types";
import { gamesForDay } from "../selectors/grouping";
import { getWeek, refreshWeek } from "./store";
import { syncPredictors } from "./predictor";

const TICK_MS = 30_000;
const LIVE_CADENCE_MS = 30_000;
const PENDING_CADENCE_MS = 120_000;
const SETTLED_TTL_MS = 15 * 60_000;
const SOON_WINDOW_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

export interface SchedulerOptions {
  weekStart: string;
  tz: string;
  /** Selected day so cadence reflects what the user is watching. */
  getSelectedDay: () => string;
  /** Injectable for tests. */
  now?: () => number;
}

/** Pure cadence decision — unit-tested independently of timers. */
export function cadenceFor(games: Game[], nowMs: number): number {
  const live = games.some((g) => g.phase === "in");
  if (live) return LIVE_CADENCE_MS;
  const soon = games.some((g) => {
    if (g.phase !== "pre" || !g.kickoffUtc || g.timeTbd) return false;
    const kickoff = Date.parse(g.kickoffUtc);
    return kickoff - nowMs <= SOON_WINDOW_MS; // includes just-kicked-off-but-still-pre
  });
  if (soon) return LIVE_CADENCE_MS;
  const pending = games.some((g) => g.phase === "pre");
  if (pending || games.length === 0) return PENDING_CADENCE_MS;
  return SETTLED_TTL_MS;
}

export function startScheduler(opts: SchedulerOptions): () => void {
  const now = opts.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoffMs = LIVE_CADENCE_MS;
  let stopped = false;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, delayMs);
  };

  const maybeRefresh = async (): Promise<number> => {
    const state = getWeek(opts.weekStart);
    const nowMs = now();

    if (state.state === "error" && state.lastAttemptAt !== undefined) {
      // Failed refreshes retry on their own backoff schedule, independent of
      // the healthy cadence — errors must never look like "nothing to do".
      // Backoff doubles per failed *attempt*, not per evaluation.
      const wait = Math.min(
        Math.max(state.error?.retryAfterMs ?? 0, backoffMs),
        MAX_BACKOFF_MS,
      );
      const since = nowMs - state.lastAttemptAt;
      if (since < wait) return wait - since;
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      await refreshWeek(opts.weekStart, opts.tz);
      return TICK_MS;
    }
    backoffMs = LIVE_CADENCE_MS;

    const dayGames = state.snapshot
      ? gamesForDay(state.snapshot.games, opts.getSelectedDay(), opts.tz)
      : [];
    // Win probabilities fill in small batches on the same tick (own cache)
    void syncPredictors(dayGames);
    const cadence = cadenceFor(dayGames, nowMs);
    const since = nowMs - (state.lastAttemptAt ?? 0);
    if (since >= cadence) {
      await refreshWeek(opts.weekStart, opts.tz);
    }
    const lastAttempt = getWeek(opts.weekStart).lastAttemptAt ?? now();
    const remaining = cadence - (now() - lastAttempt);
    return remaining > 0 ? remaining : TICK_MS;
  };

  const tick = (): void => {
    if (stopped) return;
    if (isHidden()) {
      schedule(TICK_MS); // wake cheaply, fetch nothing while hidden
      return;
    }
    void maybeRefresh().then((waitMs) => schedule(Math.min(TICK_MS, waitMs)));
  };

  const onWake = (): void => {
    if (!isHidden()) schedule(250); // forced revalidation on visibility/online
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onWake);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", onWake);
  }

  // Initial fetch if the week is missing or stale-on-access
  void (async () => {
    const state = getWeek(opts.weekStart);
    const stale =
      state.lastAttemptAt === undefined || now() - state.lastAttemptAt >= SETTLED_TTL_MS;
    if (state.state === "idle" || stale) {
      await refreshWeek(opts.weekStart, opts.tz);
    }
    const fresh = getWeek(opts.weekStart);
    if (fresh.snapshot) {
      void syncPredictors(gamesForDay(fresh.snapshot.games, opts.getSelectedDay(), opts.tz));
    }
    schedule(TICK_MS);
  })();

  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onWake);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onWake);
    }
  };
}
