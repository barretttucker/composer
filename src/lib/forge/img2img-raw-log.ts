import "server-only";

import fs from "node:fs";
import path from "node:path";

import { ensureDir } from "@/lib/env";

export type ForgeImg2imgRawLogOutcome =
  | "success"
  | "http_error"
  | "json_parse_error"
  | "extraction_error";

/** Full HTTP-style record for one `POST /sdapi/v1/img2img` (bodies can be very large). */
export type ForgeImg2imgRawLogRecord = {
  saved_at: string;
  api: "img2img";
  method: "POST";
  url: string;
  status: number;
  ok: boolean;
  duration_ms: number;
  request_body: string;
  response_body: string;
  outcome: ForgeImg2imgRawLogOutcome;
  error_message?: string;
};

export function writeForgeImg2imgRawLogFile(
  runAbsDir: string,
  segmentIndex: number,
  segmentId: string,
  record: ForgeImg2imgRawLogRecord,
): void {
  const dir = path.join(runAbsDir, "forgeraw");
  ensureDir(dir);
  const safeId = segmentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  const name = `img2img_seg_${String(segmentIndex).padStart(2, "0")}_${safeId}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(record, null, 2), "utf8");
}
