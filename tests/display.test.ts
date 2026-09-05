import { describe, expect, it } from "vitest";
import { teamMeta } from "../src/lib/display";

describe("teamMeta", () => {
  it("combines overall record, conference record, and conference", () => {
    expect(teamMeta({ record: "2-0", conferenceRecord: "1-0", conference: "SEC" })).toBe(
      "(2-0, 1-0 SEC)",
    );
  });

  it("drops missing pieces", () => {
    expect(teamMeta({ record: "2-0", conferenceRecord: "1-0" })).toBe("(2-0, 1-0)");
    expect(teamMeta({ record: "2-0", conference: "Big Ten" })).toBe("(2-0 Big Ten)");
    expect(teamMeta({ conference: "ACC" })).toBe("(ACC)");
  });

  it("returns undefined when nothing is known", () => {
    expect(teamMeta({})).toBeUndefined();
  });
});
