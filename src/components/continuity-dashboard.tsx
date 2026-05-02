"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ActiveProfileSubtitle } from "@/components/active-profile-subtitle";
import { AppShell } from "@/components/app-shell";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildRegistryMaps,
  effectivePositivePrompt,
} from "@/lib/prompt-assembly/assemble";
import type { Project } from "@/lib/schemas/project";
import type { SegmentHealthFlags } from "@/lib/segment-render-fingerprint";
import { diffWords } from "@/lib/word-diff";
import { cn } from "@/lib/utils";

async function fetchProject(projectId: string): Promise<{
  project: Project;
  segmentRenderHealth: Record<string, SegmentHealthFlags>;
}> {
  const res = await fetch(`/api/projects/${projectId}`);
  if (!res.ok) throw new Error("Failed to load project");
  return res.json();
}

function truncateBeat(text: string, max = 96): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function assembledPromptForBoundary(
  seg: Project["segments"][number],
  project: Project,
  maps: ReturnType<typeof buildRegistryMaps>,
): string {
  const pub = seg.published_generation?.assembled_prompt?.trim();
  if (pub) return seg.published_generation!.assembled_prompt;
  return effectivePositivePrompt(seg, project, maps);
}

function Thumb({
  src,
  alt,
  label,
}: {
  src: string;
  alt: string;
  label: string;
}) {
  const [bad, setBad] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <div className="bg-muted relative aspect-video w-36 overflow-hidden rounded-md border">
        {bad ? (
          <div className="text-muted-foreground flex h-full items-center justify-center px-2 text-center text-[11px]">
            Missing file
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- binary thumbnail from API
          <img
            src={src}
            alt={alt}
            className="size-full object-cover"
            onError={() => setBad(true)}
          />
        )}
      </div>
    </div>
  );
}

export function ContinuityDashboard({ projectId }: { projectId: string }) {
  const [highlightPromptDiff, setHighlightPromptDiff] = useState(true);

  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const project = q.data?.project;
  const health = q.data?.segmentRenderHealth;

  const maps = useMemo(
    () => (project ? buildRegistryMaps(project) : null),
    [project],
  );

  const motionFlags = useMemo(() => {
    if (!project) return [];
    const rows: {
      boundaryLabel: string;
      motionOut: string;
      motionIn: string;
      mismatch: boolean;
    }[] = [];
    for (let i = 0; i < project.segments.length - 1; i++) {
      const prev = project.segments[i]!;
      const next = project.segments[i + 1]!;
      const motionOut = prev.motion_out?.trim() ?? "";
      const motionIn = next.motion_in?.trim() ?? "";
      const mismatch = motionOut !== "" && !motionIn.includes(motionOut);
      rows.push({
        boundaryLabel: `Clip ${i + 1} → ${i + 2}`,
        motionOut,
        motionIn,
        mismatch,
      });
    }
    return rows;
  }, [project]);

  const charactersWithSegments = useMemo(() => {
    if (!project) return [];
    return project.character_ids
      .map((id) => {
        const ch = project.characters.find((c) => c.id === id);
        if (!ch) return null;
        const indices: number[] = [];
        project.segments.forEach((s, ix) => {
          if (s.active_characters?.some((a) => a.character_id === id))
            indices.push(ix);
        });
        return { character: ch, indices };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [project]);

  if (q.isLoading) {
    return (
      <AppShell subtitle={<ActiveProfileSubtitle />}>
        <p className="text-muted-foreground text-sm">Loading continuity…</p>
      </AppShell>
    );
  }

  if (!project || !maps) {
    return (
      <AppShell subtitle={<ActiveProfileSubtitle />}>
        <p className="text-destructive text-sm">Project failed to load.</p>
      </AppShell>
    );
  }

  return (
    <AppShell subtitle={<ActiveProfileSubtitle />}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Continuity — {project.name}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
            Review seeds, last frames across cuts, assembled prompt deltas, motion handoffs, and where each
            character appears. Substring motion checks can flag minor wording edits; treat as hints only.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <Link href={`/project/${projectId}`} className="text-primary hover:underline">
              Back to composer
            </Link>
            <Link href={`/project/${projectId}/runs`} className="hover:underline">
              Snapshots
            </Link>
            <span className="font-mono text-xs">{projectId}</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Timeline</CardTitle>
            <CardDescription>
              Seed frame used at generation time vs canonical last frame after publish (when present).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Seed</th>
                  <th className="pb-2 pr-3 font-medium">Last frame</th>
                  <th className="pb-2 pr-3 font-medium">Beat</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {project.segments.map((seg, i) => {
                  const h = health?.[seg.id];
                  const stale =
                    h?.contentStale || h?.chainStale ? true : false;
                  const lfRel = `segment_outputs/${seg.id}/last_frame.png`;
                  const lfSrc = `/api/projects/${projectId}/file?rel=${encodeURIComponent(lfRel)}`;
                  const seedSrc = `/api/projects/${projectId}/clip-thumbnail?segmentIndex=${i}`;
                  return (
                    <tr key={seg.id} className="border-b align-top">
                      <td className="py-3 pr-3 font-mono text-xs">{i + 1}</td>
                      <td className="py-3 pr-3">
                        <Thumb src={seedSrc} alt="" label="Seed" />
                      </td>
                      <td className="py-3 pr-3">
                        <Thumb src={lfSrc} alt="" label="Published last frame" />
                      </td>
                      <td className="text-muted-foreground max-w-[240px] py-3 pr-3 text-xs leading-snug">
                        {truncateBeat(seg.beat ?? seg.prompt ?? "")}
                      </td>
                      <td className="py-3">
                        {stale ? (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">
                            Stale
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cut preview</CardTitle>
            <CardDescription>
              Previous clip last frame beside the next clip seed (same thumbnail sizes).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {project.segments.length < 2 ? (
              <p className="text-muted-foreground text-sm">Add a second clip to preview cuts.</p>
            ) : (
              project.segments.slice(0, -1).map((seg, i) => {
                const next = project.segments[i + 1]!;
                const prevLf = `/api/projects/${projectId}/file?rel=${encodeURIComponent(`segment_outputs/${seg.id}/last_frame.png`)}`;
                const nextSeed = `/api/projects/${projectId}/clip-thumbnail?segmentIndex=${i + 1}`;
                return (
                  <div
                    key={`cut-${seg.id}-${next.id}`}
                    className="flex flex-wrap items-end gap-6 border-b pb-6 last:border-0 last:pb-0"
                  >
                    <span className="text-muted-foreground w-full text-xs font-medium">
                      Cut after clip {i + 1}
                    </span>
                    <Thumb src={prevLf} alt="" label={`Clip ${i + 1} last frame`} />
                    <Thumb src={nextSeed} alt="" label={`Clip ${i + 2} seed`} />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Prompt delta across cuts</CardTitle>
              <CardDescription>
                Compares assembled prompts clip-to-clip (last successful Forge publish when available,
                otherwise live assembly).
              </CardDescription>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={highlightPromptDiff}
                onCheckedChange={(v) => setHighlightPromptDiff(v === true)}
              />
              Highlight word changes
            </label>
          </CardHeader>
          <CardContent className="space-y-6">
            {project.segments.length < 2 ? (
              <p className="text-muted-foreground text-sm">Need two clips for a boundary diff.</p>
            ) : (
              project.segments.slice(0, -1).map((seg, i) => {
                const next = project.segments[i + 1]!;
                const a = assembledPromptForBoundary(seg, project, maps);
                const b = assembledPromptForBoundary(next, project, maps);
                const parts = diffWords(a, b);
                return (
                  <div key={`diff-${seg.id}`} className="space-y-2 border-b pb-6 last:border-0 last:pb-0">
                    <div className="text-muted-foreground text-xs font-medium">
                      Boundary after clip {i + 1}
                    </div>
                    {highlightPromptDiff ? (
                      <p className="rounded-md border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                        {parts.map((p, ix) => (
                          <span
                            key={ix}
                            className={cn(
                              p.kind === "removed" && "bg-red-100 text-red-950 line-through decoration-red-900/40",
                              p.kind === "added" && "bg-emerald-100 text-emerald-950",
                            )}
                          >
                            {p.text}
                          </span>
                        ))}
                      </p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-md border p-3">
                          <Label className="text-[11px]">Clip {i + 1}</Label>
                          <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap">{a}</p>
                        </div>
                        <div className="rounded-md border p-3">
                          <Label className="text-[11px]">Clip {i + 2}</Label>
                          <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap">{b}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Character strip</CardTitle>
            <CardDescription>
              Seed thumbnail per clip where the character is marked active (ordered registries).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {charactersWithSegments.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No characters in project order list — add characters in composer registries.
              </p>
            ) : (
              charactersWithSegments.map(({ character, indices }) => (
                <div key={character.id}>
                  <div className="mb-2 text-sm font-medium">{character.name}</div>
                  {indices.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Not active on any clip.</p>
                  ) : (
                    <ScrollArea className="w-full pb-2">
                      <div className="flex gap-4 pb-1">
                        {indices.map((ix) => (
                          <Thumb
                            key={`${character.id}-${ix}`}
                            src={`/api/projects/${projectId}/clip-thumbnail?segmentIndex=${ix}`}
                            alt=""
                            label={`Clip ${ix + 1}`}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Motion handoff</CardTitle>
            <CardDescription>
              Flags when clip N declares motion out but clip N+1 motion in omits that exact substring.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {motionFlags.length === 0 ? (
              <p className="text-muted-foreground text-sm">Single-clip project.</p>
            ) : (
              motionFlags.map((row) => (
                <div
                  key={row.boundaryLabel}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{row.boundaryLabel}</span>
                    {row.mismatch ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-950">
                        Motion mismatch hint
                      </span>
                    ) : row.motionOut !== "" ? (
                      <span className="text-muted-foreground text-xs">Substring OK or empty target</span>
                    ) : null}
                  </div>
                  <dl className="text-muted-foreground mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground">Motion out (prior)</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap">
                        {row.motionOut || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Motion in (next)</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap">
                        {row.motionIn || "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
