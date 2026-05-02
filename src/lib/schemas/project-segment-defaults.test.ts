import { describe, expect, it } from "vitest";

import { segmentSchema } from "@/lib/schemas/project";

describe("segmentSchema defaults", () => {
  it("fills descriptor_mode full when omitted", () => {
    const s = segmentSchema.parse({
      id: "s",
      index: 0,
      prompt: "",
      pause_for_review: false,
      locked: false,
    });
    expect(s.descriptor_mode).toBe("full");
  });
});
