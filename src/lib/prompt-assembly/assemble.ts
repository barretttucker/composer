import type {
  Character,
  Location,
  Project,
  Segment,
  StyleBlock,
} from "@/lib/schemas/project";
import { segmentUsesStructuredAssembly } from "@/lib/schemas/project";

/** Matches Forge client default; kept here so this module stays client-safe (no server-only imports). */
export const FORGE_DEFAULT_NEGATIVE_PROMPT =
  "worst quality, low quality, watermark, text, logo, blurry";

export type RegistryMaps = {
  charactersById: Map<string, Character>;
  locationsById: Map<string, Location>;
  styleBlocksById: Map<string, StyleBlock>;
};

export function buildRegistryMaps(project: Project): RegistryMaps {
  return {
    charactersById: new Map(project.characters.map((c) => [c.id, c])),
    locationsById: new Map(project.locations.map((l) => [l.id, l])),
    styleBlocksById: new Map(project.style_blocks.map((s) => [s.id, s])),
  };
}

function characterDescriptor(c: Character, variantId?: string): string {
  if (variantId != null && variantId !== "" && c.variants?.[variantId] != null) {
    return c.variants[variantId]!;
  }
  return c.descriptor_block;
}

/** Image-to-video continuity line prepended when `motion_in` is present (short-clip ordering). */
export const I2V_CONTINUITY_PREFIX = "Continuing from the previous moment,";

/**
 * Strip user-pasted continuity lead-ins from motion_in so we do not duplicate the prefix.
 */
export function stripLeadingContinuityPhrase(motionIn: string): string {
  return motionIn
    .replace(
      /^\s*Continuing\s+from\s+(the\s+)?previous\s+moment,?\s*/i,
      "",
    )
    .trim();
}

function normEq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Wan image-to-video structured assembly (~5s clips): continuity + motion first, then beat and
 * camera, then location/character anchoring. `motion_out` is review/chaining metadata only — never
 * included here. Descriptor blocks are copied verbatim from registries.
 */
export function assemblePrompt(
  segment: Segment,
  project: Project,
  maps: RegistryMaps,
): string {
  const sections: string[] = [];

  const motionRaw = segment.motion_in?.trim() ?? "";
  const motionBody = stripLeadingContinuityPhrase(motionRaw);

  if (motionBody !== "") {
    sections.push(`${I2V_CONTINUITY_PREFIX} ${motionBody}`);
  }

  const motionBlockForDedupe = motionBody;

  let beat = segment.beat?.trim() ?? "";
  if (beat !== "" && motionBlockForDedupe !== "" && normEq(beat, motionBlockForDedupe)) {
    beat = "";
  }
  if (beat !== "") sections.push(beat);

  let camera = segment.camera_intent?.trim() ?? "";
  if (camera !== "") {
    if (motionBlockForDedupe !== "" && normEq(camera, motionBlockForDedupe)) {
      camera = "";
    } else if (beat !== "" && normEq(camera, beat)) {
      camera = "";
    }
  }
  if (camera !== "") sections.push(camera);

  const locId = segment.location_id?.trim() ?? "";
  if (locId !== "") {
    const loc = maps.locationsById.get(locId);
    const desc = loc?.descriptor_block?.trim() ?? "";
    if (desc !== "") sections.push(`Setting: ${desc}`);
  }

  const active = segment.active_characters ?? [];
  const charParts: string[] = [];
  for (const ac of active) {
    const ch = maps.charactersById.get(ac.character_id);
    if (ch == null) continue;
    const text = characterDescriptor(ch, ac.variant_id).trim();
    if (text !== "") charParts.push(text);
  }
  if (charParts.length > 0) {
    sections.push(`Characters: ${charParts.join(". ")}`);
  }

  const styleId =
    (segment.style_block_id_override?.trim() ?? "") !== ""
      ? segment.style_block_id_override!.trim()
      : (project.default_style_block_id?.trim() ?? "");
  if (styleId !== "") {
    const sb = maps.styleBlocksById.get(styleId);
    if (sb != null && sb.descriptor_block.trim() !== "") {
      sections.push(sb.descriptor_block);
    }
  }

  return sections.join(". ");
}

export function assembleNegativePrompt(
  segment: Segment,
  project: Project,
  forgeDefault: string = FORGE_DEFAULT_NEGATIVE_PROMPT,
): string {
  const segNeg = segment.negative_prompt?.trim() ?? "";
  if (segNeg !== "") return segment.negative_prompt!.trim();
  const projNeg = project.default_negative_prompt?.trim() ?? "";
  if (projNeg !== "") return project.default_negative_prompt!.trim();
  return forgeDefault;
}

/** Positive prompt sent to Forge: structured assembly or legacy `segment.prompt`. */
export function effectivePositivePrompt(
  segment: Segment,
  project: Project,
  maps: RegistryMaps,
): string {
  if (segmentUsesStructuredAssembly(project, segment)) {
    return assemblePrompt(segment, project, maps);
  }
  return segment.prompt;
}

/** Same inputs as Forge should see for fingerprinting. */
export function effectiveNegativePrompt(
  segment: Segment,
  project: Project,
): string {
  return assembleNegativePrompt(segment, project);
}
