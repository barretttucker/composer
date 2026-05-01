import { NextResponse } from "next/server";

import { pruneUnpinnedRuns } from "@/lib/run-store";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(req: Request, context: Params) {
  const { projectId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const keep_latest_unpinned =
    typeof body.keep_latest_unpinned === "number"
      ? body.keep_latest_unpinned
      : undefined;
  try {
    const result = pruneUnpinnedRuns(projectId, {
      keepLatestUnpinned: keep_latest_unpinned,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Prune failed" }, { status: 400 });
  }
}
