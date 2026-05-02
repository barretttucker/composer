import { describe, expect, it } from "vitest";

import type { Project, Segment } from "@/lib/schemas/project";
import {
  assembleNegativePrompt,
  assemblePrompt,
  buildRegistryMaps,
  I2V_CONTINUITY_PREFIX,
  stripLeadingContinuityPhrase,
} from "@/lib/prompt-assembly/assemble";

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Test",
    created_at: "",
    updated_at: "",
    segments: [],
    characters: [
      {
        id: "c1",
        name: "A",
        descriptor_block: "Alpha desc",
        variants: { wet: "Alpha wet variant" },
      },
      {
        id: "c2",
        name: "B",
        descriptor_block: "Beta desc",
      },
    ],
    locations: [
      { id: "l1", name: "Street", descriptor_block: "Rainy street" },
    ],
    style_blocks: [
      { id: "s1", name: "Noir", descriptor_block: "Moody lighting" },
    ],
    character_ids: ["c1", "c2"],
    location_ids: ["l1"],
    style_block_ids: ["s1"],
    default_style_block_id: "s1",
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
    },
    chaining: { frame_offset: -1, blend_frames: 0, fps: 16 },
    resolution: {
      mode: "custom",
      bucket: "480p",
      detected_aspect: null,
    },
    ...overrides,
  } as Project;
}

function baseSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg",
    index: 0,
    prompt: "",
    pause_for_review: false,
    locked: false,
    location_id: "l1",
    active_characters: [
      { character_id: "c1", variant_id: "wet" },
      { character_id: "c2" },
    ],
    beat: "They run",
    camera_intent: "dolly forward",
    motion_in: "",
    ...overrides,
  } as Segment;
}

describe("assemblePrompt", () => {
  it("is deterministic for identical input", () => {
    const project = baseProject();
    const segment = baseSegment();
    const maps = buildRegistryMaps(project);
    const a = assemblePrompt(segment, project, maps);
    const b = assemblePrompt(segment, project, maps);
    expect(a).toBe(b);
  });

  it("applies character variant verbatim", () => {
    const project = baseProject();
    const segment = baseSegment();
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out).toContain("Alpha wet variant");
    expect(out).not.toContain("Alpha desc");
  });

  it("omits motion continuation when motion_in empty", () => {
    const project = baseProject({ structured_prompts: true });
    const segment = baseSegment({ motion_in: "   " });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out).not.toMatch(/Continuing from/i);
  });

  it("prepends continuity and motion before beat and camera", () => {
    const project = baseProject({ structured_prompts: true });
    const segment = baseSegment({
      motion_in: "camera settles",
      beat: "They walk",
      camera_intent: "tracking shot",
      location_id: "l1",
    });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out.startsWith(`${I2V_CONTINUITY_PREFIX} camera settles`)).toBe(true);
    const iMotion = out.indexOf("camera settles");
    const iBeat = out.indexOf("They walk");
    const iCam = out.indexOf("tracking shot");
    const iSetting = out.indexOf("Setting:");
    const iChars = out.indexOf("Characters:");
    expect(iBeat).toBeGreaterThan(iMotion);
    expect(iCam).toBeGreaterThan(iBeat);
    expect(iSetting).toBeGreaterThan(iCam);
    expect(iChars).toBeGreaterThan(iSetting);
  });

  it("includes continuity line when motion_in present", () => {
    const project = baseProject({ structured_prompts: true });
    const segment = baseSegment({ motion_in: "subject turns" });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out.startsWith(`${I2V_CONTINUITY_PREFIX} subject turns`)).toBe(true);
  });

  it("strips pasted continuity phrase from motion_in to avoid duplication", () => {
    const project = baseProject({ structured_prompts: true });
    const segment = baseSegment({
      motion_in: "Continuing from the previous moment, pan slowly left",
    });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out).toBe(`${I2V_CONTINUITY_PREFIX} pan slowly left. They run. dolly forward. Setting: Rainy street. Characters: Alpha wet variant. Beta desc. Moody lighting`);
    expect(out.match(/Continuing from/gi)?.length).toBe(1);
  });

  it("never includes motion_out in assembled prompt", () => {
    const project = baseProject({ structured_prompts: true });
    const segment = baseSegment({
      motion_out: "Unique motion out phrase for test",
      motion_in: "motion in only",
    });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out).not.toContain("Unique motion out phrase");
  });

  it("drops beat when identical to motion body (dedupe)", () => {
    const project = baseProject({ structured_prompts: true });
    const segment = baseSegment({
      motion_in: "same text",
      beat: "Same Text",
      camera_intent: "",
    });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    expect(out.match(/same text/gi)?.length).toBe(1);
  });

  it("uses style_block_id_override over project default", () => {
    const project2 = baseProject({
      style_blocks: [
        ...baseProject().style_blocks,
        { id: "s2", name: "Bright", descriptor_block: "High key" },
      ],
      style_block_ids: ["s1", "s2"],
    });
    const segment = baseSegment({ style_block_id_override: "s2" });
    const maps = buildRegistryMaps(project2);
    const out = assemblePrompt(segment, project2, maps);
    expect(out).toContain("High key");
    expect(out).not.toContain("Moody lighting");
  });

  it("preserves multi-character order inside Characters section", () => {
    const project = baseProject();
    const segment = baseSegment({
      active_characters: [
        { character_id: "c2" },
        { character_id: "c1" },
      ],
    });
    const maps = buildRegistryMaps(project);
    const out = assemblePrompt(segment, project, maps);
    const iBeta = out.indexOf("Beta desc");
    const iAlpha = out.indexOf("Alpha desc");
    expect(out).toContain("Characters:");
    expect(iBeta).toBeLessThan(iAlpha);
  });
});

describe("stripLeadingContinuityPhrase", () => {
  it("removes canonical continuity prefix variants", () => {
    expect(stripLeadingContinuityPhrase("Continuing from the previous moment, pan")).toBe("pan");
    expect(stripLeadingContinuityPhrase("Continuing from previous moment,pan")).toBe("pan");
    expect(stripLeadingContinuityPhrase("  continuing FROM previous moment pan")).toBe("pan");
  });
});

describe("assembleNegativePrompt", () => {
  it("uses segment override first", () => {
    const project = baseProject({ default_negative_prompt: "project neg" });
    const segment = baseSegment({ negative_prompt: "seg neg" });
    expect(assembleNegativePrompt(segment, project)).toBe("seg neg");
  });

  it("falls back through project then forge default", () => {
    const project = baseProject({ default_negative_prompt: "  proj  " });
    const segment = baseSegment({ negative_prompt: undefined });
    expect(assembleNegativePrompt(segment, project)).toBe("proj");
  });
});
