import { NextResponse } from "next/server";

import { requestStopRun } from "@/lib/orchestrator/run-project";

type Params = { params: Promise<{ projectId: string; runId: string }> };

export async function POST(_req: Request, context: Params) {
  const { projectId, runId } = await context.params;
  requestStopRun(projectId, runId);
  return NextResponse.json({ ok: true });
}
