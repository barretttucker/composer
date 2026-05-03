import "server-only";

import fs from "node:fs";
import path from "node:path";

import { mergeGenerationParams } from "@/lib/schemas/project";
import {
  loadProject,
  runsDir,
  readCanonicalSegmentArtifacts,
  canonicalSegmentLastFrame,
} from "@/lib/project-store";
import { assertValidRunFolderKey } from "@/lib/project-slug";
import { runRecordSchema, type RunRecord, type SegmentRunState } from "@/lib/schemas/run";
import { ensureDir } from "@/lib/env";

export function nextRunFolderName(projectId: string): string {
  ensureDir(runsDir(projectId));
  const nums = fs
    .readdirSync(runsDir(projectId))
    .filter((name) => /^run_\d{3}$/.test(name))
    .map((name) => parseInt(name.slice(4), 10));
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return `run_${String(n).padStart(3, "0")}`;
}

export function runFolder(projectId: string, runId: string): string {
  assertValidRunFolderKey(runId);
  return path.join(runsDir(projectId), runId);
}

export function runJsonPath(projectId: string, runId: string): string {
  return path.join(runFolder(projectId, runId), "run.json");
}

export function segmentsDir(projectId: string, runId: string): string {
  return path.join(runFolder(projectId, runId), "segments");
}

export function listRuns(projectId: string): RunRecord[] {
  ensureDir(runsDir(projectId));
  const out: RunRecord[] = [];
  for (const name of fs.readdirSync(runsDir(projectId))) {
    if (!/^run_\d{3}$/.test(name)) continue;
    const rpath = runJsonPath(projectId, name);
    if (!fs.existsSync(rpath)) continue;
    try {
      out.push(loadRunRecord(projectId, name));
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadRunRecord(projectId: string, runId: string): RunRecord {
  const raw = JSON.parse(fs.readFileSync(runJsonPath(projectId, runId), "utf8"));
  return runRecordSchema.parse(raw);
}

export function saveRunRecord(projectId: string, record: RunRecord): void {
  const parsed = runRecordSchema.parse(record);
  fs.writeFileSync(
    runJsonPath(projectId, parsed.id),
    JSON.stringify(parsed, null, 2),
    "utf8",
  );
}

/** Default policy: keep the 20 most recent unpinned runs, drop anything older than 7 days. */
export const DEFAULT_KEEP_LATEST_UNPINNED = 20;
export const DEFAULT_RUN_MAX_AGE_DAYS = 7;

export function createRunSkeleton(params: {
  projectId: string;
  profileId: string;
  forgeBaseUrl: string;
  options?: RunRecord["options"];
}): { record: RunRecord; folder: string } {
  // Garbage-collect old jobs before creating the new one. Active and AB-pending
  // jobs are always preserved.
  pruneUnpinnedRuns(params.projectId);

  const runId = nextRunFolderName(params.projectId);
  const folder = runFolder(params.projectId, runId);
  ensureDir(folder);
  ensureDir(segmentsDir(params.projectId, runId));

  const project = loadProject(params.projectId);
  const now = new Date().toISOString();
  const segment_states: SegmentRunState[] = project.segments.map((s, i) => ({
    segment_id: s.id,
    index: i,
    status: "pending",
  }));

  const record: RunRecord = {
    id: runId,
    profile_id: params.profileId,
    forge_base_url: params.forgeBaseUrl,
    created_at: now,
    updated_at: now,
    status: "running",
    options: params.options,
    segment_states,
    params_snapshot: {},
  };
  saveRunRecord(params.projectId, record);
  return { record, folder };
}

/** AB pending-pick variants live under run-folder paths until the user picks one. */
export function segmentArtifactPathsInRunAb(
  i: number,
  key: "a" | "b",
): {
  mp4Rel: string;
  lastFrameRel: string;
} {
  const pad = String(i).padStart(2, "0");
  const suf = key === "a" ? "_a" : "_b";
  return {
    mp4Rel: path.posix.join("segments", `seg_${pad}${suf}.mp4`),
    lastFrameRel: path.posix.join("segments", `seg_${pad}${suf}_lastframe.png`),
  };
}

/** Scratch render output (later promoted to canonical via rename). */
export function segmentScratchPathsInRun(i: number): {
  mp4Rel: string;
  lastFrameRel: string;
} {
  const pad = String(i).padStart(2, "0");
  return {
    mp4Rel: path.posix.join("segments", `seg_${pad}.mp4`),
    lastFrameRel: path.posix.join("segments", `seg_${pad}_lastframe.png`),
  };
}

/**
 * Validate that all priors `[0, fromIndex)` have canonical artifacts on disk
 * and return the chain-input absolute path (canonical last frame of the prior
 * segment). Replaces the legacy "copy everything into the run folder" hydrator
 * — renders now read priors directly from canonical.
 */
export function validateCanonicalPriors(params: {
  projectId: string;
  fromIndex: number;
}): { chainInputAbs: string } {
  const { projectId, fromIndex } = params;
  if (fromIndex <= 0) {
    throw new Error("validateCanonicalPriors requires fromIndex > 0");
  }
  const project = loadProject(projectId);
  if (fromIndex > project.segments.length) {
    throw new Error("from_segment_index out of range");
  }
  for (let i = 0; i < fromIndex; i++) {
    const segment = project.segments[i];
    if (!readCanonicalSegmentArtifacts(projectId, segment.id)) {
      throw new Error(
        `Cannot start from clip index ${fromIndex}: missing canonical output for segment ${i + 1}. Render from the beginning or lower the start index.`,
      );
    }
  }
  return {
    chainInputAbs: canonicalSegmentLastFrame(
      projectId,
      project.segments[fromIndex - 1].id,
    ),
  };
}

export function deleteRunFolder(projectId: string, runId: string): void {
  const folder = runFolder(projectId, runId);
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true });
}

function isAbPending(record: RunRecord): boolean {
  return record.segment_states.some((s) => s.assembly_ab_pending_pick === true);
}

function ageMs(record: RunRecord): number {
  return Date.now() - new Date(record.updated_at).getTime();
}

/**
 * Auto-prunes unpinned terminal runs. Default: keep the most recent 20, and
 * delete anything older than 7 days. AB-pending and active (running/paused)
 * runs are always preserved regardless of age.
 */
export function pruneUnpinnedRuns(
  projectId: string,
  options?: { keepLatestUnpinned?: number; maxAgeDays?: number },
): { deleted: string[] } {
  const keep = Math.max(0, options?.keepLatestUnpinned ?? DEFAULT_KEEP_LATEST_UNPINNED);
  const maxAgeDays = Math.max(0, options?.maxAgeDays ?? DEFAULT_RUN_MAX_AGE_DAYS);
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const runs = listRuns(projectId);
  const candidates = runs.filter(
    (r) =>
      !r.pinned &&
      r.status !== "running" &&
      r.status !== "paused" &&
      !isAbPending(r),
  );
  // Newest first so we can keep the head and consider the rest for deletion.
  candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const overflow = candidates.slice(keep);
  const tooOld = maxAgeMs > 0 ? candidates.filter((r) => ageMs(r) > maxAgeMs) : [];
  const toDelete = new Set<string>([
    ...overflow.map((r) => r.id),
    ...tooOld.map((r) => r.id),
  ]);
  const deleted: string[] = [];
  for (const id of toDelete) {
    deleteRunFolder(projectId, id);
    deleted.push(id);
  }
  return { deleted };
}

export { mergeGenerationParams as mergeParamsForSegment };
