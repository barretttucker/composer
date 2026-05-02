"use client";

import { useMemo } from "react";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ForgeCatalog } from "@/lib/forge/types";
import { vaeDisplayLabel, vaeOptionValue } from "@/lib/forge/types";
import { suggestWanCheckpointPair } from "@/lib/forge/wan-pair";
import {
  WAN_DEFAULT_TEXT_ENCODER_FILENAME,
  WAN_DEFAULT_VAE_FILENAME,
} from "@/lib/wan-forge-modules";
import { PromptRegistryPanel } from "@/components/prompt-registry-panel";
import {
  applyAutoDimensions,
  effectiveResolution,
} from "@/lib/project-resolution";
import { framesForClipSeconds } from "@/lib/video-time";
import {
  DEFAULT_GENERATION_SEED,
  type Project,
  type ResolutionSettings,
} from "@/lib/schemas/project";
import type { WanBucket } from "@/lib/wan-resolution";
import { aspectUsesPortraitFrame } from "@/lib/wan-resolution";

export type ForgeCatalogPayload = {
  catalog: ForgeCatalog;
  options?: unknown;
};

export type ForgeUpscalersPayload = {
  upscalers: string[];
};

export function ProjectSetupPanel({
  draft,
  patchDraft,
  res,
  forgeCatalogQuery,
  refreshForgeCatalogMutation,
  forgeUpscalersQuery,
  refreshForgeUpscalersMutation,
  forgePickersReady,
  checkpointItems,
  vaeItems,
  textEncoderItems,
  samplerItems,
  schedulerItems,
  savedSetupSummary,
  hasSavedSetupDefaults,
  onSaveSetupDefaults,
  onApplySetupDefaults,
  saveSetupDefaultsPending,
  applySetupDefaultsPending,
}: {
  draft: Project;
  patchDraft: (updater: (p: Project) => Project) => void;
  res: ResolutionSettings;
  forgeCatalogQuery: UseQueryResult<ForgeCatalogPayload, Error>;
  refreshForgeCatalogMutation: UseMutationResult<
    ForgeCatalogPayload,
    Error,
    void,
    unknown
  >;
  forgeUpscalersQuery: UseQueryResult<ForgeUpscalersPayload, Error>;
  refreshForgeUpscalersMutation: UseMutationResult<
    ForgeUpscalersPayload,
    Error,
    void,
    unknown
  >;
  forgePickersReady: boolean;
  checkpointItems: { value: string; label: string }[];
  vaeItems: { value: string; label: string }[];
  textEncoderItems: { value: string; label: string }[];
  samplerItems: { value: string; label: string }[];
  schedulerItems: { value: string; label: string }[];
  savedSetupSummary: string | null;
  hasSavedSetupDefaults: boolean;
  onSaveSetupDefaults: () => void;
  onApplySetupDefaults: () => void;
  saveSetupDefaultsPending: boolean;
  applySetupDefaultsPending: boolean;
}) {
  const defaults = draft.defaults;
  const chaining = draft.chaining;
  const fpsRounded = Math.max(1, Math.round(chaining.fps));

  const upscalerItems = useMemo(
    () =>
      (forgeUpscalersQuery.data?.upscalers ?? []).map((n) => ({
        value: n,
        label: n,
      })),
    [forgeUpscalersQuery.data?.upscalers],
  );

  return (
    <Tabs defaultValue="canvas" className="flex flex-col gap-0">
      <TabsList
        variant="line"
        className="bg-background sticky top-0 z-10 mb-5 grid h-auto w-full grid-cols-3 gap-1 rounded-none border-0 border-b border-border p-0 pb-3 shadow-none"
      >
        <TabsTrigger value="canvas" className="flex-1 px-1.5 py-2 text-xs sm:px-2 sm:text-sm">
          Canvas &amp; chain
        </TabsTrigger>
        <TabsTrigger value="continuity" className="flex-1 px-1.5 py-2 text-xs sm:px-2 sm:text-sm">
          Continuity
        </TabsTrigger>
        <TabsTrigger value="forge" className="flex-1 px-1.5 py-2 text-xs sm:px-2 sm:text-sm">
          Forge defaults
        </TabsTrigger>
      </TabsList>

      <TabsContent value="canvas" className="mt-0 space-y-5 outline-none">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">WAN 2.2 output size</CardTitle>
          <CardDescription>
            Forge uses horizontal width and vertical height in pixels ({`width × height`}). Auto mode
            matches your start-frame aspect (including JPEG orientation) to the WAN table buckets.
            Higher buckets demand more VRAM (720p hardest except 1:1).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Sizing mode</Label>
            <Select
              value={res.mode}
              onValueChange={(mode) =>
                patchDraft((p) => {
                  p.resolution = {
                    ...effectiveResolution(p),
                    mode: mode as "auto" | "custom",
                  };
                  return applyAutoDimensions(p);
                })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (WAN table)</SelectItem>
                <SelectItem value="custom">Custom width / height</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quality bucket</Label>
            <Select
              value={res.bucket}
              disabled={res.mode === "custom"}
              onValueChange={(bucket) =>
                patchDraft((p) => {
                  p.resolution = {
                    ...effectiveResolution(p),
                    bucket: bucket as WanBucket,
                  };
                  return applyAutoDimensions(p);
                })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Bucket" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p (recommended)</SelectItem>
                <SelectItem value="576p">576p</SelectItem>
                <SelectItem value="720p">720p (VRAM-heavy)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {res.detected_aspect ? (
            <div className="text-xs leading-snug">
              <span className="text-muted-foreground">Aspect from start frame:</span>{" "}
              <span className="font-mono">{res.detected_aspect}</span>
              {aspectUsesPortraitFrame(res.detected_aspect) ? (
                <>
                  {" "}
                  <span className="text-muted-foreground">
                    (portrait layout: taller than wide)
                  </span>
                </>
              ) : res.detected_aspect === "1:1" ? (
                <>
                  {" "}
                  <span className="text-muted-foreground">(square)</span>
                </>
              ) : (
                <>
                  {" "}
                  <span className="text-muted-foreground">
                    (landscape layout: wider than tall)
                  </span>
                </>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Upload a start frame to detect aspect (required for auto sizing).
            </p>
          )}
          {res.mode === "auto" ? (
            <div className="space-y-0.5">
              <p className="text-muted-foreground text-[11px]">
                WAN output pixels: horizontal × vertical — how Forge renders the canvas.
              </p>
              <div className="bg-muted/40 rounded-md border px-2 py-1.5 font-mono text-sm">
                {defaults.width} px wide × {defaults.height} px tall
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="Width (horizontal px)"
                value={defaults.width}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.width = v;
                    return p;
                  })}
              />
              <NumField
                label="Height (vertical px)"
                value={defaults.height}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.height = v;
                    return p;
                  })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Chaining</CardTitle>
          <CardDescription>
            Frame offset: negative counts from end of clip (-1 = last frame). FPS ties clip length to
            latent frame counts on the Forge defaults tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <NumField
            label="Frame offset"
            value={chaining.frame_offset}
            onChange={(v) =>
              patchDraft((p) => {
                p.chaining.frame_offset = v;
                return p;
              })}
          />
          <NumField
            label="FPS"
            value={chaining.fps}
            onChange={(v) =>
              patchDraft((p) => {
                p.chaining.fps = v;
                const f = Math.max(1, Math.round(v));
                p.defaults.frames = framesForClipSeconds(p.defaults.clip_duration_seconds, f);
                return p;
              })}
          />
          <NumField
            label="Blend frames (future)"
            value={chaining.blend_frames}
            onChange={(v) =>
              patchDraft((p) => {
                p.chaining.blend_frames = v;
                return p;
              })}
          />
        </CardContent>
      </Card>

      <details className="bg-card rounded-xl border shadow-sm">
        <summary className="hover:bg-muted/30 [&::-webkit-details-marker]:hidden cursor-pointer list-none px-6 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-base font-semibold tracking-tight">Chain hygiene</span>
            <span
              className="text-muted-foreground max-w-[560px] text-xs leading-snug"
              title="Reduces compounded softness when each clip seeds the next from an H.264 frame. Uses an earlier frame as uncompressed PNG and optionally Forge upscaler ×2 plus Lanczos downscale—WAN checkpoints stay loaded."
            >
              Default off for 1–3 clips; often worth enabling for longer chains (4+ segments).
            </span>
          </div>
        </summary>
        <div className="border-border space-y-4 border-t px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={defaults.chain_hygiene.enabled}
                onCheckedChange={(checked) =>
                  patchDraft((p) => {
                    p.defaults.chain_hygiene.enabled = checked;
                    return p;
                  })
                }
              />
              <Label className="text-sm font-normal">Enable between chained clips</Label>
            </div>
          </div>
          <NumField
            label="Hygiene frame offset (−1 … −10)"
            value={defaults.chain_hygiene.frame_offset}
            onChange={(v) =>
              patchDraft((p) => {
                const x = Math.round(Number(v));
                p.defaults.chain_hygiene.frame_offset = Math.min(-1, Math.max(-10, x));
                return p;
              })}
          />
          <p className="text-muted-foreground text-[11px] leading-snug">
            Extract frame at{" "}
            <span className="font-mono">total_frames + offset</span> into uncompressed PNG.
            Recommended <span className="font-mono">−3</span> (avoid the weakest final WAN frame).
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={defaults.chain_hygiene.sharpen}
                onCheckedChange={(checked) =>
                  patchDraft((p) => {
                    p.defaults.chain_hygiene.sharpen = checked;
                    return p;
                  })
                }
              />
              <Label className="text-sm font-normal">
                Sharpen (Forge upscale ×2, Lanczos downscale)
              </Label>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-[220px] flex-1">
              <CatalogPickRow
                label="Upscaler (Forge)"
                value={defaults.chain_hygiene.upscaler}
                items={upscalerItems}
                disabled={
                  !defaults.chain_hygiene.sharpen ||
                  (forgeUpscalersQuery.isLoading && upscalerItems.length === 0)
                }
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.chain_hygiene.upscaler = v;
                    return p;
                  })
                }
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                refreshForgeUpscalersMutation.isPending || forgeUpscalersQuery.isFetching
              }
              onClick={() => {
                void refreshForgeUpscalersMutation.mutateAsync();
              }}
            >
              {refreshForgeUpscalersMutation.isPending || forgeUpscalersQuery.isFetching
                ? "Loading…"
                : "Reload upscaler list"}
            </Button>
          </div>
          {forgeUpscalersQuery.isError ? (
            <p className="text-destructive text-xs leading-snug">
              Could not load Forge upscalers:{" "}
              {forgeUpscalersQuery.error instanceof Error
                ? forgeUpscalersQuery.error.message
                : String(forgeUpscalersQuery.error)}
            </p>
          ) : null}
        </div>
      </details>

      </TabsContent>

      <TabsContent value="continuity" className="mt-0 space-y-5 outline-none">
        <PromptRegistryPanel
          draft={draft}
          patchDraft={patchDraft}
          defaultCollapsed={false}
        />
      </TabsContent>

      <TabsContent value="forge" className="mt-0 space-y-5 outline-none">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Generation defaults</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Applied per clip unless overridden.{" "}
            <span className="font-medium">Save project + default template</span> stores these for new
            projects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-muted/30 space-y-2 rounded-md border border-dashed px-3 py-2.5">
            <Label className="text-xs font-medium">Remembered default setup</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saveSetupDefaultsPending}
                onClick={onSaveSetupDefaults}
              >
                {saveSetupDefaultsPending ? "Saving…" : "Save project + default template"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasSavedSetupDefaults || applySetupDefaultsPending}
                onClick={onApplySetupDefaults}
              >
                {applySetupDefaultsPending ? "Applying…" : "Apply saved defaults here"}
              </Button>
            </div>
            {savedSetupSummary ? (
              <p className="text-muted-foreground text-xs leading-snug">
                Last saved {savedSetupSummary}. Creates from the home screen use these values unless
                you change them later.
              </p>
            ) : (
              <p className="text-muted-foreground text-xs leading-snug">
                No template file yet. Use the button above to save this project and store a reusable
                default for new projects.
              </p>
            )}
          </div>
          {forgeCatalogQuery.isError ? (
            <p className="text-destructive text-xs leading-snug">
              Could not load Forge lists:{" "}
              {forgeCatalogQuery.error instanceof Error
                ? forgeCatalogQuery.error.message
                : String(forgeCatalogQuery.error)}
              . Check the active profile base URL and that Forge is running. Use free-text fields
              below until the catalog loads.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                refreshForgeCatalogMutation.isPending || forgeCatalogQuery.isFetching
              }
              onClick={() => {
                if (forgeCatalogQuery.data) {
                  refreshForgeCatalogMutation.mutate();
                } else {
                  void forgeCatalogQuery.refetch();
                }
              }}
            >
              {refreshForgeCatalogMutation.isPending || forgeCatalogQuery.isFetching
                ? "Loading Forge…"
                : "Rescan Forge lists"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!forgeCatalogQuery.data?.catalog?.checkpoints?.length}
              onClick={() => {
                const catalog = forgeCatalogQuery.data?.catalog;
                if (!catalog) return;
                const { high, low } = suggestWanCheckpointPair(catalog.checkpoints);
                patchDraft((p) => {
                  if (high) p.defaults.checkpoint_high = high;
                  if (low) p.defaults.checkpoint_low = low;
                  const wanVae =
                    catalog.vaes.find((v) =>
                      /wan.*vae|wan_?2[\._]?1.*vae/i.test(vaeDisplayLabel(v)),
                    ) ?? null;
                  p.defaults.vae = wanVae
                    ? vaeOptionValue(wanVae)
                    : WAN_DEFAULT_VAE_FILENAME;
                  p.defaults.text_encoder = WAN_DEFAULT_TEXT_ENCODER_FILENAME;
                  return p;
                });
              }}
            >
              Guess WAN checkpoints / VAE / text encoder
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Default clip length</Label>
              <Select
                value={String(defaults.clip_duration_seconds)}
                onValueChange={(v) => {
                  const sec = Number(v);
                  patchDraft((p) => {
                    const f = Math.max(1, Math.round(p.chaining.fps));
                    p.defaults.clip_duration_seconds = sec;
                    p.defaults.frames = framesForClipSeconds(sec, f);
                    return p;
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seconds" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground leading-snug text-xs">
                Sends {defaults.frames} latent frames ({defaults.clip_duration_seconds} s ×{" "}
                {fpsRounded} fps + 1).
              </p>
            </div>
            <NumField
              label="Steps"
              value={defaults.steps}
              onChange={(v) =>
                patchDraft((p) => {
                  p.defaults.steps = v;
                  return p;
                })}
            />
          </div>
          {forgePickersReady ? (
            <>
              <CatalogPickRow
                label="Checkpoint (high)"
                value={defaults.checkpoint_high}
                items={checkpointItems}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.checkpoint_high = v;
                    return p;
                  })}
              />
              <CatalogPickRow
                label="Checkpoint (low / refiner)"
                value={defaults.checkpoint_low}
                items={checkpointItems}
                allowEmpty
                emptyLabel="(none)"
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.checkpoint_low = v;
                    return p;
                  })}
              />
              <CatalogPickRow
                label="VAE"
                value={defaults.vae}
                items={vaeItems}
                allowEmpty
                emptyLabel="(Forge default)"
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.vae = v;
                    return p;
                  })}
              />
              <CatalogPickRow
                label="Text encoder module"
                value={defaults.text_encoder}
                items={textEncoderItems}
                allowEmpty
                emptyLabel="(Forge default)"
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.text_encoder = v;
                    return p;
                  })}
              />
            </>
          ) : (
            <>
              <TextField
                label="Checkpoint (high)"
                value={defaults.checkpoint_high}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.checkpoint_high = v;
                    return p;
                  })}
              />
              <TextField
                label="Checkpoint (low / refiner)"
                value={defaults.checkpoint_low}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.checkpoint_low = v;
                    return p;
                  })}
              />
              <TextField
                label="VAE"
                value={defaults.vae}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.vae = v;
                    return p;
                  })}
              />
              <TextField
                label="Text encoder module"
                value={defaults.text_encoder}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.text_encoder = v;
                    return p;
                  })}
              />
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="CFG"
              value={defaults.cfg_scale}
              onChange={(v) =>
                patchDraft((p) => {
                  p.defaults.cfg_scale = v;
                  return p;
                })}
            />
            <NumField
              label="Denoise"
              value={defaults.denoising_strength}
              onChange={(v) =>
                patchDraft((p) => {
                  p.defaults.denoising_strength = v;
                  return p;
                })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Shift"
              value={defaults.shift}
              onChange={(v) =>
                patchDraft((p) => {
                  p.defaults.shift = v;
                  return p;
                })}
            />
            <NumField
              label="Refiner switch"
              value={defaults.refiner_switch_at}
              onChange={(v) =>
                patchDraft((p) => {
                  p.defaults.refiner_switch_at = v;
                  return p;
                })}
            />
          </div>
          {forgePickersReady ? (
            <>
              <CatalogPickRow
                label="Sampler"
                value={defaults.sampler}
                items={samplerItems}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.sampler = v;
                    return p;
                  })}
              />
              <CatalogPickRow
                label="Scheduler"
                value={defaults.scheduler}
                items={schedulerItems}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.scheduler = v;
                    return p;
                  })}
              />
            </>
          ) : (
            <>
              <TextField
                label="Sampler"
                value={defaults.sampler}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.sampler = v;
                    return p;
                  })}
              />
              <TextField
                label="Scheduler"
                value={defaults.scheduler}
                onChange={(v) =>
                  patchDraft((p) => {
                    p.defaults.scheduler = v;
                    return p;
                  })}
              />
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Seed</Label>
            <Input
              className="font-mono text-xs"
              type="number"
              value={Number.isFinite(defaults.seed) ? defaults.seed : DEFAULT_GENERATION_SEED}
              onChange={(e) =>
                patchDraft((p) => {
                  p.defaults.seed = Number(e.target.value);
                  return p;
                })}
            />
            <p className="text-muted-foreground leading-snug text-xs">
              Default is {DEFAULT_GENERATION_SEED}. Use <span className="font-mono">-1</span> for a
              random seed each generation (Forge).
            </p>
          </div>
        </CardContent>
      </Card>
      </TabsContent>
    </Tabs>
  );
}

function CatalogPickRow({
  label,
  value,
  items,
  onChange,
  allowEmpty,
  emptyLabel,
  disabled,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const NONE = "__composer_none__";
  const merged = useMemo(() => {
    const seen = new Map(items.map((i) => [i.value, i]));
    if (value && !seen.has(value)) {
      return [{ value, label: value }, ...items];
    }
    return items;
  }, [items, value]);

  const selectValue = allowEmpty && !value ? NONE : value || NONE;

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        disabled={disabled}
        value={selectValue}
        onValueChange={(v) => onChange(!v || v === NONE ? "" : v)}
      >
        <SelectTrigger className="w-full font-mono text-xs">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent className="max-h-[min(70vh,320px)] overflow-y-auto">
          {allowEmpty ? (
            <SelectItem value={NONE}>{emptyLabel ?? "(none)"}</SelectItem>
          ) : null}
          {merged.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="block font-mono text-xs" title={opt.label}>
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="font-mono text-xs"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        className="font-mono text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
