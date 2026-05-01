import { NextResponse } from "next/server";

import { resumeAfterPause } from "@/lib/orchestrator/run-project";

type Params = { params: Promise<{ projectId: string; runId: string }> };

export async function POST(_req: Request, context: Params) {
  const { projectId, runId } = await context.params;
  const ok = resumeAfterPause(projectId, runId);
  if (!ok) {
    return NextResponse.json({ error: "No paused run waiting for resume" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
