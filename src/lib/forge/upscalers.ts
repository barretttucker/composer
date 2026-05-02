import { DEFAULT_CHAIN_HYGIENE } from "@/lib/schemas/project";

/** Pick a sensible default upscaler label from Forge's /sdapi/v1/upscalers list. */
export function preferredForgeUpscalerName(names: string[]): string {
  if (names.length === 0) return DEFAULT_CHAIN_HYGIENE.upscaler;
  const exactUnderscore = names.find((n) => n === "SwinIR_4x");
  if (exactUnderscore) return exactUnderscore;
  const loose = names.find((n) => /swinir/i.test(n) && /4x/i.test(n));
  if (loose) return loose;
  const filtered = names.filter((n) => n && n !== "None");
  return filtered[0] ?? names[0] ?? DEFAULT_CHAIN_HYGIENE.upscaler;
}

export function parseForgeUpscalerNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") out.push(item);
    else if (
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string"
    ) {
      out.push((item as { name: string }).name);
    }
  }
  return out;
}
