"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import type { AssemblyAbVariant } from "@/lib/schemas/run";
import { cn } from "@/lib/utils";

export function AssemblyComparePanel({
  projectId,
  runId,
  segmentId,
  variants,
}: {
  projectId: string;
  runId: string;
  segmentId: string;
  variants: AssemblyAbVariant[];
}) {
  const qc = useQueryClient();
  const pickMutation = useMutation({
    mutationFn: async (variant: "a" | "b") => {
      const res = await fetch(
        `/api/projects/${projectId}/runs/${runId}/pick-assembly-variant`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segment_id: segmentId, variant }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Pick failed");
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      void qc.invalidateQueries({ queryKey: ["runs", projectId] });
    },
  });

  if (variants.length < 2) return null;

  return (
    <div className="border-border bg-card space-y-3 rounded-lg border p-4 shadow-sm">
      <h3 className="text-sm font-semibold">Assembly order comparison</h3>
      <p className="text-muted-foreground text-xs leading-snug">
        Two prompts were generated with the same seed. Pick one to publish to this clip and continue the
        chain. The other stays in the run folder for reference.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {variants.map((v) => (
          <div
            key={v.key}
            className="border-border flex flex-col gap-2 rounded-md border bg-white p-3"
          >
            <p className="text-xs font-medium">{v.label}</p>
            <video
              src={`/api/projects/${projectId}/file?${new URLSearchParams({
                rel: `runs/${runId}/${v.mp4_rel}`,
              }).toString()}`}
              controls
              className="bg-muted aspect-video w-full rounded-md"
            />
            <dl className="text-muted-foreground space-y-0.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt>Seed</dt>
                <dd className="font-mono">{v.seed_used ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Generation time</dt>
                <dd>
                  {v.generation_ms != null
                    ? `${(v.generation_ms / 1000).toFixed(1)}s`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Word count</dt>
                <dd>{v.word_count ?? "—"}</dd>
              </div>
            </dl>
            <Button
              type="button"
              size="sm"
              className="mt-auto"
              disabled={pickMutation.isPending}
              onClick={() => pickMutation.mutate(v.key)}
            >
              Pick this version
            </Button>
          </div>
        ))}
      </div>
      {pickMutation.isError ? (
        <p className={cn("text-destructive text-xs")}>
          {pickMutation.error instanceof Error
            ? pickMutation.error.message
            : String(pickMutation.error)}
        </p>
      ) : null}
    </div>
  );
}
