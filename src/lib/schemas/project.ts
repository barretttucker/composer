import { z } from "zod";

import { PROJECT_FOLDER_KEY_RE } from "@/lib/project-slug";

/**
 * Chain seed frame settings (always applied between chained clips). The legacy
 * "extract last frame as JPEG-compressed PNG" path was removed; we always
 * extract an earlier frame as an uncompressed PNG, optionally sharpened via a
 * Forge upscaler ×2 + Lanczos downscale.
 *
 * Zod preprocess strips the legacy `enabled` field so old project.json files
 * still load cleanly.
 */
export const chainHygieneSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const { enabled: _ignored, ...rest } = raw as Record<string, unknown>;
      void _ignored;
      return rest;
    }
    return raw;
  },
  z.object({
    /** Negative offset from last frame: -1 = last frame, -3 ≈ third-to-last (default). */
    frame_offset: z.number().int().min(-10).max(-1),
    /** Forge `extra-single-image` 2× upscale then Lanczos downscale back to chain frame size. */
    sharpen: z.boolean(),
    /** Forge upscaler name (see /sdapi/v1/upscalers), e.g. SwinIR_4x or SwinIR 4x. */
    upscaler: z.string(),
  }),
);

export type ChainHygieneParams = z.infer<typeof chainHygieneSchema>;

export const DEFAULT_CHAIN_HYGIENE: ChainHygieneParams = {
  frame_offset: -3,
  sharpen: true,
  upscaler: "SwinIR_4x",
};

export const generationParamsSchema = z.object({
  checkpoint_high: z.string(),
  checkpoint_low: z.string(),
  vae: z.string(),
  text_encoder: z.string(),
  width: z.number(),
  height: z.number(),
  /** User-facing clip length on the timeline (1–10 s); frames derive from chaining fps. */
  clip_duration_seconds: z.number().int().min(1).max(10),
  frames: z.number(),
  steps: z.number(),
  cfg_scale: z.number(),
  shift: z.number(),
  refiner_switch_at: z.number(),
  denoising_strength: z.number(),
  sampler: z.string(),
  scheduler: z.string(),
  seed: z.number(),
  chain_hygiene: chainHygieneSchema.default(DEFAULT_CHAIN_HYGIENE),
});

export type GenerationParams = z.infer<typeof generationParamsSchema>;

export function mergeGenerationParams(
  defaults: GenerationParams,
  override?: Partial<GenerationParams>,
): GenerationParams {
  const ov = override ?? {};
  const mergedChainHygiene = chainHygieneSchema.parse({
    ...defaults.chain_hygiene,
    ...(ov.chain_hygiene ?? {}),
  });
  const restOverride: Partial<GenerationParams> = { ...ov };
  delete restOverride.chain_hygiene;
  return generationParamsSchema.parse({
    ...defaults,
    ...restOverride,
    chain_hygiene: mergedChainHygiene,
  });
}

export const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  descriptor_block: z.string(),
  variants: z.record(z.string(), z.string()).optional(),
  notes: z.string().optional(),
});

export type Character = z.infer<typeof characterSchema>;

export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  descriptor_block: z.string(),
  notes: z.string().optional(),
});

export type Location = z.infer<typeof locationSchema>;

export const styleBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  descriptor_block: z.string(),
  notes: z.string().optional(),
});

export type StyleBlock = z.infer<typeof styleBlockSchema>;

export const seedFrameSourceSchema = z.enum([
  /** Use the previous clip's chained last frame (default for clips after the first). */
  "chained",
  /** Use a specific earlier clip's last frame, identified by `seed_from_segment_id`. */
  "chained_from",
  /** Custom uploaded init PNG (per-segment override). */
  "fresh",
  /** Chain from previous, but allow the user to manually retouch the seed PNG. */
  "touched_up",
]);
export type SeedFrameSource = z.infer<typeof seedFrameSourceSchema>;

export const ASSEMBLY_FIELDS = [
  "motion",
  "beat",
  "interaction",
  "camera",
  "setting",
  "characters",
  "style",
] as const;
export type AssemblyField = (typeof ASSEMBLY_FIELDS)[number];

export const assemblyFieldSchema = z.enum(ASSEMBLY_FIELDS);

/** Default motion-first assembly (interaction between beat and camera when non-empty). */
export const MOTION_FIRST_ASSEMBLY_ORDER: AssemblyField[] = [
  "motion",
  "beat",
  "interaction",
  "camera",
  "setting",
  "characters",
  "style",
];

export const CHARACTER_FIRST_ASSEMBLY_ORDER: AssemblyField[] = [
  "characters",
  "motion",
  "beat",
  "interaction",
  "camera",
  "setting",
  "style",
];

export const assemblyConfigSchema = z.object({
  order: z.array(assemblyFieldSchema),
});

export type AssemblyConfig = z.infer<typeof assemblyConfigSchema>;

export const fieldBudgetEntrySchema = z.object({
  target_min: z.number().int().min(0),
  target_max: z.number().int().min(0),
  soft_max: z.number().int().min(0),
  hard_cap: z.number().int().min(0),
});

export type FieldBudgetEntry = z.infer<typeof fieldBudgetEntrySchema>;

export const fieldBudgetsSchema = z.record(assemblyFieldSchema, fieldBudgetEntrySchema);

export type FieldBudgets = z.infer<typeof fieldBudgetsSchema>;

export const spatialPositionEnumSchema = z.enum([
  "left",
  "right",
  "center",
  "foreground",
  "background",
  "left_of_frame",
  "right_of_frame",
]);

export const spatialPositionSchema = z.union([
  spatialPositionEnumSchema,
  z.object({ custom: z.string().min(1) }),
]);

export type SpatialPosition = z.infer<typeof spatialPositionSchema>;

export const segmentAssemblyOverrideSchema = z.enum([
  "project",
  "motion_first",
  "character_first",
  "custom",
]);

export type SegmentAssemblyOverride = z.infer<typeof segmentAssemblyOverrideSchema>;

export const descriptorModeSchema = z.enum(["full", "reference", "none"]);
export type DescriptorMode = z.infer<typeof descriptorModeSchema>;

export const segmentActiveCharacterSchema = z.object({
  character_id: z.string(),
  variant_id: z.string().optional(),
  position: spatialPositionSchema.optional(),
});

export type SegmentActiveCharacter = z.infer<typeof segmentActiveCharacterSchema>;

export const publishedGenerationSchema = z.object({
  assembled_prompt: z.string(),
  assembled_negative_prompt: z.string(),
  merged_generation_params: generationParamsSchema,
  published_at: z.string(),
  seed_frame_rel_used: z.string(),
  output_clip_rel: z.string(),
  output_last_frame_rel: z.string(),
});

export type PublishedGeneration = z.infer<typeof publishedGenerationSchema>;

export const segmentSchema = z.object({
  id: z.string(),
  index: z.number(),
  /** Legacy flat prompt; used when structured assembly is off. */
  prompt: z.string().default(""),
  negative_prompt: z.string().optional(),
  /** Omit to use project default clip length. */
  duration_seconds: z.number().int().min(1).max(10).optional(),
  params_override: generationParamsSchema.partial().optional(),
  pause_for_review: z.boolean(),
  locked: z.boolean(),
  /**
   * Clips after the first: when true (default), use the previous clip’s chained last frame once
   * rendered. When false, use a custom-uploaded PNG for this clip (until cleared).
   */
  extend_from_previous: z.boolean().optional(),
  /** Set when canonical segment_outputs match this fingerprint (prompt + merged params + duration + chain). */
  last_built_fingerprint: z.string().optional(),

  location_id: z.string().optional(),
  active_characters: z.array(segmentActiveCharacterSchema).optional(),
  beat: z.string().optional(),
  camera_intent: z.string().optional(),
  style_block_id_override: z.string().optional(),
  motion_in: z.string().optional(),
  motion_out: z.string().optional(),
  interaction: z.string().optional(),
  /** How character registry text appears in the Characters block. */
  descriptor_mode: descriptorModeSchema.default("full"),
  /** Override project assembly order for this segment (for experiments). */
  assembly_override: segmentAssemblyOverrideSchema.optional(),
  /** When assembly_override is custom; must be a permutation of AssemblyField for best results. */
  assembly_order_custom: z.array(assemblyFieldSchema).optional(),
  seed_frame_source: seedFrameSourceSchema.optional(),
  /** Project-root-relative path to PNG seed (fresh / touched_up / explicit). */
  seed_frame_rel: z.string().optional(),
  /** When seed_frame_source = "chained_from": the source segment's stable id. */
  seed_from_segment_id: z.string().optional(),
  published_generation: publishedGenerationSchema.optional(),
});

export type Segment = z.infer<typeof segmentSchema>;

/** True when Forge should use assembler output instead of segment.prompt. */
export function segmentUsesStructuredAssembly(project: Project, segment: Segment): boolean {
  if (project.structured_prompts === true) return true;
  if (segment.location_id && segment.location_id.trim() !== "") return true;
  if (segment.active_characters && segment.active_characters.length > 0) return true;
  const beat = segment.beat?.trim() ?? "";
  if (beat !== "") return true;
  const cam = segment.camera_intent?.trim() ?? "";
  if (cam !== "") return true;
  const motionIn = segment.motion_in?.trim() ?? "";
  if (motionIn !== "") return true;
  if (segment.style_block_id_override && segment.style_block_id_override.trim() !== "") return true;
  const interaction = segment.interaction?.trim() ?? "";
  if (interaction !== "") return true;
  return false;
}

export function segmentUsesChainInit(segment: Segment, segmentIndex: number): boolean {
  if (segmentIndex === 0) return true;
  if (segment.seed_frame_source === "fresh") return false;
  if (
    segment.seed_frame_source === "chained" ||
    segment.seed_frame_source === "touched_up" ||
    segment.seed_frame_source === "chained_from"
  )
    return true;
  return segment.extend_from_previous !== false;
}

/**
 * Index of the segment whose last frame seeds this segment, or null when there is no
 * upstream chain (start frame, or fresh upload). Falls back to segmentIndex - 1 when a
 * chained_from reference is missing or stale.
 */
export function segmentChainSourceIndex(
  project: Pick<Project, "segments">,
  segmentIndex: number,
): number | null {
  if (segmentIndex <= 0) return null;
  const segment = project.segments[segmentIndex];
  if (!segment) return null;
  if (segment.seed_frame_source === "fresh") return null;
  if (segment.seed_frame_source === "chained_from") {
    const tid = segment.seed_from_segment_id?.trim();
    if (tid) {
      const idx = project.segments.findIndex((s) => s.id === tid);
      if (idx >= 0 && idx < segmentIndex) return idx;
    }
    return segmentIndex - 1;
  }
  if (
    segment.seed_frame_source === "chained" ||
    segment.seed_frame_source === "touched_up"
  ) {
    return segmentIndex - 1;
  }
  if (segment.extend_from_previous === false) return null;
  return segmentIndex - 1;
}

export const chainingSchema = z
  .object({
    blend_frames: z.number(),
    fps: z.number(),
    /** Legacy fields — stripped on parse so old projects load cleanly. */
    frame_offset: z.number().optional(),
    target_total_seconds: z.number().optional(),
  })
  .transform(({ blend_frames, fps }) => ({
    blend_frames,
    fps,
  }));

export const wanAspectEnum = z.enum(["16:9", "3:2", "1:1", "9:16", "2:3"]);
export const wanBucketEnum = z.enum(["480p", "576p", "720p"]);

export const resolutionSettingsSchema = z.object({
  /** auto: width/height from WAN table; custom: defaults.width / defaults.height manual */
  mode: z.enum(["auto", "custom"]),
  bucket: wanBucketEnum,
  detected_aspect: wanAspectEnum.nullable(),
});

export type ResolutionSettings = z.infer<typeof resolutionSettingsSchema>;

export const projectSchema = z
  .object({
    /** Stable identifier (never changes); exports and imports reference this. */
    id: z.string(),
    /** Folder name under COMPOSER_PROJECTS_ROOT and `/project/[slug]` URL segment. */
    slug: z.string().regex(PROJECT_FOLDER_KEY_RE),
    name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    segments: z.array(segmentSchema),
    defaults: generationParamsSchema,
    chaining: chainingSchema,
    resolution: resolutionSettingsSchema.optional(),

    structured_prompts: z.boolean().optional(),
    characters: z.array(characterSchema).default([]),
    locations: z.array(locationSchema).default([]),
    style_blocks: z.array(styleBlockSchema).default([]),
    character_ids: z.array(z.string()).default([]),
    location_ids: z.array(z.string()).default([]),
    style_block_ids: z.array(z.string()).default([]),
    default_style_block_id: z.string().optional(),
    default_negative_prompt: z.string().optional(),
    assembly_config: assemblyConfigSchema.optional(),
    /** Per-field soft word budgets; partial overrides merge with code defaults. */
    field_budgets: fieldBudgetsSchema.optional(),
  })
  .superRefine((proj, ctx) => {
    const charIds = new Set(proj.characters.map((c) => c.id));
    for (const id of proj.character_ids) {
      if (!charIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `character_ids references missing character: ${id}`,
          path: ["character_ids"],
        });
      }
    }
    const locIds = new Set(proj.locations.map((l) => l.id));
    for (const id of proj.location_ids) {
      if (!locIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `location_ids references missing location: ${id}`,
          path: ["location_ids"],
        });
      }
    }
    const styleIds = new Set(proj.style_blocks.map((s) => s.id));
    for (const id of proj.style_block_ids) {
      if (!styleIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `style_block_ids references missing style_block: ${id}`,
          path: ["style_block_ids"],
        });
      }
    }
    if (
      proj.default_style_block_id != null &&
      proj.default_style_block_id !== "" &&
      !styleIds.has(proj.default_style_block_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `default_style_block_id not found in style_blocks`,
        path: ["default_style_block_id"],
      });
    }
    const segmentIndexById = new Map(proj.segments.map((s, i) => [s.id, i]));
    proj.segments.forEach((seg, i) => {
      if (seg.seed_frame_source !== "chained_from") return;
      const tid = seg.seed_from_segment_id?.trim();
      if (!tid) {
        ctx.addIssue({
          code: "custom",
          message: `segment[${i}] uses chained_from but has no seed_from_segment_id`,
          path: ["segments", i, "seed_from_segment_id"],
        });
        return;
      }
      const sourceIdx = segmentIndexById.get(tid);
      if (sourceIdx === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `segment[${i}] seed_from_segment_id references missing segment`,
          path: ["segments", i, "seed_from_segment_id"],
        });
        return;
      }
      if (sourceIdx >= i) {
        ctx.addIssue({
          code: "custom",
          message: `segment[${i}] seed_from_segment_id must reference an earlier segment`,
          path: ["segments", i, "seed_from_segment_id"],
        });
      }
    });
  });

export type Project = z.infer<typeof projectSchema>;

/**
 * Exclusive end index for "render through next scene boundary" starting at `startIndex`.
 * Includes `startIndex`; stops before the first clip after it that does not chain from the prior clip.
 * If `startIndex` is a non-chained clip (custom reference), only that clip is included.
 */
export function chainGroupEndExclusive(project: Project, startIndex: number): number {
  const n = project.segments.length;
  if (startIndex < 0 || startIndex >= n) return Math.min(Math.max(0, startIndex), n);

  if (startIndex > 0 && !segmentUsesChainInit(project.segments[startIndex], startIndex)) {
    return startIndex + 1;
  }

  let endExclusive = startIndex + 1;
  for (let j = startIndex + 1; j < n; j++) {
    if (!segmentUsesChainInit(project.segments[j], j)) break;
    endExclusive = j + 1;
  }
  return endExclusive;
}

export const WAN_COMPOSER_VERSION = "1.0";

/** Default generation seed (-1 remains valid for truly random Forge behavior). */
export const DEFAULT_GENERATION_SEED = 1234567890;

export const portableScriptSchema = z.object({
  wan_composer_version: z.string(),
  name: z.string(),
  input_image_hash: z.string(),
  input_image_filename: z.string(),
  defaults: generationParamsSchema,
  chaining: z.object({
    frame_offset: z.number().optional(),
    blend_frames: z.number().optional(),
    fps: z.number().optional(),
  }),
  resolution: resolutionSettingsSchema.optional(),
  segments: z.array(
    z.object({
      prompt: z.string(),
      negative_prompt: z.string().optional(),
      frames: z.number().optional(),
      duration_seconds: z.number().int().min(1).max(10).optional(),
      seed: z.number().optional(),
      pause_for_review: z.boolean().optional(),
      locked: z.boolean().optional(),
      extend_from_previous: z.boolean().optional(),
      params_override: generationParamsSchema.partial().optional(),
    }),
  ),
});

export type PortableScript = z.infer<typeof portableScriptSchema>;

export const STRUCTURED_EXPORT_KIND = "structured_v1" as const;

export const structuredProjectExportSchema = z.object({
  export_kind: z.literal(STRUCTURED_EXPORT_KIND),
  wan_composer_version: z.string(),
  exported_at: z.string(),
  project: z.object({
    id: z.string(),
    slug: z.string().regex(PROJECT_FOLDER_KEY_RE).optional(),
    name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    structured_prompts: z.boolean().optional(),
    characters: z.array(characterSchema),
    locations: z.array(locationSchema),
    style_blocks: z.array(styleBlockSchema),
    character_ids: z.array(z.string()),
    location_ids: z.array(z.string()),
    style_block_ids: z.array(z.string()),
    default_style_block_id: z.string().optional(),
    default_negative_prompt: z.string().optional(),
    assembly_config: assemblyConfigSchema.optional(),
    field_budgets: fieldBudgetsSchema.optional(),
    defaults: generationParamsSchema,
    chaining: chainingSchema,
    resolution: resolutionSettingsSchema.optional(),
    segments: z.array(segmentSchema),
  }),
});

export type StructuredProjectExport = z.infer<typeof structuredProjectExportSchema>;
