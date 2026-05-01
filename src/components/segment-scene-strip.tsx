"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Segment } from "@/lib/schemas/project";
import type { SegmentHealthFlags } from "@/lib/segment-render-fingerprint";
import { segmentUsesChainInit } from "@/lib/schemas/project";
import { cn } from "@/lib/utils";
import { ArrowDownFromLine, Clapperboard, Plus } from "lucide-react";

type SegmentSceneStripProps = {
  projectId: string;
  clipPreviewNonce: number;
  segments: Segment[];
  segmentHealth?: Record<string, SegmentHealthFlags>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  addDisabled?: boolean;
  fps: number;
  defaultClipSeconds: number;
  onRequestUploadClip: (segmentIndex: number) => void;
  /** Clips after the first: revert to chaining from prior segment’s last frame. */
  onRequestExtendFromPrevious: (segmentId: string) => void;
  extendBusy?: boolean;
  uploadBusy?: boolean;
};

export function SegmentSceneStrip({
  projectId,
  clipPreviewNonce,
  segments,
  segmentHealth,
  selectedId,
  onSelect,
  onAdd,
  addDisabled,
  fps,
  defaultClipSeconds,
  onRequestUploadClip,
  onRequestExtendFromPrevious,
  extendBusy,
  uploadBusy,
}: SegmentSceneStripProps) {
  const f = Math.max(1, Math.round(fps));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium leading-tight">Scene</h2>
          <p className="text-muted-foreground text-xs">
            Clips play left to right. Use + on a clip for its start image (clip 1 = project start
            frame); later clips default to chaining from the previous render. Latest renders are also
            mirrored under <span className="font-mono">segment_outputs/</span> as the canonical scene
            timeline.
          </p>
        </div>
        <Button size="sm" type="button" variant="secondary" disabled={addDisabled} onClick={onAdd}>
          <Plus className="mr-1.5 size-4" aria-hidden />
          Add clip
        </Button>
      </div>

      <div className="bg-muted/25 rounded-xl border">
        <div className="flex gap-3 overflow-x-auto p-3 [scrollbar-gutter:stable]">
          {segments.map((seg, i) => {
            const sec = seg.duration_seconds ?? defaultClipSeconds;
            const active = selectedId === seg.id;
            const chain = segmentUsesChainInit(seg, i);
            const health = segmentHealth?.[seg.id];
            const thumbSrc = `/api/projects/${encodeURIComponent(projectId)}/clip-thumbnail?segmentIndex=${i}&v=${encodeURIComponent(String(clipPreviewNonce))}`;
            return (
              <div
                key={seg.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(seg.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onSelect(seg.id);
                  }
                }}
                className={cn(
                  "w-[15.5rem] shrink-0 cursor-pointer rounded-lg border bg-background shadow-sm transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                  "hover:border-primary/45 hover:shadow",
                  active &&
                    "border-primary/50 ring-primary/30 ring-2 ring-offset-2 ring-offset-background",
                )}
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-t-[7px] bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- API-served thumbnails */}
                  <img
                    alt=""
                    src={thumbSrc}
                    className="h-full w-full object-contain object-center"
                    loading="lazy"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1 pb-8 pt-4">
                    <div className="flex items-center gap-1 text-[10px] leading-none font-medium tracking-tight text-white drop-shadow-xs">
                      <Clapperboard className="size-3 shrink-0 opacity-95" aria-hidden />
                      <span className="truncate">{i === 0 ? "Start frame" : `Clip ${i + 1}`}</span>
                    </div>
                  </div>
                  {(health?.contentStale || health?.chainStale) && (
                    <div className="pointer-events-none absolute top-1 left-1 flex flex-wrap gap-1">
                      {health.contentStale ? (
                        <Badge
                          variant="outline"
                          className="border-amber-700/80 bg-black/50 text-[10px] text-amber-50"
                        >
                          Stale
                        </Badge>
                      ) : null}
                      {health.chainStale ? (
                        <Badge
                          variant="outline"
                          className="border-sky-700/80 bg-black/50 text-[10px] text-sky-50"
                        >
                          Chain
                        </Badge>
                      ) : null}
                    </div>
                  )}
                  <div className="absolute top-1 right-1 flex flex-col gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="pointer-events-auto size-7 border border-white/30 bg-black/55 text-white shadow backdrop-blur-sm hover:bg-black/65"
                      title={i === 0 ? "Set start-frame image for the project" : "Upload image for this clip"}
                      aria-label={
                        i === 0 ? "Upload start-frame image for the project" : "Upload image for this clip"
                      }
                      disabled={uploadBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestUploadClip(i);
                      }}
                    >
                      <Plus className="size-4" aria-hidden />
                    </Button>
                    {i > 0 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="pointer-events-auto size-7 border border-white/30 bg-black/55 text-white shadow backdrop-blur-sm hover:bg-black/65"
                        title={
                          chain
                            ? "Already extending from previous clip once rendered"
                            : "Extend from previous: use chained frame from prior clip"
                        }
                        aria-label="Extend from previous clip"
                        disabled={extendBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestExtendFromPrevious(seg.id);
                        }}
                      >
                        <ArrowDownFromLine className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-2 py-1.5 font-mono text-[10px] tabular-nums">
                  <span className="text-foreground">{sec}s</span>
                  <span className="text-muted-foreground">{sec * f + 1} f</span>
                </div>
                <div className="border-border/60 border-t px-2 pb-1.5">
                  <p className="text-muted-foreground text-[10px] leading-snug">
                    {i === 0
                      ? "First frame drives the timeline."
                      : chain
                        ? "Chains from prev last frame."
                        : "Uses your uploaded frame."}
                  </p>
                </div>
              </div>
            );
          })}
          {segments.length === 0 ? (
            <p className="text-muted-foreground px-1 py-6 text-sm">
              Add clips to build your scene. Each successful clip updates canonical outputs under{" "}
              <span className="font-mono">segment_outputs/</span> and keeps a full snapshot under{" "}
              <span className="font-mono">runs/</span> (pin or prune from Snapshots).
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
