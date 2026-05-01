import { NextResponse } from "next/server";

import { getActiveProfile } from "@/lib/app-config/profiles";
import { createForgeClient } from "@/lib/forge/client";

export async function GET(req: Request) {
  const profile = getActiveProfile();
  const url = new URL(req.url);
  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("refresh") === "true";

  try {
    const client = createForgeClient(profile);
    if (refresh) await client.refreshAll();
    const catalog = await client.fetchFullCatalog();
    const options = await client.getOptions();
    return NextResponse.json({ catalog, options });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      "[composer] GET /api/forge/catalog failed — active profile Forge URL:",
      profile.forge.baseUrl,
      "\n",
      msg,
    );
    return NextResponse.json(
      { error: msg },
      { status: 502 },
    );
  }
}
