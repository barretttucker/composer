import { NextResponse } from "next/server";

import { getActiveProfile } from "@/lib/app-config/profiles";
import { executeProjectRun } from "@/lib/orchestrator/run-project";
import { listRuns } from "@/lib/run-store";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    const runs = listRuns(projectId);
    return NextResponse.json({ runs });
  } catch {
    return NextResponse.json({ error: "Failed to list runs" }, { status: 400 });
  }
}

export async function POST(req: Request, context: Params) {
  const { projectId } = await context.params;
  const profile = getActiveProfile();
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const from_segment_index =
    typeof body.from_segment_index === "number"
      ? body.from_segment_index
      : undefined;
  const seed_delta =
    typeof body.seed_delta === "number" ? body.seed_delta : undefined;
  const pause_mode =
    typeof body.pause_mode === "boolean" ? body.pause_mode : undefined;
  const to_segment_index_exclusive =
    typeof body.to_segment_index_exclusive === "number"
      ? body.to_segment_index_exclusive
      : undefined;

  try {
    const result = await executeProjectRun({
      projectId,
      profile,
      options: {
        from_segment_index,
        to_segment_index_exclusive,
        seed_delta,
        pause_mode,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
