import { z } from "zod";

import { generationParamsSchema } from "@/lib/schemas/project";

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
    })
    .optional(),
  segment_states: z.array(segmentRunStateSchema),
  params_snapshot: z.record(z.string(), generationParamsSchema).optional(),
  final_mp4_rel: z.string().optional(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
