import { NextResponse } from "next/server";

import {
  appProfileSchema,
  normalizeForgeBaseUrl,
  readProfilesFile,
  writeProfilesFile,
} from "@/lib/app-config/profiles";

type Params = { params: Promise<{ profileId: string }> };

export async function PUT(req: Request, context: Params) {
  const { profileId } = await context.params;
  const body = await req.json();
  const file = readProfilesFile();
  const idx = file.profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prev = file.profiles[idx];
  const mergedForge = {
    ...prev.forge,
    ...(typeof body?.forge?.baseUrl === "string"
      ? { baseUrl: normalizeForgeBaseUrl(body.forge.baseUrl) }
      : {}),
    ...(typeof body?.forge?.requestTimeoutMs === "number"
      ? { requestTimeoutMs: body.forge.requestTimeoutMs }
      : {}),
    ...(typeof body?.forge?.progressPollMs === "number"
      ? { progressPollMs: body.forge.progressPollMs }
      : {}),
  };

  const candidate = {
    ...prev,
    name:
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : prev.name,
    description:
      typeof body.description === "string"
        ? body.description
        : prev.description,
    updated_at: new Date().toISOString(),
    forge: mergedForge,
  };

  file.profiles[idx] = appProfileSchema.parse(candidate);
  writeProfilesFile(file);
  return NextResponse.json({ profile: file.profiles[idx] });
}

export async function DELETE(_req: Request, context: Params) {
  const { profileId } = await context.params;
  const file = readProfilesFile();
  if (file.profiles.length <= 1) {
    return NextResponse.json({ error: "Cannot delete last profile" }, { status: 400 });
  }
  const nextProfiles = file.profiles.filter((p) => p.id !== profileId);
  if (nextProfiles.length === file.profiles.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let activeProfileId = file.activeProfileId;
  if (activeProfileId === profileId) {
    activeProfileId = nextProfiles[0]!.id;
  }

  writeProfilesFile({
    activeProfileId,
    profiles: nextProfiles,
  });

  return NextResponse.json({ ok: true, activeProfileId });
}
