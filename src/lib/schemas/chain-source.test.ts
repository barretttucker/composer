import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHAIN_HYGIENE,
  projectSchema,
  segmentChainSourceIndex,
  segmentSchema,
  segmentUsesChainInit,
  type Project,
  type Segment,
} from "@/lib/schemas/project";

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

function makeProject(segments: Segment[]): Project {
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

describe("segmentUsesChainInit", () => {
  it("treats chained_from as a chain seed source", () => {
    const s = seg({ id: "x", index: 1, seed_frame_source: "chained_from" });
    expect(segmentUsesChainInit(s, 1)).toBe(true);
  });

  it("returns false for fresh", () => {
    const s = seg({ id: "x", index: 1, seed_frame_source: "fresh" });
    expect(segmentUsesChainInit(s, 1)).toBe(false);
  });

  it("first segment always considered chained (start frame seeded)", () => {
    const s = seg({ id: "x", index: 0, seed_frame_source: "fresh" });
    expect(segmentUsesChainInit(s, 0)).toBe(true);
  });
});

describe("segmentChainSourceIndex", () => {
  it("returns null for the first segment", () => {
    const project = makeProject([seg({ id: "a", index: 0 })]);
    expect(segmentChainSourceIndex(project, 0)).toBeNull();
  });

  it("returns null for fresh segments", () => {
    const project = makeProject([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1, seed_frame_source: "fresh" }),
    ]);
    expect(segmentChainSourceIndex(project, 1)).toBeNull();
  });

  it("returns index-1 for chained segments", () => {
    const project = makeProject([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1, seed_frame_source: "chained" }),
    ]);
    expect(segmentChainSourceIndex(project, 1)).toBe(0);
  });

  it("resolves chained_from by id", () => {
    const project = makeProject([
      seg({ id: "a", index: 0 }),
      seg({ id: "b", index: 1, seed_frame_source: "fresh" }),
      seg({
        id: "c",
        index: 2,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
    ]);
    expect(segmentChainSourceIndex(project, 2)).toBe(0);
  });

  it("falls back to index-1 when chained_from id becomes dangling at runtime", () => {
    const project = makeProject([
      seg({ id: "a", index: 0 }),
      seg({
        id: "b",
        index: 1,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
    ]);
    // Simulate a stale reference left over after the source segment was deleted
    // outside the schema-validated load path.
    project.segments[1].seed_from_segment_id = "ghost";
    expect(segmentChainSourceIndex(project, 1)).toBe(0);
  });
});

describe("projectSchema validation for chained_from", () => {
  it("rejects chained_from without seed_from_segment_id", () => {
    const result = projectSchema.safeParse({
      id: "p1",
      slug: "p1",
      name: "x",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      segments: [
        seg({ id: "a", index: 0 }),
        seg({ id: "b", index: 1, seed_frame_source: "chained_from" }),
      ],
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
    });
    expect(result.success).toBe(false);
  });

  it("rejects chained_from referencing a later or missing segment", () => {
    const segments = [
      seg({ id: "a", index: 0 }),
      seg({
        id: "b",
        index: 1,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "a",
      }),
    ];
    expect(() => makeProject(segments)).not.toThrow();

    const future = [
      seg({
        id: "a",
        index: 0,
        seed_frame_source: "chained_from",
        seed_from_segment_id: "b",
      }),
      seg({ id: "b", index: 1 }),
    ];
    expect(() => makeProject(future)).toThrow();
  });
});
