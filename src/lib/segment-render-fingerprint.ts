import "server-only";

import crypto from "node:crypto";

import {
  buildRegistryMaps,
  effectiveNegativePrompt,
  effectivePositivePrompt,
} from "@/lib/prompt-assembly/assemble";
import {
  mergeGenerationParams,
  segmentUsesChainInit,
  type Project,
} from "@/lib/schemas/project";
import {
  framesForClipSeconds,
  inferClipSecondsFromFrames,
} from "@/lib/video-time";

/** Matches orchestrator merge logic for frame count before Forge. */
export function segmentEffectiveMergedParams(
  project: Project,
  segmentIndex: number,
): ReturnType<typeof mergeGenerationParams> {
  const segment = project.segments[segmentIndex];
  const fps = Math.max(1, Math.round(project.chaining.fps));
  let merged = mergeGenerationParams(project.defaults, segment.params_override);
  if (segment.params_override?.frames === undefined) {
    const sec =
      segment.duration_seconds ??
      project.defaults.clip_duration_seconds ??
      inferClipSecondsFromFrames(merged.frames, fps);
    merged = mergeGenerationParams(merged, {
      frames: framesForClipSeconds(sec, fps),
    });
  }
  return merged;
}

export function segmentRenderFingerprint(
  project: Project,
  segmentIndex: number,
): string {
  const segment = project.segments[segmentIndex];
  const merged = segmentEffectiveMergedParams(project, segmentIndex);
  const chain = segmentUsesChainInit(segment, segmentIndex);
  const dur =
    segment.duration_seconds ?? project.defaults.clip_duration_seconds;
  const maps = buildRegistryMaps(project);
  const prompt = effectivePositivePrompt(segment, project, maps);
  const neg = effectiveNegativePrompt(segment, project);
  const payload = [
    prompt,
    neg,
    chain ? "1" : "0",
    String(dur),
    JSON.stringify(merged),
  ].join("\x1e");
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export type SegmentRenderHealth = {
  /** Canonical outputs do not match the current segment definition (prompt/params/duration/chain flag). */
  contentStale: boolean[];
  /** Continuity from chained predecessors means this clip should be re-rendered even if its own definition did not change. */
  chainStale: boolean[];
};

export function computeSegmentRenderHealth(project: Project): SegmentRenderHealth {
  const n = project.segments.length;
  const contentStale = new Array<boolean>(n).fill(false);
  const chainStale = new Array<boolean>(n).fill(false);

  let upstreamBroken = false;

  for (let i = 0; i < n; i++) {
    const seg = project.segments[i];
    const fp = segmentRenderFingerprint(project, i);
    const selfStale =
      seg.last_built_fingerprint === undefined ||
      seg.last_built_fingerprint !== fp;

    contentStale[i] = selfStale;

    const usesChain = segmentUsesChainInit(seg, i);
    if (i > 0 && usesChain && upstreamBroken) {
      chainStale[i] = true;
    }

    if (usesChain) {
      upstreamBroken = upstreamBroken || selfStale;
    } else {
      upstreamBroken = selfStale;
    }
  }

  return { contentStale, chainStale };
}

export type SegmentHealthFlags = {
  contentStale: boolean;
  chainStale: boolean;
};

export function segmentRenderHealthBySegmentId(
  project: Project,
): Record<string, SegmentHealthFlags> {
  const { contentStale, chainStale } = computeSegmentRenderHealth(project);
  const out: Record<string, SegmentHealthFlags> = {};
  project.segments.forEach((s, i) => {
    out[s.id] = {
      contentStale: contentStale[i] ?? false,
      chainStale: chainStale[i] ?? false,
    };
  });
  return out;
}
