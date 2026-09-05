/**
 * ESPN Analytics win probability, from the per-game summary endpoint.
 *
 * Pre-game:  `predictor: { homeTeam: { gameProjection: "84.1" }, awayTeam: … }`
 *            ("Matchup Predictor")
 * In-play:   `winprobability: [{ homeWinPercentage: 0.969, tiePercentage: 0 }]`
 *            — last entry is the current probability
 *
 * Summaries are ~100–275KB each, so callers must batch and cache
 * (see src/state/predictor.ts) — never fetch for a whole day at once.
 */
import { ScoreboardFetchError, fetchTransport, type Transport } from "./espn";
import type { WinProb } from "./types";

const SUMMARY_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pctOf(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function teamIdOf(v: unknown): string | undefined {
  return isRecord(v) && typeof v.id === "string" ? v.id : undefined;
}

/** Home/away team ids from the summary header, for winprobability mapping. */
function homeAwayIds(header: unknown): { homeId: string; awayId: string } | null {
  if (!isRecord(header) || !Array.isArray(header.competitions)) return null;
  const competition = header.competitions.find(isRecord);
  if (!competition || !Array.isArray(competition.competitors)) return null;
  let homeId: string | undefined;
  let awayId: string | undefined;
  for (const c of competition.competitors) {
    if (!isRecord(c)) continue;
    const id = isRecord(c.team) ? teamIdOf(c.team) : teamIdOf(c);
    if (!id) continue;
    if (c.homeAway === "home" && !homeId) homeId = id;
    if (c.homeAway === "away" && !awayId) awayId = id;
  }
  return homeId && awayId ? { homeId, awayId } : null;
}

export async function fetchWinProb(
  gameId: string,
  signal?: AbortSignal,
  transport: Transport = fetchTransport,
): Promise<WinProb | null> {
  const res = await transport(`${SUMMARY_URL}?event=${encodeURIComponent(gameId)}`, {
    signal,
  });
  if (res.status !== 200) {
    throw new ScoreboardFetchError({
      type: "http",
      message: `HTTP ${res.status} from summary`,
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
    });
  }
  if (!isRecord(res.body)) {
    throw new ScoreboardFetchError({
      type: "schema",
      message: "invalid summary envelope",
      retryable: false,
    });
  }

  // Live: newest play's probabilities (ids come from the header)
  if (Array.isArray(res.body.winprobability)) {
    let home: number | undefined;
    let tie = 0;
    for (const entry of res.body.winprobability) {
      if (!isRecord(entry)) continue;
      const h = pctOf(entry.homeWinPercentage);
      if (h === undefined || h < 0 || h > 1) continue;
      home = h;
      const t = pctOf(entry.tiePercentage);
      tie = t !== undefined && t >= 0 ? t : 0;
    }
    const ids = homeAwayIds(res.body.header);
    if (home !== undefined && ids) {
      const homePct = home * 100;
      const awayPct = (1 - home - tie) * 100;
      return homePct >= awayPct
        ? { teamId: ids.homeId, pct: Math.round(homePct) }
        : { teamId: ids.awayId, pct: Math.round(awayPct) };
    }
  }

  // Pre-game: matchup predictor
  const pred = res.body.predictor;
  if (isRecord(pred)) {
    const homeSide = isRecord(pred.homeTeam) ? pred.homeTeam : undefined;
    const awaySide = isRecord(pred.awayTeam) ? pred.awayTeam : undefined;
    const homePct = homeSide ? pctOf(homeSide.gameProjection) : undefined;
    const awayPct = awaySide ? pctOf(awaySide.gameProjection) : undefined;
    const homeId = homeSide ? teamIdOf(homeSide) : undefined;
    const awayId = awaySide ? teamIdOf(awaySide) : undefined;
    if (
      homePct !== undefined &&
      awayPct !== undefined &&
      homeId !== undefined &&
      awayId !== undefined
    ) {
      return homePct >= awayPct
        ? { teamId: homeId, pct: Math.round(homePct) }
        : { teamId: awayId, pct: Math.round(awayPct) };
    }
  }

  return null; // final, or no analytics published
}
