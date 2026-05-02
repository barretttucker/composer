import { NextResponse } from "next/server";

import { deleteProject } from "@/lib/project-store-extra";
import {
  allocateFolderSlugForProject,
  loadProject,
  renameProjectFolderIfNeeded,
  saveProject,
} from "@/lib/project-store";
import { projectSchema } from "@/lib/schemas/project";
import { assertValidProjectFolderKey } from "@/lib/project-slug";
import { segmentRenderHealthBySegmentId } from "@/lib/segment-render-fingerprint";

type Params = { params: Promise<{ projectId: string }> };

function folderKeyFromParams(projectId: string): string {
  try {
    return decodeURIComponent(projectId);
  } catch {
    return projectId;
  }
}

export async function GET(_req: Request, context: Params) {
  const folderKey = folderKeyFromParams((await context.params).projectId);
  try {
    assertValidProjectFolderKey(folderKey);
    const project = loadProject(folderKey);
    const segmentRenderHealth = segmentRenderHealthBySegmentId(project);
    return NextResponse.json({ project, segmentRenderHealth });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(req: Request, context: Params) {
  const folderKey = folderKeyFromParams((await context.params).projectId);
  try {
    assertValidProjectFolderKey(folderKey);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let project: ReturnType<typeof loadProject>;
  try {
    project = loadProject(folderKey);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let patchRaw: Record<string, unknown>;
  try {
    patchRaw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  // Strip immutable / server-managed fields so clients cannot bypass slug
  // consistency, rewrite the canonical id, or backdate created_at.
  const {
    id: _idRaw,
    created_at: _createdAtRaw,
    slug: _slugRaw,
    updated_at: _updatedAtRaw,
    ...patchRest
  } = patchRaw;
  void _idRaw;
  void _createdAtRaw;
  void _slugRaw;
  void _updatedAtRaw;
  const merged = {
    ...project,
    ...patchRest,
    slug: folderKey,
    updated_at: new Date().toISOString(),
  };
  try {
    project = projectSchema.parse(merged);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  const nextSlug = allocateFolderSlugForProject(project.name, project.id, folderKey);
  if (nextSlug !== folderKey) {
    renameProjectFolderIfNeeded(folderKey, nextSlug);
  }
  project.slug = nextSlug;
  saveProject(project);
  return NextResponse.json({ project });
}

export async function DELETE(_req: Request, context: Params) {
  const folderKey = folderKeyFromParams((await context.params).projectId);
  try {
    assertValidProjectFolderKey(folderKey);
    deleteProject(folderKey);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
