import { z } from "zod";

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
});

export type GenerationParams = z.infer<typeof generationParamsSchema>;

export function mergeGenerationParams(
  defaults: GenerationParams,
  override?: Partial<GenerationParams>,
): GenerationParams {
  return generationParamsSchema.parse({ ...defaults, ...override });
}

export const segmentSchema = z.object({
  id: z.string(),
  index: z.number(),
  prompt: z.string(),
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
});

export type Segment = z.infer<typeof segmentSchema>;

export function segmentUsesChainInit(segment: Segment, segmentIndex: number): boolean {
  if (segmentIndex === 0) return true;
  return segment.extend_from_previous !== false;
}

export const chainingSchema = z
  .object({
    frame_offset: z.number(),
    blend_frames: z.number(),
    fps: z.number(),
    /** Legacy — stripped on parse. */
    target_total_seconds: z.number().optional(),
  })
  .transform(({ frame_offset, blend_frames, fps }) => ({
    frame_offset,
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

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  segments: z.array(segmentSchema),
  defaults: generationParamsSchema,
  chaining: chainingSchema,
  resolution: resolutionSettingsSchema.optional(),
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
