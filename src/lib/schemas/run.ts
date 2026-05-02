import { z } from "zod";

import { assemblyFieldSchema, generationParamsSchema } from "@/lib/schemas/project";

export const assemblyAbVariantSchema = z.object({
  key: z.enum(["a", "b"]),
  label: z.string(),
  mp4_rel: z.string(),
  last_frame_rel: z.string(),
  assembled_prompt: z.string(),
  /** Assembly field order used to build this prompt (apply to segment on pick for fingerprint match). */
  order: z.array(assemblyFieldSchema),
  seed_used: z.number().optional(),
  generation_ms: z.number().optional(),
  word_count: z.number().optional(),
});

export type AssemblyAbVariant = z.infer<typeof assemblyAbVariantSchema>;

export const segmentRunStateSchema = z.object({
  segment_id: z.string(),
  index: z.number(),
  status: z.enum([
    "pending",
    "generating",
    "done",
    "failed",
    "skipped",
    "paused",
  ]),
  mp4_rel: z.string().optional(),
  last_frame_rel: z.string().optional(),
  seed_used: z.number().optional(),
  error: z.string().optional(),
  /** Present when Forge img2img returns JSON but no usable video (redacted shapes only). */
  forge_diagnostics: z.unknown().optional(),
  /** Chain hygiene: PNG frame extraction timing (when enabled). */
  chain_hygiene_frame_extraction_ms: z.number().optional(),
  /** Chain hygiene: Forge extra-single-image + Lanczos downscale timing (when sharpen on). */
  chain_hygiene_sharpen_ms: z.number().optional(),
  /** Single-segment A/B assembly compare: canonical publish deferred until pick. */
  assembly_ab_pending_pick: z.boolean().optional(),
  assembly_ab_variants: z.array(assemblyAbVariantSchema).optional(),
});

export type SegmentRunState = z.infer<typeof segmentRunStateSchema>;

export const runRecordSchema = z.object({
  id: z.string(),
  profile_id: z.string(),
  forge_base_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  /** When true, pruning keeps this run folder on disk. */
  pinned: z.boolean().optional(),
  status: z.enum(["running", "paused", "completed", "failed", "stopped"]),
  options: z
    .object({
      from_segment_index: z.number().optional(),
      /** Segments in `[from, to)` are processed; tail is marked skipped. Omitted = through end. */
      to_segment_index_exclusive: z.number().optional(),
      seed_delta: z.number().optional(),
      pause_mode: z.boolean().optional(),
      replay_mode: z.enum(["fresh", "exact_replay", "seed_variation"]).optional(),
      /** When true with a single-segment window, run motion-first vs character-first prompts; defer publish. */
      assembly_ab_compare: z.boolean().optional(),
    })
    .optional(),
  segment_states: z.array(segmentRunStateSchema),
  params_snapshot: z.record(z.string(), generationParamsSchema).optional(),
  /** Last prompts attempted per segment in this run (mutable within the run). */
  prompt_snapshot: z
    .record(
      z.string(),
      z.object({
        positive: z.string(),
        negative: z.string(),
      }),
    )
    .optional(),
  final_mp4_rel: z.string().optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
