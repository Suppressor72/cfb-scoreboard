/** Static channel tables. Unmapped names fall back by kind — never crash. */

export type ChannelKind = "tv" | "stream" | "other";

export const OTHER_CHANNEL = "Other";

/** Broadcast networks first, then cable. Order = row order in the grid. */
const TV_ORDER = [
  "ABC",
  "CBS",
  "FOX",
  "NBC",
  "CW",
  "ESPN",
  "ESPN2",
  "ESPNU",
  "ESPNEWS",
  "SECN",
  "ACCN",
  "BTN",
  "FS1",
  "FS2",
  "CBSSN",
];

const STREAM_ORDER = [
  "ESPN+",
  "Disney+",
  "ACCNX",
  "SECN+",
  "B1G+",
  "Peacock",
  "FloSports",
  "ESPN App",
];

const TV_SET = new Set(TV_ORDER);
const STREAM_SET = new Set(STREAM_ORDER);

/** Known streaming names observed in ESPN payloads or expected this season. */
const STREAM_ALIASES = new Set([
  ...STREAM_ORDER,
  "ESPN Plus",
  "Big Ten+",
  "B1G+",
  "Hulu",
  "Max",
  "Paramount+",
  "YouTube TV",
]);

export function broadcastKind(name: string): "tv" | "stream" | "unknown" {
  if (STREAM_SET.has(name) || STREAM_ALIASES.has(name)) return "stream";
  if (TV_SET.has(name)) return "tv";
  // ACCNX/SECN+-style suffixed names are streaming extensions of linear networks
  if (/^\+|NX$|\+$/.test(name)) return "stream";
  return "unknown";
}

export interface ChannelInfo {
  kind: ChannelKind;
  /** Sort key: broadcast nets < cable < unmapped tv < streams < unmapped < Other. */
  order: number;
}

const OTHER_ORDER = 900;
const UNKNOWN_TV_ORDER = 50;
const UNKNOWN_STREAM_ORDER = 150;

export function channelInfo(name: string): ChannelInfo {
  if (name === OTHER_CHANNEL) return { kind: "other", order: OTHER_ORDER };
  const tvIdx = TV_ORDER.indexOf(name);
  if (tvIdx >= 0) return { kind: "tv", order: tvIdx };
  const streamIdx = STREAM_ORDER.indexOf(name);
  if (streamIdx >= 0) return { kind: "stream", order: 100 + streamIdx };
  const kind = broadcastKind(name);
  // Unmapped channels sort after their kind group, alphabetically
  if (kind === "tv") return { kind: "tv", order: UNKNOWN_TV_ORDER };
  if (kind === "stream") return { kind: "stream", order: UNKNOWN_STREAM_ORDER };
  return { kind: "tv", order: UNKNOWN_TV_ORDER };
}
