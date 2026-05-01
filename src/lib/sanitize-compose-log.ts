/** Keep UI run logs readable: strip video/base64 and other huge payloads. */

const HEAVY_FIELD =
  /\b(video|videos|images?|picture|embedding|embedding_base64|init_images|output|buffer|binary)\b|^data:/i;

function looksLikeHugePayload(s: string): boolean {
  const t = s.trim();
  return (
    (t.length > 400 &&
      (/^[\s\dA-Za-z+/=]+$/.test(t) || /^data:(image|video|application)\//i.test(t))) ||
    t.length > 12_000
  );
}

export function sanitizeForComposerRunLog(value: unknown, keyHint?: string, depth = 0): unknown {
  if (depth > 14) return "[max-depth]";
  if (value === null || typeof value === "undefined" || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") {
    if (HEAVY_FIELD.test(keyHint ?? "") && value.length > 80) {
      return `[omitted (${value.length} chars)]`;
    }
    if (looksLikeHugePayload(value)) {
      return `[omitted (${value.length} chars)]`;
    }
    return value.length > 4000 ? `${value.slice(0, 200)}… (${value.length} chars total)` : value;
  }
  if (Array.isArray(value)) {
    if (value.length > 120) return `[array: ${value.length} items omitted]`;
    return value.map((v, i) => sanitizeForComposerRunLog(v, `${keyHint}[${i}]`, depth + 1));
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (HEAVY_FIELD.test(k) && typeof v === "string" && v.length > 80) {
        out[k] = `[omitted (${v.length} chars)]`;
      } else {
        out[k] = sanitizeForComposerRunLog(v, k, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function formatComposerRunEventLine(parsed: Record<string, unknown>): string {
  try {
    const sanitized = sanitizeForComposerRunLog(parsed, undefined, 0);
    const pretty =
      parsed.type === "segment_failed" &&
      parsed.forge_diagnostics !== null &&
      typeof parsed.forge_diagnostics !== "undefined";
    return JSON.stringify(sanitized, null, pretty ? 2 : undefined);
  } catch {
    return `[log] ${parsed.type ?? "event"} (sanitize failed)`;
  }
}
