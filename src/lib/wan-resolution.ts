/**
 * WAN 2.1 / 2.2 reference resolutions (480p / 576p / 720p buckets by aspect).
 * Matches common community tables for comfortable 49–81 frame runs at 480p;
 * higher buckets need more VRAM (720p often tight).
 */

export type WanAspect = "16:9" | "3:2" | "1:1" | "9:16" | "2:3";

export type WanBucket = "480p" | "576p" | "720p";

export const WAN22_RESOLUTIONS: Record<
  WanAspect,
  Record<WanBucket, readonly [width: number, height: number]>
> = {
  "16:9": {
    "480p": [832, 480],
    "576p": [1024, 576],
    "720p": [1280, 720],
  },
  "3:2": {
    "480p": [720, 480],
    "576p": [832, 576],
    "720p": [1088, 720],
  },
  "1:1": {
    "480p": [480, 480],
    "576p": [576, 576],
    "720p": [720, 720],
  },
  "9:16": {
    "480p": [480, 832],
    "576p": [576, 1024],
    "720p": [720, 1280],
  },
  "2:3": {
    "480p": [480, 720],
    "576p": [576, 832],
    "720p": [720, 1088],
  },
};

/** Aspect names that imply height > width in the WAN table (upright portrait video). */
export function aspectUsesPortraitFrame(aspect: WanAspect): boolean {
  return aspect === "9:16" || aspect === "2:3";
}

/**
 * Maps image pixel geometry to WAN aspect using long-side ÷ short-side (orientation-neutral),
 * plus whether the raster is wider or taller upright.
 */
export function detectWanAspect(imageWidth: number, imageHeight: number): WanAspect {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return "16:9";
  }

  const long = Math.max(imageWidth, imageHeight);
  const short = Math.min(imageWidth, imageHeight);
  /** Longer edge ÷ shorter edge — always ≥ 1, comparable to WAN shape magnitudes without mixing portrait w/h fractions. */
  const longOverShort = long / short;

  const dist = (canonicalLongOverShort: number) =>
    Math.abs(Math.log(longOverShort) - Math.log(canonicalLongOverShort));

  const dUltra = dist(16 / 9);
  const dClassic = dist(3 / 2);
  const dSq = dist(1);

  let bucket: "ultrawide" | "classic" | "square";
  if (dSq <= dClassic && dSq <= dUltra) {
    bucket = "square";
  } else if (dUltra <= dClassic) {
    bucket = "ultrawide";
  } else {
    bucket = "classic";
  }

  const landscape = imageWidth > imageHeight;

  if (bucket === "square") return "1:1";
  if (bucket === "ultrawide") return landscape ? "16:9" : "9:16";
  return landscape ? "3:2" : "2:3";
}

export function wanDimensionsFor(aspect: WanAspect, bucket: WanBucket): {
  width: number;
  height: number;
} {
  const pair = WAN22_RESOLUTIONS[aspect][bucket];
  return { width: pair[0], height: pair[1] };
}
