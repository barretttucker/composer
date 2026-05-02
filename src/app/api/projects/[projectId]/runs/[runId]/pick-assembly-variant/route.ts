import { NextResponse } from "next/server";

import { pickAssemblyAbVariant } from "@/lib/orchestrator/run-project";
import {
  assertValidProjectFolderKey,
  assertValidRunFolderKey,
} from "@/lib/project-slug";

type Params = { params: Promise<{ projectId: string; runId: string }> };

export async function POST(req: Request, context: Params) {
  const { projectId, runId } = await context.params;
  try {
    assertValidProjectFolderKey(projectId);
    assertValidRunFolderKey(runId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid path" },
      { status: 400 },
    );
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const segmentId = typeof body.segment_id === "string" ? body.segment_id : "";
  const v = body.variant;
  const variant = v === "a" || v === "b" ? v : null;
  if (!segmentId || variant == null) {
    return NextResponse.json(
      { error: "Request JSON must include segment_id (string) and variant (\"a\" | \"b\")." },
      { status: 400 },
    );
  }
  try {
    pickAssemblyAbVariant({ projectId, runId, segmentId, variant });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
