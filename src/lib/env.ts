import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function getProjectsRoot(): string {
  const raw =
    process.env.COMPOSER_PROJECTS_ROOT ??
    path.join(os.homedir(), "projects", "personal", "composer-projects");
  const resolved = path.resolve(expandHome(raw));
  return resolved;
}

export function getDataDir(): string {
  const raw =
    process.env.COMPOSER_DATA_DIR ??
    path.join(os.homedir(), ".local", "share", "composer");
  return path.resolve(expandHome(raw));
}

export function getDefaultForgeUrl(): string {
  return (
    process.env.COMPOSER_DEFAULT_FORGE_URL?.replace(/\/$/, "") ??
    "http://127.0.0.1:7860"
  );
}

/** Full `POST /sdapi/v1/img2img` JSON is written under each run's `forgeraw/` when enabled (large files). */
export function isForgeRawHttpLogEnabled(): boolean {
  const v = process.env.COMPOSER_FORGE_RAW_HTTP?.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
