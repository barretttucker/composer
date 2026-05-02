import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { AppProfile } from "@/lib/app-config/profiles";
import { normalizeForgeBaseUrl } from "@/lib/app-config/profiles";
import {
  ForgeImg2ImgError,
} from "@/lib/forge/client";
import {
  writeForgeImg2imgRawLogFile,
  type ForgeImg2imgRawLogRecord,
} from "@/lib/forge/img2img-raw-log";
import { summarizeForgeImg2imgRequestPayload } from "@/lib/forge/img2img-diagnostics";
import {
  extractChainFrame,
  stitchConcat,
} from "@/lib/ffmpeg/index";
import {
  loadProject,
  publishSegmentCanonicalArtifacts,
  resolveSegmentInitImageAbs,
  seedFrameRelUsedForSegment,
  startFramePath,
  wireNextSegmentSeedAfterPublish,
} from "@/lib/project-store";
import { buildRegistryMaps, effectiveNegativePrompt, effectivePositivePrompt } from "@/lib/prompt-assembly/assemble";
import { mergeGenerationParams } from "@/lib/schemas/project";
import { isForgeRawHttpLogEnabled } from "@/lib/env";
import {
  createRunSkeleton,
  hydrateRunPrefixFromPriorOutputs,
  loadRunRecord,
  runFolder,
  saveRunRecord,
  segmentArtifactPathsInRun,
} from "@/lib/run-store";
import {
  segmentEffectiveMergedParams,
  segmentRenderFingerprint,
} from "@/lib/segment-render-fingerprint";
import type { RunRecord, SegmentRunState } from "@/lib/schemas/run";
import { createForgeNeoVideoBackend } from "@/lib/video-backend/forge-neo-backend";

import { broadcast } from "@/lib/orchestrator/broadcast";
import {
  clearContinue,
  signalContinue,
  waitForContinue,
} from "@/lib/orchestrator/pause";

const stoppedRuns = new Set<string>();

function runKey(projectId: string, runId: string): string {
  return `${projectId}:${runId}`;
}

export function requestStopRun(projectId: string, runId: string): void {
  stoppedRuns.add(runKey(projectId, runId));
}

export function clearStopRun(projectId: string, runId: string): void {
  stoppedRuns.delete(runKey(projectId, runId));
}

function isStopped(projectId: string, runId: string): boolean {
  return stoppedRuns.has(runKey(projectId, runId));
}

/** Project-root-relative path for `/api/projects/.../file?rel=`. */
function segmentMp4RelForProjectFileApi(runId: string, i: number): string {
  const { mp4Rel } = segmentArtifactPathsInRun(i);
  return path.posix.join("runs", runId, mp4Rel).replace(/\\/g, "/");
}
/** Dedupes poller: Forge often returns the same step/progress for many seconds while GPU-bound. */
function forgeProgressSignature(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  const st =
    o.state && typeof o.state === "object"
      ? (o.state as Record<string, unknown>)
      : {};
  const pr =
    typeof o.progress === "number" ? Math.round(o.progress * 10_000) / 10_000 : -1;
  const step = typeof st.sampling_step === "number" ? st.sampling_step : -1;
  const steps = typeof st.sampling_steps === "number" ? st.sampling_steps : -1;
  const jt = typeof st.job_timestamp === "string" ? st.job_timestamp : "";
  const jn = typeof st.job_no === "number" ? st.job_no : -1;
  return `${pr}|${step}|${steps}|${jt}|${jn}`;
}

export async function executeProjectRun(params: {
  projectId: string;
  profile: AppProfile;
  options?: {
    from_segment_index?: number;
    to_segment_index_exclusive?: number;
    seed_delta?: number;
    pause_mode?: boolean;
  };
}): Promise<{ runId: string }> {
  const projectId = params.projectId;
  const project = loadProject(projectId);
  if (project.segments.length === 0) {
    throw new Error("Project has no segments");
  }
  if (!fs.existsSync(startFramePath(projectId))) {
    throw new Error("Add inputs/start_frame.png before running");
  }

  const profile = params.profile;
  const forgeBaseUrl = normalizeForgeBaseUrl(profile.forge.baseUrl);

  const fromIndex = Math.floor(params.options?.from_segment_index ?? 0);
  const seedDelta = params.options?.seed_delta ?? 0;
  const pauseMode = params.options?.pause_mode ?? false;

  if (
    !Number.isFinite(fromIndex) ||
    fromIndex < 0 ||
    fromIndex > project.segments.length
  ) {
    throw new Error("from_segment_index out of range");
  }
  if (fromIndex === project.segments.length) {
    throw new Error("Nothing to run at this start index");
  }

  const toExclusive =
    params.options?.to_segment_index_exclusive !== undefined
      ? Math.floor(params.options.to_segment_index_exclusive)
      : project.segments.length;
  if (
    !Number.isFinite(toExclusive) ||
    toExclusive <= fromIndex ||
    toExclusive > project.segments.length
  ) {
    throw new Error("to_segment_index_exclusive out of range");
  }

  const { record } = createRunSkeleton({
    projectId,
    profileId: profile.id,
    forgeBaseUrl,
    options: {
      from_segment_index: fromIndex,
      to_segment_index_exclusive: toExclusive,
      seed_delta: seedDelta,
      pause_mode: pauseMode,
      replay_mode: "fresh",
    },
  });

  const runId = record.id;
  clearStopRun(projectId, runId);

  void runLoop({
    projectId,
    runId,
    profile,
    fromIndex,
    toExclusive,
    seedDelta,
    pauseMode,
  }).catch((err) => {
    broadcast(projectId, runId, {
      type: "segment_failed",
      segmentId: project.segments[0]?.id ?? "",
      index: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      const r = loadRunRecord(projectId, runId);
      r.status = "failed";
      r.updated_at = new Date().toISOString();
      saveRunRecord(projectId, r);
    } catch {
      /* ignore */
    }
  });

  return { runId };
}

async function runLoop(args: {
  projectId: string;
  runId: string;
  profile: AppProfile;
  fromIndex: number;
  toExclusive: number;
  seedDelta: number;
  pauseMode: boolean;
}): Promise<void> {
  const { projectId, runId, profile, fromIndex, toExclusive, seedDelta, pauseMode } =
    args;
  let project = loadProject(projectId);
  let rawImg2imgWriter: ((record: ForgeImg2imgRawLogRecord) => void) | undefined;
  const { client, backend } = createForgeNeoVideoBackend(
    profile,
    isForgeRawHttpLogEnabled()
      ? {
          logRawImg2img: (rec) => rawImg2imgWriter?.(rec),
        }
      : undefined,
  );

  let record = loadRunRecord(projectId, runId);
  const baseFolder = runFolder(projectId, runId);

  let currentInputPath = startFramePath(projectId);

  if (fromIndex > 0) {
    try {
      const { chainInputAbs } = hydrateRunPrefixFromPriorOutputs({
        projectId,
        runId,
        fromIndex,
      });
      currentInputPath = chainInputAbs;
      record = loadRunRecord(projectId, runId);
      project = loadProject(projectId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.status = "failed";
      record.updated_at = new Date().toISOString();
      saveRunRecord(projectId, record);
      broadcast(projectId, runId, {
        type: "segment_failed",
        segmentId: project.segments[fromIndex]?.id ?? "",
        index: fromIndex,
        error: msg,
      });
      return;
    }
  }

  for (let i = 0; i < project.segments.length; i++) {
    const segment = project.segments[i];
    const stateIdx = record.segment_states.findIndex(
      (s) => s.segment_id === segment.id,
    );
    const { mp4Rel, lastFrameRel } = segmentArtifactPathsInRun(i);
    const mp4Abs = path.join(baseFolder, mp4Rel.replace(/\//g, path.sep));
    const lastFrameAbs = path.join(baseFolder, lastFrameRel.replace(/\//g, path.sep));

    if (i < fromIndex) {
      const st = record.segment_states[stateIdx];
      if (st?.status === "done" && st.mp4_rel && st.last_frame_rel) {
        currentInputPath = path.join(baseFolder, st.last_frame_rel);
      }
      continue;
    }

    if (i >= toExclusive) {
      updateSegmentState(record, segment.id, { status: "skipped" });
      record.updated_at = new Date().toISOString();
      saveRunRecord(projectId, record);
      broadcast(projectId, runId, {
        type: "log",
        message: `Out of scope for this render (clip ${i + 1} skipped)`,
      });
      continue;
    }

    if (isStopped(projectId, runId)) {
      record.status = "stopped";
      record.updated_at = new Date().toISOString();
      saveRunRecord(projectId, record);
      broadcast(projectId, runId, { type: "stopped" });
      return;
    }

    let merged = segmentEffectiveMergedParams(project, i);
    if (seedDelta !== 0 && merged.seed >= 0) {
      merged = mergeGenerationParams(merged, {
        seed: merged.seed + seedDelta,
      });
    }

    record.params_snapshot = record.params_snapshot ?? {};
    record.params_snapshot[segment.id] = merged;

    if (segment.locked && fs.existsSync(mp4Abs)) {
      broadcast(projectId, runId, {
        type: "log",
        message: `Skipping locked segment ${i} (reuse existing file)`,
      });
      if (!fs.existsSync(lastFrameAbs)) {
        await extractChainFrame(
          mp4Abs,
          project.chaining.frame_offset,
          lastFrameAbs,
        );
      }
      updateSegmentState(record, segment.id, {
        status: "skipped",
        mp4_rel: mp4Rel.replace(/\\/g, "/"),
        last_frame_rel: lastFrameRel.replace(/\\/g, "/"),
      });
      saveRunRecord(projectId, record);
      const mapsLocked = buildRegistryMaps(project);
      const posLocked = effectivePositivePrompt(segment, project, mapsLocked);
      const negLocked = effectiveNegativePrompt(segment, project);
      const resolvedLocked = resolveSegmentInitImageAbs({
        projectId,
        project,
        segmentIndex: i,
        chainCurrentAbs: currentInputPath,
      });
      publishSegmentCanonicalArtifacts({
        projectId,
        segmentId: segment.id,
        mp4SourceAbs: mp4Abs,
        lastFrameSourceAbs: lastFrameAbs,
        fingerprint: segmentRenderFingerprint(project, i),
        published: {
          assembled_prompt: posLocked,
          assembled_negative_prompt: negLocked,
          merged_generation_params: merged,
          seed_frame_rel_used: seedFrameRelUsedForSegment(project, i, resolvedLocked),
        },
      });
      wireNextSegmentSeedAfterPublish(
        projectId,
        i,
        path.posix.join("segment_outputs", segment.id, "last_frame.png"),
      );
      project = loadProject(projectId);
      broadcast(projectId, runId, {
        type: "segment_finished",
        segmentId: segment.id,
        index: i,
        mp4_rel: segmentMp4RelForProjectFileApi(runId, i),
      });
      currentInputPath = lastFrameAbs;
      continue;
    }

    updateSegmentState(record, segment.id, {
      status: "generating",
      error: undefined,
      forge_diagnostics: undefined,
    });
    record.updated_at = new Date().toISOString();
    saveRunRecord(projectId, record);

    broadcast(projectId, runId, {
      type: "segment_started",
      segmentId: segment.id,
      index: i,
    });

    let lastForgePayload: Record<string, unknown> | undefined;
    try {
      rawImg2imgWriter = isForgeRawHttpLogEnabled()
        ? (rec) =>
            writeForgeImg2imgRawLogFile(baseFolder, i, segment.id, rec)
        : undefined;

      const maps = buildRegistryMaps(project);
      const positivePrompt = effectivePositivePrompt(segment, project, maps);
      const negativePrompt = effectiveNegativePrompt(segment, project);
      record.prompt_snapshot = record.prompt_snapshot ?? {};
      record.prompt_snapshot[segment.id] = {
        positive: positivePrompt,
        negative: negativePrompt,
      };
      record.updated_at = new Date().toISOString();
      saveRunRecord(projectId, record);

      const resolvedInit = resolveSegmentInitImageAbs({
        projectId,
        project,
        segmentIndex: i,
        chainCurrentAbs: currentInputPath,
      });
      const initB64 = fs.readFileSync(resolvedInit).toString("base64");
      const seedRelUsed = seedFrameRelUsedForSegment(project, i, resolvedInit);

      let lastProgressSig = "";
      let lastProgressBroadcastAt = 0;
      const FORGE_PROGRESS_HEARTBEAT_MS = 15_000;

      const progressTimer = setInterval(async () => {
        try {
          const prog = await client.getProgress();
          const sig = forgeProgressSignature(prog);
          const now = Date.now();
          const sigChanged = sig !== lastProgressSig;
          const heartbeat = now - lastProgressBroadcastAt >= FORGE_PROGRESS_HEARTBEAT_MS;
          if (sigChanged || heartbeat) {
            lastProgressSig = sig;
            lastProgressBroadcastAt = now;
            broadcast(projectId, runId, { type: "forge_progress", raw: prog });
          }
        } catch {
          /* ignore */
        }
      }, 1000);

      let videoBase64: string;
      let payload: Record<string, unknown>;
      let seedUsed: number;
      try {
        const result = await backend.generate({
          generation: merged,
          initImageBase64: initB64,
          prompt: positivePrompt,
          negativePrompt: negativePrompt,
        });
        payload = result.requestPayload;
        seedUsed = result.seedUsed;
        videoBase64 = result.videoBase64;
      } finally {
        clearInterval(progressTimer);
      }
      lastForgePayload = payload;

      await fs.promises.mkdir(path.dirname(mp4Abs), { recursive: true });
      await fs.promises.writeFile(
        mp4Abs,
        Buffer.from(videoBase64, "base64"),
      );

      await extractChainFrame(
        mp4Abs,
        project.chaining.frame_offset,
        lastFrameAbs,
      );

      updateSegmentState(record, segment.id, {
        status: "done",
        mp4_rel: mp4Rel.replace(/\\/g, "/"),
        last_frame_rel: lastFrameRel.replace(/\\/g, "/"),
        seed_used: seedUsed,
      });
      record.updated_at = new Date().toISOString();
      saveRunRecord(projectId, record);

      publishSegmentCanonicalArtifacts({
        projectId,
        segmentId: segment.id,
        mp4SourceAbs: mp4Abs,
        lastFrameSourceAbs: lastFrameAbs,
        fingerprint: segmentRenderFingerprint(project, i),
        published: {
          assembled_prompt: positivePrompt,
          assembled_negative_prompt: negativePrompt,
          merged_generation_params: merged,
          seed_frame_rel_used: seedRelUsed,
        },
      });
      wireNextSegmentSeedAfterPublish(
        projectId,
        i,
        path.posix.join("segment_outputs", segment.id, "last_frame.png"),
      );
      project = loadProject(projectId);

      broadcast(projectId, runId, {
        type: "segment_finished",
        segmentId: segment.id,
        index: i,
        mp4_rel: segmentMp4RelForProjectFileApi(runId, i),
      });

      currentInputPath = lastFrameAbs;

      if (segment.pause_for_review && pauseMode) {
        record.status = "paused";
        record.updated_at = new Date().toISOString();
        saveRunRecord(projectId, record);
        broadcast(projectId, runId, {
          type: "paused",
          segmentId: segment.id,
          index: i,
        });

        await waitForContinue(projectId, runId);

        record = loadRunRecord(projectId, runId);
        record.status = "running";
        record.updated_at = new Date().toISOString();
        saveRunRecord(projectId, record);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const forgeDiagnostics =
        err instanceof ForgeImg2ImgError
          ? {
              response: err.responseDiagnostics,
              ...(lastForgePayload
                ? { request: summarizeForgeImg2imgRequestPayload(lastForgePayload) }
                : {}),
            }
          : undefined;
      updateSegmentState(record, segment.id, {
        status: "failed",
        error: msg,
        ...(forgeDiagnostics ? { forge_diagnostics: forgeDiagnostics } : {}),
      });
      record.status = "failed";
      record.updated_at = new Date().toISOString();
      saveRunRecord(projectId, record);
      broadcast(projectId, runId, {
        type: "segment_failed",
        segmentId: segment.id,
        index: i,
        error: msg,
        ...(forgeDiagnostics ? { forge_diagnostics: forgeDiagnostics } : {}),
      });
      return;
    }

    record = loadRunRecord(projectId, runId);
  }

  const doneSegments = project.segments.map((_, i) => {
    const { mp4Rel } = segmentArtifactPathsInRun(i);
    return path.join(baseFolder, mp4Rel.replace(/\//g, path.sep));
  });
  const existing = doneSegments.filter((p) => fs.existsSync(p));
  if (existing.length > 0) {
    const finalPath = path.join(baseFolder, "final.mp4");
    await stitchConcat(existing, finalPath);
    record = loadRunRecord(projectId, runId);
    record.final_mp4_rel = "final.mp4";
    record.status = "completed";
    record.updated_at = new Date().toISOString();
    saveRunRecord(projectId, record);
    broadcast(projectId, runId, {
      type: "completed",
      final_mp4_rel: "final.mp4",
    });
  } else {
    record = loadRunRecord(projectId, runId);
    record.status = "completed";
    record.updated_at = new Date().toISOString();
    saveRunRecord(projectId, record);
    broadcast(projectId, runId, { type: "completed", final_mp4_rel: undefined });
  }

  clearContinue(projectId, runId);
}

function updateSegmentState(
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

export function resumeAfterPause(projectId: string, runId: string): boolean {
  const signaled = signalContinue(projectId, runId);
  if (!signaled) return false;
  try {
    const record = loadRunRecord(projectId, runId);
    record.status = "running";
    record.updated_at = new Date().toISOString();
    saveRunRecord(projectId, record);
  } catch {
    /* ignore */
  }
  return true;
}
