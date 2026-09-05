/**
 * Sanitized ESPN event fixtures — trimmed from verified payload shapes
 * (docs/DATA.md "Verified behavior"). Only fields the adapter reads are
 * kept. No credentials, no personal data.
 */
import type { StatusKind } from "../../src/api/types";

type RawStatus = {
  id: string;
  name: string;
  state: string;
  completed: boolean;
  description: string;
  detail: string;
  shortDetail: string;
};

const STATUS: Record<string, RawStatus> = {
  scheduled: {
    id: "1",
    name: "STATUS_SCHEDULED",
    state: "pre",
    completed: false,
    description: "Scheduled",
    detail: "Sat, September 12th at 12:00 PM EDT",
    shortDetail: "9/12 - 12:00 PM EDT",
  },
  live: {
    id: "2",
    name: "STATUS_IN_PROGRESS",
    state: "in",
    completed: false,
    description: "In Progress",
    detail: "Q3 - 8:12",
    shortDetail: "Q3 8:12",
  },
  final: {
    id: "3",
    name: "STATUS_FINAL",
    state: "post",
    completed: true,
    description: "Final",
    detail: "Final",
    shortDetail: "Final",
  },
  final_ot: {
    id: "41",
    name: "STATUS_FINAL_OT",
    state: "post",
    completed: true,
    description: "Final/OT",
    detail: "Final/OT",
    shortDetail: "Final/OT",
  },
  canceled: {
    id: "74",
    name: "STATUS_CANCELED",
    state: "post",
    completed: false,
    description: "Canceled",
    detail: "Canceled",
    shortDetail: "CANCELED",
  },
  postponed: {
    id: "66",
    name: "STATUS_POSTPONED",
    state: "post",
    completed: false,
    description: "Postponed",
    detail: "Postponed",
    shortDetail: "PPD",
  },
};

export function statusFor(kind: keyof typeof STATUS | "unknown"): RawStatus {
  // Return a copy — callers mutate the status object to simulate edge cases
  return { ...STATUS[kind] };
}

function competitor(opts: {
  id: string;
  abbr: string;
  name: string;
  color: string;
  conferenceId: string;
  homeAway: "home" | "away";
  rank?: number;
  score?: number | string;
  winner?: boolean;
  record?: string;
}) {
  return {
    id: opts.id,
    homeAway: opts.homeAway,
    curatedRank: { current: opts.rank ?? 99 },
    score: opts.score ?? 0,
    winner: opts.winner === true ? true : undefined,
    records: opts.record
      ? [{ name: "overall", type: "total", summary: opts.record }]
      : undefined,
    team: {
      id: opts.id,
      displayName: opts.name,
      shortDisplayName: opts.abbr,
      abbreviation: opts.abbr,
      color: opts.color,
      alternateColor: "000000",
      logo: `https://a.espncdn.com/i/teamlogos/ncaa/500/${opts.id}.png`,
      conferenceId: opts.conferenceId,
    },
  };
}

export interface EventOverrides {
  id?: string;
  date?: string;
  timeValid?: boolean;
  status?: keyof typeof STATUS;
  broadcasts?: unknown;
  links?: unknown;
  venue?: unknown;
  competitors?: unknown;
}

export function makeEvent(o: EventOverrides = {}): Record<string, unknown> {
  return {
    id: o.id ?? "401856782",
    date: o.date ?? "2026-09-12T16:00Z",
    uid: `s:20~l:23~e:${o.id ?? "401856782"}`,
    name: "Oregon at Oklahoma State",
    shortName: "ORE @ OKST",
    season: { type: 2, year: 2026 },
    status: {
      type: statusFor(o.status ?? "scheduled"),
      clock: 0,
      period: 0,
    },
    links:
      o.links ??
      [
        {
          rel: ["summary", "desktop", "event"],
          href: "https://www.espn.com/college-football/game/_/gameId/401856782/oregon-oklahoma-st",
        },
      ],
    competitions: [
      {
        id: "401856782",
        date: o.date ?? "2026-09-12T16:00Z",
        timeValid: o.timeValid !== false,
        dateValid: true,
        neutralSite: false,
        venue:
          o.venue ??
          {
            id: "3646",
            fullName: "Boone Pickens Stadium",
            address: { city: "Stillwater", state: "OK", country: "USA" },
            indoor: false,
          },
        broadcasts: o.broadcasts ?? [{ market: "national", names: ["ABC", "Disney+"] }],
        competitors:
          o.competitors ??
          [
            competitor({
              id: "2483",
              abbr: "ORE",
              name: "Oregon Ducks",
              color: "154733",
              conferenceId: "5",
              homeAway: "away",
              rank: 12,
              score: "0", // string zero, as ESPN sometimes sends pre-game
              record: "1-0",
            }),
            competitor({
              id: "201",
              abbr: "OKST",
              name: "Oklahoma State Cowboys",
              color: "FF7300",
              conferenceId: "4",
              homeAway: "home",
              record: "1-0",
            }),
          ],
        notes: [],
      },
    ],
  };
}

export function makeEnvelope(events: unknown[]): Record<string, unknown> {
  return {
    leagues: [{ id: "23", name: "NCAA - Football", abbreviation: "NCAAF" }],
    season: {},
    day: { date: "20260912" },
    events,
  };
}

export const liveEvent = makeEvent({
  id: "401900001",
  date: "2026-09-12T19:00Z",
  status: "live",
  broadcasts: [{ market: "national", names: ["ESPN"] }],
  competitors: [
    competitor({
      id: "130", abbr: "MICH", name: "Michigan Wolverines", color: "00274C",
      conferenceId: "5", homeAway: "away", rank: 4, score: 17,
    }),
    competitor({
      id: "194", abbr: "WISC", name: "Wisconsin Badgers", color: "c5050c",
      conferenceId: "5", homeAway: "home", score: 10,
    }),
  ],
});

export const finalEvent = makeEvent({
  id: "401900002",
  date: "2026-09-12T16:00Z",
  status: "final",
  broadcasts: [{ market: "national", names: ["FOX"] }],
  competitors: [
    competitor({ id: "111", abbr: "PSU", name: "Penn State Nittany Lions", color: "093161", conferenceId: "5", homeAway: "away", rank: 7, score: 31, winner: true, record: "2-0" }),
    competitor({ id: "112", abbr: "IOWA", name: "Iowa Hawkeyes", color: "FFCD00", conferenceId: "5", homeAway: "home", score: 14, record: "1-1" }),
  ],
});

export const finalOtEvent = makeEvent({
  id: "401900003",
  date: "2026-09-12T23:30Z",
  status: "final_ot",
  broadcasts: [{ market: "national", names: ["Peacock"] }],
  competitors: [
    competitor({ id: "211", abbr: "HAW", name: "Hawaii Warriors", color: "024E63", conferenceId: "17", homeAway: "away", score: 44, winner: true }),
    competitor({ id: "212", abbr: "UNLV", name: "UNLV Rebels", color: "8b0303", conferenceId: "17", homeAway: "home", score: 41 }),
  ],
});

export const streamOnlyEvent = makeEvent({
  id: "401900004",
  date: "2026-09-12T22:00Z",
  broadcasts: [{ market: "national", names: ["ACCNX"] }],
  competitors: [
    competitor({ id: "301", abbr: "DUKE", name: "Duke Blue Devils", color: "012169", conferenceId: "1", homeAway: "away", score: 21 }),
    competitor({ id: "302", abbr: "UL", name: "Louisiana Ragin Cajuns", color: "BA0C2F", conferenceId: "37", homeAway: "home", score: 28, winner: true }),
  ],
  status: "final",
});

export const noBroadcastEvent = makeEvent({
  id: "401900005",
  date: "2026-09-12T20:00Z",
  broadcasts: [],
});

export const tbdEvent = makeEvent({
  id: "401900006",
  date: "2026-09-12T00:00Z", // ESPN parks TBD-time games at T00:00Z
  timeValid: false,
  broadcasts: [{ market: "national", names: ["BTN"] }],
});

export const canceledEvent = makeEvent({
  id: "401900007",
  date: "2026-09-12T18:00Z",
  status: "canceled",
  competitors: [
    competitor({ id: "401", abbr: "MERC", name: "Mercer Bears", color: "F47B20", conferenceId: "48", homeAway: "away", winner: true }),
    competitor({ id: "322", abbr: "NMSU", name: "New Mexico State Aggies", color: "8b0303", conferenceId: "151", homeAway: "home" }),
  ],
});

export const malformedEvent = {
  id: "401900008",
  date: "2026-09-12T17:00Z",
  status: { type: statusFor("scheduled") },
  competitions: [
    {
      competitors: [{ homeAway: "away", team: { id: "500", displayName: "No Abbrev Team" } }],
      broadcasts: [],
    },
  ],
};

export const expectedKind: Record<string, StatusKind> = {};
