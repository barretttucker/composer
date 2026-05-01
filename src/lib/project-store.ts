import "server-only";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { nanoid } from "nanoid";

import {
  ensureDir,
  getProjectsRoot,
} from "@/lib/env";
import {
  chainingSchema,
  generationParamsSchema,
  mergeGenerationParams,
  portableScriptSchema,
  projectSchema,
  WAN_COMPOSER_VERSION,
  DEFAULT_GENERATION_SEED,
  type PortableScript,
  type Project,
  type ResolutionSettings,
  type Segment,
} from "@/lib/schemas/project";
import { applySetupDefaultsTemplate } from "@/lib/app-config/project-setup-defaults";
import { migrateClipDurationFields } from "@/lib/clip-defaults-migrate";
import { displayPixelDimensions } from "@/lib/image-display-dims";
import { detectWanAspect, wanDimensionsFor } from "@/lib/wan-resolution";
import {
  WAN_DEFAULT_TEXT_ENCODER_FILENAME,
  WAN_DEFAULT_VAE_FILENAME,
} from "@/lib/wan-forge-modules";
import {
  framesForClipSeconds,
  inferClipSecondsFromFrames,
} from "@/lib/video-time";

export function projectRoot(projectId: string): string {
  return path.join(getProjectsRoot(), projectId);
}

export function projectJsonPath(projectId: string): string {
  return path.join(projectRoot(projectId), "project.json");
}

export function presetsPath(projectId: string): string {
  return path.join(projectRoot(projectId), "presets.json");
}

export function inputsDir(projectId: string): string {
  return path.join(projectRoot(projectId), "inputs");
}

export function runsDir(projectId: string): string {
  return path.join(projectRoot(projectId), "runs");
}

/** Canonical scene timeline artifacts (latest successful render per clip). */
export function segmentOutputsRoot(projectId: string): string {
  return path.join(projectRoot(projectId), "segment_outputs");
}

export function segmentArtifactsDir(projectId: string, segmentId: string): string {
  return path.join(segmentOutputsRoot(projectId), segmentId);
}

export function canonicalSegmentMp4(projectId: string, segmentId: string): string {
  return path.join(segmentArtifactsDir(projectId, segmentId), "clip.mp4");
}

export function canonicalSegmentLastFrame(
  projectId: string,
  segmentId: string,
): string {
  return path.join(segmentArtifactsDir(projectId, segmentId), "last_frame.png");
}

export function readCanonicalSegmentArtifacts(
  projectId: string,
  segmentId: string,
): { mp4Abs: string; lastFrameAbs: string } | null {
  const mp4 = canonicalSegmentMp4(projectId, segmentId);
  const lf = canonicalSegmentLastFrame(projectId, segmentId);
  if (fs.existsSync(mp4) && fs.existsSync(lf)) {
    return { mp4Abs: mp4, lastFrameAbs: lf };
  }
  return null;
}

export function publishSegmentCanonicalArtifacts(params: {
  projectId: string;
  segmentId: string;
  mp4SourceAbs: string;
  lastFrameSourceAbs: string;
  fingerprint: string;
}): void {
  const dir = segmentArtifactsDir(params.projectId, params.segmentId);
  ensureDir(dir);
  fs.copyFileSync(
    params.mp4SourceAbs,
    canonicalSegmentMp4(params.projectId, params.segmentId),
  );
  fs.copyFileSync(
    params.lastFrameSourceAbs,
    canonicalSegmentLastFrame(params.projectId, params.segmentId),
  );
  const p = loadProject(params.projectId);
  const seg = p.segments.find((s) => s.id === params.segmentId);
  if (!seg) return;
  seg.last_built_fingerprint = params.fingerprint;
  saveProject(p);
}

export function removeSegmentArtifactsDir(projectId: string, segmentId: string): void {
  const dir = segmentArtifactsDir(projectId, segmentId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
}

export function customSegmentInitRel(segmentId: string): string {
  return path.posix.join("inputs", `custom-init-${segmentId}.png`);
}

export function customSegmentInitAbsolute(projectId: string, segmentId: string): string {
  return path.join(inputsDir(projectId), `custom-init-${segmentId}.png`);
}

export function unlinkCustomSegmentInit(projectId: string, segmentId: string): void {
  const abs = customSegmentInitAbsolute(projectId, segmentId);
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
}

export function defaultGenerationParams(): Project["defaults"] {
  return generationParamsSchema.parse({
    checkpoint_high: "wan2.2_i2v_high_noise_14B_fp8_scaled",
    checkpoint_low: "",
    vae: WAN_DEFAULT_VAE_FILENAME,
    text_encoder: WAN_DEFAULT_TEXT_ENCODER_FILENAME,
    width: 832,
    height: 480,
    clip_duration_seconds: 3,
    frames: framesForClipSeconds(3, 16),
    steps: 4,
    cfg_scale: 1,
    shift: 8,
    refiner_switch_at: 0.875,
    denoising_strength: 1,
    sampler: "Euler",
    scheduler: "Simple",
    seed: DEFAULT_GENERATION_SEED,
  });
}

export function defaultChaining(): Project["chaining"] {
  return chainingSchema.parse({
    frame_offset: -1,
    blend_frames: 0,
    fps: 16,
  });
}

export function listProjectIds(): string[] {
  ensureDir(getProjectsRoot());
  const entries = fs.readdirSync(getProjectsRoot(), { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => fs.existsSync(projectJsonPath(id)))
    .sort();
}

export function loadProject(projectId: string): Project {
  const raw = JSON.parse(fs.readFileSync(projectJsonPath(projectId), "utf8")) as Record<
    string,
    unknown
  >;
  if (raw.resolution == null || typeof raw.resolution !== "object") {
    raw.resolution = {
      mode: "custom",
      bucket: "480p",
      detected_aspect: null,
    };
  }
  migrateClipDurationFields(raw);
  return projectSchema.parse(raw);
}

export function getResolution(project: Project): ResolutionSettings {
  return (
    project.resolution ?? {
      mode: "custom",
      bucket: "480p",
      detected_aspect: null,
    }
  );
}

export function saveProject(project: Project): void {
  const parsed = projectSchema.parse(project);
  fs.writeFileSync(
    projectJsonPath(parsed.id),
    JSON.stringify(parsed, null, 2),
    "utf8",
  );
}

export function createProject(name: string): Project {
  ensureDir(getProjectsRoot());
  const id = nanoid();
  const now = new Date().toISOString();
  const root = projectRoot(id);
  ensureDir(root);
  ensureDir(inputsDir(id));
  ensureDir(runsDir(id));
  ensureDir(segmentOutputsRoot(id));

  let project: Project = {
    id,
    name,
    created_at: now,
    updated_at: now,
    segments: [],
    defaults: defaultGenerationParams(),
    chaining: defaultChaining(),
    resolution: {
      mode: "auto",
      bucket: "480p",
      detected_aspect: null,
    },
  };
  project = applySetupDefaultsTemplate(project);
  saveProject(project);
  return project;
}

export function touchProjectUpdated(projectId: string): void {
  const p = loadProject(projectId);
  p.updated_at = new Date().toISOString();
  saveProject(p);
}

export function addSegment(projectId: string, prompt: string): Segment {
  const p = loadProject(projectId);
  const seg: Segment = {
    id: nanoid(),
    index: p.segments.length,
    prompt,
    pause_for_review: false,
    locked: false,
  };
  if (p.segments.length > 0) {
    seg.extend_from_previous = true;
  }
  p.segments.push(seg);
  p.updated_at = new Date().toISOString();
  saveProject(p);
  return seg;
}

export function updateSegment(
  projectId: string,
  segmentId: string,
  patch: Partial<Omit<Segment, "id" | "index">>,
): Segment {
  const p = loadProject(projectId);
  const idx = p.segments.findIndex((s) => s.id === segmentId);
  if (idx === -1) throw new Error("Segment not found");
  const merged = { ...p.segments[idx], ...patch } as Segment;
  p.segments[idx] = merged;
  p.updated_at = new Date().toISOString();
  saveProject(p);
  return merged;
}

export function removeSegment(projectId: string, segmentId: string): void {
  const p = loadProject(projectId);
  unlinkCustomSegmentInit(projectId, segmentId);
  removeSegmentArtifactsDir(projectId, segmentId);
  p.segments = p.segments.filter((s) => s.id !== segmentId);
  p.segments.forEach((s, i) => {
    s.index = i;
  });
  p.updated_at = new Date().toISOString();
  saveProject(p);
}

export function reorderSegments(projectId: string, orderedIds: string[]): void {
  const p = loadProject(projectId);
  const map = new Map(p.segments.map((s) => [s.id, s]));
  const next: Segment[] = [];
  for (const id of orderedIds) {
    const s = map.get(id);
    if (s) next.push(s);
  }
  for (const s of p.segments) {
    if (!orderedIds.includes(s.id)) next.push(s);
  }
  next.forEach((s, i) => {
    s.index = i;
  });
  p.segments = next;
  p.updated_at = new Date().toISOString();
  saveProject(p);
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function startFramePath(projectId: string): string {
  return path.join(inputsDir(projectId), "start_frame.png");
}

export function importPortableScript(
  rawScript: unknown,
  imageBuffer: Buffer,
): Project {
  if (!rawScript || typeof rawScript !== "object") {
    throw new Error("Invalid script");
  }
  const raw = structuredClone(rawScript) as Record<string, unknown>;
  migrateClipDurationFields(raw);
  const parsed = portableScriptSchema.parse(raw);

  const hash = sha256Buffer(imageBuffer);
  if (hash !== parsed.input_image_hash) {
    throw new Error("Input image hash does not match script.input_image_hash");
  }

  const { width: iw, height: ih } = displayPixelDimensions(imageBuffer);
  if (iw <= 0 || ih <= 0) {
    throw new Error("Could not read image dimensions from imported image");
  }
  const detectedAspect = detectWanAspect(iw, ih);

  const project = createProject(parsed.name);
  const pngPath = startFramePath(project.id);
  fs.writeFileSync(pngPath, imageBuffer);

  const chaining = defaultChaining();
  const ch = parsed.chaining;
  if (ch.frame_offset !== undefined) chaining.frame_offset = ch.frame_offset;
  if (ch.fps !== undefined) chaining.fps = ch.fps;
  if (ch.blend_frames !== undefined) chaining.blend_frames = ch.blend_frames;

  const fpsCh = Math.max(1, Math.round(chaining.fps));

  const segments: Segment[] = parsed.segments.map((s, index) => {
    let duration_seconds = s.duration_seconds;
    if (duration_seconds === undefined && typeof s.frames === "number") {
      duration_seconds = inferClipSecondsFromFrames(s.frames, fpsCh);
    }
    let params_override = s.params_override;
    if (params_override?.frames !== undefined && duration_seconds !== undefined) {
      const po = { ...params_override };
      delete po.frames;
      params_override =
        po && Object.keys(po).length > 0 ? (po as Segment["params_override"]) : undefined;
    }

    const seg: Segment = {
      id: nanoid(),
      index,
      prompt: s.prompt,
      negative_prompt: s.negative_prompt,
      params_override,
      pause_for_review: s.pause_for_review ?? false,
      locked: s.locked ?? false,
    };
    if (duration_seconds !== undefined) seg.duration_seconds = duration_seconds;
    if (index > 0 && s.extend_from_previous !== undefined) {
      seg.extend_from_previous = s.extend_from_previous;
    }
    return seg;
  });

  for (let i = 0; i < segments.length; i++) {
    const ov = parsed.segments[i];
    if (ov?.seed !== undefined) {
      segments[i].params_override = {
        ...segments[i].params_override,
        seed: ov.seed,
      };
    }
  }

  let defaults = generationParamsSchema.parse(parsed.defaults);

  const resolutionFromScript = parsed.resolution;
  const resolution: ResolutionSettings = {
    mode: resolutionFromScript?.mode ?? "auto",
    bucket: resolutionFromScript?.bucket ?? "480p",
    detected_aspect:
      resolutionFromScript?.detected_aspect ?? detectedAspect,
  };
  resolution.detected_aspect = detectedAspect;

  if (resolution.mode === "auto") {
    const dim = wanDimensionsFor(resolution.detected_aspect, resolution.bucket);
    defaults = mergeGenerationParams(defaults, {
      width: dim.width,
      height: dim.height,
    });
  }

  const updated: Project = {
    ...project,
    name: parsed.name,
    segments,
    defaults,
    chaining,
    resolution,
    updated_at: new Date().toISOString(),
  };
  saveProject(updated);
  return updated;
}

export function exportPortableScript(projectId: string): PortableScript {
  const p = loadProject(projectId);
  const inputPath = startFramePath(projectId);
  if (!fs.existsSync(inputPath)) {
    throw new Error("Missing inputs/start_frame.png");
  }
  const hash = sha256File(inputPath);

  return portableScriptSchema.parse({
    wan_composer_version: WAN_COMPOSER_VERSION,
    name: p.name,
    input_image_hash: hash,
    input_image_filename: "start_frame.png",
    defaults: p.defaults,
    chaining: {
      frame_offset: p.chaining.frame_offset,
      fps: p.chaining.fps,
      blend_frames: p.chaining.blend_frames,
    },
    resolution: getResolution(p),
    segments: p.segments.map((s, idx) => {
      const fpsExp = Math.max(1, Math.round(p.chaining.fps));
      const sec =
        s.duration_seconds ?? p.defaults.clip_duration_seconds;
      const framesOut = framesForClipSeconds(sec, fpsExp);
      const params = s.params_override
        ? ({ ...s.params_override } as Record<string, unknown>)
        : undefined;
      if (params && "frames" in params) delete params.frames;

      return {
        prompt: s.prompt,
        negative_prompt: s.negative_prompt,
        frames: framesOut,
        duration_seconds: s.duration_seconds,
        seed: s.params_override?.seed,
        pause_for_review: s.pause_for_review,
        locked: s.locked,
        ...(idx > 0 && s.extend_from_previous === false
          ? { extend_from_previous: false }
          : {}),
        params_override:
          params && Object.keys(params).length > 0
            ? (params as Segment["params_override"])
            : undefined,
      };
    }),
  });
}
