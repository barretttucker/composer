import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAIN_HYGIENE,
  projectSchema,
  segmentSchema,
  type Project,
  type Segment,
} from "@/lib/schemas/project";
import {
  computeSegmentRenderHealth,
  segmentRenderFingerprint,
} from "@/lib/segment-render-fingerprint";

function seg(overrides: Partial<Segment> = {}): Segment {
  return segmentSchema.parse({
    id: overrides.id ?? "seg",
    index: 0,
    prompt: "",
    pause_for_review: false,
    locked: false,
    ...overrides,
  });
}

function project(segments: Segment[]): Project {
  return projectSchema.parse({
    id: "p1",
    slug: "p1",
    name: "Test",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    segments,
    characters: [],
    locations: [],
    style_blocks: [],
    character_ids: [],
    location_ids: [],
    style_block_ids: [],
    defaults: {
      checkpoint_high: "h",
      checkpoint_low: "",
      vae: "v",
      text_encoder: "t",
      width: 832,
      height: 480,
      clip_duration_seconds: 3,
      frames: 48,
      steps: 4,
      cfg_scale: 1,
      shift: 8,
      refiner_switch_at: 0.875,
      denoising_strength: 1,
      sampler: "Euler",
      scheduler: "Simple",
      seed: 1,
      chain_hygiene: { ...DEFAULT_CHAIN_HYGIENE },
    },
    chaining: { frame_offset: -1, blend_frames: 0, fps: 16 },
    resolution: { mode: "custom", bucket: "480p", detected_aspect: null },
  } as Project);
}

function bake(p: Project): Project {
  for (let i = 0; i < p.segments.length; i++) {
    p.segments[i].last_built_fingerprint = segmentRenderFingerprint(p, i);
  }
  return p;
}

describe("segmentRenderFingerprint chain key", () => {
  it("differs when switching from chained to chained_from", () => {
    const a = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1, seed_frame_source: "chained" }),
    ]);
    const b = project([
      seg({ id: "a", index: 0 }),
      seg({
        id: "b",
        index: 1,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
    ]);
    expect(segmentRenderFingerprint(a, 1)).not.toEqual(
      segmentRenderFingerprint(b, 1),
    );
  });

  it("differs when chained_from target id changes", () => {
    const fromA = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1 }),
      seg({
        id: "c",
        index: 2,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
    ]);
    const fromB = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1 }),
      seg({
        id: "c",
        index: 2,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "b",
      }),
    ]);
    expect(segmentRenderFingerprint(fromA, 2)).not.toEqual(
      segmentRenderFingerprint(fromB, 2),
    );
  });
});

describe("computeSegmentRenderHealth chain DAG", () => {
  it("propagates staleness through the chained_previous chain", () => {
    const p = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1 }),
      seg({ id: "c", index: 2 }),
    ]);
    bake(p);
    p.segments[0].prompt = "edited";

    const { contentStale, chainStale } = computeSegmentRenderHealth(p);
    expect(contentStale).toEqual([true, false, false]);
    expect(chainStale).toEqual([false, true, true]);
  });

  it("does not mark chained_from-skipped intermediate clip as upstream-cause for the skipped clip", () => {
    // Topology:
    //   a -> b -> c    (b chains from a, c chains from b)
    //   a -> d         (d chains from a, skipping b and c)
    //   d -> e         (e chains from d)
    const p = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1, seed_frame_source: "chained" }),
      seg({ id: "c", index: 2, seed_frame_source: "chained" }),
      seg({
        id: "d",
        index: 3,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
      seg({ id: "e", index: 4, seed_frame_source: "chained" }),
    ]);
    bake(p);

    // Edit only b: c should be chain-stale, but d should NOT be (d skips b).
    p.segments[1].prompt = "edit b";
    const after = computeSegmentRenderHealth(p);
    expect(after.contentStale).toEqual([false, true, false, false, false]);
    expect(after.chainStale).toEqual([false, false, true, false, false]);
  });

  it("propagates from chained_from source through its descendants", () => {
    const p = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1 }),
      seg({
        id: "d",
        index: 2,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
      seg({ id: "e", index: 3, seed_frame_source: "chained" }),
    ]);
    bake(p);

    p.segments[0].prompt = "edit a";
    const { contentStale, chainStale } = computeSegmentRenderHealth(p);
    expect(contentStale).toEqual([true, false, false, false]);
    expect(chainStale).toEqual([false, true, true, true]);
  });

  it("treats fresh clip as a chain break", () => {
    const p = project([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1, seed_frame_source: "fresh" }),
      seg({ id: "c", index: 2, seed_frame_source: "chained" }),
    ]);
    bake(p);

    p.segments[0].prompt = "edit a";
    const { contentStale, chainStale } = computeSegmentRenderHealth(p);
    expect(contentStale).toEqual([true, false, false]);
    expect(chainStale).toEqual([false, false, false]);
  });
});
