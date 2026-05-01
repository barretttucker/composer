/** Interpret `/sdapi/v1/progress` payloads for composer run UI (client + shared). */

export type ForgeRenderBarState =
  | { kind: "starting"; segmentIndex: number }
  | {
      kind: "preparing";
      segmentIndex: number;
      etaSeconds: number | null;
      progressHint: number;
    }
  | {
      kind: "sampling";
      segmentIndex: number;
      progress: number;
      samplingStep: number;
      samplingTotal: number | null;
      etaSeconds: number | null;
    };

type Parsed = {
  progress: number;
  etaRelative: number | null;
  samplingStep: number;
  samplingSteps: number | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export function parseForgeProgressPayload(raw: unknown): Parsed | null {
  const root = asRecord(raw);
  if (!root) return null;
  const progress = num(root.progress);
  if (progress == null) return null;
  const etaRaw = num(root.eta_relative);
  const etaRelative = etaRaw != null && etaRaw >= 0 ? etaRaw : null;
  const state = asRecord(root.state);
  const samplingStep = state ? num(state.sampling_step) : null;
  const samplingSteps = state ? num(state.sampling_steps) : null;
  return {
    progress,
    etaRelative,
    samplingStep: samplingStep ?? 0,
    samplingSteps,
  };
}

/**
 * While Forge loads weights / compiles the pipeline, progress often stays ~0.01 and ETA drifts up.
 * Once denoising runs, `sampling_step` advances and/or `progress` moves past a small threshold.
 */
export function forgeProgressToRenderState(
  raw: unknown,
  segmentIndex: number,
): ForgeRenderBarState | null {
  const p = parseForgeProgressPayload(raw);
  if (!p) return null;

  const samplingStarted = p.samplingStep > 0 || p.progress >= 0.04;

  if (samplingStarted) {
    return {
      kind: "sampling",
      segmentIndex,
      progress: Math.min(1, Math.max(0, p.progress)),
      samplingStep: p.samplingStep,
      samplingTotal: p.samplingSteps,
      etaSeconds: p.etaRelative,
    };
  }

  return {
    kind: "preparing",
    segmentIndex,
    etaSeconds: p.etaRelative,
    progressHint: p.progress,
  };
}

export function formatForgeEtaSeconds(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0.5) return null;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}
