import { describe, expect, it } from "vitest";
import { badgeLabel } from "./nav-badge";

describe("badgeLabel", () => {
  it("says nothing when there is nothing waiting", () => {
    expect(badgeLabel(0)).toBeNull();
  });

  it("counts what is waiting", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(19)).toBe("19");
  });

  it("shows the cap exactly, since twenty is still a number", () => {
    expect(badgeLabel(20)).toBe("20");
  });

  it("stops counting past the cap", () => {
    expect(badgeLabel(21)).toBe("20+");
    expect(badgeLabel(203)).toBe("20+");
  });

  it("ignores a negative or nonsense count rather than rendering it", () => {
    expect(badgeLabel(-3)).toBeNull();
    expect(badgeLabel(Number.NaN)).toBeNull();
  });
});
