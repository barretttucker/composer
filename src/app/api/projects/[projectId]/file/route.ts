import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { projectRoot } from "@/lib/project-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string }> };

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function isInsideProjectRoot(rootDir: string, candidateFile: string): boolean {
  const rel = path.relative(rootDir, candidateFile);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return true;
}

export async function GET(req: Request, context: Params) {
  const { projectId } = await context.params;
  const url = new URL(req.url);
  const rel = url.searchParams.get("rel");
  if (!rel || rel.includes("..")) {
    return NextResponse.json({ error: "invalid rel" }, { status: 400 });
  }

  const root = path.resolve(projectRoot(projectId));
  const resolved = path.resolve(root, rel);

  if (!isInsideProjectRoot(root, resolved)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const buf = fs.readFileSync(resolved);
  return new Response(buf, {
    headers: {
      "Content-Type": contentType(resolved),
      "Cache-Control": "private, max-age=0",
    },
  });
}
