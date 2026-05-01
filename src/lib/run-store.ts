import "server-only";

import fs from "node:fs";
import path from "node:path";

import { mergeGenerationParams } from "@/lib/schemas/project";
import {
  loadProject,
  runsDir,
  readCanonicalSegmentArtifacts,
} from "@/lib/project-store";
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

export function createRunSkeleton(params: {
  projectId: string;
  profileId: string;
  forgeBaseUrl: string;
  options?: RunRecord["options"];
}): { record: RunRecord; folder: string } {
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

export function segmentArtifactPathsInRun(i: number): {
  mp4Rel: string;
  lastFrameRel: string;
} {
  const pad = String(i).padStart(2, "0");
  return {
    mp4Rel: path.posix.join("segments", `seg_${pad}.mp4`),
    lastFrameRel: path.posix.join("segments", `seg_${pad}_lastframe.png`),
  };
}

function patchSegmentRunState(
  record: RunRecord,
  segmentId: string,
  patch: Partial<SegmentRunState>,
): void {
  const idx = record.segment_states.findIndex((s) => s.segment_id === segmentId);
  if (idx === -1) return;
  record.segment_states[idx] = {
    ...record.segment_states[idx],
    ...patch,
    segment_id: segmentId,
    index: record.segment_states[idx].index,
  };
}

/** Copies canonical or latest-run artifacts into this run for indices `[0, fromIndex)`. */
export function hydrateRunPrefixFromPriorOutputs(params: {
  projectId: string;
  runId: string;
  fromIndex: number;
}): { chainInputAbs: string } {
  const { projectId, runId, fromIndex } = params;
  if (fromIndex <= 0) {
    throw new Error("hydrateRunPrefixFromPriorOutputs requires fromIndex > 0");
  }

  const project = loadProject(projectId);
  let record = loadRunRecord(projectId, runId);
  const baseFolder = runFolder(projectId, runId);
  ensureDir(segmentsDir(projectId, runId));

  if (fromIndex > project.segments.length) {
    throw new Error("from_segment_index out of range");
  }

  for (let i = 0; i < fromIndex; i++) {
    const segment = project.segments[i];
    const canonical = readCanonicalSegmentArtifacts(projectId, segment.id);
    const fromRun = resolveLatestSegmentDoneArtifacts(projectId, i);
    const src = canonical ?? fromRun;
    if (!src) {
      throw new Error(
        `Cannot start from clip index ${fromIndex}: missing rendered clips for segment ${i + 1}. Run from the beginning or lower the start index.`,
      );
    }

    const { mp4Rel, lastFrameRel } = segmentArtifactPathsInRun(i);
    const mp4Abs = path.join(baseFolder, mp4Rel.replace(/\//g, path.sep));
    const lastAbs = path.join(baseFolder, lastFrameRel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(mp4Abs), { recursive: true });
    fs.copyFileSync(src.mp4Abs, mp4Abs);
    fs.copyFileSync(src.lastFrameAbs, lastAbs);

    patchSegmentRunState(record, segment.id, {
      status: "done",
      mp4_rel: mp4Rel.replace(/\\/g, "/"),
      last_frame_rel: lastFrameRel.replace(/\\/g, "/"),
      error: undefined,
    });
    record.updated_at = new Date().toISOString();
    saveRunRecord(projectId, record);
    record = loadRunRecord(projectId, runId);
  }

  const lastPaths = segmentArtifactPathsInRun(fromIndex - 1);
  const chainInputAbs = path.join(
    baseFolder,
    lastPaths.lastFrameRel.replace(/\//g, path.sep),
  );
  if (!fs.existsSync(chainInputAbs)) {
    throw new Error("Hydration failed: chain input frame missing.");
  }
  return { chainInputAbs };
}

export function resolveLatestSegmentDoneArtifacts(
  projectId: string,
  segmentIndex: number,
): { mp4Abs: string; lastFrameAbs: string } | null {
  const runs = listRuns(projectId);
  runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  for (const rec of runs) {
    const st = rec.segment_states.find((s) => s.index === segmentIndex);
    if (!st || (st.status !== "done" && st.status !== "skipped")) continue;
    if (!st.mp4_rel || !st.last_frame_rel) continue;
    const folder = runFolder(projectId, rec.id);
    const mp4Abs = path.join(folder, st.mp4_rel.split("/").join(path.sep));
    const lfAbs = path.join(folder, st.last_frame_rel.split("/").join(path.sep));
    if (fs.existsSync(mp4Abs) && fs.existsSync(lfAbs)) {
      return { mp4Abs, lastFrameAbs: lfAbs };
    }
  }
  return null;
}

export function deleteRunFolder(projectId: string, runId: string): void {
  const folder = runFolder(projectId, runId);
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true });
}

/** Deletes oldest unpinned, non-active runs; keeps the `keepLatestUnpinned` most recent by updated_at. */
export function pruneUnpinnedRuns(
  projectId: string,
  options?: { keepLatestUnpinned?: number },
): { deleted: string[] } {
  const keep = Math.max(0, options?.keepLatestUnpinned ?? 8);
  const runs = listRuns(projectId);
  const volatile = runs.filter(
    (r) =>
      !r.pinned && r.status !== "running" && r.status !== "paused",
  );
  volatile.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const deleteCount = Math.max(0, volatile.length - keep);
  const toDelete = volatile.slice(0, deleteCount);
  const deleted: string[] = [];
  for (const r of toDelete) {
    deleteRunFolder(projectId, r.id);
    deleted.push(r.id);
  }
  return { deleted };
}

export { mergeGenerationParams as mergeParamsForSegment };

export function resolveLatestPriorLastFrameAbs(
  projectId: string,
  priorSegmentIndex: number,
): string | null {
  const runs = listRuns(projectId);
  runs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  for (const rec of runs) {
    const st = rec.segment_states.find((s) => s.index === priorSegmentIndex);
    if (
      !st ||
      (st.status !== "done" && st.status !== "skipped") ||
      !st.last_frame_rel
    )
      continue;
    const abs = path.join(
      runFolder(projectId, rec.id),
      st.last_frame_rel.split("/").join(path.sep),
    );
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}
