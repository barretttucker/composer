"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ActiveProfileSubtitle } from "@/components/active-profile-subtitle";
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

type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
  updated_at: string;
  segment_count: number;
};

export default function HomePage() {
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json() as Promise<{ projects: ProjectSummary[] }>;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create project");
      return res.json() as Promise<{ project: { id: string; slug: string } }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Delete failed");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const [name, setName] = useState("");
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!scriptFile || !imageFile) throw new Error("Select script JSON and image");
      const fd = new FormData();
      fd.set("script", scriptFile);
      fd.set("image", imageFile);
      const res = await fetch("/api/projects/import", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Import failed");
      }
      return res.json() as Promise<{ project: { id: string; slug: string } }>;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/project/${d.project.slug}`);
    },
  });

  return (
    <AppShell subtitle={<ActiveProfileSubtitle />}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="text-muted-foreground text-sm">
              Local filesystem projects under COMPOSER_PROJECTS_ROOT.
            </p>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim() || "Untitled";
              createMutation.mutate(n, {
                onSuccess: (d) => router.push(`/project/${d.project.slug}`),
              });
              setName("");
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="new-project">New project</Label>
              <Input
                id="new-project"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={createMutation.isPending}>
              <Plus className="mr-1 size-4" />
              Create
            </Button>
          </form>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import portable script</CardTitle>
            <CardDescription>
              JSON export plus matching input image (hash-checked).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="import-script">Script (.json)</Label>
              <Input
                id="import-script"
                type="file"
                accept="application/json,.json"
                onChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="import-img">Start image</Label>
              <Input
                id="import-img"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={importMutation.isPending || !scriptFile || !imageFile}
              onClick={() => importMutation.mutate()}
            >
              Import
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading projects…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.projects ?? []).map((p) => (
              <div key={p.slug} className="relative">
                <Link href={`/project/${encodeURIComponent(p.slug)}`} className="block">
                  <Card className="h-full pr-14 transition hover:border-primary/40">
                    <CardHeader>
                      <CardTitle className="text-lg">{p.name}</CardTitle>
                      <CardDescription>
                        {p.segment_count} segment
                        {p.segment_count === 1 ? "" : "s"} · updated{" "}
                        {new Date(p.updated_at).toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <span className="text-muted-foreground text-xs font-mono" title="Folder name and URL">
                        {p.slug}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  className="border-destructive/35 text-destructive hover:bg-destructive/10 absolute top-4 right-4 z-10 bg-background"
                  aria-label={`Delete project ${p.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const ok = window.confirm(
                      `Delete project "${p.name}" and all of its data on disk (segments, snapshots, inputs)? This cannot be undone.`,
                    );
                    if (!ok) return;
                    deleteMutation.mutate(p.slug);
                  }}
                >
                  <Trash2 className="mr-1 size-4" aria-hidden />
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
