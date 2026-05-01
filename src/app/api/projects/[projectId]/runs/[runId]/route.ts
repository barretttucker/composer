import { NextResponse } from "next/server";

import { loadRunRecord, saveRunRecord } from "@/lib/run-store";

type Params = { params: Promise<{ projectId: string; runId: string }> };

export async function PATCH(req: Request, context: Params) {
  const { projectId, runId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const pinned = body.pinned;
  if (typeof pinned !== "boolean") {
    return NextResponse.json({ error: "pinned boolean required" }, { status: 400 });
  }
  try {
    const record = loadRunRecord(projectId, runId);
    record.pinned = pinned;
    record.updated_at = new Date().toISOString();
    saveRunRecord(projectId, record);
    return NextResponse.json({ run: record });
  } catch {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
}
