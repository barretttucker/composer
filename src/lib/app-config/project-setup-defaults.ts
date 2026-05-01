import "server-only";

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { ensureDir, getDataDir } from "@/lib/env";
import { migrateClipDurationFields } from "@/lib/clip-defaults-migrate";
import {
  chainingSchema,
  generationParamsSchema,
  resolutionSettingsSchema,
  type Project,
} from "@/lib/schemas/project";

/** Persisted template: no detected_aspect (per start frame). */
export const projectSetupDefaultsStoredSchema = z.object({
  updated_at: z.string(),
  defaults: generationParamsSchema,
  chaining: chainingSchema,
  resolution: resolutionSettingsSchema.pick({ mode: true, bucket: true }),
});

export type ProjectSetupDefaultsStored = z.infer<
  typeof projectSetupDefaultsStoredSchema
>;

function filePath(): string {
  return path.join(getDataDir(), "project-setup-defaults.json");
}

export function readProjectSetupDefaults(): ProjectSetupDefaultsStored | null {
  ensureDir(getDataDir());
  const p = filePath();
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  const stub: Record<string, unknown> = {
    defaults: raw.defaults,
    chaining:
      raw.chaining && typeof raw.chaining === "object"
        ? raw.chaining
        : { fps: 16 },
    segments: [],
  };
  migrateClipDurationFields(stub);
  raw.defaults = stub.defaults;

  return projectSetupDefaultsStoredSchema.parse(raw);
}

export function writeProjectSetupDefaults(
  data: Omit<ProjectSetupDefaultsStored, "updated_at">,
): ProjectSetupDefaultsStored {
  ensureDir(getDataDir());
  const next: ProjectSetupDefaultsStored = {
    ...data,
    updated_at: new Date().toISOString(),
  };
  projectSetupDefaultsStoredSchema.parse(next);
  fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Merge saved template into a new project shell (caller sets id, name, dates, segments). */
export function applySetupDefaultsTemplate(project: Project): Project {
  const saved = readProjectSetupDefaults();
  if (!saved) return project;
  project.defaults = generationParamsSchema.parse(saved.defaults);
  project.chaining = chainingSchema.parse(saved.chaining);
  project.resolution = resolutionSettingsSchema.parse({
    mode: saved.resolution.mode,
    bucket: saved.resolution.bucket,
    detected_aspect: null,
  });
  return project;
}
