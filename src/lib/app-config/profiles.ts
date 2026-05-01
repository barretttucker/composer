import "server-only";

import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";

import { ensureDir, getDataDir, getDefaultForgeUrl } from "@/lib/env";

const forgeEndpointSchema = z.object({
  baseUrl: z.string().url(),
  requestTimeoutMs: z.number().int().positive().optional(),
  progressPollMs: z.number().int().positive().optional(),
});

export const appProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  updated_at: z.string(),
  forge: forgeEndpointSchema,
});

export type AppProfile = z.infer<typeof appProfileSchema>;

export const profilesFileSchema = z.object({
  activeProfileId: z.string(),
  profiles: z.array(appProfileSchema),
});

export type ProfilesFile = z.infer<typeof profilesFileSchema>;

function profilesPath(): string {
  return path.join(getDataDir(), "profiles.json");
}

function bootstrapProfiles(): ProfilesFile {
  const now = new Date().toISOString();
  const profile: AppProfile = {
    id: nanoid(),
    name: "Local Forge",
    description: "Default Stable Diffusion / Forge API",
    updated_at: now,
    forge: { baseUrl: getDefaultForgeUrl() },
  };
  return {
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

export function readProfilesFile(): ProfilesFile {
  ensureDir(getDataDir());
  const file = profilesPath();
  if (!fs.existsSync(file)) {
    const initial = bootstrapProfiles();
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return profilesFileSchema.parse(raw);
}

export function writeProfilesFile(data: ProfilesFile): void {
  ensureDir(getDataDir());
  fs.writeFileSync(profilesPath(), JSON.stringify(data, null, 2), "utf8");
}

export function getActiveProfile(): AppProfile {
  const file = readProfilesFile();
  const active = file.profiles.find((p) => p.id === file.activeProfileId);
  if (!active) {
    throw new Error("Active profile not found; fix profiles.json");
  }
  return active;
}

export function getProfileById(id: string): AppProfile | undefined {
  return readProfilesFile().profiles.find((p) => p.id === id);
}

export function normalizeForgeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
