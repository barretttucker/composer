import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import imageSize from "image-size";

import { extractChainFrame } from "@/lib/ffmpeg/index";
import type { ForgeNeoClient } from "@/lib/video-backend/forge-neo-backend";
import type { GenerationParams } from "@/lib/schemas/project";

import { segmentChainHygienePathsAdjacentToMp4 } from "@/lib/orchestrator/chain_hygiene_math";

const execFileAsync = promisify(execFile);

async function downscalePngLanczos(
  srcPath: string,
  width: number,
  height: number,
  destPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    srcPath,
    "-vf",
    `scale=${width}:${height}:flags=lanczos`,
    "-compression_level",
    "0",
    destPath,
  ]);
}

export type ChainHygieneResult = {
  conditioningPath: string;
  frame_extraction_ms: number;
  sharpen_ms?: number;
};

/**
 * Extract a chain-conditioning PNG from a segment MP4 (lossless zlib), optionally sharpen via
 * Forge `extra-single-image` 2× upscale + Lanczos downscale. Does not switch checkpoints.
 */
export async function applyChainHygiene(
  segmentMp4Path: string,
  totalFrames: number | null,
  config: GenerationParams["chain_hygiene"],
  runDir: string,
  forgeClient: Pick<ForgeNeoClient, "extraSingleImage">,
): Promise<ChainHygieneResult> {
  const { chainframeRel, sharpenedRel } =
    segmentChainHygienePathsAdjacentToMp4(segmentMp4Path);
  const chainAbs = path.join(runDir, chainframeRel.split("/").join(path.sep));
  const sharpenAbs = path.join(runDir, sharpenedRel.split("/").join(path.sep));

  const tExtract = Date.now();
  const probe = await extractChainFrame(segmentMp4Path, config.frame_offset, chainAbs, {
    pngCompressionLevel: 0,
  });
  const frame_extraction_ms = Date.now() - tExtract;

  if (totalFrames != null && totalFrames !== probe.totalFrames) {
    throw new Error(
      `applyChainHygiene: totalFrames mismatch (caller ${totalFrames}, file ${probe.totalFrames})`,
    );
  }

  if (!config.sharpen) {
    return { conditioningPath: chainAbs, frame_extraction_ms };
  }

  // Read the chain frame exactly once: we need both its dimensions and its
  // base64 form for the Forge upscale request.
  const chainBuf = fs.readFileSync(chainAbs);
  const dim = imageSize(chainBuf);
  const w = dim.width;
  const h = dim.height;
  if (!w || !h) {
    throw new Error("applyChainHygiene: could not read chain frame dimensions");
  }

  const tmpUpscale = path.join(
    path.dirname(sharpenAbs),
    `_tmp_extra_${path.basename(segmentMp4Path, path.extname(segmentMp4Path))}.png`,
  );

  const tSharpen = Date.now();
  try {
    const { imageBase64 } = await forgeClient.extraSingleImage({
      resize_mode: 0,
      show_extras_results: false,
      gfpgan_visibility: 0,
      codeformer_visibility: 0,
      codeformer_weight: 0,
      upscaling_resize: 2,
      upscaling_crop: false,
      upscaler_1: config.upscaler,
      upscaler_2: "None",
      extras_upscaler_2_visibility: 0,
      upscaling_first: false,
      image: chainBuf.toString("base64"),
    });
    fs.writeFileSync(tmpUpscale, Buffer.from(imageBase64, "base64"));
    await downscalePngLanczos(tmpUpscale, w, h, sharpenAbs);
  } finally {
    try {
      if (fs.existsSync(tmpUpscale)) fs.unlinkSync(tmpUpscale);
    } catch {
      /* ignore */
    }
  }

  const sharpen_ms = Date.now() - tSharpen;

  return {
    conditioningPath: sharpenAbs,
    frame_extraction_ms,
    sharpen_ms,
  };
}
