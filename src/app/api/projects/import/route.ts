import { NextResponse } from "next/server";

import { portableScriptSchema } from "@/lib/schemas/project";
import { importPortableScript } from "@/lib/project-store";

export async function POST(req: Request) {
  const form = await req.formData();
  const scriptBlob = form.get("script");
  const imageBlob = form.get("image");
  if (!(scriptBlob instanceof Blob) || !(imageBlob instanceof Blob)) {
    return NextResponse.json(
      { error: "script JSON file and image file required" },
      { status: 400 },
    );
  }

  const scriptText = await scriptBlob.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(scriptText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON script" }, { status: 400 });
  }

  const script = portableScriptSchema.parse(parsedJson);
  const buf = Buffer.from(await imageBlob.arrayBuffer());

  try {
    const project = importPortableScript(script, buf);
    return NextResponse.json({ project });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
