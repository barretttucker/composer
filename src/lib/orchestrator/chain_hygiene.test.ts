import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import imageSize from "image-size";
import { describe, expect, it } from "vitest";

import { applyChainHygiene } from "@/lib/orchestrator/chain_hygiene";
import type { ForgeNeoClient } from "@/lib/video-backend/forge-neo-backend";
import type { GenerationParams } from "@/lib/schemas/project";

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("applyChainHygiene", () => {
  it.skipIf(!hasFfmpeg())("extracts chainframe PNG with configurable offset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ch-hyg-"));
    const mp4 = path.join(dir, "seg_00.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x48:rate=16",
      "-t",
      "1",
      "-pix_fmt",
      "yuv420p",
      mp4,
    ]);

    const cfg: GenerationParams["chain_hygiene"] = {
      frame_offset: -3,
      sharpen: false,
      upscaler: "SwinIR_4x",
    };

    const result = await applyChainHygiene(mp4, 16, cfg, dir, {} as ForgeNeoClient);

    expect(fs.existsSync(result.conditioningPath)).toBe(true);
    const dim = imageSize(fs.readFileSync(result.conditioningPath));
    expect(dim.width).toBe(64);
    expect(dim.height).toBe(48);
    expect(result.frame_extraction_ms).toBeGreaterThanOrEqual(0);
    expect(result.sharpen_ms).toBeUndefined();
  });

  it.skipIf(!hasFfmpeg())("runs sharpen path with mocked Forge upscale", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ch-hyg-sh-"));
    const mp4 = path.join(dir, "seg_01.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=80x60:rate=16",
      "-t",
      "1",
      "-pix_fmt",
      "yuv420p",
      mp4,
    ]);

    const forgeMock = {
      async extraSingleImage(payload: Record<string, unknown>) {
        const image = typeof payload.image === "string" ? payload.image : "";
        const buf = Buffer.from(image, "base64");
        const inPath = path.join(dir, "_mock_in.png");
        const outPath = path.join(dir, "_mock_up.png");
        fs.writeFileSync(inPath, buf);
        execFileSync("ffmpeg", [
          "-y",
          "-i",
          inPath,
          "-vf",
          "scale=iw*2:ih*2",
          "-compression_level",
          "0",
          outPath,
        ]);
        return { imageBase64: fs.readFileSync(outPath).toString("base64") };
      },
    } satisfies Pick<ForgeNeoClient, "extraSingleImage">;

    const cfg: GenerationParams["chain_hygiene"] = {
      frame_offset: -3,
      sharpen: true,
      upscaler: "SwinIR_4x",
    };

    const result = await applyChainHygiene(mp4, null, cfg, dir, forgeMock);

    expect(result.conditioningPath.endsWith("seg_01_chainframe_sharpened.png")).toBe(true);
    expect(fs.existsSync(result.conditioningPath)).toBe(true);
    const dim = imageSize(fs.readFileSync(result.conditioningPath));
    expect(dim.width).toBe(80);
    expect(dim.height).toBe(60);
    expect(result.sharpen_ms).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!hasFfmpeg())("throws when declared totalFrames mismatches file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ch-hyg-bad-"));
    const mp4 = path.join(dir, "seg_00.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=32x32:rate=16",
      "-t",
      "1",
      "-pix_fmt",
      "yuv420p",
      mp4,
    ]);

    const cfg: GenerationParams["chain_hygiene"] = {
      frame_offset: -1,
      sharpen: false,
      upscaler: "SwinIR_4x",
    };

    await expect(
      applyChainHygiene(mp4, 999, cfg, dir, {} as ForgeNeoClient),
    ).rejects.toThrow(/totalFrames mismatch/);
  });
});
