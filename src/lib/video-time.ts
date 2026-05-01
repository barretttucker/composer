/** Clip length in discrete frames (~WAN-style): one frame at start + fps samples per elapsed second. */
export function framesForClipSeconds(seconds: number, fps: number): number {
  const sec = Math.min(10, Math.max(1, Math.round(seconds)));
  const f = Math.max(1, Math.round(fps));
  return sec * f + 1;
}

export function inferClipSecondsFromFrames(frames: number, fps: number): number {
  const f = Math.max(1, Math.round(fps));
  const fr = typeof frames === "number" && Number.isFinite(frames) ? frames : f + 1;
  return Math.min(10, Math.max(1, Math.round((fr - 1) / f)));
}
