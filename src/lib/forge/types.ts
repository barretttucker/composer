import { z } from "zod";

/**
 * /sdapi/v1/sd-models entry — `config` may be null (Forge quirk #3001).
 * Prefer `title` for sd_model_checkpoint / options (canonical string with hash suffix).
 */
export const sdModelEntrySchema = z
  .object({
    title: z.string(),
    model_name: z.string().optional(),
    hash: z.string().optional(),
    sha256: z.string().optional(),
    filename: z.string().optional(),
    config: z.unknown().nullable().optional(),
  })
  .passthrough();

export type SdModelInfo = z.infer<typeof sdModelEntrySchema>;

/** VAE entries vary by Forge build; accept loose records with a display title-like field. */
export const sdVaeEntrySchema = z
  .object({
    model_name: z.string().optional(),
    filename: z.string().optional(),
  })
  .passthrough();

export type SdVaeInfo = z.infer<typeof sdVaeEntrySchema>;

export const loraEntrySchema = z
  .object({
    name: z.string().optional(),
    alias: z.string().optional(),
    filename: z.string().optional(),
  })
  .passthrough();

export type LoraInfo = z.infer<typeof loraEntrySchema>;

export function parseSdModels(data: unknown): SdModelInfo[] {
  if (!Array.isArray(data)) return [];
  const out: SdModelInfo[] = [];
  for (const row of data) {
    const r = sdModelEntrySchema.safeParse(row);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function parseSdVaes(data: unknown): SdVaeInfo[] {
  if (!Array.isArray(data)) return [];
  const out: SdVaeInfo[] = [];
  for (const row of data) {
    const r = sdVaeEntrySchema.safeParse(row);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function parseLoras(data: unknown): LoraInfo[] {
  if (!Array.isArray(data)) return [];
  const out: LoraInfo[] = [];
  for (const row of data) {
    const r = loraEntrySchema.safeParse(row);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Samplers API may return string[] or { name: string }[] */
export function parseSamplerNames(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && "name" in x && typeof (x as { name: unknown }).name === "string") {
        return (x as { name: string }).name;
      }
      return "";
    })
    .filter(Boolean);
}

/** Schedulers — same shape possibilities as samplers */
export function parseSchedulerNames(data: unknown): string[] {
  return parseSamplerNames(data);
}

export type ForgeCatalog = {
  checkpoints: SdModelInfo[];
  vaes: SdVaeInfo[];
  loras: LoraInfo[];
  samplers: string[];
  schedulers: string[];
};

/** Derive a stable select value for a VAE row (Forge variants differ). */
export function vaeOptionValue(v: SdVaeInfo): string {
  const any = v as Record<string, unknown>;
  if (typeof any.model_name === "string" && any.model_name) return any.model_name;
  if (typeof any.filename === "string" && any.filename) {
    const base = any.filename.split(/[/\\]/).pop() ?? any.filename;
    return String(base);
  }
  return JSON.stringify(v);
}

/** Human-readable label for dropdowns (Forge payloads still use `vaeOptionValue`). */
export function vaeDisplayLabel(v: SdVaeInfo): string {
  const any = v as Record<string, unknown>;
  if (typeof any.name === "string" && any.name) return String(any.name);
  if (typeof any.model_name === "string" && any.model_name) return any.model_name;
  if (typeof any.filename === "string" && any.filename) {
    const base = any.filename.split(/[/\\]/).pop() ?? any.filename;
    return String(base);
  }
  return vaeOptionValue(v);
}
