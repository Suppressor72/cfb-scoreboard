import { describe, expect, it } from "vitest";
import { applyFilters, hasActiveFilters, NO_FILTERS } from "../src/selectors/filters";
import type { Game } from "../src/api/types";
import { normalizeEvent } from "../src/api/espn";
import {
  finalEvent,
  liveEvent,
  makeEvent,
  noBroadcastEvent,
  streamOnlyEvent,
} from "./fixtures/events";

function gameOf(raw: unknown): Game {
  const r = normalizeEvent(raw);
  if (!("game" in r)) throw new Error("expected game");
  return r.game;
}

// makeEvent default: ORE (ranked 12, Big Ten) @ OKST (unranked, Big 12), ABC tv

describe("applyFilters", () => {
  it("top25 matches when either team is ranked", () => {
    const games = [gameOf(makeEvent()), gameOf(streamOnlyEvent)]; // streamOnly unranked
    const out = applyFilters(games, { ...NO_FILTERS, top25: true });
    expect(out.map((g) => g.id)).toEqual([makeEvent().id as string]);
  });

  it("conference matches either team, including cross-conference games", () => {
    const b1gHome = gameOf(makeEvent()); // ORE(B1G) @ OKST(B12)
    const secGame = gameOf(liveEvent); // MICH(B1G) @ WISC(B1G)
    const out = applyFilters([b1gHome, secGame], { ...NO_FILTERS, conferences: ["SEC"] });
    expect(out).toHaveLength(0);
    const b12 = applyFilters([b1gHome], { ...NO_FILTERS, conferences: ["Big 12"] });
    expect(b12).toHaveLength(1); // cross-conference away team counts
  });

  it("unknown conference membership never matches a conference filter", () => {
    const g = gameOf(streamOnlyEvent); // DUKE(ACC) @ UL(Sun Belt)
    const out = applyFilters([g], { ...NO_FILTERS, conferences: ["Big Ten"] });
    expect(out).toHaveLength(0);
  });

  it("televisedOnly keeps tv and unknown, drops stream-only (A9 rule)", () => {
    const tv = gameOf(makeEvent()); // ABC
    const stream = gameOf(streamOnlyEvent); // ACCNX only
    const unknown = gameOf(noBroadcastEvent); // no broadcast listed
    const out = applyFilters([tv, stream, unknown], { ...NO_FILTERS, televisedOnly: true });
    expect(out.map((g) => g.id).sort()).toEqual([tv.id, unknown.id].sort());
  });

  it("combines active filters with AND", () => {
    const games = [gameOf(makeEvent()), gameOf(finalEvent)];
    const out = applyFilters(games, {
      top25: true,
      conferences: ["Big 12"],
      televisedOnly: false,
    });
    // makeEvent: ranked + Big 12 ✓ ; finalEvent: ranked + Big Ten only ✗
    expect(out.map((g) => g.id)).toEqual([makeEvent().id as string]);
  });

  it("hasActiveFilters reflects every dimension", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, top25: true })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, conferences: ["SEC"] })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, televisedOnly: true })).toBe(true);
  });
});
