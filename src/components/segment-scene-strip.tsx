"use client";

import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  segmentChainSourceIndex,
  segmentUsesChainInit,
  type Project,
  type Segment,
} from "@/lib/schemas/project";
import type { SegmentHealthFlags } from "@/lib/segment-render-fingerprint";
import { cn } from "@/lib/utils";
import {
  ArrowDownFromLine,
  ChevronRight,
  Clapperboard,
  CornerLeftUp,
  Plus,
  Trash2,
} from "lucide-react";

type SegmentSceneStripProps = {
  projectId: string;
  clipPreviewNonce: number;
  project: Pick<Project, "segments">;
  segmentHealth?: Record<string, SegmentHealthFlags>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  addDisabled?: boolean;
  fps: number;
  defaultClipSeconds: number;
  onRequestUploadClip: (segmentIndex: number) => void;
  /** Clips after the first: revert to chaining from prior segment's last frame. */
  onRequestExtendFromPrevious: (segmentId: string) => void;
  extendBusy?: boolean;
  uploadBusy?: boolean;
  /** Removes clip from server timeline (persisted immediately). */
  onRemoveSegment?: (segmentId: string) => void;
  removeDisabled?: boolean;
  /** When true the strip auto-scrolls to keep `selectedId` in view. */
  autoCenterSelected?: boolean;
};

const CARD_WIDTH = 248; // 15.5rem -> px (kept in sync with className)

function chainSourceLabel(
  segments: Segment[],
  index: number,
  chainSourceIdx: number | null,
  source: Segment["seed_frame_source"],
): string | null {
  if (index === 0) return "Start frame";
  if (source === "fresh") return "Fresh";
  if (source === "touched_up") return "Touched-up";
  if (source === "chained_from" && chainSourceIdx != null) {
    return `From clip ${chainSourceIdx + 1}`;
  }
  if (chainSourceIdx === index - 1) return null; // implied by adjacency arrow
  return null;
}

export function SegmentSceneStrip({
  projectId,
  clipPreviewNonce,
  project,
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
  onRemoveSegment,
  removeDisabled,
  autoCenterSelected,
}: SegmentSceneStripProps) {
  const f = Math.max(1, Math.round(fps));
  const segments = project.segments;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!autoCenterSelected || !selectedId) return;
    const el = cardRefs.current[selectedId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [autoCenterSelected, selectedId]);

  return (
    <div className="bg-background/90 supports-[backdrop-filter]:bg-background/70 border-b backdrop-blur">
      <div
        ref={scrollerRef}
        className="flex items-stretch gap-1 overflow-x-auto px-3 py-3 [scrollbar-gutter:stable]"
      >
        {segments.map((seg, i) => {
          const sec = seg.duration_seconds ?? defaultClipSeconds;
          const active = selectedId === seg.id;
          const chain = segmentUsesChainInit(seg, i);
          const sourceIdx = segmentChainSourceIndex(project, i);
          const sourceLabel = chainSourceLabel(segments, i, sourceIdx, seg.seed_frame_source);
          const health = segmentHealth?.[seg.id];
          const thumbSrc = `/api/projects/${encodeURIComponent(projectId)}/clip-thumbnail?segmentIndex=${i}&v=${encodeURIComponent(String(clipPreviewNonce))}`;

          // Inter-card arrow shown to the LEFT of cards i >= 1 to indicate chain link.
          const showPrevArrow = i > 0 && chain && sourceIdx === i - 1;
          const showSkipArrow =
            i > 0 && chain && sourceIdx != null && sourceIdx !== i - 1;
          const showFreshGap = i > 0 && !chain;

          return (
            <div key={seg.id} className="flex items-stretch">
              {i > 0 ? (
                <div
                  aria-hidden
                  className={cn(
                    "flex w-5 flex-col items-center justify-center text-[10px] font-medium leading-none",
                    showPrevArrow && "text-muted-foreground",
                    showSkipArrow && "text-sky-700",
                    showFreshGap && "text-muted-foreground/40",
                  )}
                  title={
                    showPrevArrow
                      ? "Chains from previous clip"
                      : showSkipArrow
                        ? `Chains from clip ${(sourceIdx ?? 0) + 1}`
                        : "Chain break (fresh seed)"
                  }
                >
                  {showFreshGap ? (
                    <span className="block h-px w-3 bg-current" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </div>
              ) : null}

              <div
                ref={(el) => {
                  cardRefs.current[seg.id] = el;
                }}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(seg.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onSelect(seg.id);
                  }
                }}
                style={{ width: CARD_WIDTH }}
                className={cn(
                  "shrink-0 cursor-pointer rounded-lg border bg-background shadow-sm transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                  "hover:border-primary/45 hover:shadow",
                  active &&
                    "border-primary ring-primary/40 ring-2 ring-offset-2 ring-offset-background",
                )}
              >
                <div className="bg-muted relative aspect-video w-full overflow-hidden rounded-t-[7px]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- API-served thumbnails */}
                  <img
                    alt=""
                    src={thumbSrc}
                    className="h-full w-full object-contain object-center"
                    loading="lazy"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-3">
                    <div className="flex items-center justify-between gap-1 text-[10px] leading-none font-medium tracking-tight text-white drop-shadow-xs">
                      <div className="flex min-w-0 items-center gap-1">
                        <Clapperboard className="size-3 shrink-0 opacity-95" aria-hidden />
                        <span className="truncate">
                          {i === 0 ? "Start frame" : `Clip ${i + 1}`}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums opacity-90">{sec}s</span>
                    </div>
                  </div>
                  {(health?.contentStale || health?.chainStale) && (
                    <div className="pointer-events-none absolute top-1 left-1 flex flex-wrap gap-1">
                      {health.contentStale ? (
                        <Badge
                          variant="outline"
                          className="border-amber-700/80 bg-black/55 text-[10px] text-amber-50"
                        >
                          Stale
                        </Badge>
                      ) : null}
                      {health.chainStale ? (
                        <Badge
                          variant="outline"
                          className="border-sky-700/80 bg-black/55 text-[10px] text-sky-50"
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
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 font-mono text-[10px] tabular-nums">
                  <span className="text-muted-foreground">{sec * f + 1}f</span>
                  {sourceLabel ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-sans text-[10px] font-medium tracking-tight",
                        seg.seed_frame_source === "chained_from"
                          ? "bg-sky-100 text-sky-900"
                          : seg.seed_frame_source === "fresh"
                            ? "bg-amber-100 text-amber-900"
                            : seg.seed_frame_source === "touched_up"
                              ? "bg-violet-100 text-violet-900"
                              : "text-muted-foreground bg-muted",
                      )}
                    >
                      {seg.seed_frame_source === "chained_from" ? (
                        <CornerLeftUp className="size-3" aria-hidden />
                      ) : null}
                      {sourceLabel}
                    </span>
                  ) : null}
                  {onRemoveSegment ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive ml-auto size-6 shrink-0"
                      title="Remove this clip"
                      aria-label={`Remove clip ${i + 1}`}
                      disabled={removeDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSegment(seg.id);
                      }}
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        <div className="flex items-stretch">
          <div className="flex w-5 items-center justify-center" aria-hidden>
            {segments.length > 0 ? (
              <ChevronRight className="text-muted-foreground/50 size-4" />
            ) : null}
          </div>
          <button
            type="button"
            onClick={onAdd}
            disabled={addDisabled}
            style={{ width: CARD_WIDTH }}
            className={cn(
              "border-muted-foreground/30 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground flex shrink-0 items-center justify-center rounded-lg border-2 border-dashed shadow-sm transition",
              "min-h-[7rem] py-6 text-sm font-medium",
              addDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Plus className="mr-1.5 size-4" aria-hidden />
            Add clip
          </button>
        </div>

        {segments.length === 0 ? (
          <p className="text-muted-foreground self-center px-3 text-sm">
            Add clips to build your scene.
          </p>
        ) : null}
      </div>
    </div>
  );
}
