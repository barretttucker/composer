import type { Project, ResolutionSettings } from "@/lib/schemas/project";
import { wanDimensionsFor } from "@/lib/wan-resolution";

export function effectiveResolution(p: Project): ResolutionSettings {
  return (
    p.resolution ?? {
      mode: "custom",
      bucket: "480p",
      detected_aspect: null,
    }
  );
}

export function applyAutoDimensions(p: Project): Project {
  const r = effectiveResolution(p);
  if (r.mode !== "auto" || r.detected_aspect == null) return p;
  const dim = wanDimensionsFor(r.detected_aspect, r.bucket);
  p.defaults.width = dim.width;
  p.defaults.height = dim.height;
  return p;
}
