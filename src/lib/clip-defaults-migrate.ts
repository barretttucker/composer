import {
  framesForClipSeconds,
  inferClipSecondsFromFrames,
} from "@/lib/video-time";

/** In-place migrate legacy defaults / segments before parsing project JSON or setup defaults files. */
export function migrateClipDurationFields(raw: Record<string, unknown>): void {
  const fpsFromChaining =
    raw.chaining &&
    typeof raw.chaining === "object" &&
    typeof (raw.chaining as { fps?: unknown }).fps === "number"
      ? Math.max(1, Math.round((raw.chaining as { fps: number }).fps))
      : 16;

  const def = raw.defaults;
  if (def && typeof def === "object") {
    const d = def as Record<string, unknown>;
    if (typeof d.clip_duration_seconds !== "number") {
      const frames =
        typeof d.frames === "number" ? d.frames : framesForClipSeconds(5, fpsFromChaining);
      const sec = inferClipSecondsFromFrames(frames, fpsFromChaining);
      d.clip_duration_seconds = sec;
      d.frames = framesForClipSeconds(sec, fpsFromChaining);
    } else if (typeof d.frames !== "number") {
      d.frames = framesForClipSeconds(
        d.clip_duration_seconds as number,
        fpsFromChaining,
      );
    }
  }

  if (!Array.isArray(raw.segments)) return;
  for (const seg of raw.segments) {
    if (!seg || typeof seg !== "object") continue;
    const s = seg as Record<string, unknown>;

    if (typeof s.duration_seconds !== "number" && typeof s.frames === "number") {
      s.duration_seconds = inferClipSecondsFromFrames(
        s.frames as number,
        fpsFromChaining,
      );
      delete s.frames;
    }

    const po = s.params_override;
    if (
      typeof s.duration_seconds !== "number" &&
      po &&
      typeof po === "object" &&
      typeof (po as { frames?: unknown }).frames === "number"
    ) {
      s.duration_seconds = inferClipSecondsFromFrames(
        (po as { frames: number }).frames,
        fpsFromChaining,
      );
      delete (po as { frames?: number }).frames;
      if (Object.keys(po as object).length === 0) {
        delete s.params_override;
      }
    }
  }
}
