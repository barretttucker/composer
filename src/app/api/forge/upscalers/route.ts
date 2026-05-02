import { NextResponse } from "next/server";

import { getActiveProfile } from "@/lib/app-config/profiles";
import { createForgeClient } from "@/lib/forge/client";

export async function GET() {
  const profile = getActiveProfile();
  try {
    const client = createForgeClient(profile);
    const upscalers = await client.listUpscalers();
    return NextResponse.json({ upscalers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      "[composer] GET /api/forge/upscalers failed — Forge URL:",
      profile.forge.baseUrl,
      msg,
    );
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
