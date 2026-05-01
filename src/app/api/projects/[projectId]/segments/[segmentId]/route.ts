import { NextResponse } from "next/server";

import { loadProject, removeSegment } from "@/lib/project-store";

type Params = { params: Promise<{ projectId: string; segmentId: string }> };

export async function DELETE(_req: Request, context: Params) {
  const { projectId, segmentId } = await context.params;
  try {
    loadProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  removeSegment(projectId, segmentId);
  const project = loadProject(projectId);
  return NextResponse.json({ project });
}
