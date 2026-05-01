import "server-only";

import { Buffer } from "node:buffer";

const MAX_DEPTH = 12;
const MAX_KEYS = 60;
const MAX_ARRAY_ITEMS = 24;
const SHORT_STRING = 240;

function binaryKindFromBuf(buf: Buffer): string {
  if (buf.length < 12) return "too_small";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  const head6 = buf.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") return "gif";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm_mkv";
  const scan = Math.min(80, buf.length - 4);
  for (let i = 0; i <= scan; i++) {
    if (
      buf[i] === 0x66 &&
      buf[i + 1] === 0x74 &&
      buf[i + 2] === 0x79 &&
      buf[i + 3] === 0x70
    ) {
      return "mp4_mov_ftyp";
    }
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x41 &&
    buf[9] === 0x56 &&
    buf[10] === 0x49
  ) {
    return "avi";
  }
  return "unknown_binary";
}

function describeLongString(s: string): Record<string, unknown> {
  const t = s.trim();
  try {
    const buf = Buffer.from(t, "base64");
    const kind = binaryKindFromBuf(buf);
    return {
      _blob: true,
      char_length: t.length,
      decoded_byte_length: buf.length,
      decoded_as_base64_kind: kind,
      prefix_ascii: buf.subarray(0, Math.min(12, buf.length)).toString("binary"),
    };
  } catch {
    return {
      _blob: true,
      char_length: t.length,
      decoded_as_base64_kind: "base64_decode_error",
      text_prefix: t.slice(0, 64),
    };
  }
}

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[max-depth]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length <= SHORT_STRING ? value : describeLongString(value);
  }
  if (Array.isArray(value)) {
    const total = value.length;
    const slice = value.slice(0, MAX_ARRAY_ITEMS).map((v) => walk(v, depth + 1));
    if (total > MAX_ARRAY_ITEMS) {
      return { _array_len: total, head: slice, _truncated_after: MAX_ARRAY_ITEMS };
    }
    return slice;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    const headKeys = keys.slice(0, MAX_KEYS);
    const out: Record<string, unknown> = {};
    for (const k of headKeys) {
      out[k] = walk(o[k], depth + 1);
    }
    if (keys.length > MAX_KEYS) {
      out._omitted_key_count = keys.length - MAX_KEYS;
    }
    return out;
  }
  return String(value);
}

/** Bounded, log-safe view of Forge `POST /sdapi/v1/img2img` JSON (for debugging). */
export function summarizeForgeImg2imgResponseForLog(raw: unknown): Record<string, unknown> {
  const top =
    raw !== null && typeof raw === "object"
      ? Object.keys(raw as object)
      : ([] as string[]);
  return {
    note: "Redacted img2img response: long strings summarized by length and detected binary kind.",
    top_level_keys: top,
    body: walk(raw, 0),
  };
}

/** Same treatment for the outbound API body (init_images entries are huge base64). */
export function summarizeForgeImg2imgRequestPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    note: "Redacted outbound img2img request (init_images summarized).",
    top_level_keys: Object.keys(payload),
    body: walk(payload, 0),
  };
}
