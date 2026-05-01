import { NextResponse } from "next/server";

import { addSegment, loadProject } from "@/lib/project-store";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(req: Request, context: Params) {
  const { projectId } = await context.params;
  try {
    loadProject(projectId);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const prompt =
    typeof body.prompt === "string" ? body.prompt : "New segment prompt";
  const segment = addSegment(projectId, prompt);
  const project = loadProject(projectId);
  return NextResponse.json({ segment, project });
}
