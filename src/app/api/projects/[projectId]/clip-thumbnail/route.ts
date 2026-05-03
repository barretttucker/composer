import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  canonicalSegmentLastFrame,
  customSegmentInitAbsolute,
  loadProject,
  projectRoot,
  startFramePath,
} from "@/lib/project-store";
import { segmentUsesChainInit } from "@/lib/schemas/project";

export const runtime = "nodejs";

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhwG/6Wd6wAAAABJRU5ErkJggg==",
  "base64",
);

type Params = { params: Promise<{ projectId: string }> };

function isInsideProjectRoot(rootDir: string, candidateFile: string): boolean {
  const rel = path.relative(rootDir, candidateFile);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

export async function GET(req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    loadProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const ix = Number(url.searchParams.get("segmentIndex"));
  if (!Number.isInteger(ix) || ix < 0) {
    return NextResponse.json({ error: "segmentIndex required" }, { status: 400 });
  }

  const project = loadProject(projectId);
  if (ix >= project.segments.length) {
    return NextResponse.json({ error: "segmentIndex out of range" }, { status: 400 });
  }

  const segment = project.segments[ix];
  const root = path.resolve(projectRoot(projectId));

  let candidate: string | null = null;
  if (ix === 0) {
    candidate = startFramePath(projectId);
  } else if (!segmentUsesChainInit(segment, ix)) {
    candidate = customSegmentInitAbsolute(projectId, segment.id);
  } else {
    const prior = project.segments[ix - 1];
    const canonLf = canonicalSegmentLastFrame(projectId, prior.id);
    candidate = fs.existsSync(canonLf) ? canonLf : null;
  }

  const send = (buffer: Buffer) =>
    new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=0",
      },
    });

  if (candidate && fs.existsSync(candidate)) {
    const resolved = path.resolve(candidate);
    if (!isInsideProjectRoot(root, resolved)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return send(fs.readFileSync(resolved));
  }

  return send(PLACEHOLDER_PNG);
}
