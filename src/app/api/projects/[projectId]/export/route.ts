import { NextResponse } from "next/server";

import { exportPortableScript, exportStructuredProject } from "@/lib/project-store";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(req: Request, context: Params) {
  const { projectId } = await context.params;
  const format = new URL(req.url).searchParams.get("format");
  if (format === "structured") {
    try {
      const body = exportStructuredProject(projectId);
      return NextResponse.json(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }
  try {
    const script = exportPortableScript(projectId);
    return NextResponse.json(script);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
