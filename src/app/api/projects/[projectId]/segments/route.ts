import { NextResponse } from "next/server";

import { addSegment, loadProject } from "@/lib/project-store";
import type { AddSegmentOptions } from "@/lib/project-store";

type Params = { params: Promise<{ projectId: string }> };

const ADD_SEGMENT_MODES = new Set<NonNullable<AddSegmentOptions["mode"]>>([
  "extend",
  "chain_from",
  "fresh",
]);

export async function POST(req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    loadProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    prompt?: unknown;
    mode?: unknown;
    fromSegmentId?: unknown;
  };
  const prompt =
    typeof body.prompt === "string" ? body.prompt : "New segment prompt";

  const opts: AddSegmentOptions = {};
  if (typeof body.mode === "string" && ADD_SEGMENT_MODES.has(body.mode as never)) {
    opts.mode = body.mode as AddSegmentOptions["mode"];
  }
  if (typeof body.fromSegmentId === "string" && body.fromSegmentId.trim() !== "") {
    opts.fromSegmentId = body.fromSegmentId.trim();
  }

  let segment;
  try {
    segment = addSegment(projectId, prompt, opts);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  const project = loadProject(projectId);
  return NextResponse.json({ segment, project });
}
