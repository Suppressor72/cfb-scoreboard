/**
 * Week snapshot store. One store, one in-flight request per week, generation
 * guards against obsolete writes; refresh failures keep the last good
 * snapshot (stale, never "no games"). Bound to the current + adjacent weeks.
 */
import type { Snapshot } from "../api/types";
import {
  ScoreboardFetchError,
  fetchScoreboardRange,
  type FetchError,
} from "../api/espn";
import { providerRangeForWeek, weekDays } from "../lib/dates";
import { dayKeyOfGame } from "../selectors/grouping";

export type WeekState = {
  state: "idle" | "loading" | "ok" | "error";
  snapshot?: Snapshot;
  error?: FetchError;
  lastAttemptAt?: number;
};

export type WeekFetcher = (
  weekStart: string,
  tz: string,
  signal?: AbortSignal,
) => Promise<Snapshot>;

const MAX_CACHED_WEEKS = 3;
const MIN_FETCH_INTERVAL_MS = 30_000;

const byWeek = new Map<string, WeekState>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, AbortController>();
const generations = new Map<string, number>();
const weekOrder: string[] = []; // LRU for bounding the cache

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function getWeek(weekStart: string): WeekState {
  return byWeek.get(weekStart) ?? { state: "idle" };
}

function setWeek(weekStart: string, next: WeekState): void {
  byWeek.set(weekStart, next);
  if (!weekOrder.includes(weekStart)) {
    weekOrder.push(weekStart);
    while (weekOrder.length > MAX_CACHED_WEEKS) {
      const evicted = weekOrder.shift();
      if (evicted) byWeek.delete(evicted);
    }
  }
}

/** The default fetcher: covering range → parse → filter to local week days. */
export const defaultFetchWeek: WeekFetcher = async (weekStart, tz, signal) => {
  const range = providerRangeForWeek(weekStart);
  const parsed = await fetchScoreboardRange(range.start, range.end, signal);
  const days = new Set(weekDays(weekStart));
  const games = parsed.games.filter((g) => {
    const key = dayKeyOfGame(g, tz);
    return key !== null && days.has(key);
  });
  const nowIso = new Date().toISOString();
  return {
    games,
    fetchedAt: nowIso,
    lastSuccessAt: nowIso,
    coverage: parsed.warnings.length > 0 ? "partial" : "complete",
    warnings: parsed.warnings,
  };
};

export interface RefreshOptions {
  force?: boolean;
  /** Injectable for tests. */
  fetcher?: WeekFetcher;
}

export async function refreshWeek(
  weekStart: string,
  tz: string,
  opts: RefreshOptions = {},
): Promise<void> {
  const fetcher = opts.fetcher ?? defaultFetchWeek;
  // Coalesce: a request for this week is already running
  if (inFlight.has(weekStart)) return;
  const current = getWeek(weekStart);
  const now = Date.now();
  if (
    !opts.force &&
    current.lastAttemptAt !== undefined &&
    now - current.lastAttemptAt < MIN_FETCH_INTERVAL_MS
  ) {
    return;
  }

  const generation = (generations.get(weekStart) ?? 0) + 1;
  generations.set(weekStart, generation);
  const controller = new AbortController();
  inFlight.set(weekStart, controller);

  if (current.state === "idle") {
    setWeek(weekStart, { ...current, state: "loading" });
    emit();
  }

  try {
    const snapshot = await fetcher(weekStart, tz, controller.signal);
    if (generations.get(weekStart) !== generation) return; // obsolete write
    setWeek(weekStart, {
      state: "ok",
      snapshot,
      lastAttemptAt: Date.now(),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (generations.get(weekStart) !== generation) return; // obsolete write
    const error: FetchError =
      err instanceof ScoreboardFetchError
        ? err
        : { type: "network", message: String(err), retryable: true };
    // Keep the previous snapshot — a refresh failure is stale, not empty
    const prev = byWeek.get(weekStart);
    setWeek(weekStart, {
      state: "error",
      error,
      snapshot: prev?.snapshot,
      lastAttemptAt: Date.now(),
    });
  } finally {
    inFlight.delete(weekStart);
    emit();
  }
}

/** Test seam: clear the store between cases. */
export function resetStoreForTests(): void {
  byWeek.clear();
  listeners.clear();
  inFlight.clear();
  generations.clear();
  weekOrder.length = 0;
}
