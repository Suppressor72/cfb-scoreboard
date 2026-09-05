import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  isoDayDow,
  localDateInTz,
  localMidnightUtc,
  providerRangeForWeek,
  weekStartFor,
} from "../src/lib/dates";

describe("localDateInTz", () => {
  it("assigns late-night west-coast games to the correct local day", () => {
    // UCLA @ CAL kicked off 2026-09-06T02:30Z (Sat 7:30pm PT)
    const ms = Date.parse("2026-09-06T02:30:00Z");
    expect(localDateInTz(ms, "America/New_York")).toBe("2026-09-05");
    expect(localDateInTz(ms, "America/Chicago")).toBe("2026-09-05");
    expect(localDateInTz(ms, "America/Los_Angeles")).toBe("2026-09-05");
  });

  it("splits zones across the UTC date boundary", () => {
    const ms = Date.parse("2026-09-06T04:30:00Z");
    expect(localDateInTz(ms, "Pacific/Honolulu")).toBe("2026-09-05"); // 6:30pm HST
    expect(localDateInTz(ms, "America/New_York")).toBe("2026-09-06"); // 12:30am ET
  });
});

describe("localMidnightUtc (DST-aware)", () => {
  it("converts local midnight to UTC for standard offsets", () => {
    expect(localMidnightUtc("2026-09-05", "America/New_York")).toBe(
      Date.parse("2026-09-05T04:00:00Z"),
    );
    expect(localMidnightUtc("2026-09-05", "America/Los_Angeles")).toBe(
      Date.parse("2026-09-05T07:00:00Z"),
    );
  });

  it("handles the DST fall-back boundary (offset changes within a day)", () => {
    // DST ends 2026-11-01 at 2am ET: midnight Nov 1 is EDT (-4), Nov 2 is EST (-5)
    expect(localMidnightUtc("2026-11-01", "America/New_York")).toBe(
      Date.parse("2026-11-01T04:00:00Z"),
    );
    expect(localMidnightUtc("2026-11-02", "America/New_York")).toBe(
      Date.parse("2026-11-02T05:00:00Z"),
    );
  });

  it("handles half-hour offsets", () => {
    expect(localMidnightUtc("2026-09-05", "Asia/Kolkata")).toBe(
      Date.parse("2026-09-04T18:30:00Z"),
    );
  });
});

describe("iso date helpers", () => {
  it("adds days without DST drift (UTC-noon anchored)", () => {
    expect(addDaysIso("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDaysIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysIso("2026-09-03", -7)).toBe("2026-08-27");
  });

  it("computes day of week", () => {
    expect(isoDayDow("2026-09-03")).toBe(4); // Thursday
    expect(isoDayDow("2026-09-05")).toBe(6); // Saturday
    expect(isoDayDow("2026-09-08")).toBe(2); // Tuesday
  });
});

describe("weekStartFor (Thursday→Wednesday window)", () => {
  const ET = "America/New_York";
  const at = (iso: string): number => Date.parse(iso);

  it("anchors Saturday to that week's Thursday", () => {
    expect(weekStartFor(at("2026-09-05T18:00:00Z"), ET)).toBe("2026-09-03");
  });

  it("keeps Tuesday and Wednesday on the prior Thursday (F6 fix)", () => {
    expect(weekStartFor(at("2026-09-08T18:00:00Z"), ET)).toBe("2026-09-03"); // Tue
    expect(weekStartFor(at("2026-09-09T18:00:00Z"), ET)).toBe("2026-09-03"); // Wed
  });

  it("returns the same Thursday on Thursday itself", () => {
    expect(weekStartFor(at("2026-09-03T12:00:00Z"), ET)).toBe("2026-09-03");
  });

  it("handles late-Saturday west coast instants", () => {
    // Sat Sep 5, 11pm PT = Sun Sep 6 06:00Z — still the Sep 3 week
    expect(weekStartFor(at("2026-09-06T06:00:00Z"), "America/Los_Angeles")).toBe(
      "2026-09-03",
    );
  });
});

describe("providerRangeForWeek", () => {
  it("pads one day either side of the window", () => {
    expect(providerRangeForWeek("2026-09-03")).toEqual({
      start: "2026-09-02",
      end: "2026-09-10",
    });
  });
});
