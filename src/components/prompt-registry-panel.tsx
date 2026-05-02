"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { nanoid } from "nanoid";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Project } from "@/lib/schemas/project";
import { cn } from "@/lib/utils";

export function PromptRegistryPanel({
  draft,
  patchDraft,
  defaultCollapsed = true,
}: {
  draft: Project;
  patchDraft: (u: (p: Project) => Project) => void;
  /** When true, panel starts collapsed (expand to edit registries). */
  defaultCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);

  const locById = new Map(draft.locations.map((l) => [l.id, l]));
  const charById = new Map(draft.characters.map((c) => [c.id, c]));
  const styleById = new Map(draft.style_blocks.map((s) => [s.id, s]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          className="flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronDown
            className={cn(
              "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">Continuity registries</CardTitle>
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
              Project-level: characters, locations, and style blocks for structured assembly (descriptor text
              is pasted verbatim).
            </p>
          </div>
        </button>
      </CardHeader>
      {open ? (
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft.structured_prompts === true}
            onCheckedChange={(v) =>
              patchDraft((p) => {
                p.structured_prompts = v === true;
                return p;
              })}
          />
          Prefer structured assembly (uses beat / registry fields when set)
        </label>

        <div className="space-y-1">
          <Label>Project default negative prompt</Label>
          <Textarea
            rows={2}
            value={draft.default_negative_prompt ?? ""}
            placeholder="Leave empty to use app default"
            onChange={(e) =>
              patchDraft((p) => {
                p.default_negative_prompt = e.target.value || undefined;
                return p;
              })}
          />
        </div>

        <div className="space-y-1">
          <Label>Default style block</Label>
          <Select
            value={draft.default_style_block_id ?? "__none__"}
            onValueChange={(v) =>
              patchDraft((p) => {
                p.default_style_block_id =
                  v === "__none__" || v == null || v === "" ? undefined : v;
                return p;
              })}
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {draft.style_block_ids.map((id) => {
                const s = styleById.get(id);
                if (!s) return null;
                return (
                  <SelectItem key={id} value={id}>
                    {s.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <RegistryBlock
          title="Locations"
          onAdd={() =>
            patchDraft((p) => {
              const id = nanoid();
              p.locations.push({ id, name: "Location", descriptor_block: "" });
              p.location_ids.push(id);
              return p;
            })}
        >
          <div className="space-y-3">
              {draft.location_ids.map((id) => {
                const l = locById.get(id);
                if (!l) return null;
                return (
                  <div key={id} className="space-y-1 rounded-md border p-2">
                    <div className="flex gap-2">
                      <Input
                        className="h-8 flex-1"
                        value={l.name}
                        onChange={(e) =>
                          patchDraft((p) => {
                            const x = p.locations.find((o) => o.id === id);
                            if (x) x.name = e.target.value;
                            return p;
                          })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive shrink-0"
                        onClick={() =>
                          patchDraft((p) => {
                            p.locations = p.locations.filter((o) => o.id !== id);
                            p.location_ids = p.location_ids.filter((x) => x !== id);
                            return p;
                          })}
                      >
                        Remove
                      </Button>
                    </div>
                    <Textarea
                      rows={2}
                      className="text-xs"
                      value={l.descriptor_block}
                      onChange={(e) =>
                        patchDraft((p) => {
                          const x = p.locations.find((o) => o.id === id);
                          if (x) x.descriptor_block = e.target.value;
                          return p;
                        })}
                    />
                  </div>
                );
              })}
          </div>
        </RegistryBlock>

        <RegistryBlock
          title="Characters"
          onAdd={() =>
            patchDraft((p) => {
              const id = nanoid();
              p.characters.push({
                id,
                name: "Character",
                descriptor_block: "",
              });
              p.character_ids.push(id);
              return p;
            })}
        >
          <div className="space-y-3">
              {draft.character_ids.map((id) => {
                const c = charById.get(id);
                if (!c) return null;
                const variantLines = Object.entries(c.variants ?? {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join("\n");
                return (
                  <div key={id} className="space-y-1 rounded-md border p-2">
                    <div className="flex gap-2">
                      <Input
                        className="h-8 flex-1"
                        value={c.name}
                        onChange={(e) =>
                          patchDraft((p) => {
                            const x = p.characters.find((o) => o.id === id);
                            if (x) x.name = e.target.value;
                            return p;
                          })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive shrink-0"
                        onClick={() =>
                          patchDraft((p) => {
                            p.characters = p.characters.filter((o) => o.id !== id);
                            p.character_ids = p.character_ids.filter((x) => x !== id);
                            for (const s of p.segments) {
                              s.active_characters = (s.active_characters ?? []).filter(
                                (a) => a.character_id !== id,
                              );
                              if (s.active_characters?.length === 0) {
                                s.active_characters = undefined;
                              }
                            }
                            return p;
                          })}
                      >
                        Remove
                      </Button>
                    </div>
                    <Label className="text-xs">Descriptor (verbatim)</Label>
                    <Textarea
                      rows={2}
                      className="text-xs"
                      value={c.descriptor_block}
                      onChange={(e) =>
                        patchDraft((p) => {
                          const x = p.characters.find((o) => o.id === id);
                          if (x) x.descriptor_block = e.target.value;
                          return p;
                        })}
                    />
                    <Label className="text-xs">
                      Variants (one per line: variant_id=text)
                    </Label>
                    <Textarea
                      rows={2}
                      className="font-mono text-xs"
                      value={variantLines}
                      onChange={(e) =>
                        patchDraft((p) => {
                          const x = p.characters.find((o) => o.id === id);
                          if (!x) return p;
                          const next: Record<string, string> = {};
                          for (const line of e.target.value.split("\n")) {
                            const t = line.trim();
                            if (!t) continue;
                            const eq = t.indexOf("=");
                            if (eq <= 0) continue;
                            next[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
                          }
                          x.variants = Object.keys(next).length ? next : undefined;
                          return p;
                        })}
                    />
                  </div>
                );
              })}
          </div>
        </RegistryBlock>

        <RegistryBlock
          title="Style blocks"
          onAdd={() =>
            patchDraft((p) => {
              const id = nanoid();
              p.style_blocks.push({ id, name: "Style", descriptor_block: "" });
              p.style_block_ids.push(id);
              return p;
            })}
        >
          <div className="space-y-3">
              {draft.style_block_ids.map((id) => {
                const s = styleById.get(id);
                if (!s) return null;
                return (
                  <div key={id} className="space-y-1 rounded-md border p-2">
                    <div className="flex gap-2">
                      <Input
                        className="h-8 flex-1"
                        value={s.name}
                        onChange={(e) =>
                          patchDraft((p) => {
                            const x = p.style_blocks.find((o) => o.id === id);
                            if (x) x.name = e.target.value;
                            return p;
                          })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive shrink-0"
                        onClick={() =>
                          patchDraft((p) => {
                            p.style_blocks = p.style_blocks.filter((o) => o.id !== id);
                            p.style_block_ids = p.style_block_ids.filter((x) => x !== id);
                            if (p.default_style_block_id === id) {
                              p.default_style_block_id = undefined;
                            }
                            for (const seg of p.segments) {
                              if (seg.style_block_id_override === id) {
                                seg.style_block_id_override = undefined;
                              }
                            }
                            return p;
                          })}
                      >
                        Remove
                      </Button>
                    </div>
                    <Textarea
                      rows={2}
                      className="text-xs"
                      value={s.descriptor_block}
                      onChange={(e) =>
                        patchDraft((p) => {
                          const x = p.style_blocks.find((o) => o.id === id);
                          if (x) x.descriptor_block = e.target.value;
                          return p;
                        })}
                    />
                  </div>
                );
              })}
          </div>
        </RegistryBlock>
      </CardContent>
      ) : null}
    </Card>
  );
}

function RegistryBlock({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">{title}</Label>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          Add
        </Button>
      </div>
      {children}
    </div>
  );
}
