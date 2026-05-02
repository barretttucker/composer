import path from "node:path";

/** 0-based frame index for `totalFrames + offset` when `offset` is negative (e.g. -3 from end). */
export function computeChainFrameIndex(
  totalFrames: number,
  frameOffsetFromEnd: number,
): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    throw new Error(`computeChainFrameIndex: invalid totalFrames (${totalFrames})`);
  }
  const idx = totalFrames + frameOffsetFromEnd;
  if (idx < 0 || idx >= totalFrames) {
    throw new Error(
      `chain frame index ${idx} out of range (total=${totalFrames}, offset=${frameOffsetFromEnd})`,
    );
  }
  return idx;
}

export function segmentIndexFromSegmentMp4Path(mp4Path: string): number {
  const base = path.basename(mp4Path);
  const m = /^seg_(\d+)(?:_[ab])?\.mp4$/i.exec(base);
  if (!m) {
    throw new Error(
      `expected basename seg_NN.mp4 or seg_NN_[ab].mp4 for chain hygiene paths, got ${base}`,
    );
  }
  return parseInt(m[1], 10);
}

/** Hygiene scratch PNGs live next to the segment mp4 basename (supports seg_NN_a / seg_NN_b). */
export function segmentChainHygienePathsAdjacentToMp4(segmentMp4Path: string): {
  chainframeRel: string;
  sharpenedRel: string;
} {
  const base = path.basename(segmentMp4Path, path.extname(segmentMp4Path));
  return {
    chainframeRel: path.posix.join("segments", `${base}_chainframe.png`),
    sharpenedRel: path.posix.join("segments", `${base}_chainframe_sharpened.png`),
  };
}
