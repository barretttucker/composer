"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AssemblyOrderEditor, ASSEMBLY_FIELD_LABELS } from "@/components/assembly-order-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  assembleNegativePrompt,
  buildRegistryMaps,
  effectivePositivePrompt,
  FORGE_DEFAULT_NEGATIVE_PROMPT,
  isValidAssemblyOrder,
  projectAssemblyOrder,
  resolveAssemblyOrder,
} from "@/lib/prompt-assembly/assemble";
import {
  estimatedTokensFromWords,
  FIELD_BUDGET_TOOLTIPS,
  fieldTooltipForSeverity,
  mergeFieldBudgets,
  severityForFieldCount,
  severityForTotalWordCount,
  totalTooltipForSeverity,
  wordCount,
} from "@/lib/prompt-assembly/budgets";
import type { Project, Segment, SegmentActiveCharacter, SpatialPosition } from "@/lib/schemas/project";
import {
  MOTION_FIRST_ASSEMBLY_ORDER,
  segmentUsesStructuredAssembly,
} from "@/lib/schemas/project";
import { cn } from "@/lib/utils";

type BudgetSeverity = ReturnType<typeof severityForFieldCount>;

function useDebouncedWordCount(text: string, ms = 200): number {
  const [n, setN] = useState(() => wordCount(text));
  useEffect(() => {
    const t = setTimeout(() => setN(wordCount(text)), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return n;
}

function counterClass(sev: BudgetSeverity): string {
  switch (sev) {
    case "soft":
      return "text-amber-700";
    case "hard":
      return "text-orange-700";
    case "capped":
      return "text-red-700";
    default:
      return "text-muted-foreground";
  }
}

function fieldRingClass(sev: BudgetSeverity): string {
  switch (sev) {
    case "soft":
      return "ring-1 ring-amber-200";
    case "hard":
      return "ring-1 ring-orange-300";
    case "capped":
      return "ring-1 ring-red-300";
    default:
      return "";
  }
}

export const CAMERA_PRESETS = [
  "slow dolly forward",
  "dolly back",
  "pan left",
  "pan right",
  "tilt up",
  "tilt down",
  "tracking shot",
  "push-in",
  "pull-out",
  "static",
] as const;

export function SegmentStructuredPromptFields({
  draft,
  selectedSeg,
  selectedIndex,
  patchDraft,
  projectId,
  onAfterSeedUpload,
  onAssemblyAbCompare,
}: {
  draft: Project;
  selectedSeg: Segment;
  selectedIndex: number;
  patchDraft: (u: (p: Project) => Project) => void;
  projectId: string;
  onAfterSeedUpload: () => void;
  /** Render this single clip with motion-first vs character-first A/B (orchestrator validates scope). */
  onAssemblyAbCompare?: () => void;
}) {
  const maps = useMemo(() => buildRegistryMaps(draft), [draft]);
  const locationIdsForPicker = useMemo(() => {
    const ids = [...draft.location_ids];
    const sel = selectedSeg.location_id?.trim();
    if (sel !== undefined && sel !== "" && !ids.includes(sel)) ids.push(sel);
    return ids;
  }, [draft.location_ids, selectedSeg.location_id]);
  const styleBlockIdsForPicker = useMemo(() => {
    const ids = [...draft.style_block_ids];
    const sel = selectedSeg.style_block_id_override?.trim();
    if (sel !== undefined && sel !== "" && !ids.includes(sel)) ids.push(sel);
    return ids;
  }, [draft.style_block_ids, selectedSeg.style_block_id_override]);
  const previewPos = useMemo(
    () => effectivePositivePrompt(selectedSeg, draft, maps),
    [selectedSeg, draft, maps],
  );
  const previewNeg = useMemo(
    () => assembleNegativePrompt(selectedSeg, draft, FORGE_DEFAULT_NEGATIVE_PROMPT),
    [selectedSeg, draft],
  );
  const budgets = useMemo(() => mergeFieldBudgets(draft), [draft]);

  const segmentOrder = useMemo(
    () => resolveAssemblyOrder(draft, selectedSeg),
    [draft, selectedSeg],
  );

  const assemblySegPreset = useMemo((): "project" | "motion_first" | "character_first" | "custom" => {
    const ov = selectedSeg.assembly_override;
    if (ov == null || ov === "project") return "project";
    if (ov === "motion_first") return "motion_first";
    if (ov === "character_first") return "character_first";
    return "custom";
  }, [selectedSeg.assembly_override]);

  const projectOrder = useMemo(() => projectAssemblyOrder(draft), [draft]);

  const [interactionOpen, setInteractionOpen] = useState(
    (selectedSeg.interaction?.trim() ?? "") !== "",
  );

  const active: SegmentActiveCharacter[] = selectedSeg.active_characters ?? [];

  function setActiveCharVariant(characterId: string, variantId: string | undefined) {
    patchDraft((p) => {
      const s = p.segments.find((x) => x.id === selectedSeg.id);
      if (!s) return p;
      const list = [...(s.active_characters ?? [])];
      const ix = list.findIndex((a) => a.character_id === characterId);
      if (ix === -1) return p;
      list[ix] = { ...list[ix]!, character_id: characterId, variant_id: variantId };
      s.active_characters = list;
      return p;
    });
  }

  function addActiveCharacter(characterId: string) {
    if (active.some((a) => a.character_id === characterId)) return;
    patchDraft((p) => {
      const s = p.segments.find((x) => x.id === selectedSeg.id);
      if (!s) return p;
      s.active_characters = [...active, { character_id: characterId }];
      return p;
    });
  }

  function removeActiveCharacter(characterId: string) {
    patchDraft((p) => {
      const s = p.segments.find((x) => x.id === selectedSeg.id);
      if (!s) return p;
      s.active_characters = active.filter((a) => a.character_id !== characterId);
      if (s.active_characters.length === 0) s.active_characters = undefined;
      return p;
    });
  }

  const usesStructured = segmentUsesStructuredAssembly(draft, selectedSeg);
  const touchedInputRef = useRef<HTMLInputElement>(null);
  const charById = useMemo(() => new Map(draft.characters.map((c) => [c.id, c])), [draft]);

  const motionInWc = useDebouncedWordCount(selectedSeg.motion_in ?? "", 200);
  const motionInSev = severityForFieldCount("motion", motionInWc, budgets);
  const beatWc = useDebouncedWordCount(selectedSeg.beat ?? "", 200);
  const beatSev = severityForFieldCount("beat", beatWc, budgets);
  const interactionWc = useDebouncedWordCount(selectedSeg.interaction ?? "", 200);
  const interactionSev = severityForFieldCount("interaction", interactionWc, budgets);
  const cameraWc = useDebouncedWordCount(selectedSeg.camera_intent ?? "", 200);
  const cameraSev = severityForFieldCount("camera", cameraWc, budgets);
  const settingDesc = useMemo(() => {
    const id = selectedSeg.location_id?.trim() ?? "";
    if (id === "") return "";
    return maps.locationsById.get(id)?.descriptor_block ?? "";
  }, [selectedSeg.location_id, maps.locationsById]);
  const settingWc = useDebouncedWordCount(settingDesc, 200);
  const settingSev = severityForFieldCount("setting", settingWc, budgets);

  const styleDesc = useMemo(() => {
    const styleId =
      (selectedSeg.style_block_id_override?.trim() ?? "") !== ""
        ? selectedSeg.style_block_id_override!.trim()
        : (draft.default_style_block_id?.trim() ?? "");
    if (styleId === "") return "";
    return maps.styleBlocksById.get(styleId)?.descriptor_block ?? "";
  }, [
    selectedSeg.style_block_id_override,
    draft.default_style_block_id,
    maps.styleBlocksById,
  ]);
  const styleWc = useDebouncedWordCount(styleDesc, 200);
  const styleSev = severityForFieldCount("style", styleWc, budgets);

  const charBlockApprox = useMemo(() => {
    const mode = selectedSeg.descriptor_mode ?? "full";
    if (mode === "none") return "";
    const activeC = selectedSeg.active_characters ?? [];
    if (activeC.length === 0) return "";
    const parts: string[] = [];
    for (const ac of activeC) {
      const ch = maps.charactersById.get(ac.character_id);
      if (!ch) continue;
      const variantId = ac.variant_id;
      const text =
        variantId != null && variantId !== "" && ch.variants?.[variantId] != null
          ? ch.variants[variantId]!
          : ch.descriptor_block;
      if (text.trim()) parts.push(text.trim());
    }
    if (parts.length === 0) return "";
    if (mode === "reference") {
      return `Characters: ${parts.join(" ")}.`;
    }
    return `Characters: ${parts.join(". ")}`;
  }, [selectedSeg.active_characters, selectedSeg.descriptor_mode, maps.charactersById]);
  const charWc = useDebouncedWordCount(charBlockApprox, 200);
  const charSev = severityForFieldCount("characters", charWc, budgets);

  const totalWc = useDebouncedWordCount(
    usesStructured || draft.structured_prompts ? previewPos : selectedSeg.prompt ?? "",
    200,
  );
  const totalSev = severityForTotalWordCount(totalWc);

  function positionSelectValue(pos: SpatialPosition | undefined): string {
    if (pos == null) return "__none__";
    if (typeof pos === "object" && "custom" in pos) return "__custom__";
    return pos;
  }

  function setActiveCharPosition(characterId: string, sel: string, customText: string) {
    patchDraft((p) => {
      const s = p.segments.find((x) => x.id === selectedSeg.id);
      if (!s) return p;
      const list = [...(s.active_characters ?? [])];
      const ix = list.findIndex((a) => a.character_id === characterId);
      if (ix === -1) return p;
      const prev = list[ix]!;
      let position: SpatialPosition | undefined;
      if (sel === "__none__") position = undefined;
      else if (sel === "__custom__") {
        const t = customText.trim();
        position = t ? { custom: t } : undefined;
      } else position = sel as SpatialPosition;
      list[ix] = { ...prev, position };
      s.active_characters = list;
      return p;
    });
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-muted-foreground text-xs leading-snug">
        Structured WAN image-to-video prompts (~5s clips) assemble with continuity and motion first, then beat
        and camera, then location and characters as anchoring context, then style. Identical text in motion /
        beat / camera is deduplicated. Motion out is for review and for seeding the next clip—never sent to
        Forge. Legacy flat prompt below applies when structured assembly is off.
      </p>

      {selectedIndex > 0 ? (
        <div className="space-y-1">
          <Label>Seed frame source</Label>
          <Select
            value={selectedSeg.seed_frame_source ?? "chained"}
            onValueChange={(v) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (!s) return p;
                s.seed_frame_source = v as Segment["seed_frame_source"];
                if (v === "chained") {
                  s.extend_from_previous = true;
                  s.seed_frame_rel = undefined;
                  s.seed_from_segment_id = undefined;
                }
                if (v === "fresh") {
                  s.extend_from_previous = false;
                  s.seed_from_segment_id = undefined;
                }
                if (v === "touched_up") {
                  s.extend_from_previous = true;
                  s.seed_from_segment_id = undefined;
                }
                if (v === "chained_from") {
                  s.extend_from_previous = true;
                  s.seed_frame_rel = undefined;
                  // Default to the immediate previous clip when first toggled.
                  if (!s.seed_from_segment_id) {
                    const prev = p.segments[selectedIndex - 1];
                    s.seed_from_segment_id = prev?.id;
                  }
                }
                return p;
              })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chained">Chained (previous clip)</SelectItem>
              <SelectItem value="chained_from">Chained from earlier clip</SelectItem>
              <SelectItem value="fresh">Fresh (custom upload)</SelectItem>
              <SelectItem value="touched_up">Touched-up (replace seed PNG)</SelectItem>
            </SelectContent>
          </Select>
          {selectedSeg.seed_frame_source === "chained_from" ? (
            <div className="mt-2 space-y-1">
              <Label className="text-xs">Source clip</Label>
              <Select
                value={selectedSeg.seed_from_segment_id ?? ""}
                onValueChange={(v) =>
                  patchDraft((p) => {
                    const s = p.segments.find((x) => x.id === selectedSeg.id);
                    if (!s) return p;
                    const nextId = typeof v === "string" && v.length > 0 ? v : undefined;
                    s.seed_from_segment_id = nextId;
                    s.seed_frame_rel = undefined;
                    return p;
                  })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick an earlier clip" />
                </SelectTrigger>
                <SelectContent>
                  {draft.segments.slice(0, selectedIndex).map((s, i) => {
                    const promptSnippet = s.prompt?.trim().slice(0, 32) ?? "";
                    const label = promptSnippet || `Clip ${i + 1}`;
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {`Clip ${i + 1} - ${label}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-[11px] leading-snug">
                Uses the picked clip&apos;s last frame as the seed for this clip&apos;s
                render. Re-rendering the source clip cascades to this one.
              </p>
            </div>
          ) : null}
          {selectedSeg.seed_frame_source === "touched_up" ? (
            <>
              <input
                ref={touchedInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.set("image", f);
                  fd.set("segmentIndex", String(selectedIndex));
                  fd.set("kind", "touched_seed");
                  const res = await fetch(`/api/projects/${projectId}/input`, {
                    method: "POST",
                    body: fd,
                  });
                  e.target.value = "";
                  if (res.ok) onAfterSeedUpload();
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => touchedInputRef.current?.click()}
              >
                Edit seed frame (upload PNG)
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Motion in</Label>
          <p className="text-muted-foreground text-[11px] leading-snug">
            First in the Forge prompt when set: adds &quot;Continuing from the previous moment,&quot; then your
            motion line. Paste without repeating that phrase—it is injected automatically.
          </p>
          <div className={cn("relative rounded-md", fieldRingClass(motionInSev))}>
            <Textarea
              rows={2}
              className="pb-6"
              value={selectedSeg.motion_in ?? ""}
              onChange={(e) =>
                patchDraft((p) => {
                  const s = p.segments.find((x) => x.id === selectedSeg.id);
                  if (s) s.motion_in = e.target.value || undefined;
                  return p;
                })}
            />
            <span
              className={cn(
                "pointer-events-none absolute right-2 bottom-2 text-[11px]",
                counterClass(motionInSev),
              )}
              title={
                fieldTooltipForSeverity("motion", motionInWc, budgets) ?? FIELD_BUDGET_TOOLTIPS.motion
              }
            >
              {motionInWc} words
            </span>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Motion out (after review)</Label>
          <p className="text-muted-foreground text-[11px] leading-snug">
            Continuity notes and optional seed for the next clip only—not included in this clip&apos;s Forge
            prompt.
          </p>
          <Textarea
            rows={2}
            value={selectedSeg.motion_out ?? ""}
            onChange={(e) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (s) s.motion_out = e.target.value || undefined;
                return p;
              })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Beat</Label>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Scene action after motion continuity—primary narrative beat for short clips.
        </p>
        <div className={cn("relative rounded-md", fieldRingClass(beatSev))}>
          <Textarea
            rows={3}
            className="pb-6"
            value={selectedSeg.beat ?? ""}
            onChange={(e) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (s) s.beat = e.target.value || undefined;
                return p;
              })}
          />
          <span
            className={cn(
              "pointer-events-none absolute right-2 bottom-2 text-[11px]",
              counterClass(beatSev),
            )}
            title={fieldTooltipForSeverity("beat", beatWc, budgets) ?? FIELD_BUDGET_TOOLTIPS.beat}
          >
            {beatWc} words
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-left text-xs font-medium"
          onClick={() => setInteractionOpen((o) => !o)}
        >
          <span className={interactionOpen ? "rotate-90" : ""}>▸</span>
          Interaction (optional)
        </button>
        {interactionOpen ? (
          <div className={cn("relative rounded-md", fieldRingClass(interactionSev))}>
            <Textarea
              rows={2}
              className="pb-6"
              placeholder='e.g. "Watson hands Holmes a folded note, Holmes glances down then up sharply"'
              value={selectedSeg.interaction ?? ""}
              onChange={(e) =>
                patchDraft((p) => {
                  const s = p.segments.find((x) => x.id === selectedSeg.id);
                  if (s) s.interaction = e.target.value || undefined;
                  return p;
                })}
            />
            <span
              className={cn(
                "pointer-events-none absolute right-2 bottom-2 text-[11px]",
                counterClass(interactionSev),
              )}
              title={
                fieldTooltipForSeverity("interaction", interactionWc, budgets) ??
                FIELD_BUDGET_TOOLTIPS.interaction
              }
            >
              {interactionWc} words
            </span>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label>Camera intent</Label>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Lens and framing intent—assembled right after beat. Duplicate camera vs motion/beat text is omitted.
        </p>
        <div className={cn("relative", fieldRingClass(cameraSev))}>
          <Input
            className="pr-16"
            list={`camera-datalist-${selectedSeg.id}`}
            value={selectedSeg.camera_intent ?? ""}
            onChange={(e) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (s) s.camera_intent = e.target.value || undefined;
                return p;
              })}
          />
          <span
            className={cn(
              "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px]",
              counterClass(cameraSev),
            )}
            title={fieldTooltipForSeverity("camera", cameraWc, budgets) ?? FIELD_BUDGET_TOOLTIPS.camera}
          >
            {cameraWc} words
          </span>
        </div>
        <datalist id={`camera-datalist-${selectedSeg.id}`}>
          {CAMERA_PRESETS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="space-y-1">
        <Label>Location</Label>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Descriptor is prefixed with &quot;Setting:&quot; in the assembled prompt for anchoring after motion,
          beat, and camera.
        </p>
        <Select
          value={
            selectedSeg.location_id?.trim() === "" ||
            selectedSeg.location_id == null
              ? "__none__"
              : selectedSeg.location_id.trim()
          }
          onValueChange={(v) =>
            patchDraft((p) => {
              const s = p.segments.find((x) => x.id === selectedSeg.id);
              if (!s) return p;
              s.location_id =
                v === "__none__" || v == null || v === "" ? undefined : v;
              return p;
            })}
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue placeholder="None">
              {(value) => {
                if (value === "__none__" || value == null || value === "") {
                  return "None";
                }
                const id = String(value).trim();
                const l = maps.locationsById.get(id);
                const nm = l?.name?.trim() ?? "";
                if (l == null) return `Unknown (${id.slice(0, 6)}…)`;
                if (nm !== "") return nm;
                return "(unnamed location)";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {locationIdsForPicker.map((id) => {
              const l = maps.locationsById.get(id);
              const nm = l?.name?.trim() ?? "";
              const label =
                l == null
                  ? `Unknown location (${id.slice(0, 6)}…)`
                  : nm !== ""
                    ? nm
                    : "(unnamed location)";
              return (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {settingDesc.trim() !== "" ? (
          <p
            className={cn("text-[11px]", counterClass(settingSev))}
            title={fieldTooltipForSeverity("setting", settingWc, budgets) ?? FIELD_BUDGET_TOOLTIPS.setting}
          >
            Setting descriptor (registry): {settingWc} words
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Character descriptors</Label>
          <Select
            value={selectedSeg.descriptor_mode ?? "full"}
            onValueChange={(v) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (!s) return p;
                s.descriptor_mode = v as Segment["descriptor_mode"];
                return p;
              })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full — registry descriptors verbatim</SelectItem>
              <SelectItem value="reference">Reference — names only</SelectItem>
              <SelectItem value="none">None — omit Characters block</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Assembly (this clip)</Label>
          <Select
            value={assemblySegPreset}
            onValueChange={(v) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (!s) return p;
                if (v === "project") {
                  s.assembly_override = undefined;
                  s.assembly_order_custom = undefined;
                } else if (v === "motion_first") {
                  s.assembly_override = "motion_first";
                  s.assembly_order_custom = undefined;
                } else if (v === "character_first") {
                  s.assembly_override = "character_first";
                  s.assembly_order_custom = undefined;
                } else {
                  s.assembly_override = "custom";
                  s.assembly_order_custom = [...projectOrder];
                }
                return p;
              })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Project default</SelectItem>
              <SelectItem value="motion_first">Motion-first</SelectItem>
              <SelectItem value="character_first">Character-first</SelectItem>
              <SelectItem value="custom">Custom (this segment)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {assemblySegPreset === "custom" ? (
        <div className="max-w-md rounded-md border p-2">
          <AssemblyOrderEditor
            order={
              selectedSeg.assembly_order_custom &&
              isValidAssemblyOrder(selectedSeg.assembly_order_custom)
                ? selectedSeg.assembly_order_custom
                : [...MOTION_FIRST_ASSEMBLY_ORDER]
            }
            onOrderChange={(next) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (!s) return p;
                s.assembly_order_custom = next;
                s.assembly_override = "custom";
                return p;
              })
            }
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <Label>Active characters</Label>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Verbatim descriptors are grouped under &quot;Characters:&quot; after setting—order matches the list
          below.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            className="border-border bg-background h-9 rounded-md border px-2 text-sm"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) addActiveCharacter(id);
              e.target.value = "";
            }}
          >
            <option value="">Add character…</option>
            {draft.character_ids.map((id) => {
              const c = charById.get(id);
              if (!c || active.some((a) => a.character_id === id)) return null;
              return (
                <option key={id} value={id}>
                  {c.name}
                </option>
              );
            })}
          </select>
        </div>
        <ul className="space-y-2">
          {active.map((a) => {
            const c = charById.get(a.character_id);
            if (!c) return null;
            const variantKeys = Object.keys(c.variants ?? {});
            return (
              <li
                key={a.character_id}
                className="flex flex-col gap-2 rounded-md border px-2 py-2 sm:flex-row sm:flex-wrap sm:items-center"
              >
                <span className="text-sm font-medium">{c.name}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-muted-foreground text-xs">Position</Label>
                  <Select
                    value={positionSelectValue(a.position)}
                    onValueChange={(v) => {
                      if (v == null || v === "") return;
                      const custom =
                        typeof a.position === "object" && a.position && "custom" in a.position
                          ? a.position.custom
                          : "";
                      setActiveCharPosition(a.character_id, v, custom);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="foreground">Foreground</SelectItem>
                      <SelectItem value="background">Background</SelectItem>
                      <SelectItem value="left_of_frame">Left of frame</SelectItem>
                      <SelectItem value="right_of_frame">Right of frame</SelectItem>
                      <SelectItem value="__custom__">Custom…</SelectItem>
                    </SelectContent>
                  </Select>
                  {positionSelectValue(a.position) === "__custom__" ? (
                    <Input
                      className="h-8 max-w-[200px]"
                      placeholder="e.g. behind Watson"
                      value={
                        typeof a.position === "object" &&
                        a.position &&
                        "custom" in a.position
                          ? a.position.custom
                          : ""
                      }
                      onChange={(e) =>
                        setActiveCharPosition(a.character_id, "__custom__", e.target.value)
                      }
                    />
                  ) : null}
                </div>
                {variantKeys.length > 0 ? (
                  <Select
                    value={a.variant_id ?? "__base__"}
                    onValueChange={(v) =>
                      setActiveCharVariant(
                        a.character_id,
                        v === "__base__" || v == null || v === "" ? undefined : v,
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__base__">Base descriptor</SelectItem>
                      {variantKeys.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive sm:ml-auto"
                  onClick={() => removeActiveCharacter(a.character_id)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        {(selectedSeg.descriptor_mode ?? "full") !== "none" && active.length > 0 ? (
          <p
            className={cn("text-[11px]", counterClass(charSev))}
            title={
              fieldTooltipForSeverity("characters", charWc, budgets) ??
              FIELD_BUDGET_TOOLTIPS.characters
            }
          >
            Characters block (approx.): {charWc} words
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label>Style override</Label>
        <Select
          value={(() => {
            const o = selectedSeg.style_block_id_override?.trim();
            if (o === "" || o == null) return "__project__";
            return o;
          })()}
          onValueChange={(v) =>
            patchDraft((p) => {
              const s = p.segments.find((x) => x.id === selectedSeg.id);
              if (!s) return p;
              s.style_block_id_override =
                v === "__project__" ||
                v === "__none__" ||
                v == null ||
                v === ""
                  ? undefined
                  : v;
              return p;
            })}
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue placeholder="Use project default">
              {(value) => {
                if (value === "__project__" || value == null || value === "") {
                  return "Use project default";
                }
                if (value === "__none__") return "No style block";
                const id = String(value).trim();
                const st = maps.styleBlocksById.get(id);
                const nm = st?.name?.trim() ?? "";
                if (st == null) return `Unknown (${id.slice(0, 6)}…)`;
                if (nm !== "") return nm;
                return "(unnamed style)";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__project__">Use project default</SelectItem>
            <SelectItem value="__none__">No style block</SelectItem>
            {styleBlockIdsForPicker.map((id) => {
              const st = maps.styleBlocksById.get(id);
              const nm = st?.name?.trim() ?? "";
              const label =
                st == null
                  ? `Unknown style (${id.slice(0, 6)}…)`
                  : nm !== ""
                    ? nm
                    : "(unnamed style)";
              return (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {styleDesc.trim() !== "" ? (
          <p
            className={cn("text-[11px]", counterClass(styleSev))}
            title={fieldTooltipForSeverity("style", styleWc, budgets) ?? FIELD_BUDGET_TOOLTIPS.style}
          >
            Style block (registry): {styleWc} words
          </p>
        ) : null}
      </div>

      <div className="space-y-1 rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs">Live assembled prompt</Label>
          {usesStructured || draft.structured_prompts ? (
            <span
              className={cn("text-[11px]", counterClass(totalSev))}
              title={totalTooltipForSeverity(totalWc) ?? undefined}
            >
              {totalWc} words — estimated ~{estimatedTokensFromWords(totalWc)} tokens
            </span>
          ) : null}
        </div>
        {usesStructured || draft.structured_prompts ? (
          <p className="text-muted-foreground text-[10px] leading-snug">
            Order: {segmentOrder.map((f) => ASSEMBLY_FIELD_LABELS[f]).join(" \u2192 ")}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed whitespace-pre-wrap">
          {(() => {
            const legacy = selectedSeg.prompt?.trim() ?? "";
            if (usesStructured || draft.structured_prompts) {
              return (
                previewPos ||
                (legacy !== "" ? legacy : "(empty — add motion in, beat, location, or legacy prompt)")
              );
            }
            return legacy !== "" ? legacy : "(legacy prompt empty)";
          })()}
        </p>
        {onAssemblyAbCompare && (usesStructured || draft.structured_prompts) ? (
          <div className="space-y-1 border-t pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAssemblyAbCompare()}
            >
              Generate variant with alternate order
            </Button>
            <p className="text-muted-foreground text-[10px] leading-snug">
              Queues a single-clip snapshot with motion-first vs character-first assembly (same seed).
              Pick the winner when both finish.
            </p>
          </div>
        ) : null}
        <Label className="mt-2 text-xs">Negative (effective)</Label>
        <p className="text-muted-foreground text-xs">{previewNeg}</p>
        {selectedSeg.published_generation ? (
          <>
            <Label className="mt-2 text-xs text-amber-900">Last published to Forge</Label>
            <p className="text-xs leading-relaxed whitespace-pre-wrap opacity-90">
              {selectedSeg.published_generation.assembled_prompt}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
