import "server-only";

import { Buffer } from "node:buffer";
import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

import type { AppProfile } from "@/lib/app-config/profiles";
import { normalizeForgeBaseUrl } from "@/lib/app-config/profiles";
import type { ForgeCatalog } from "@/lib/forge/types";
import { parseForgeUpscalerNames } from "@/lib/forge/upscalers";
import type { GenerationParams } from "@/lib/schemas/project";
import {
  parseLoras,
  parseSamplerNames,
  parseSchedulerNames,
  parseSdModels,
  parseSdVaes,
  type LoraInfo,
  type SdModelInfo,
  type SdVaeInfo,
} from "@/lib/forge/types";
import { summarizeForgeImg2imgResponseForLog } from "@/lib/forge/img2img-diagnostics";
import type {
  ForgeImg2imgRawLogOutcome,
  ForgeImg2imgRawLogRecord,
} from "@/lib/forge/img2img-raw-log";

export type { ForgeImg2imgRawLogRecord } from "@/lib/forge/img2img-raw-log";

export type Img2ImgResult = {
  videoBase64: string;
  raw: unknown;
};

/** img2img succeeded at HTTP level but video extraction failed; carries redacted response JSON for logs. */
export class ForgeImg2ImgError extends Error {
  readonly responseDiagnostics: Record<string, unknown>;

  constructor(message: string, raw: unknown) {
    super(message);
    this.name = "ForgeImg2ImgError";
    this.responseDiagnostics = summarizeForgeImg2imgResponseForLog(raw);
  }
}

async function fetchJson(
  baseUrl: string,
  apiPath: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  const url = `${baseUrl}${apiPath}`;
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 30 * 60 * 1000;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    if (
      init.method &&
      init.method !== "GET" &&
      init.method !== "HEAD" &&
      init.body
    ) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted|AbortError/i.test(err.message));
      if (aborted) {
        throw new Error(
          `Forge request aborted or timed out after ${timeoutMs}ms (${url})`,
        );
      }
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Cannot reach Forge at ${url}: ${cause}. Is Forge running and is Settings → profile base URL correct? Catalog calls run on the Next.js server (same host as npm run dev), not in the browser.`,
      );
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Forge returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const msg =
        typeof json === "object" && json && "detail" in json
          ? String((json as { detail?: string }).detail)
          : text.slice(0, 500);
      throw new Error(`Forge ${apiPath} failed (${res.status}): ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

/** True when `fetchJson` threw for HTTP 404 (message shape: `Forge ... failed (404):`). */
function isForgeHttp404(e: unknown): boolean {
  return e instanceof Error && /\((404)\)/.test(e.message);
}

/** Subtrees that are only ever still previews / inputs — skip to avoid PNG false paths and huge decodes. */
const SKIP_VIDEO_TREE_KEYS = new Set([
  "images",
  "init_images",
  "mask",
  "mask_image",
  "image",
  "current_image",
]);

function tryParseDataUrlVideo(s: string): string | null {
  if (!s.startsWith("data:")) return null;
  const comma = s.indexOf(",");
  if (comma === -1) return null;
  const b64 = s.slice(comma + 1).trim();
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    const kind = binaryPayloadMediaKind(buf);
    if (kind === "video") return b64;
    if (kind === "image") return null;
    const decompressed = tryZlibDecompressToVideoBuffer(buf);
    if (decompressed) return decompressed.toString("base64");
    return null;
  } catch {
    return null;
  }
}

function tryBase64StringAsVideo(s: string): string | null {
  const t = s.trim();
  if (t.length < 64) return null;
  try {
    const buf = Buffer.from(t, "base64");
    if (buf.length < 32) return null;
    const kind = binaryPayloadMediaKind(buf);
    if (kind === "video") return t;
    if (kind === "image") return null;
    const decompressed = tryZlibDecompressToVideoBuffer(buf);
    if (decompressed) return decompressed.toString("base64");
    return null;
  } catch {
    return null;
  }
}

function tryZlibDecompressToVideoBuffer(buf: Buffer): Buffer | null {
  const attempts: Array<() => Buffer> = [
    () => gunzipSync(buf),
    () => inflateSync(buf),
    () => inflateRawSync(buf),
  ];
  for (const run of attempts) {
    try {
      const out = run();
      if (out.length >= 32 && binaryPayloadMediaKind(out) === "video") {
        return out;
      }
    } catch {
      /* not this zlib variant */
    }
  }
  return null;
}

function findVideoBase64Nested(val: unknown, depth: number): string | null {
  if (depth > 10) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const inner = findVideoBase64Nested(parsed, depth + 1);
        if (inner) return inner;
      } catch {
        /* not JSON; try as raw/base64 payload below */
      }
    }
    return tryBase64StringAsVideo(val);
  }
  if (!val || typeof val !== "object") return null;
  if (Array.isArray(val)) {
    for (const item of val) {
      const f = findVideoBase64Nested(item, depth + 1);
      if (f) return f;
    }
    return null;
  }
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (SKIP_VIDEO_TREE_KEYS.has(k)) continue;
    const f = findVideoBase64Nested(v, depth + 1);
    if (f) return f;
  }
  return null;
}

/**
 * WAN / Forge forks may return the clip as `video`, nest it under custom keys, or only expose PNG in `images`.
 * Never treat `images[0]` as video unless it decodes to a video container.
 */
export function extractVideoBase64(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const preferredKeys = [
    "video",
    "video_base64",
    "videos",
    "result_video",
    "mp4",
    "mp4_base64",
    "animation",
    "clip",
    "clip_base64",
    "wan_video",
    "output_video",
  ] as const;
  for (const key of preferredKeys) {
    const v = d[key];
    if (typeof v === "string") {
      const fromPlain = tryBase64StringAsVideo(v);
      if (fromPlain) return fromPlain;
      const fromData = tryParseDataUrlVideo(v);
      if (fromData) return fromData;
    }
    if (Array.isArray(v) && typeof v[0] === "string") {
      const fromArr = tryBase64StringAsVideo(v[0]);
      if (fromArr) return fromArr;
    }
  }
  if (typeof d.output === "string") {
    const fromData = tryParseDataUrlVideo(d.output);
    if (fromData) return fromData;
    const fromPlain = tryBase64StringAsVideo(d.output);
    if (fromPlain) return fromPlain;
  }
  const nested = findVideoBase64Nested(d, 0);
  if (nested) return nested;
  if (Array.isArray(d.images)) {
    for (const img of d.images) {
      if (typeof img !== "string") continue;
      const clip = tryBase64StringAsVideo(img);
      if (clip) return clip;
    }
  }
  return null;
}

/** After base64 decode: distinguish video containers from still previews (WAN may put PNG in `images[0]`). */
function binaryPayloadMediaKind(buf: Buffer): "video" | "image" | "unknown" {
  if (buf.length < 12) return "unknown";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image";
  }
  const head6 = buf.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") {
    return "image";
  }
  /** MP4 `ftyp` / WebM EBML can sit after a short wrapper; scan first 256KiB. */
  const scan = Math.min(buf.length - 4, 262_144);
  for (let i = 0; i <= scan; i++) {
    if (
      buf[i] === 0x66 &&
      buf[i + 1] === 0x74 &&
      buf[i + 2] === 0x79 &&
      buf[i + 3] === 0x70
    ) {
      return "video";
    }
    if (
      buf[i] === 0x1a &&
      buf[i + 1] === 0x45 &&
      buf[i + 2] === 0xdf &&
      buf[i + 3] === 0xa3
    ) {
      return "video";
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
    return "video";
  }
  return "unknown";
}

export type ForgeClient = ReturnType<typeof createForgeClient>;

export type CreateForgeClientOptions = {
  /** When set, each img2img call invokes this with the full request/response bodies (can be very large). */
  logRawImg2img?: (record: ForgeImg2imgRawLogRecord) => void;
};

type Img2imgHttpSuccessParts = Omit<
  ForgeImg2imgRawLogRecord,
  "saved_at" | "outcome" | "error_message"
>;

export function createForgeClient(
  profile: AppProfile,
  forgeOptions?: CreateForgeClientOptions,
) {
  const baseUrl = normalizeForgeBaseUrl(profile.forge.baseUrl);
  const timeoutMs = profile.forge.requestTimeoutMs ?? 45 * 60 * 1000;
  const discoveryTimeout = 120_000;
  const rawImg2imgLog = forgeOptions?.logRawImg2img;

  async function postEmpty(apiPath: string): Promise<void> {
    await fetchJson(baseUrl, apiPath, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: discoveryTimeout,
    });
  }

  /** Forge Neo / some builds omit refresh-vae or return 404 — ignore. */
  async function postEmptySkip404(apiPath: string): Promise<void> {
    try {
      await postEmpty(apiPath);
    } catch (e) {
      if (isForgeHttp404(e)) return;
      throw e;
    }
  }

  async function listCheckpoints(): Promise<SdModelInfo[]> {
    const raw = await fetchJson(baseUrl, "/sdapi/v1/sd-models", {
      method: "GET",
      timeoutMs: discoveryTimeout,
    });
    return parseSdModels(raw);
  }

  /**
   * Classic A1111 uses GET /sdapi/v1/sd-vae; Forge Neo often removes it (404).
   * Try /sdapi/v1/vae if present; otherwise return [] (VAE still works via free-text / options).
   */
  async function listVAEs(): Promise<SdVaeInfo[]> {
    const paths = ["/sdapi/v1/sd-vae", "/sdapi/v1/vae"];
    for (const apiPath of paths) {
      try {
        const raw = await fetchJson(baseUrl, apiPath, {
          method: "GET",
          timeoutMs: discoveryTimeout,
        });
        return parseSdVaes(raw);
      } catch (e) {
        if (isForgeHttp404(e)) continue;
        throw e;
      }
    }
    return [];
  }

  async function listLoras(): Promise<LoraInfo[]> {
    const raw = await fetchJson(baseUrl, "/sdapi/v1/loras", {
      method: "GET",
      timeoutMs: discoveryTimeout,
    });
    return parseLoras(raw);
  }

  async function listSamplers(): Promise<string[]> {
    const raw = await fetchJson(baseUrl, "/sdapi/v1/samplers", {
      method: "GET",
      timeoutMs: discoveryTimeout,
    });
    return parseSamplerNames(raw);
  }

  async function listSchedulers(): Promise<string[]> {
    const raw = await fetchJson(baseUrl, "/sdapi/v1/schedulers", {
      method: "GET",
      timeoutMs: discoveryTimeout,
    });
    return parseSchedulerNames(raw);
  }

  return {
    baseUrl,

    refreshCheckpoints: () => postEmpty("/sdapi/v1/refresh-checkpoints"),
    refreshVae: () => postEmptySkip404("/sdapi/v1/refresh-vae"),
    refreshLoras: () => postEmpty("/sdapi/v1/refresh-loras"),

    async refreshAll(): Promise<void> {
      await Promise.all([
        postEmpty("/sdapi/v1/refresh-checkpoints"),
        postEmptySkip404("/sdapi/v1/refresh-vae"),
        postEmpty("/sdapi/v1/refresh-loras"),
      ]);
    },

    listCheckpoints,
    listVAEs,
    listLoras,
    listSamplers,
    listSchedulers,

    async fetchFullCatalog(): Promise<ForgeCatalog> {
      const [checkpoints, vaes, loras, samplers, schedulers] = await Promise.all([
        listCheckpoints(),
        listVAEs(),
        listLoras(),
        listSamplers(),
        listSchedulers(),
      ]);
      return { checkpoints, vaes, loras, samplers, schedulers };
    },

    getOptions: () =>
      fetchJson(baseUrl, "/sdapi/v1/options", {
        method: "GET",
        timeoutMs: discoveryTimeout,
      }),

    async getCurrentCheckpointTitle(): Promise<string | undefined> {
      const opts = (await fetchJson(baseUrl, "/sdapi/v1/options", {
        method: "GET",
        timeoutMs: discoveryTimeout,
      })) as Record<string, unknown>;
      const v = opts?.sd_model_checkpoint;
      return typeof v === "string" ? v : undefined;
    },

    setOptions: (body: Record<string, unknown>) =>
      fetchJson(baseUrl, "/sdapi/v1/options", {
        method: "POST",
        body: JSON.stringify(body),
        timeoutMs: 180_000,
      }).then(() => undefined),

    setCheckpoint: (modelTitle: string) =>
      fetchJson(baseUrl, "/sdapi/v1/options", {
        method: "POST",
        body: JSON.stringify({ sd_model_checkpoint: modelTitle }),
        timeoutMs: 180_000,
      }).then(() => undefined),

    unloadCheckpoint: () => postEmpty("/sdapi/v1/unload-checkpoint"),

    getProgress: () =>
      fetchJson(baseUrl, "/sdapi/v1/progress", {
        method: "GET",
        timeoutMs: 30_000,
      }),

    async listUpscalers(): Promise<string[]> {
      const raw = await fetchJson(baseUrl, "/sdapi/v1/upscalers", {
        method: "GET",
        timeoutMs: discoveryTimeout,
      });
      return parseForgeUpscalerNames(raw);
    },

    async extraSingleImage(
      payload: Record<string, unknown>,
    ): Promise<{ imageBase64: string }> {
      const raw = await fetchJson(baseUrl, "/sdapi/v1/extra-single-image", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs,
      });
      if (!raw || typeof raw !== "object") {
        throw new Error("Forge extra-single-image returned non-object JSON");
      }
      const img = (raw as Record<string, unknown>).image;
      if (typeof img !== "string" || !img.trim()) {
        throw new Error("Forge extra-single-image response missing string `image`");
      }
      return { imageBase64: img.trim() };
    },

    async img2img(payload: Record<string, unknown>): Promise<Img2ImgResult> {
      const apiPath = "/sdapi/v1/img2img";
      const url = `${baseUrl}${apiPath}`;
      const body = JSON.stringify(payload);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const t0 = Date.now();

      const emitRaw = (
        parts: Omit<ForgeImg2imgRawLogRecord, "saved_at"> & {
          saved_at?: string;
        },
      ) => {
        if (!rawImg2imgLog) return;
        rawImg2imgLog({
          ...parts,
          saved_at: parts.saved_at ?? new Date().toISOString(),
        } as ForgeImg2imgRawLogRecord);
      };

      let status = 0;
      let ok = false;
      let responseText = "";

      try {
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            body,
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const duration_ms = Date.now() - t0;
          const aborted =
            err instanceof Error &&
            (err.name === "AbortError" || /aborted|AbortError/i.test(err.message));
          const errMsg = aborted
            ? `Forge request aborted or timed out after ${timeoutMs}ms (${url})`
            : `Cannot reach Forge at ${url}: ${err instanceof Error ? err.message : String(err)}. Is Forge running and is Settings → profile base URL correct? Catalog calls run on the Next.js server (same host as npm run dev), not in the browser.`;
          emitRaw({
            api: "img2img",
            method: "POST",
            url,
            status: 0,
            ok: false,
            duration_ms,
            request_body: body,
            response_body: "",
            outcome: "http_error",
            error_message: errMsg,
          });
          throw new Error(errMsg);
        }
        status = res.status;
        ok = res.ok;
        responseText = await res.text();
      } finally {
        clearTimeout(t);
      }

      const duration_ms = Date.now() - t0;
      const partial: Img2imgHttpSuccessParts = {
        api: "img2img",
        method: "POST",
        url,
        status,
        ok,
        duration_ms,
        request_body: body,
        response_body: responseText,
      };

      const finalize = (outcome: ForgeImg2imgRawLogOutcome, error_message?: string) => {
        emitRaw({
          ...partial,
          outcome,
          error_message,
        });
      };

      let raw: unknown = null;
      try {
        raw = responseText ? JSON.parse(responseText) : null;
      } catch {
        finalize(
          "json_parse_error",
          "Response body is not valid JSON",
        );
        throw new Error(`Forge returned non-JSON (${status}): ${responseText.slice(0, 200)}`);
      }
      if (!ok) {
        const msg =
          typeof raw === "object" && raw && "detail" in raw
            ? String((raw as { detail?: string }).detail)
            : responseText.slice(0, 500);
        finalize("http_error", msg);
        throw new Error(`Forge ${apiPath} failed (${status}): ${msg}`);
      }

      try {
        const videoBase64 = extractVideoBase64(raw);
        if (!videoBase64) {
          finalize(
            "extraction_error",
            "No encoded video in JSON (see UI diagnostics or forgeraw log).",
          );
          throw new ForgeImg2ImgError(
            "Forge img2img response has no encoded video in any JSON field (checked video*, nested values, and images[] for MP4/WebM magic). Confirm your Forge/WAN build adds the clip to the API JSON or match the field name Composer expects.",
            raw,
          );
        }
        const decoded = Buffer.from(videoBase64, "base64");
        const kind = binaryPayloadMediaKind(decoded);
        if (kind === "image") {
          finalize(
            "extraction_error",
            "Decoded payload is a still image, not a video container.",
          );
          throw new ForgeImg2ImgError(
            "Forge img2img returned a still image in the payload (e.g. images[0] PNG), not encoded video. WAN I2V must return the clip as `video` or `video_base64` in the JSON response; otherwise duration/frame settings cannot produce a real clip.",
            raw,
          );
        }
        if (kind === "unknown") {
          finalize(
            "extraction_error",
            "Payload is not a recognized video container (MP4/WebM/AVI).",
          );
          throw new ForgeImg2ImgError(
            "Forge img2img payload is not a recognized video container (expected MP4 ftyp / WebM / AVI). Check the WAN extension response format.",
            raw,
          );
        }
        finalize("success");
        return { videoBase64, raw };
      } catch (err) {
        if (
          rawImg2imgLog &&
          !(err instanceof ForgeImg2ImgError) &&
          err instanceof Error
        ) {
          finalize("extraction_error", err.message);
        }
        throw err;
      }
    },
  };
}

export function mapParamsToForgeImg2Img(params: {
  generation: GenerationParams;
  initImageBase64: string;
  prompt: string;
  negativePrompt: string;
}): { payload: Record<string, unknown>; seedUsed: number } {
  const g = params.generation;
  const seedUsed =
    g.seed < 0 ? Math.floor(Math.random() * 2_147_483_647) : g.seed;

  const override_settings: Record<string, unknown> = {
    sd_model_checkpoint: g.checkpoint_high,
  };
  const vaeTrim = g.vae.trim();
  const textEncoderTrim = g.text_encoder.trim();
  const moduleList: string[] = [];
  if (vaeTrim) moduleList.push(vaeTrim);
  if (textEncoderTrim) moduleList.push(textEncoderTrim);
  if (moduleList.length > 0) {
    override_settings.forge_additional_modules = moduleList;
  }
  if (vaeTrim && !textEncoderTrim) {
    override_settings.sd_vae = vaeTrim;
  }

  const lowTrim = g.checkpoint_low.trim();

  // Forge / A1111 img2img: Refiner accordion maps to these keys (see modules/processing_scripts/refiner.py).
  const payload: Record<string, unknown> = {
    prompt: params.prompt,
    negative_prompt: params.negativePrompt,
    steps: g.steps,
    width: g.width,
    height: g.height,
    cfg_scale: g.cfg_scale,
    denoising_strength: g.denoising_strength,
    sampler_index: g.sampler,
    scheduler: g.scheduler,
    seed: seedUsed,
    init_images: [params.initImageBase64],
    // Forge WAN: `process_images_inner` treats `batch_size` as the UI "Frames" count for I2V
    // (`_times` / `_is_video`). Sending only `frames` leaves batch_size at 1, so no clip is saved and API `video` stays null.
    batch_size: g.frames,
    /** WAN I2V: patched Forge `StableDiffusionProcessing*` accepts these; vanilla Forge ignores unknown keys. */
    frames: g.frames,
    shift: g.shift,
    override_settings,
    override_settings_restore_afterwards: false,
    alwayson_scripts: {},
    refiner_checkpoint: lowTrim,
    refiner_switch_at: lowTrim ? g.refiner_switch_at : 0,
  };

  return { payload, seedUsed };
}
