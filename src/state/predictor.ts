/**
 * Predictor cache: win probability per game id, fetched in small batches
 * from the summary endpoint (never a whole day at once). TTLs: 15 min
 * pre-game, 90 s live; final games stop refreshing. Failures keep the last
 * value and count as an attempt, so a dead endpoint is not hammered.
 */
import type { Game, WinProb } from "../api/types";
import { fetchWinProb } from "../api/predictor";

export const PRE_TTL_MS = 15 * 60_000;
export const LIVE_TTL_MS = 90_000;
const BATCH_SIZE = 8;
const CONCURRENCY = 3;
const MAX_ENTRIES = 300;

interface Entry {
  wp: WinProb | null;
  fetchedAt: number;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

export function subscribePredictors(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function predictorVersion(): number {
  return version;
}

export function getPrediction(gameId: string): WinProb | null {
  return cache.get(gameId)?.wp ?? null;
}

function emit(): void {
  version++;
  for (const fn of listeners) fn();
}

function prune(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function resetPredictorsForTests(): void {
  cache.clear();
  listeners.clear();
  version = 0;
}

export async function syncPredictors(games: Game[], nowMs: number = Date.now()): Promise<void> {
  const stale: Game[] = [];
  for (const game of games) {
    if (game.phase === "post") continue;
    const entry = cache.get(game.id);
    const ttl = game.phase === "in" ? LIVE_TTL_MS : PRE_TTL_MS;
    if (!entry || nowMs - entry.fetchedAt > ttl) stale.push(game);
  }
  prune();
  const batch = stale.slice(0, BATCH_SIZE);
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (game) => {
        try {
          const wp = await fetchWinProb(game.id);
          cache.set(game.id, { wp, fetchedAt: Date.now() });
        } catch {
          // keep the last value, record the attempt (waits out the TTL)
          cache.set(game.id, {
            wp: cache.get(game.id)?.wp ?? null,
            fetchedAt: Date.now(),
          });
        }
      }),
    );
  }
  if (batch.length > 0) emit();
}
