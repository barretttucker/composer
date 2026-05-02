import { describe, expect, it } from "vitest";

import { slugifyDisplayName } from "@/lib/project-slug";

describe("slugifyDisplayName", () => {
  it("replaces whitespace with underscores and strips unsafe characters", () => {
    expect(slugifyDisplayName("My Cool Video")).toBe("My_Cool_Video");
    expect(slugifyDisplayName("  a/b:c  ")).toBe("a_b_c");
  });

  it("returns empty string for blank names", () => {
    expect(slugifyDisplayName("   ")).toBe("");
  });

  it("avoids leading hyphens (which would be ambiguous with CLI flags)", () => {
    expect(slugifyDisplayName("-foo")).toBe("_foo");
    expect(slugifyDisplayName("--bar baz")).toBe("_bar_baz");
  });
});
