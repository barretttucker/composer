import { NextResponse } from "next/server";

import {
  projectSetupDefaultsStoredSchema,
  readProjectSetupDefaults,
  writeProjectSetupDefaults,
} from "@/lib/app-config/project-setup-defaults";

const putBodySchema = projectSetupDefaultsStoredSchema.omit({ updated_at: true });

export async function GET() {
  const saved = readProjectSetupDefaults();
  return NextResponse.json({ setupDefaults: saved });
}

export async function PUT(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = putBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid setup defaults payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const saved = writeProjectSetupDefaults(parsed.data);
  return NextResponse.json({ setupDefaults: saved });
}
