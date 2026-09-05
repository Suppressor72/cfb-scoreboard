/**
 * ESPN adapter: validation + normalization at the boundary.
 * Responses are `unknown` until proven; valid events survive partially
 * malformed payloads (coverage: "partial"); invalid envelopes are errors.
 * See docs/DATA.md — every rule here traces to a review finding.
 */
import { broadcastKind } from "./channels";
import { CONFERENCE_BY_ID } from "./conferences";
import type {
  Availability,
  BroadcastAssignment,
  Game,
  Phase,
  StatusKind,
  TeamResult,
} from "./types";

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

export type FetchErrorType =
  | "network"
  | "timeout"
  | "http"
  | "parse"
  | "schema";

export interface FetchError {
  type: FetchErrorType;
  message: string;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
}

export class ScoreboardFetchError extends Error implements FetchError {
  type: FetchErrorType;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(e: FetchError) {
    super(e.message);
    this.name = "ScoreboardFetchError";
    this.type = e.type;
    this.status = e.status;
    this.retryable = e.retryable;
    this.retryAfterMs = e.retryAfterMs;
  }
}

export interface TransportResponse {
  status: number;
  body: unknown;
  retryAfterMs?: number;
}

export type Transport = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<TransportResponse>;

export const fetchTransport: Transport = async (url, init) => {
  let res: Response;
  try {
    res = await fetch(url, { signal: init?.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ScoreboardFetchError({
      type: "network",
      message: `network error: ${String(err)}`,
      retryable: true,
    });
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new ScoreboardFetchError({
      type: "parse",
      message: `non-JSON response (HTTP ${res.status})`,
      status: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
  const retryAfter = res.headers.get("retry-after");
  const retryAfterMs = retryAfter !== null ? Number(retryAfter) * 1000 : undefined;
  return {
    status: res.status,
    body,
    retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
  };
};

// ---------------------------------------------------------------------------
// validation helpers — treat everything as unknown at the boundary
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * ESPN sends scores as strings ("17") once games are live; accept both.
 * Pre-game zeros are filtered out by the caller's phase check.
 */
function scoreOf(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** Per-period points from `linescores: [{ value }]`, completed periods only. */
function linescoresOf(competitor: Record<string, unknown>): number[] | undefined {
  const entries = arr(competitor.linescores);
  if (!entries) return undefined;
  const out: number[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const v = scoreOf(entry.value);
    if (v === undefined) continue;
    out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

function arr(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

// ---------------------------------------------------------------------------
// normalization
// ---------------------------------------------------------------------------

const STATUS_KINDS: Record<string, StatusKind> = {
  STATUS_SCHEDULED: "scheduled",
  STATUS_IN_PROGRESS: "live",
  STATUS_HALFTIME: "halftime",
  STATUS_END_OF_REG: "end_of_reg",
  STATUS_FINAL: "final",
  STATUS_FINAL_OT: "final_ot",
  STATUS_DELAYED: "delayed",
  STATUS_POSTPONED: "postponed",
  STATUS_CANCELED: "canceled",
};

export function espnStatusKind(name: unknown): StatusKind {
  return STATUS_KINDS[str(name) ?? ""] ?? "unknown";
}

function espnPhase(state: unknown): Phase {
  return state === "in" || state === "post" ? state : "pre";
}

/** Terminal statuses where a winner legitimately exists. */
const WINNER_STATUSES: ReadonlySet<StatusKind> = new Set(["final", "final_ot"]);

/** Only intended HTTPS ESPN destinations may render as images/links (A13). */
function safeEspnUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (
      u.protocol === "https:" &&
      (u.hostname === "a.espncdn.com" || u.hostname.endsWith(".espncdn.com") || u.hostname.endsWith("espn.com"))
    ) {
      return url;
    }
  } catch {
    // invalid URL — reject
  }
  return undefined;
}

function normalizeTeam(
  competitor: unknown,
  phase: Phase,
  statusKind: StatusKind,
): TeamResult | null {
  if (!isRecord(competitor)) return null;
  const team = competitor.team;
  if (!isRecord(team)) return null;
  const id = str(team.id);
  const name = str(team.displayName);
  const abbreviation = str(team.abbreviation);
  if (!id || !name || !abbreviation) return null;

  const rankRaw = isRecord(competitor.curatedRank)
    ? num(competitor.curatedRank.current)
    : undefined;
  const recordEntries = arr(competitor.records) ?? [];
  const recordSummary = (match: (r: Record<string, unknown>) => boolean): string | undefined => {
    const entry = recordEntries.find((r) => isRecord(r) && match(r));
    return isRecord(entry) ? str(entry.summary) : undefined;
  };
  const recordOverall = recordSummary((r) => r.name === "overall");
  // Conference record lives in the "vs. Conf." entry (type "vsconf")
  const recordConf = recordSummary((r) => r.name === "vs. Conf." || r.type === "vsconf");

  return {
    id,
    name,
    abbreviation,
    logo: safeEspnUrl(str(team.logo)),
    // Dark-background variant (what ESPN's own dark mode serves), derived
    // from the stable team id; UI falls back to `logo` if it 404s.
    logoDark: `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png`,
    color: str(team.color),
    rank: rankRaw !== undefined && rankRaw >= 1 && rankRaw <= 25 ? rankRaw : undefined,
    record: recordOverall,
    conferenceRecord: recordConf,
    conference: CONFERENCE_BY_ID[str(team.conferenceId) ?? ""] ?? undefined,
    // ESPN sends literal 0 pre-game — never expose it (docs/DATA.md);
    // live/final scores arrive as strings and scoreOf accepts both
    score: phase === "pre" ? undefined : scoreOf(competitor.score),
    linescores: phase === "pre" ? undefined : linescoresOf(competitor),
    winner:
      competitor.winner === true &&
      phase === "post" &&
      WINNER_STATUSES.has(statusKind)
        ? true
        : undefined,
  };
}

function normalizeBroadcasts(competition: Record<string, unknown>): {
  assignments: BroadcastAssignment[];
  primary: string | null;
  availability: Availability;
} {
  const assignments: BroadcastAssignment[] = [];
  const national: BroadcastAssignment[] = [];
  for (const entry of arr(competition.broadcasts) ?? []) {
    if (!isRecord(entry)) continue;
    const market = str(entry.market) ?? "unknown";
    for (const n of arr(entry.names) ?? []) {
      const source = str(n);
      if (!source) continue;
      const assignment: BroadcastAssignment = {
        source,
        kind: broadcastKind(source),
      };
      assignments.push(assignment);
      if (market === "national") national.push(assignment);
    }
  }
  // Deterministic primary pick: national TV → national any → first → null
  const primary =
    national.find((a) => a.kind === "tv")?.source ??
    national[0]?.source ??
    assignments[0]?.source ??
    null;
  const availability: Availability = assignments.some((a) => a.kind === "tv")
    ? "tv"
    : assignments.some((a) => a.kind === "stream")
      ? "stream"
      : "unknown";
  return { assignments, primary, availability };
}

function normalizeVenue(competition: Record<string, unknown>): Game["venue"] {
  const venue = competition.venue;
  if (!isRecord(venue)) return undefined;
  const name = str(venue.fullName);
  if (!name) return undefined;
  const city = isRecord(venue.address) ? str(venue.address.city) : undefined;
  return { name, city };
}

/**
 * Betting line from `competitions[].odds[0]` — present pre-game; ESPN drops
 * it once games are live. All fields optional except details.
 */
function normalizeOdds(competition: Record<string, unknown>): Game["odds"] {
  const first = arr(competition.odds)?.find(isRecord);
  if (!first) return undefined;
  const details = str(first.details);
  const overUnder = num(first.overUnder);
  const provider = isRecord(first.provider) ? str(first.provider.name) : undefined;
  let favoriteTeamId: string | undefined;
  for (const side of [first.homeTeamOdds, first.awayTeamOdds]) {
    if (!isRecord(side) || side.favorite !== true || !isRecord(side.team)) continue;
    favoriteTeamId = str(side.team.id);
    break;
  }
  if (!details && overUnder === undefined) return undefined;
  return {
    provider,
    details: details ?? "",
    overUnder,
    spread: num(first.spread),
    favoriteTeamId,
  };
}

function normalizeGamecastUrl(event: Record<string, unknown>): string | undefined {
  for (const link of arr(event.links) ?? []) {
    if (!isRecord(link)) continue;
    const rel = arr(link.rel);
    const href = str(link.href);
    if (!rel?.includes("summary") || !href) continue;
    // Validate scheme + host before it ever reaches an href
    try {
      const u = new URL(href);
      if (u.protocol === "https:" && u.hostname.endsWith("espn.com")) return href;
    } catch {
      // invalid URL — skip
    }
  }
  return undefined;
}

export type NormalizedEvent = { game: Game } | { error: string };

export function normalizeEvent(event: unknown): NormalizedEvent {
  if (!isRecord(event)) return { error: "event is not an object" };
  const id = str(event.id);
  const dateStr = str(event.date);
  if (!id) return { error: "missing event id" };
  if (!dateStr) return { error: `event ${id}: missing date` };
  const kickoffMs = Date.parse(dateStr);
  if (Number.isNaN(kickoffMs)) {
    return { error: `event ${id}: unparseable date "${dateStr}"` };
  }
  const competition = arr(event.competitions)?.find(isRecord);
  if (!competition) return { error: `event ${id}: no competition` };

  const statusType = isRecord(event.status) ? event.status.type : undefined;
  const statusRecord = isRecord(statusType) ? statusType : {};
  const statusKind = espnStatusKind(statusRecord.name);
  const phase = espnPhase(statusRecord.state);

  const competitors = arr(competition.competitors) ?? [];
  let home: TeamResult | null = null;
  let away: TeamResult | null = null;
  for (const c of competitors) {
    if (!isRecord(c)) continue;
    const normalized = normalizeTeam(c, phase, statusKind);
    if (!normalized) continue;
    if (c.homeAway === "away" && !away) away = normalized;
    if (c.homeAway === "home" && !home) home = normalized;
  }
  if (!home || !away) return { error: `event ${id}: missing home/away competitor` };

  const { assignments, primary, availability } = normalizeBroadcasts(competition);

  return {
    game: {
      id,
      kickoffUtc: new Date(kickoffMs).toISOString(),
      timeTbd: competition.timeValid === false,
      phase,
      statusKind,
      statusDetail: str(statusRecord.shortDetail) ?? "",
      home,
      away,
      broadcasts: assignments,
      primaryBroadcast: primary,
      availability,
      venue: normalizeVenue(competition),
      gamecastUrl: normalizeGamecastUrl(event),
      odds: normalizeOdds(competition),
      endUtc: null,
    },
  };
}

export interface ParsedScoreboard {
  games: Game[];
  warnings: string[];
}

/** Invalid envelope → null (callers turn this into a schema FetchError). */
export function parseScoreboard(payload: unknown): ParsedScoreboard | null {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return null;
  const games: Game[] = [];
  const warnings: string[] = [];
  for (const event of payload.events) {
    const result = normalizeEvent(event);
    if ("game" in result) games.push(result.game);
    else warnings.push(result.error);
  }
  return { games, warnings };
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

/**
 * Fetches the provider date range covering the week window (±1 day — ESPN
 * buckets by US Eastern date; caller filters games down to local days).
 * Dates in the URL are compact YYYYMMDD, not ISO — ESPN 400s on dashed dates.
 */
export async function fetchScoreboardRange(
  providerStart: string,
  providerEnd: string,
  signal?: AbortSignal,
  transport: Transport = fetchTransport,
): Promise<ParsedScoreboard> {
  const compact = (d: string): string => d.replace(/-/g, "");
  const url = `${SCOREBOARD_URL}?dates=${compact(providerStart)}-${compact(providerEnd)}&limit=300`;
  const res = await transport(url, { signal });
  if (res.status !== 200) {
    throw new ScoreboardFetchError({
      type: "http",
      message: `HTTP ${res.status} from scoreboard`,
      status: res.status,
      retryable: res.status === 429 || res.status >= 500,
      retryAfterMs: res.status === 429 ? res.retryAfterMs : undefined,
    });
  }
  const parsed = parseScoreboard(res.body);
  if (!parsed) {
    throw new ScoreboardFetchError({
      type: "schema",
      message: "invalid scoreboard envelope",
      status: res.status,
      retryable: false,
    });
  }
  return parsed;
}
