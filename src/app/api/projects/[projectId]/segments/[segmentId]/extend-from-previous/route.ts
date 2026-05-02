import { NextResponse } from "next/server";

import {
  loadProject,
  unlinkCustomSegmentInit,
  updateSegment,
} from "@/lib/project-store";

type Params = {
  params: Promise<{ projectId: string; segmentId: string }>;
};

export async function POST(_req: Request, context: Params) {
  const { projectId, segmentId } = await context.params;
  let project;
  try {
    project = loadProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const idx = project.segments.findIndex((s) => s.id === segmentId);
  if (idx === -1) {
    return NextResponse.json({ error: "segment not found" }, { status: 404 });
  }
  if (idx === 0) {
    return NextResponse.json(
      { error: "clip 1 always uses the timeline start frame" },
      { status: 400 },
    );
  }

  unlinkCustomSegmentInit(projectId, segmentId);
  updateSegment(projectId, segmentId, {
    extend_from_previous: true,
    seed_frame_source: "chained",
    seed_frame_rel: undefined,
  });
  const refreshed = loadProject(projectId);
  return NextResponse.json({ ok: true, project: refreshed });
}
