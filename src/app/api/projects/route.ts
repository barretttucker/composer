import { NextResponse } from "next/server";

import {
  createProject,
  listProjectIds,
  loadProject,
} from "@/lib/project-store";

export async function GET() {
  const ids = listProjectIds();
  const projects = ids.map((folderKey) => {
    const p = loadProject(folderKey);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      updated_at: p.updated_at,
      segment_count: p.segments.length,
    };
  });
  projects.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const project = createProject(name);
  return NextResponse.json({ project });
}
