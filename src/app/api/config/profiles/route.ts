import { NextResponse } from "next/server";

import {
  appProfileSchema,
  normalizeForgeBaseUrl,
  readProfilesFile,
  writeProfilesFile,
} from "@/lib/app-config/profiles";
import { nanoid } from "nanoid";

export async function GET() {
  const data = readProfilesFile();
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const now = new Date().toISOString();
  const baseUrlRaw =
    typeof body?.forge?.baseUrl === "string"
      ? body.forge.baseUrl
      : undefined;
  if (!baseUrlRaw) {
    return NextResponse.json({ error: "forge.baseUrl required" }, { status: 400 });
  }

  const profileCandidate = {
    id: nanoid(),
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Profile",
    description:
      typeof body.description === "string" ? body.description : undefined,
    updated_at: now,
    forge: {
      baseUrl: normalizeForgeBaseUrl(baseUrlRaw),
      requestTimeoutMs: body?.forge?.requestTimeoutMs,
      progressPollMs: body?.forge?.progressPollMs,
    },
  };

  const profile = appProfileSchema.parse(profileCandidate);
  const file = readProfilesFile();
  file.profiles.push(profile);
  writeProfilesFile(file);
  return NextResponse.json({ profile });
}
