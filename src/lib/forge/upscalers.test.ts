import { describe, expect, it } from "vitest";

import {
  parseForgeUpscalerNames,
  preferredForgeUpscalerName,
} from "@/lib/forge/upscalers";

describe("parseForgeUpscalerNames", () => {
  it("accepts string tuples", () => {
    expect(parseForgeUpscalerNames(["None", "Foo"])).toEqual(["None", "Foo"]);
  });

  it("accepts objects with name", () => {
    expect(parseForgeUpscalerNames([{ name: "SwinIR 4x" }])).toEqual(["SwinIR 4x"]);
  });
});

describe("preferredForgeUpscalerName", () => {
  it("prefers SwinIR 4× variants when present", () => {
    expect(preferredForgeUpscalerName(["None", "SwinIR_4x", "Other"])).toBe("SwinIR_4x");
    expect(preferredForgeUpscalerName(["None", "SwinIR 4x"])).toBe("SwinIR 4x");
  });

  it("falls back to first non-empty entry", () => {
    expect(preferredForgeUpscalerName(["Foo"])).toBe("Foo");
  });
});
