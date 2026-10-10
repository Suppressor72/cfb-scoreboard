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
import type { DriveChart, WinProb } from "./types";

export interface GameInsights {
  wp: WinProb | null;
  drive: DriveChart | null;
}

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

export async function fetchGameInsights(
  gameId: string,
  signal?: AbortSignal,
  transport: Transport = fetchTransport,
): Promise<GameInsights> {
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

  const drive = driveOf(res.body, homeAwayIds(res.body.header));

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
      return {
        wp: homePct >= awayPct
          ? { teamId: ids.homeId, pct: Math.round(homePct) }
          : { teamId: ids.awayId, pct: Math.round(awayPct) },
        drive,
      };
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
      return {
        wp: homePct >= awayPct
          ? { teamId: homeId, pct: Math.round(homePct) }
          : { teamId: awayId, pct: Math.round(awayPct) },
        drive,
      };
    }
  }

  return { wp: null, drive }; // final, or no analytics published
}

const NOOP_PLAY_TYPES = new Set(["Timeout", "End Period", "End of Half", "End of Game"]);

/**
 * Live drive chart from `drives.current`. Ball spot and down/distance come
 * from the last play that actually has them (timeouts/end-period carry
 * stale copies); first downs are down transitions (start down ≥ 2 ending
 * at down 1) — CFB play types don't label them.
 */
function driveOf(body: Record<string, unknown>, ids: { homeId: string; awayId: string } | null): DriveChart | null {
  const drives = body.drives;
  if (!isRecord(drives) || !isRecord(drives.current)) return null;
  const current = drives.current;
  const possessionTeamId = isRecord(current.team) ? teamIdOf(current.team) : undefined;
  if (!possessionTeamId) return null;

  const plays = Array.isArray(current.plays) ? current.plays : [];
  const typeText = (p: Record<string, unknown>): string =>
    isRecord(p.type) ? String(p.type.text ?? "") : "";
  // Punts/kickoffs/turnover returns are field-position flips that appear
  // inside drives; the offense's drive actually starts where the flip
  // landed, and flips never count as earned first downs.
  const isFlip = (p: Record<string, unknown>): boolean =>
    /punt|kickoff|intercept|fumble/i.test(typeText(p));
  // A play that hands possession to the other team: punts/kickoffs always,
  // plus any play ESPN flags isTurnover (interceptions, lost fumbles —
  // recovered-by-offense fumbles stay out because the flag stays false).
  const endsPossession = (p: Record<string, unknown>): boolean =>
    /punt|kickoff/i.test(typeText(p)) || p.isTurnover === true;
  // Scoring plays end the drive with end.yardLine at the goal line — during
  // the lag before the ensuing kickoff drive appears, the new spot is
  // unknowable, so render no drive at all (bare field) rather than a
  // bogus endzone arrow.
  const isScore = (p: Record<string, unknown>): boolean =>
    p.scoringPlay === true || /touchdown|field goal|safety/i.test(typeText(p));
  const endYard = (p: Record<string, unknown>): number | undefined => {
    const end = isRecord(p.end) ? p.end : {};
    return typeof end.yardLine === "number" && Number.isFinite(end.yardLine)
      ? end.yardLine
      : undefined;
  };

  // Ball spot + down/distance: last non-no-op, non-flip play
  let ballAbs: number | undefined;
  let downDistance = "";
  let lastReal: Record<string, unknown> | undefined;
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (!isRecord(p) || NOOP_PLAY_TYPES.has(typeText(p))) continue;
    lastReal = p;
    if (endsPossession(p) || isScore(p)) break; // drive over
    const end = isRecord(p.end) ? p.end : {};
    if (ballAbs === undefined && endYard(p) !== undefined) {
      ballAbs = endYard(p);
      if (typeof end.shortDownDistanceText === "string" && end.shortDownDistanceText) {
        downDistance = end.shortDownDistanceText;
      }
      break;
    }
  }

  // Drive start, most-authoritative first: where a leading punt/kickoff/
  // return landed; else where the first scrimmage play snapped the ball
  // (drive.start can be unreliable right after possession changes — e.g. a
  // bogus goal-line value that stretches the line across the field); else
  // the drive-level start; else the ball spot.
  let flipLanding: number | undefined;
  let firstSnap: number | undefined;
  for (const p of plays) {
    if (!isRecord(p) || NOOP_PLAY_TYPES.has(typeText(p))) continue;
    if (isFlip(p)) {
      const y = endYard(p);
      if (y !== undefined) flipLanding = y;
      continue;
    }
    const s = isRecord(p.start) ? p.start : {};
    if (typeof s.yardLine === "number" && Number.isFinite(s.yardLine)) {
      firstSnap = s.yardLine;
    }
    break; // first scrimmage play decides
  }
  const startRaw = isRecord(current.start) ? current.start.yardLine : undefined;
  const startAbs =
    flipLanding ??
    firstSnap ??
    (typeof startRaw === "number" && Number.isFinite(startRaw) ? startRaw : undefined) ??
    ballAbs ??
    0;

  // Scores end the drive at the goal line; show nothing until the kickoff
  // drive replaces it (the receiving spot is unknowable until then)
  if (lastReal !== undefined && isScore(lastReal)) return null;

  // Possession change the data hasn't caught up to yet: the drive ended with
  // a punt, kickoff, or turnover — synthesize the receiving team's fresh
  // possession, opposite direction, 1st & 10 (or Goal inside the 10).
  if (lastReal !== undefined && ids && endsPossession(lastReal)) {
    const landing = endYard(lastReal);
    if (landing !== undefined) {
      const receiver =
        possessionTeamId === ids.homeId ? ids.awayId : possessionTeamId === ids.awayId ? ids.homeId : undefined;
      if (receiver) {
        const flipEnd = isRecord(lastReal.end) ? lastReal.end : {};
        const dd =
          typeof flipEnd.shortDownDistanceText === "string" && flipEnd.shortDownDistanceText
            ? flipEnd.shortDownDistanceText
            : Math.min(landing, 100 - landing) <= 10
              ? "1st & Goal"
              : "1st & 10";
        return {
          possessionTeamId: receiver,
          startAbs: landing,
          ballAbs: landing,
          downDistance: dd,
          firstDowns: [],
        };
      }
    }
  }

  if (ballAbs === undefined) return null;

  // Earned first downs: down transitions on scrimmage plays only
  const firstDowns: number[] = [];
  for (const p of plays) {
    if (!isRecord(p) || NOOP_PLAY_TYPES.has(typeText(p)) || isFlip(p)) continue;
    const start = isRecord(p.start) ? p.start : {};
    const end = isRecord(p.end) ? p.end : {};
    if (
      typeof start.down === "number" && start.down >= 2 &&
      end.down === 1 &&
      typeof end.yardLine === "number" && Number.isFinite(end.yardLine)
    ) {
      firstDowns.push(end.yardLine);
    }
  }
  return { possessionTeamId, startAbs, ballAbs, downDistance, firstDowns };
}
