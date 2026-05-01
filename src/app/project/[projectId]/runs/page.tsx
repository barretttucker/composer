"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ActiveProfileSubtitle } from "@/components/active-profile-subtitle";
import { Badge } from "@/components/ui/badge";
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
import type { RunRecord } from "@/lib/schemas/run";

export default function RunHistoryPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const qc = useQueryClient();
  const [keepLatestUnpinned, setKeepLatestUnpinned] = useState(8);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("load project");
      return res.json() as Promise<{ project: { name: string } }>;
    },
  });

  const runsQuery = useQuery({
    queryKey: ["runs", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runs`);
      if (!res.ok) throw new Error("runs");
      return res.json() as Promise<{ runs: RunRecord[] }>;
    },
  });

  const replayMutation = useMutation({
    mutationFn: async (seedDelta: number) => {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seed_delta: seedDelta,
          pause_mode: false,
          from_segment_index: 0,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "replay failed");
      }
      return res.json() as Promise<{ runId: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
      router.push(`/project/${projectId}`);
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (input: { runId: string; pinned: boolean }) => {
      const res = await fetch(`/api/projects/${projectId}/runs/${input.runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: input.pinned }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Pin update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
    },
  });

  const pruneMutation = useMutation({
    mutationFn: async (keep: number) => {
      const res = await fetch(`/api/projects/${projectId}/runs/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep_latest_unpinned: keep }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Prune failed");
      }
      return res.json() as Promise<{ deleted: string[] }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", projectId] });
    },
  });

  return (
    <AppShell subtitle={<ActiveProfileSubtitle />}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Snapshots · {projectQuery.data?.project.name ?? projectId}
          </h1>
          <Link href={`/project/${projectId}`} className="text-muted-foreground text-sm hover:underline">
            Back to composer
          </Link>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Disk housekeeping</CardTitle>
          <CardDescription>
            Pin runs you might compare or revert to. Pruning deletes oldest unpinned snapshots (never a
            running or paused job); canonical clips stay under{" "}
            <span className="font-mono">segment_outputs/</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="keep-unpinned">Keep latest unpinned snapshots</Label>
            <Input
              id="keep-unpinned"
              type="number"
              min={0}
              className="w-36 font-mono"
              value={keepLatestUnpinned}
              onChange={(e) =>
                setKeepLatestUnpinned(Math.max(0, Math.floor(Number(e.target.value)) || 0))
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pruneMutation.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Delete oldest unpinned runs, keeping the ${keepLatestUnpinned} most recent unpinned snapshots (pinned runs are never deleted)?`,
                )
              ) {
                return;
              }
              pruneMutation.mutate(keepLatestUnpinned);
            }}
          >
            Prune old snapshots
          </Button>
          {pruneMutation.isSuccess ? (
            <span className="text-muted-foreground font-mono text-xs">
              Removed {pruneMutation.data.deleted.length} run(s).
            </span>
          ) : null}
        </CardContent>
      </Card>

      {runsQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading snapshots…</p>
      ) : (
        <div className="space-y-4">
          {(runsQuery.data?.runs ?? []).map((run) => (
            <Card key={run.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="font-mono text-base">{run.id}</CardTitle>
                  {run.pinned ? (
                    <Badge variant="secondary">Pinned</Badge>
                  ) : null}
                  <CardDescription className="basis-full">
                    {run.created_at} · {run.status} · Forge {run.forge_base_url}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pinMutation.isPending}
                    onClick={() =>
                      pinMutation.mutate({ runId: run.id, pinned: !run.pinned })
                    }
                  >
                    {run.pinned ? "Unpin" : "Pin"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => replayMutation.mutate(0)}
                  >
                    Replay (same seeds)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => replayMutation.mutate(1)}
                  >
                    Variation (+1 seed delta)
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-muted-foreground font-mono text-xs">
                Segments:{" "}
                {run.segment_states
                  .map((s) => `${s.index}:${s.status}`)
                  .join(", ")}
                {run.final_mp4_rel ? ` · final: ${run.final_mp4_rel}` : ""}
              </CardContent>
            </Card>
          ))}
          {(runsQuery.data?.runs ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">No snapshots yet.</p>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
