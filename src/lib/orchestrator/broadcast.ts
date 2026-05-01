import "server-only";

import { EventEmitter } from "node:events";

type OrchestratorPayload =
  | { type: "log"; message: string }
  | { type: "segment_started"; segmentId: string; index: number }
  | {
      type: "segment_finished";
      segmentId: string;
      index: number;
      mp4_rel: string;
    }
  | {
      type: "segment_failed";
      segmentId: string;
      index: number;
      error: string;
      /** Redacted img2img request/response summaries when extraction fails (see forge/img2img-diagnostics). */
      forge_diagnostics?: unknown;
    }
  | { type: "paused"; segmentId: string; index: number }
  | { type: "completed"; final_mp4_rel?: string }
  | { type: "stopped" }
  | { type: "forge_progress"; raw: unknown };

export const orchestratorEmitter = new EventEmitter();
orchestratorEmitter.setMaxListeners(200);

export function broadcast(
  projectId: string,
  runId: string,
  payload: OrchestratorPayload,
): void {
  orchestratorEmitter.emit(channel(projectId, runId), payload);
}

export function subscribeOrchestrator(
  projectId: string,
  runId: string,
  fn: (payload: OrchestratorPayload) => void,
): () => void {
  const ch = channel(projectId, runId);
  orchestratorEmitter.on(ch, fn);
  return () => orchestratorEmitter.off(ch, fn);
}

function channel(projectId: string, runId: string): string {
  return `${projectId}:${runId}`;
}

export type { OrchestratorPayload };
