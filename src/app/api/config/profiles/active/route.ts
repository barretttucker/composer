import { NextResponse } from "next/server";

import {
  readProfilesFile,
  writeProfilesFile,
} from "@/lib/app-config/profiles";

export async function PATCH(req: Request) {
  const body = await req.json();
  const profileId =
    typeof body.profileId === "string" ? body.profileId.trim() : "";
  if (!profileId) {
    return NextResponse.json({ error: "profileId required" }, { status: 400 });
  }

  const file = readProfilesFile();
  const exists = file.profiles.some((p) => p.id === profileId);
  if (!exists) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  file.activeProfileId = profileId;
  writeProfilesFile(file);
  return NextResponse.json({ activeProfileId: profileId });
}
