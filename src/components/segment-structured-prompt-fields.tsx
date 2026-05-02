"use client";

import { useMemo, useRef } from "react";

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
} from "@/lib/prompt-assembly/assemble";
import type { Project, Segment, SegmentActiveCharacter } from "@/lib/schemas/project";
import { segmentUsesStructuredAssembly } from "@/lib/schemas/project";

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
}: {
  draft: Project;
  selectedSeg: Segment;
  selectedIndex: number;
  patchDraft: (u: (p: Project) => Project) => void;
  projectId: string;
  onAfterSeedUpload: () => void;
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
  const usesStructured = segmentUsesStructuredAssembly(draft, selectedSeg);
  const touchedInputRef = useRef<HTMLInputElement>(null);
  const charById = useMemo(() => new Map(draft.characters.map((c) => [c.id, c])), [draft]);

  const active: SegmentActiveCharacter[] = selectedSeg.active_characters ?? [];

  function setActiveCharVariant(characterId: string, variantId: string | undefined) {
    patchDraft((p) => {
      const s = p.segments.find((x) => x.id === selectedSeg.id);
      if (!s) return p;
      const list = [...(s.active_characters ?? [])];
      const ix = list.findIndex((a) => a.character_id === characterId);
      if (ix === -1) return p;
      list[ix] = { character_id: characterId, variant_id: variantId };
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
                }
                if (v === "fresh") {
                  s.extend_from_previous = false;
                }
                if (v === "touched_up") {
                  s.extend_from_previous = true;
                }
                return p;
              })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chained">Chained (previous last frame)</SelectItem>
              <SelectItem value="fresh">Fresh (custom upload)</SelectItem>
              <SelectItem value="touched_up">Touched-up (replace seed PNG)</SelectItem>
            </SelectContent>
          </Select>
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
          <Textarea
            rows={2}
            value={selectedSeg.motion_in ?? ""}
            onChange={(e) =>
              patchDraft((p) => {
                const s = p.segments.find((x) => x.id === selectedSeg.id);
                if (s) s.motion_in = e.target.value || undefined;
                return p;
              })}
          />
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
        <Textarea
          rows={3}
          value={selectedSeg.beat ?? ""}
          onChange={(e) =>
            patchDraft((p) => {
              const s = p.segments.find((x) => x.id === selectedSeg.id);
              if (s) s.beat = e.target.value || undefined;
              return p;
            })}
        />
      </div>

      <div className="space-y-1">
        <Label>Camera intent</Label>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Lens and framing intent—assembled right after beat. Duplicate camera vs motion/beat text is omitted.
        </p>
        <Input
          list={`camera-datalist-${selectedSeg.id}`}
          value={selectedSeg.camera_intent ?? ""}
          onChange={(e) =>
            patchDraft((p) => {
              const s = p.segments.find((x) => x.id === selectedSeg.id);
              if (s) s.camera_intent = e.target.value || undefined;
              return p;
            })}
        />
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
      </div>

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
                className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1"
              >
                <span className="text-sm font-medium">{c.name}</span>
                {variantKeys.length > 0 ? (
                  <Select
                    value={a.variant_id ?? "__base__"}
                    onValueChange={(v) =>
                      setActiveCharVariant(
                        a.character_id,
                        v === "__base__" || v == null || v === ""
                          ? undefined
                          : v,
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
                  className="text-destructive ml-auto"
                  onClick={() => removeActiveCharacter(a.character_id)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
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
      </div>

      <div className="space-y-1 rounded-md border bg-muted/30 p-3">
        <Label className="text-xs">Live assembled prompt</Label>
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
