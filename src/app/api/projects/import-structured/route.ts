import { NextResponse } from "next/server";

import { importStructuredProject } from "@/lib/project-store";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = new URL(req.url);
  const overwrite = url.searchParams.get("overwrite") === "1";

  try {
    const project = importStructuredProject(body, { overwrite });
    return NextResponse.json({ project });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
