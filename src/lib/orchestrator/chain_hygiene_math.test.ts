import { describe, expect, it } from "vitest";

import {
  computeChainFrameIndex,
  segmentIndexFromSegmentMp4Path,
} from "@/lib/orchestrator/chain_hygiene_math";

describe("computeChainFrameIndex", () => {
  it("maps negative offsets from the end", () => {
    expect(computeChainFrameIndex(100, -1)).toBe(99);
    expect(computeChainFrameIndex(100, -3)).toBe(97);
    expect(computeChainFrameIndex(100, -10)).toBe(90);
  });

  it("rejects out-of-range offsets", () => {
    expect(() => computeChainFrameIndex(10, -11)).toThrow(/out of range/);
    expect(() => computeChainFrameIndex(10, 0)).toThrow(/out of range/);
  });
});

describe("segmentIndexFromSegmentMp4Path", () => {
  it("parses seg_NN.mp4 basename", () => {
    expect(segmentIndexFromSegmentMp4Path("/runs/run_001/segments/seg_00.mp4")).toBe(0);
    expect(segmentIndexFromSegmentMp4Path("seg_02.mp4")).toBe(2);
  });

  it("parses assembly A/B variant basenames", () => {
    expect(segmentIndexFromSegmentMp4Path("seg_03_a.mp4")).toBe(3);
    expect(segmentIndexFromSegmentMp4Path("seg_01_b.mp4")).toBe(1);
  });

  it("rejects unexpected names", () => {
    expect(() => segmentIndexFromSegmentMp4Path("clip.mp4")).toThrow(/seg_NN/);
  });
});
