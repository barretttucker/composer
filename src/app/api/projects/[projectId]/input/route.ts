import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { displayPixelDimensions } from "@/lib/image-display-dims";
import {
  customSegmentInitAbsolute,
  customSegmentInitRel,
  getResolution,
  inputsDir,
  loadProject,
  projectRoot,
  saveProject,
  touchedUpSeedRel,
  updateSegment,
} from "@/lib/project-store";
import { detectWanAspect, wanDimensionsFor } from "@/lib/wan-resolution";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(req: Request, context: Params) {
  const { projectId } = await context.params;
  let project;
  try {
    project = loadProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (project.segments.length === 0) {
    return NextResponse.json(
      { error: "Add a clip before uploading an image" },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "image file required" }, { status: 400 });
  }

  const segmentIndexRaw = form.get("segmentIndex");
  const segmentIndex =
    segmentIndexRaw == null || segmentIndexRaw === ""
      ? 0
      : Number(String(segmentIndexRaw));
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    return NextResponse.json({ error: "invalid segmentIndex" }, { status: 400 });
  }
  if (segmentIndex >= project.segments.length) {
    return NextResponse.json({ error: "segmentIndex out of range" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  fs.mkdirSync(inputsDir(projectId), { recursive: true });

  if (segmentIndex === 0) {
    const dest = path.join(inputsDir(projectId), "start_frame.png");
    fs.writeFileSync(dest, buf);

    const { width: iw, height: ih } = displayPixelDimensions(buf);
    if (iw <= 0 || ih <= 0) {
      return NextResponse.json(
        {
          error: "Could not read image dimensions (supported: PNG, JPEG, WebP, …)",
        },
        { status: 400 },
      );
    }

    const aspect = detectWanAspect(iw, ih);
    const prev = getResolution(project);
    project.resolution = {
      mode: prev.mode,
      bucket: prev.bucket,
      detected_aspect: aspect,
    };

    if (project.resolution.mode === "auto") {
      const { width, height } = wanDimensionsFor(aspect, project.resolution.bucket);
      project.defaults.width = width;
      project.defaults.height = height;
    }

    project.updated_at = new Date().toISOString();
    saveProject(project);

    return NextResponse.json({
      ok: true,
      path: "inputs/start_frame.png",
      segmentIndex: 0,
      image_width: iw,
      image_height: ih,
      detected_aspect: aspect,
      resolution: project.resolution,
      defaults: { width: project.defaults.width, height: project.defaults.height },
    });
  }

  const seg = project.segments[segmentIndex];
  const { width: iw, height: ih } = displayPixelDimensions(buf);
  if (iw <= 0 || ih <= 0) {
    return NextResponse.json(
      { error: "Could not read image dimensions (supported: PNG, JPEG, WebP, …)" },
      { status: 400 },
    );
  }

  const uploadKind = String(form.get("kind") ?? "clip_init");

  if (uploadKind === "touched_seed") {
    const rel = touchedUpSeedRel(seg.id);
    const dest = path.join(projectRoot(projectId), ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    updateSegment(projectId, seg.id, {
      seed_frame_source: "touched_up",
      seed_frame_rel: rel,
    });
    return NextResponse.json({
      ok: true,
      path: rel,
      segmentIndex,
      image_width: iw,
      image_height: ih,
    });
  }

  const dest = customSegmentInitAbsolute(projectId, seg.id);
  fs.writeFileSync(dest, buf);
  updateSegment(projectId, seg.id, {
    extend_from_previous: false,
    seed_frame_source: "fresh",
    seed_frame_rel: customSegmentInitRel(seg.id),
  });

  return NextResponse.json({
    ok: true,
    path: `inputs/custom-init-${seg.id}.png`,
    segmentIndex,
    image_width: iw,
    image_height: ih,
  });
}
