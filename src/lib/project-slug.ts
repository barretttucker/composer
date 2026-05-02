/** Windows reserved device names (without extension). */
const WINDOWS_RESERVED = new Set(
  ["CON", "PRN", "AUX", "NUL"].concat(
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`COM${n}`, `LPT${n}`]),
  ),
);

/** Safe single path segment for project root folder and URL segment (legacy IDs may start with `_` or `-`). */
export const PROJECT_FOLDER_KEY_RE = /^[a-zA-Z0-9_.-]{1,128}$/;

const MAX_SLUG_LEN = 120;

/**
 * Derive a filesystem- and URL-friendly folder name from a display name (spaces → `_`).
 */
export function slugifyDisplayName(name: string): string {
  let s = name.trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "_");
  s = s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_");
  s = s.replace(/[^a-zA-Z0-9_.-]/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  s = s.replace(/\.+$/g, "");
  if (s.length > MAX_SLUG_LEN) {
    s = s.slice(0, MAX_SLUG_LEN).replace(/[._-]+$/g, "");
  }
  if (WINDOWS_RESERVED.has(s.toUpperCase())) {
    s = `${s}_`;
  }
  if (s.startsWith(".")) {
    s = `_${s.replace(/^\./g, "")}`;
  }
  // A leading hyphen makes the folder ambiguous with CLI flags (rm/git/etc).
  if (s.startsWith("-")) {
    s = `_${s.replace(/^-+/, "")}`;
  }
  return s;
}

/** Legacy project.json had no `slug`; folder name matched `id`. */
export function migrateProjectSlugRaw(raw: Record<string, unknown>): void {
  if (typeof raw.slug === "string" && raw.slug.trim() !== "") return;
  if (typeof raw.id === "string" && raw.id) {
    raw.slug = raw.id;
  }
}

export function assertValidProjectFolderKey(key: string): void {
  if (!key || key !== key.trim()) {
    throw new Error("Invalid project path");
  }
  if (key === "." || key === ".." || key.includes("/") || key.includes("\\")) {
    throw new Error("Invalid project path");
  }
  if (key.includes("\0")) {
    throw new Error("Invalid project path");
  }
  if (!PROJECT_FOLDER_KEY_RE.test(key)) {
    throw new Error("Invalid project path");
  }
}

/** Run folders are always created as `run_NNN` (zero-padded 3 digits). */
export const RUN_FOLDER_KEY_RE = /^run_\d{3}$/;

export function assertValidRunFolderKey(key: string): void {
  if (!key || !RUN_FOLDER_KEY_RE.test(key)) {
    throw new Error("Invalid run path");
  }
}
