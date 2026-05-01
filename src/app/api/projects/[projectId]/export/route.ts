import { NextResponse } from "next/server";

import { exportPortableScript } from "@/lib/project-store";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    const script = exportPortableScript(projectId);
    return NextResponse.json(script);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
