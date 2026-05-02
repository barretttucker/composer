import type {
  AssemblyField,
  Character,
  DescriptorMode,
  Location,
  Project,
  Segment,
  SpatialPosition,
  StyleBlock,
} from "@/lib/schemas/project";
import {
  ASSEMBLY_FIELDS,
  CHARACTER_FIRST_ASSEMBLY_ORDER,
  MOTION_FIRST_ASSEMBLY_ORDER,
  segmentUsesStructuredAssembly,
} from "@/lib/schemas/project";

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isValidAssemblyOrder(order: unknown): order is AssemblyField[] {
  if (!Array.isArray(order) || order.length !== ASSEMBLY_FIELDS.length) return false;
  const set = new Set(order);
  return ASSEMBLY_FIELDS.every((f) => set.has(f));
}

function ordersEqual(a: AssemblyField[], b: AssemblyField[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function assemblyOrdersEqual(a: AssemblyField[], b: AssemblyField[]): boolean {
  return ordersEqual(a, b);
}

export function assemblyOrderLabel(order: AssemblyField[]): string {
  if (ordersEqual(order, MOTION_FIRST_ASSEMBLY_ORDER)) return "Motion-first";
  if (ordersEqual(order, CHARACTER_FIRST_ASSEMBLY_ORDER)) return "Character-first";
  return "Custom";
}

export function projectAssemblyOrder(project: Project): AssemblyField[] {
  const o = project.assembly_config?.order;
  if (o && isValidAssemblyOrder(o)) return [...o];
  return [...MOTION_FIRST_ASSEMBLY_ORDER];
}

/**
 * Resolved assembly order for a segment (project defaults + segment override).
 */
export function resolveAssemblyOrder(project: Project, segment: Segment): AssemblyField[] {
  const base = projectAssemblyOrder(project);
  const ov = segment.assembly_override;
  if (ov === "motion_first") return [...MOTION_FIRST_ASSEMBLY_ORDER];
  if (ov === "character_first") return [...CHARACTER_FIRST_ASSEMBLY_ORDER];
  if (ov === "custom" && isValidAssemblyOrder(segment.assembly_order_custom)) {
    return [...segment.assembly_order_custom];
  }
  return base;
}

/**
 * Variant B uses the opposite preset (motion-first vs character-first) for A/B testing.
 */
export function abVariantBAssemblyOrder(project: Project, segment: Segment): AssemblyField[] {
  const a = resolveAssemblyOrder(project, segment);
  const aIsCharacterFirst = ordersEqual(a, CHARACTER_FIRST_ASSEMBLY_ORDER);
  return aIsCharacterFirst
    ? [...MOTION_FIRST_ASSEMBLY_ORDER]
    : [...CHARACTER_FIRST_ASSEMBLY_ORDER];
}

function positionLeadIn(pos: SpatialPosition | undefined): string | null {
  if (pos == null) return null;
  if (typeof pos === "object" && "custom" in pos) {
    const t = pos.custom.trim();
    if (!t) return null;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  switch (pos) {
    case "left":
      return "On the left";
    case "right":
      return "On the right";
    case "center":
      return "In the center";
    case "foreground":
      return "In the foreground";
    case "background":
      return "In the background";
    case "left_of_frame":
      return "On the left of the frame";
    case "right_of_frame":
      return "On the right of the frame";
    default:
      return null;
  }
}

function positionShortLabel(pos: SpatialPosition | undefined): string | null {
  if (pos == null) return null;
  if (typeof pos === "object" && "custom" in pos) {
    const t = pos.custom.trim();
    return t || null;
  }
  switch (pos) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "center":
      return "center";
    case "foreground":
      return "foreground";
    case "background":
      return "background";
    case "left_of_frame":
      return "left of frame";
    case "right_of_frame":
      return "right of frame";
    default:
      return null;
  }
}

type SpatialEntry = { name: string; leadIn: string };

function activeSpatialEntries(
  segment: Segment,
  maps: RegistryMaps,
): SpatialEntry[] {
  const out: SpatialEntry[] = [];
  for (const ac of segment.active_characters ?? []) {
    const lead = positionLeadIn(ac.position);
    if (!lead) continue;
    const ch = maps.charactersById.get(ac.character_id);
    if (!ch) continue;
    const name = ch.name.trim();
    if (!name) continue;
    out.push({ name, leadIn: lead });
  }
  return out;
}

/**
 * Prefix each character name's first mention with spatial lead-in (comma-separated).
 */
export function injectSpatialPrefixesInProse(text: string, entries: SpatialEntry[]): string {
  let acc = text;
  for (const { name, leadIn } of entries) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
    const m = acc.match(re);
    if (m == null || m.index === undefined) continue;
    acc =
      acc.slice(0, m.index) +
      `${leadIn}, ${m[0]}` +
      acc.slice(m.index + m[0].length);
  }
  return acc;
}

function renderCharactersBlock(
  segment: Segment,
  maps: RegistryMaps,
): string | null {
  const mode: DescriptorMode = segment.descriptor_mode ?? "full";
  if (mode === "none") return null;

  const active = segment.active_characters ?? [];
  if (active.length === 0) return null;

  if (mode === "reference") {
    const names: { label: string; hasParen: boolean }[] = [];
    for (const ac of active) {
      const ch = maps.charactersById.get(ac.character_id);
      if (!ch) continue;
      const nm = ch.name.trim();
      if (!nm) continue;
      const tag = positionShortLabel(ac.position);
      names.push({
        label: tag ? `${nm} (${tag})` : nm,
        hasParen: tag != null,
      });
    }
    if (names.length === 0) return null;
    let inner: string;
    if (names.length === 2 && !names.some((n) => n.hasParen)) {
      inner = `${names[0]!.label} and ${names[1]!.label}`;
    } else {
      inner = names.map((n) => n.label).join(", ");
    }
    return `Characters: ${inner}.`;
  }

  // full
  const charParts: string[] = [];
  for (const ac of active) {
    const ch = maps.charactersById.get(ac.character_id);
    if (ch == null) continue;
    const text = characterDescriptor(ch, ac.variant_id).trim();
    if (text === "") continue;
    const lead = positionLeadIn(ac.position);
    charParts.push(lead ? `${lead}, ${text}` : text);
  }
  if (charParts.length === 0) return null;
  return `Characters: ${charParts.join(". ")}`;
}

type DedupeCtx = {
  motionBody: string;
  beat: string;
  camera: string;
  interaction: string;
};

function prepareDedupedFields(segment: Segment): DedupeCtx {
  const motionRaw = segment.motion_in?.trim() ?? "";
  const motionBody = stripLeadingContinuityPhrase(motionRaw);

  let beat = segment.beat?.trim() ?? "";
  if (beat !== "" && motionBody !== "" && normEq(beat, motionBody)) beat = "";

  let camera = segment.camera_intent?.trim() ?? "";
  if (camera !== "") {
    if (motionBody !== "" && normEq(camera, motionBody)) {
      camera = "";
    } else if (beat !== "" && normEq(camera, beat)) {
      camera = "";
    }
  }

  let interaction = segment.interaction?.trim() ?? "";
  if (interaction !== "") {
    if (motionBody !== "" && normEq(interaction, motionBody)) interaction = "";
    else if (beat !== "" && normEq(interaction, beat)) interaction = "";
    else if (camera !== "" && normEq(interaction, camera)) interaction = "";
  }

  return { motionBody, beat, camera, interaction };
}

export function assemblePrompt(
  segment: Segment,
  project: Project,
  maps: RegistryMaps,
  order?: AssemblyField[],
): string {
  const ord = order ?? resolveAssemblyOrder(project, segment);
  const spatial = activeSpatialEntries(segment, maps);
  const d = prepareDedupedFields(segment);
  const sections: string[] = [];

  for (const field of ord) {
    const piece = renderAssemblyField(field, segment, project, maps, d, spatial);
    if (piece != null && piece !== "") sections.push(piece);
  }

  return sections.join(". ");
}

function renderAssemblyField(
  field: AssemblyField,
  segment: Segment,
  project: Project,
  maps: RegistryMaps,
  d: DedupeCtx,
  spatial: SpatialEntry[],
): string | null {
  switch (field) {
    case "motion": {
      if (d.motionBody === "") return null;
      const injected = injectSpatialPrefixesInProse(d.motionBody, spatial);
      return `${I2V_CONTINUITY_PREFIX} ${injected}`;
    }
    case "beat": {
      if (d.beat === "") return null;
      return injectSpatialPrefixesInProse(d.beat, spatial);
    }
    case "interaction": {
      if (d.interaction === "") return null;
      return injectSpatialPrefixesInProse(d.interaction, spatial);
    }
    case "camera": {
      if (d.camera === "") return null;
      return injectSpatialPrefixesInProse(d.camera, spatial);
    }
    case "setting": {
      const locId = segment.location_id?.trim() ?? "";
      if (locId === "") return null;
      const loc = maps.locationsById.get(locId);
      const desc = loc?.descriptor_block?.trim() ?? "";
      if (desc === "") return null;
      return `Setting: ${desc}`;
    }
    case "characters":
      return renderCharactersBlock(segment, maps);
    case "style": {
      const styleId =
        (segment.style_block_id_override?.trim() ?? "") !== ""
          ? segment.style_block_id_override!.trim()
          : (project.default_style_block_id?.trim() ?? "");
      if (styleId === "") return null;
      const sb = maps.styleBlocksById.get(styleId);
      if (sb == null || sb.descriptor_block.trim() === "") return null;
      return sb.descriptor_block;
    }
    default:
      return null;
  }
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
  options?: { order?: AssemblyField[] },
): string {
  if (segmentUsesStructuredAssembly(project, segment)) {
    return assemblePrompt(segment, project, maps, options?.order);
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
