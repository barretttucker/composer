import { describe, expect, it } from "vitest";

import { diffWords } from "./word-diff";

describe("diffWords", () => {
  it("matches identical strings as all same", () => {
    const d = diffWords("a b c", "a b c");
    expect(d.every((x) => x.kind === "same")).toBe(true);
    expect(d.map((x) => x.text).join("")).toBe("a b c");
  });

  it("detects insertion", () => {
    const d = diffWords("hello world", "hello big world");
    const added = d.filter((x) => x.kind === "added").map((x) => x.text).join("");
    expect(added).toContain("big");
  });
});
