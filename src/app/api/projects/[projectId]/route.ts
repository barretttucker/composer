import { NextResponse } from "next/server";

import { deleteProject } from "@/lib/project-store-extra";
import { loadProject, saveProject } from "@/lib/project-store";
import { projectSchema } from "@/lib/schemas/project";
import { segmentRenderHealthBySegmentId } from "@/lib/segment-render-fingerprint";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    const project = loadProject(projectId);
    const segmentRenderHealth = segmentRenderHealthBySegmentId(project);
    return NextResponse.json({ project, segmentRenderHealth });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(req: Request, context: Params) {
  const { projectId } = await context.params;
  let project = loadProject(projectId);
  const patch = await req.json();
  const merged = { ...project, ...patch };
  merged.updated_at = new Date().toISOString();
  try {
    project = projectSchema.parse(merged);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  saveProject(project);
  return NextResponse.json({ project });
}

export async function DELETE(_req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    deleteProject(projectId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
