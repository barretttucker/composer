import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function ffprobeFrameCount(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=nb_read_frames",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    const n = parseInt(String(stdout).trim(), 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error("bad nb_read_frames");
    return n;
  } catch {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "csv=p=0",
      videoPath,
    ]);
    const n = parseInt(String(stdout).trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Could not determine frame count for ${videoPath}`);
    }
    return n;
  }
}

export type ExtractChainFrameOptions = {
  /** PNG zlib level for ffmpeg's PNG encoder (0 = uncompressed; smaller CPU, larger files). */
  pngCompressionLevel?: number;
};

/**
 * @param frameOffsetFromEnd -1 = last frame, -2 = second-to-last (0-based indexing into frame sequence).
 */
export async function extractChainFrame(
  mp4Path: string,
  frameOffsetFromEnd: number,
  outputPngPath: string,
  options?: ExtractChainFrameOptions,
): Promise<{ totalFrames: number; extractedIndex: number }> {
  const total = await ffprobeFrameCount(mp4Path);
  const idx = total + frameOffsetFromEnd;
  if (idx < 0 || idx >= total) {
    throw new Error(
      `extractChainFrame: frame index ${idx} out of range (total frames ${total}, offset ${frameOffsetFromEnd})`,
    );
  }
  fs.mkdirSync(path.dirname(outputPngPath), { recursive: true });
  const args: string[] = [
    "-y",
    "-i",
    mp4Path,
    "-vf",
    `select=eq(n\\,${idx})`,
    "-vframes",
    "1",
  ];
  if (options?.pngCompressionLevel !== undefined) {
    args.push("-compression_level", String(options.pngCompressionLevel));
  }
  args.push(outputPngPath);
  await execFileAsync("ffmpeg", args);
  return { totalFrames: total, extractedIndex: idx };
}

export async function stitchConcat(
  segmentMp4AbsPaths: string[],
  outputMp4Path: string,
): Promise<void> {
  if (segmentMp4AbsPaths.length === 0) {
    throw new Error("stitchConcat: no segments");
  }
  fs.mkdirSync(path.dirname(outputMp4Path), { recursive: true });
  const listPath = path.join(path.dirname(outputMp4Path), "concat_list.txt");
  const lines = segmentMp4AbsPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  fs.writeFileSync(listPath, lines, "utf8");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outputMp4Path,
    ]);
  } finally {
    // Best-effort cleanup of the scratch concat list; never fails the caller.
    try {
      await fs.promises.unlink(listPath);
    } catch {
      // ignore
    }
  }
}
