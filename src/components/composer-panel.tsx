"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { ActiveProfileSubtitle } from "@/components/active-profile-subtitle";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  ForgeCatalogPayload,
  ForgeUpscalersPayload,
  ProjectSetupPanel,
} from "@/components/project-setup-panel";
import { AssemblyComparePanel } from "@/components/run/assembly-compare-panel";
import { SegmentStructuredPromptFields } from "@/components/segment-structured-prompt-fields";
import { SegmentSceneStrip } from "@/components/segment-scene-strip";
import {
  formatForgeEtaSeconds,
  forgeProgressToRenderState,
  type ForgeRenderBarState,
} from "@/lib/forge/render-progress";
import type { ForgeCatalog } from "@/lib/forge/types";
import { vaeDisplayLabel, vaeOptionValue } from "@/lib/forge/types";
import { wanDefaultTextEncoderSelectItem, wanDefaultVaeSelectItem } from "@/lib/wan-forge-modules";
import { effectiveResolution, applyAutoDimensions } from "@/lib/project-resolution";
import { chainGroupEndExclusive, type Project } from "@/lib/schemas/project";
import type { RunRecord } from "@/lib/schemas/run";
import type { SegmentHealthFlags } from "@/lib/segment-render-fingerprint";
import { formatComposerRunEventLine } from "@/lib/sanitize-compose-log";
import { framesForClipSeconds } from "@/lib/video-time";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Film,
  PanelLeft,
  PlayCircle,
  ScrollText,
  StopCircle,
  Wand2,
} from "lucide-react";
import { useComposerStore } from "@/stores/composer-store";

function runsFinalMp4ProjectRel(runId: string, finalRel: string): string {
  const rel = finalRel.replace(/^\/+/, "");
  return rel.startsWith("runs/")
    ? rel.replace(/\\/g, "/")
    : `runs/${runId}/${rel}`.replace(/\/+/g, "/");
}

async function fetchProject(projectId: string): Promise<{
  project: Project;
  segmentRenderHealth: Record<string, SegmentHealthFlags>;
}> {
  const res = await fetch(`/api/projects/${projectId}`);
  if (!res.ok) throw new Error("Failed to load project");
  return res.json();
}

function ForgeRunRenderStatus({ state }: { state: ForgeRenderBarState }) {
  const clip = `Rendering clip ${state.segmentIndex + 1}`;
  const etaFmt = (s: number | null) => formatForgeEtaSeconds(s);
  return (
    <div className="border-border bg-muted/20 space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium">{clip} on Forge</div>
      {state.kind === "starting" ? (
        <>
          <p className="text-muted-foreground text-xs leading-snug">
            Starting render…
          </p>
          <div className="bg-muted relative h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary/70 absolute top-0 bottom-0 w-2/5 rounded-full"
              style={{
                animation: "composer-forge-indeterminate 1.25s ease-in-out infinite",
              }}
            />
          </div>
        </>
      ) : null}
      {state.kind === "preparing" ? (
        <>
          <p className="text-muted-foreground text-xs leading-snug">
            Loading model and pipeline — Forge progress stays near{" "}
            {Math.round(state.progressHint * 100)}% until sampling begins. Large
            ETA values are normal while weights load.
          </p>
          {etaFmt(state.etaSeconds) ? (
            <p className="text-muted-foreground font-mono text-xs">
              Forge ETA ~{etaFmt(state.etaSeconds)} (often inflated while loading)
            </p>
          ) : null}
          <div className="bg-muted relative h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary/70 absolute top-0 bottom-0 w-2/5 rounded-full"
              style={{
                animation: "composer-forge-indeterminate 1.25s ease-in-out infinite",
              }}
            />
          </div>
        </>
      ) : null}
      {state.kind === "sampling" ? (
        <>
          <p className="text-muted-foreground text-xs leading-snug">
            Sampling
            {state.samplingTotal != null
              ? ` — step ${state.samplingStep} / ${state.samplingTotal}`
              : null}{" "}
            ({Math.round(state.progress * 100)}%)
            {etaFmt(state.etaSeconds) ? ` · ~${etaFmt(state.etaSeconds)} left` : ""}
          </p>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, state.progress)) * 100)}%` }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

async function fetchForgeUpscalers(): Promise<ForgeUpscalersPayload> {
  const res = await fetch("/api/forge/upscalers");
  const j = (await res.json()) as { error?: string; upscalers?: string[] };
  if (!res.ok) throw new Error(j.error ?? "Forge upscalers request failed");
  return { upscalers: j.upscalers ?? [] };
}

async function fetchForgeCatalog(refresh: boolean): Promise<ForgeCatalogPayload> {
  const q = refresh ? "?refresh=1" : "";
  const res = await fetch(`/api/forge/catalog${q}`);
  const j = (await res.json()) as {
    error?: string;
    catalog?: ForgeCatalog;
    options?: unknown;
  };
  if (!res.ok) throw new Error(j.error ?? "Forge catalog request failed");
  if (!j.catalog) throw new Error("Forge catalog missing in response");
  return { catalog: j.catalog, options: j.options };
}

export function ComposerPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const [draft, setDraft] = useState<Project | null>(null);
  function patchDraft(updater: (p: Project) => Project) {
    setDraft((prev) => (prev ? updater(structuredClone(prev)) : prev));
  }

  useEffect(() => {
    if (projectQuery.data?.project) {
      const p = structuredClone(projectQuery.data.project);
      if (!p.resolution) {
        p.resolution = {
          mode: "custom",
          bucket: "480p",
          detected_aspect: null,
        };
      }
      setDraft(p);
    }
  }, [projectQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (project: Project) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json() as Promise<{ project: Project }>;
    },
    onSuccess: (data) => {
      setDraft(structuredClone(data.project));
      const nextSlug = data.project.slug;
      if (nextSlug !== projectId) {
        qc.removeQueries({ queryKey: ["project", projectId] });
        router.replace(`/project/${nextSlug}`);
      }
      void qc.invalidateQueries({ queryKey: ["project", nextSlug] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const addSegmentMutation = useMutation({
    mutationFn: async () => {
      const prev = draft?.segments[draft.segments.length - 1];
      const prompt =
        prev !== undefined && prev.prompt.trim() !== ""
          ? prev.prompt
          : "Describe this clip...";
      const res = await fetch(`/api/projects/${projectId}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error("Add segment failed");
      return res.json() as Promise<{ project: Project }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const deleteSegmentMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Delete failed");
      return res.json() as Promise<{ project: Project }>;
    },
    onSuccess: (data, segmentId) => {
      setDraft(structuredClone(data.project));
      setSelectedSegmentId((sid) => {
        if (sid !== segmentId) return sid;
        return data.project.segments[0]?.id ?? null;
      });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const clipImageMutation = useMutation({
    mutationFn: async (input: { file: File; segmentIndex: number }) => {
      const fd = new FormData();
      fd.set("image", input.file);
      fd.set("segmentIndex", String(input.segmentIndex));
      const res = await fetch(`/api/projects/${projectId}/input`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Upload failed");
      }
    },
    onSuccess: () => {
      setClipPreviewNonce((n) => n + 1);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const extendFromPreviousMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/extend-from-previous`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Extend request failed");
      }
      return res.json() as Promise<{ project?: Project }>;
    },
    onSuccess: () => {
      setClipPreviewNonce((n) => n + 1);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const forgeUpscalersQuery = useQuery({
    queryKey: ["forge-upscalers"],
    queryFn: fetchForgeUpscalers,
    staleTime: 120_000,
    retry: false,
  });

  const refreshForgeUpscalersMutation = useMutation({
    mutationFn: fetchForgeUpscalers,
    onSuccess: (data) => {
      qc.setQueryData(["forge-upscalers"], data);
    },
  });

  const forgeCatalogQuery = useQuery({
    queryKey: ["forge-catalog"],
    queryFn: () => fetchForgeCatalog(false),
    staleTime: 120_000,
    retry: false,
  });

  const refreshForgeCatalogMutation = useMutation({
    mutationFn: () => fetchForgeCatalog(true),
    onSuccess: (data) => {
      qc.setQueryData(["forge-catalog"], data);
    },
  });

  const [timelineAdvancedOpen, setTimelineAdvancedOpen] = useState(false);
  const [timelineAdvanced, setTimelineAdvanced] = useState({
    pause_mode: false,
    seed_delta: 0,
    manual_from_index: 0,
    /** Empty string = through end of timeline */
    manual_to_exclusive: "",
  });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [forgeRender, setForgeRender] = useState<ForgeRenderBarState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  /** Canonical segment_outputs clip last touched by a finished segment in this session (preferred over selection). */
  const [latestRenderedSegmentId, setLatestRenderedSegmentId] = useState<string | null>(
    null,
  );
  /** Merged final.mp4 from the snapshot that just completed (falls back to run history). */
  const [lastCompletedMergedRel, setLastCompletedMergedRel] = useState<string | null>(
    null,
  );
  const [playbackTab, setPlaybackTab] = useState<"single" | "merged">("single");
  const [playbackNonce, setPlaybackNonce] = useState(0);
  const [projectSetupOpen, setProjectSetupOpen] = useState(false);
  const [scriptSheetOpen, setScriptSheetOpen] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const clipFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadClipIndex = useRef<number | null>(null);
  const [clipPreviewNonce, setClipPreviewNonce] = useState(0);
  const previewMuted = useComposerStore((s) => s.previewMuted);
  const togglePreviewMuted = useComposerStore((s) => s.togglePreviewMuted);

  const segmentFinishCountRef = useRef(0);

  const playbackRunsQuery = useQuery({
    queryKey: ["runs", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/runs`);
      if (!res.ok) throw new Error("runs");
      return res.json() as Promise<{ runs: RunRecord[] }>;
    },
    staleTime: 15_000,
  });

  const timelineRenderMutation = useMutation({
    mutationFn: async (payload: {
      from_segment_index: number;
      to_segment_index_exclusive?: number;
      assembly_ab_compare?: boolean;
    }) => {
      const from_segment_index = Math.max(
        0,
        Math.floor(Number(payload.from_segment_index)) || 0,
      );
      const body: Record<string, unknown> = {
        pause_mode: timelineAdvanced.pause_mode,
        seed_delta: timelineAdvanced.seed_delta,
        from_segment_index,
      };
      if (payload.to_segment_index_exclusive !== undefined) {
        body.to_segment_index_exclusive = Math.floor(
          payload.to_segment_index_exclusive,
        );
      }
      if (payload.assembly_ab_compare === true) {
        body.assembly_ab_compare = true;
      }
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Render failed");
      }
      return res.json() as Promise<{ runId: string }>;
    },
    onSuccess: (data) => {
      setActiveRunId(data.runId);
      setLatestRenderedSegmentId(null);
      setLogs((l) => [...l, `[render] Snapshot ${data.runId}`]);
    },
  });

  useEffect(() => {
    setForgeRender(null);
    segmentFinishCountRef.current = 0;
  }, [activeRunId]);

  const bootstrapMergedRel = useMemo(() => {
    const runs = playbackRunsQuery.data?.runs ?? [];
    const sorted = [...runs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    for (const r of sorted) {
      if (r.status === "completed" && r.final_mp4_rel) {
        return runsFinalMp4ProjectRel(r.id, r.final_mp4_rel);
      }
    }
    return null;
  }, [playbackRunsQuery.data?.runs]);

  const clipPlaybackId = latestRenderedSegmentId ?? selectedSegmentId;

  const playbackVideoSrc = useMemo(() => {
    const mergedRel = lastCompletedMergedRel ?? bootstrapMergedRel;
    const qs = (rel: string) =>
      `/api/projects/${projectId}/file?${new URLSearchParams({
        rel,
        v: String(playbackNonce),
      }).toString()}`;
    if (playbackTab === "merged" && mergedRel) {
      return qs(mergedRel);
    }
    if (playbackTab === "single" && clipPlaybackId) {
      return qs(`segment_outputs/${clipPlaybackId}/clip.mp4`);
    }
    return null;
  }, [
    playbackTab,
    lastCompletedMergedRel,
    bootstrapMergedRel,
    clipPlaybackId,
    playbackNonce,
    projectId,
  ]);

  useEffect(() => {
    if (!activeRunId) return;
    const url = `/api/projects/${projectId}/runs/${activeRunId}/events`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as Record<string, unknown>;
        if (payload.type === "heartbeat") return;
        setLogs((l) => [...l, formatComposerRunEventLine(payload)]);

        const t = payload.type;
        if (t === "segment_started") {
          const ix =
            typeof payload.index === "number" && Number.isFinite(payload.index)
              ? payload.index
              : 0;
          setForgeRender({ kind: "starting", segmentIndex: ix });
        } else if (t === "forge_progress") {
          setForgeRender((prev) => {
            const seg =
              prev && typeof prev.segmentIndex === "number"
                ? prev.segmentIndex
                : 0;
            return forgeProgressToRenderState(payload.raw, seg) ?? prev;
          });
        } else if (
          t === "segment_finished" ||
          t === "segment_failed" ||
          t === "completed" ||
          t === "stopped" ||
          t === "paused"
        ) {
          setForgeRender(null);
        }

        if (payload.type === "segment_finished") {
          segmentFinishCountRef.current += 1;
          void qc.invalidateQueries({ queryKey: ["project", projectId] });
          void qc.invalidateQueries({ queryKey: ["runs", projectId] });
          setClipPreviewNonce((n) => n + 1);
          const sid = payload.segmentId;
          const abPick = payload.assembly_ab_pending_pick === true;
          if (typeof sid === "string" && sid.length > 0 && !abPick) {
            setLatestRenderedSegmentId(sid);
            // Anchor the player to the just-finished clip so the user sees it
            // immediately. The completed handler later promotes to "merged" if
            // multiple clips finished in this run.
            setPlaybackTab("single");
          }
          setPlaybackNonce((n) => n + 1);
        }
        if (payload.type === "completed") {
          void qc.invalidateQueries({ queryKey: ["project", projectId] });
          void qc.invalidateQueries({ queryKey: ["runs", projectId] });
          const finalRel = payload.final_mp4_rel;
          if (
            typeof finalRel === "string" &&
            finalRel.length > 0 &&
            activeRunId
          ) {
            setLastCompletedMergedRel(runsFinalMp4ProjectRel(activeRunId, finalRel));
            setPlaybackNonce((n) => n + 1);
            setPlaybackTab(segmentFinishCountRef.current === 1 ? "single" : "merged");
          }
        }
      } catch {
        const raw = ev.data;
        const line =
          typeof raw === "string" && raw.length > 500
            ? `[raw event ${raw.length} chars omitted]`
            : raw;
        setLogs((l) => [...l, typeof line === "string" ? line : String(line)]);
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [activeRunId, projectId, qc]);

  useEffect(() => {
    if (projectSetupOpen) {
      void qc.invalidateQueries({ queryKey: ["project-setup-defaults"] });
    }
  }, [projectSetupOpen, qc]);

  useEffect(() => {
    if (!draft) return;
    setSelectedSegmentId((cur) => {
      const segs = draft.segments;
      if (segs.length === 0) return null;
      if (cur && segs.some((s) => s.id === cur)) return cur;
      return segs[0]!.id;
    });
  }, [draft]);

  const forgeCatalog = forgeCatalogQuery.data?.catalog;

  const checkpointItems = useMemo(
    () =>
      (forgeCatalog?.checkpoints ?? []).map((m) => ({
        value: m.title,
        label: m.title,
      })),
    [forgeCatalog?.checkpoints],
  );

  const vaeItems = useMemo(() => {
    const fromCatalog = (forgeCatalog?.vaes ?? []).map((v) => ({
      value: vaeOptionValue(v),
      label: vaeDisplayLabel(v),
    }));
    const seen = new Map(fromCatalog.map((i) => [i.value, i]));
    const wan = wanDefaultVaeSelectItem();
    if (!seen.has(wan.value)) seen.set(wan.value, wan);
    return Array.from(seen.values());
  }, [forgeCatalog?.vaes]);

  const textEncoderItems = useMemo(() => [wanDefaultTextEncoderSelectItem()], []);

  const samplerItems = useMemo(
    () =>
      (forgeCatalog?.samplers ?? []).map((s) => ({
        value: s,
        label: s,
      })),
    [forgeCatalog?.samplers],
  );

  const schedulerItems = useMemo(
    () =>
      (forgeCatalog?.schedulers ?? []).map((s) => ({
        value: s,
        label: s,
      })),
    [forgeCatalog?.schedulers],
  );

  const forgePickersReady =
    forgeCatalogQuery.data?.catalog != null && !forgeCatalogQuery.isError;

  const setupDefaultsQuery = useQuery({
    queryKey: ["project-setup-defaults"],
    queryFn: async () => {
      const res = await fetch("/api/config/project-setup-defaults");
      if (!res.ok) throw new Error("Failed to load default setup");
      return res.json() as Promise<{
        setupDefaults: {
          updated_at: string;
          defaults: Project["defaults"];
          chaining: Project["chaining"];
          resolution: { mode: "auto" | "custom"; bucket: "480p" | "576p" | "720p" };
        } | null;
      }>;
    },
    staleTime: 30_000,
  });

  const saveSetupDefaultsMutation = useMutation({
    mutationFn: async () => {
      const d = draft;
      if (!d) throw new Error("Project not loaded");
      const projectRes = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!projectRes.ok) {
        const j = (await projectRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Save project failed");
      }
      const projectBody = (await projectRes.json()) as { project: Project };
      const r = effectiveResolution(d);
      const res = await fetch("/api/config/project-setup-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaults: d.defaults,
          chaining: d.chaining,
          resolution: { mode: r.mode, bucket: r.bucket },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Save defaults failed");
      }
      const setupBody = (await res.json()) as {
        setupDefaults: { updated_at: string };
      };
      return { setupDefaults: setupBody.setupDefaults, project: projectBody.project };
    },
    onSuccess: (data) => {
      setDraft(structuredClone(data.project));
      qc.invalidateQueries({ queryKey: ["project-setup-defaults"] });
      const nextSlug = data.project.slug;
      if (nextSlug !== projectId) {
        qc.removeQueries({ queryKey: ["project", projectId] });
        router.replace(`/project/${nextSlug}`);
      }
      void qc.invalidateQueries({ queryKey: ["project", nextSlug] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const applySetupDefaultsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/project-setup-defaults");
      if (!res.ok) throw new Error("Could not load default setup");
      return res.json() as Promise<{
        setupDefaults: {
          defaults: Project["defaults"];
          chaining: Project["chaining"];
          resolution: { mode: "auto" | "custom"; bucket: "480p" | "576p" | "720p" };
        } | null;
      }>;
    },
    onSuccess: (body) => {
      const s = body.setupDefaults;
      if (!s) return;
      patchDraft((p) => {
        p.defaults = structuredClone(s.defaults);
        p.chaining = structuredClone(s.chaining);
        const cur = effectiveResolution(p);
        p.resolution = {
          mode: s.resolution.mode,
          bucket: s.resolution.bucket,
          detected_aspect: cur.detected_aspect,
        };
        return applyAutoDimensions(p);
      });
    },
  });

  const setupDefaultsSaved = setupDefaultsQuery.data?.setupDefaults ?? null;
  const savedSetupSummary = setupDefaultsSaved
    ? new Date(setupDefaultsSaved.updated_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const hasSavedSetupDefaults = setupDefaultsSaved != null;

  const dirty =
    draft && projectQuery.data?.project
      ? JSON.stringify(draft) !== JSON.stringify(projectQuery.data.project)
      : false;

  const staleSummary = useMemo(() => {
    if (!draft?.segments.length) return { firstIndex: null as number | null, count: 0 };
    const health = projectQuery.data?.segmentRenderHealth;
    if (!health) return { firstIndex: null as number | null, count: 0 };
    let firstIndex: number | null = null;
    let count = 0;
    for (let i = 0; i < draft.segments.length; i++) {
      const h = health[draft.segments[i]!.id];
      if (h?.contentStale || h?.chainStale) {
        if (firstIndex === null) firstIndex = i;
        count += 1;
      }
    }
    return { firstIndex, count };
  }, [draft?.segments, projectQuery.data?.segmentRenderHealth]);

  const assemblyAbPending = useMemo(() => {
    if (!activeRunId || !selectedSegmentId) return null;
    const run = playbackRunsQuery.data?.runs.find((r) => r.id === activeRunId);
    const st = run?.segment_states.find((s) => s.segment_id === selectedSegmentId);
    if (!st?.assembly_ab_pending_pick || !st.assembly_ab_variants?.length) return null;
    return { variants: st.assembly_ab_variants };
  }, [activeRunId, selectedSegmentId, playbackRunsQuery.data?.runs]);

  if (!draft && projectQuery.isLoading) {
    return (
      <AppShell subtitle={<ActiveProfileSubtitle />}>
        <p className="text-muted-foreground text-sm">Loading composer…</p>
      </AppShell>
    );
  }

  if (!draft) {
    return (
      <AppShell subtitle={<ActiveProfileSubtitle />}>
        <p className="text-destructive text-sm">Project failed to load.</p>
      </AppShell>
    );
  }

  const res = effectiveResolution(draft);
  const fpsRound = Math.max(1, Math.round(draft.chaining.fps));
  const selectedSeg =
    draft.segments.find((s) => s.id === selectedSegmentId) ?? null;
  const selectedIndex = selectedSeg
    ? draft.segments.findIndex((s) => s.id === selectedSeg.id)
    : -1;

  return (
    <AppShell subtitle={<ActiveProfileSubtitle />}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{draft.name}</h1>
          <div className="text-muted-foreground flex gap-3 text-sm">
            <Link href={`/project/${projectId}/continuity`} className="hover:underline">
              Continuity
            </Link>
            <Link href={`/project/${projectId}/runs`} className="hover:underline">
              Snapshots
            </Link>
            <span className="font-mono text-xs">{projectId}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            type="button"
            aria-expanded={projectSetupOpen}
            onClick={() => setProjectSetupOpen(true)}
          >
            <PanelLeft className="mr-2 size-4" aria-hidden />
            Project setup
          </Button>
          <Button
            variant="outline"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate(draft)}
          >
            Save project
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const res = await fetch(`/api/projects/${projectId}/export`);
              const json = await res.json();
              const blob = new Blob([JSON.stringify(json, null, 2)], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${draft.name.replace(/\s+/g, "_")}_script.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export script JSON
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const res = await fetch(
                `/api/projects/${projectId}/export?format=structured`,
              );
              const json = await res.json();
              if (!res.ok) {
                window.alert(
                  typeof json?.error === "string"
                    ? json.error
                    : "Structured export failed",
                );
                return;
              }
              const blob = new Blob([JSON.stringify(json, null, 2)], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${draft.name.replace(/\s+/g, "_")}_structured.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export structured JSON
          </Button>
        </div>
      </div>

      <Dialog open={projectSetupOpen} onOpenChange={setProjectSetupOpen}>
        <DialogContent fullscreen showCloseButton>
          <DialogHeader className="border-border shrink-0 border-b px-6 py-4 pr-14 pt-14 sm:px-10 sm:pb-5 sm:pt-16">
            <DialogTitle className="text-lg sm:text-xl">Project setup</DialogTitle>
            <DialogDescription>
              Full-screen editor: tabs for canvas, continuity registries, and Forge defaults. Scroll the
              page for long lists. Save the project when you are done.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 py-6 sm:px-10 sm:py-8">
            <ProjectSetupPanel
              draft={draft}
              patchDraft={patchDraft}
              res={res}
              forgeCatalogQuery={forgeCatalogQuery}
              refreshForgeCatalogMutation={refreshForgeCatalogMutation}
              forgeUpscalersQuery={forgeUpscalersQuery}
              refreshForgeUpscalersMutation={refreshForgeUpscalersMutation}
              forgePickersReady={forgePickersReady}
              checkpointItems={checkpointItems}
              vaeItems={vaeItems}
              textEncoderItems={textEncoderItems}
              samplerItems={samplerItems}
              schedulerItems={schedulerItems}
              savedSetupSummary={savedSetupSummary}
              hasSavedSetupDefaults={hasSavedSetupDefaults}
              onSaveSetupDefaults={() => saveSetupDefaultsMutation.mutate()}
              onApplySetupDefaults={() => applySetupDefaultsMutation.mutate()}
              saveSetupDefaultsPending={saveSetupDefaultsMutation.isPending}
              applySetupDefaultsPending={applySetupDefaultsMutation.isPending}
            />
          </div>
        </DialogContent>
      </Dialog>

      <input
        ref={clipFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const ix = pendingUploadClipIndex.current;
          if (f && ix !== null && Number.isInteger(ix)) {
            clipImageMutation.mutate({ file: f, segmentIndex: ix });
          }
          pendingUploadClipIndex.current = null;
          e.target.value = "";
        }}
      />

      <div className="-mx-4 sticky top-0 z-30 mb-4 rounded-lg border shadow-sm">
        <div className="bg-card flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Film className="size-4" aria-hidden />
            <span>Scene timeline</span>
            {staleSummary.count > 0 ? (
              <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                {staleSummary.count} stale
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setScriptSheetOpen(true)}
            disabled={draft.segments.length === 0}
          >
            <ScrollText className="mr-2 size-4" aria-hidden />
            Whole script
          </Button>
        </div>
        <SegmentSceneStrip
          projectId={projectId}
          clipPreviewNonce={clipPreviewNonce}
          project={draft}
          segmentHealth={projectQuery.data?.segmentRenderHealth}
          selectedId={selectedSegmentId}
          onSelect={setSelectedSegmentId}
          onAdd={() => addSegmentMutation.mutate()}
          addDisabled={addSegmentMutation.isPending}
          fps={draft.chaining.fps}
          defaultClipSeconds={draft.defaults.clip_duration_seconds}
          onRequestUploadClip={(segmentIndex) => {
            pendingUploadClipIndex.current = segmentIndex;
            clipFileInputRef.current?.click();
          }}
          onRequestExtendFromPrevious={(segmentId) =>
            extendFromPreviousMutation.mutate(segmentId)
          }
          extendBusy={extendFromPreviousMutation.isPending}
          uploadBusy={clipImageMutation.isPending}
          onRemoveSegment={(segmentId) =>
            deleteSegmentMutation.mutate(segmentId)
          }
          removeDisabled={deleteSegmentMutation.isPending}
          autoCenterSelected
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="min-w-0 space-y-4">
          {dirty ? (
            <p className="text-muted-foreground text-xs">
              Unsaved changes (continuity markers reflect the last saved project).
            </p>
          ) : null}

          {selectedSeg && selectedIndex >= 0 ? (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-3">
                <CardTitle className="text-base">
                  Clip {selectedIndex + 1} — prompts
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/40 shrink-0"
                  disabled={deleteSegmentMutation.isPending}
                  onClick={() => deleteSegmentMutation.mutate(selectedSeg.id)}
                >
                  Remove clip
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {assemblyAbPending && activeRunId && selectedSeg ? (
                  <AssemblyComparePanel
                    projectId={projectId}
                    runId={activeRunId}
                    segmentId={selectedSeg.id}
                    variants={assemblyAbPending.variants}
                  />
                ) : null}
                <div className="space-y-1">
                  <Label>Clip length</Label>
                  <Select
                    value={String(
                      selectedSeg.duration_seconds ??
                        draft.defaults.clip_duration_seconds,
                    )}
                    onValueChange={(v) => {
                      const sec = Number(v);
                      patchDraft((p) => {
                        const s = p.segments.find((x) => x.id === selectedSeg.id);
                        if (!s) return p;
                        s.duration_seconds = sec;
                        if (s.params_override?.frames !== undefined) {
                          const po = { ...s.params_override };
                          delete po.frames;
                          s.params_override =
                            Object.keys(po).length > 0 ? po : undefined;
                        }
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
                          {n}s ({framesForClipSeconds(n, fpsRound)} frames)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    WAN frame count is seconds × {fpsRound} fps + 1 (set FPS in Project setup →
                    Chaining).
                  </p>
                </div>

                <SegmentStructuredPromptFields
                  draft={draft}
                  selectedSeg={selectedSeg}
                  selectedIndex={selectedIndex}
                  patchDraft={patchDraft}
                  projectId={projectId}
                  onAfterSeedUpload={() => {
                    setClipPreviewNonce((n) => n + 1);
                    qc.invalidateQueries({ queryKey: ["project", projectId] });
                  }}
                  onAssemblyAbCompare={() =>
                    timelineRenderMutation.mutate({
                      from_segment_index: selectedIndex,
                      to_segment_index_exclusive: selectedIndex + 1,
                      assembly_ab_compare: true,
                    })
                  }
                />

                <div className="space-y-1">
                  <Label>Legacy flat prompt</Label>
                  <Textarea
                  value={selectedSeg.prompt}
                  rows={5}
                  onChange={(e) =>
                    patchDraft((p) => {
                      const s = p.segments.find((x) => x.id === selectedSeg.id);
                      if (s) s.prompt = e.target.value;
                      return p;
                    })}
                />
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedSeg.locked}
                      onCheckedChange={(v) =>
                        patchDraft((p) => {
                          const s = p.segments.find((x) => x.id === selectedSeg.id);
                          if (s) s.locked = v === true;
                          return p;
                        })}
                    />
                    Locked
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedSeg.pause_for_review}
                      onCheckedChange={(v) =>
                        patchDraft((p) => {
                          const s = p.segments.find((x) => x.id === selectedSeg.id);
                          if (s) s.pause_for_review = v === true;
                          return p;
                        })}
                    />
                    Pause for review
                  </label>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                Add a clip from the timeline above, then select it to write the prompt.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Render</CardTitle>
              <p className="text-muted-foreground text-xs leading-snug">
                {selectedIndex >= 0
                  ? `Selected: clip ${selectedIndex + 1}. Earlier clips reuse saved
                  timeline outputs so chaining stays consistent.`
                  : "Pick a clip on the timeline above to render."}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {staleSummary.firstIndex !== null ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
                  <span className="font-medium text-amber-900">
                    {staleSummary.count} clip{staleSummary.count === 1 ? "" : "s"} stale
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
                    disabled={timelineRenderMutation.isPending}
                    onClick={() =>
                      timelineRenderMutation.mutate({
                        from_segment_index: staleSummary.firstIndex!,
                        to_segment_index_exclusive: chainGroupEndExclusive(
                          draft,
                          staleSummary.firstIndex!,
                        ),
                      })
                    }
                  >
                    Render stale block (clip {staleSummary.firstIndex + 1})
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="flex-1 justify-center"
                    disabled={
                      timelineRenderMutation.isPending ||
                      draft.segments.length === 0 ||
                      selectedIndex < 0
                    }
                    onClick={() =>
                      timelineRenderMutation.mutate({
                        from_segment_index: selectedIndex,
                        to_segment_index_exclusive: selectedIndex + 1,
                      })
                    }
                  >
                    <PlayCircle className="mr-1.5 size-4" aria-hidden />
                    Render this clip
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 justify-center"
                    disabled={
                      timelineRenderMutation.isPending ||
                      draft.segments.length === 0 ||
                      selectedIndex < 0
                    }
                    onClick={() =>
                      timelineRenderMutation.mutate({
                        from_segment_index: selectedIndex,
                        to_segment_index_exclusive: chainGroupEndExclusive(
                          draft,
                          selectedIndex,
                        ),
                      })
                    }
                  >
                    <Film className="mr-1.5 size-4" aria-hidden />
                    Full scene
                  </Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between"
                        disabled={
                          timelineRenderMutation.isPending ||
                          draft.segments.length === 0
                        }
                      />
                    }
                  >
                    <span>More render scopes</span>
                    <ChevronDown className="size-4" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>Render scope</DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={selectedIndex < 0}
                      onSelect={() =>
                        timelineRenderMutation.mutate({
                          from_segment_index: Math.max(0, selectedIndex),
                        })
                      }
                    >
                      From here to end
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        timelineRenderMutation.mutate({ from_segment_index: 0 })
                      }
                    >
                      Entire timeline
                    </DropdownMenuItem>
                    {selectedIndex >= 0 ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            timelineRenderMutation.mutate({
                              from_segment_index: selectedIndex,
                              to_segment_index_exclusive: selectedIndex + 1,
                              assembly_ab_compare: true,
                            })
                          }
                        >
                          <Wand2 className="mr-2 size-4" aria-hidden />
                          A/B compare assembly orders
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <Separator />

              <div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between gap-2 text-left text-sm font-medium"
                  onClick={() => {
                    setTimelineAdvancedOpen((o) => {
                      const next = !o;
                      if (next && selectedIndex >= 0) {
                        setTimelineAdvanced((a) => ({
                          ...a,
                          manual_from_index: selectedIndex,
                        }));
                      }
                      return next;
                    });
                  }}
                  aria-expanded={timelineAdvancedOpen}
                >
                  Advanced
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      timelineAdvancedOpen ? "rotate-180" : "",
                    )}
                    aria-hidden
                  />
                </button>
                {timelineAdvancedOpen ? (
                  <div className="mt-3 space-y-3 border-border border-t pt-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="adv-from">Start clip index</Label>
                        <Input
                          id="adv-from"
                          type="number"
                          min={0}
                          className="font-mono"
                          value={timelineAdvanced.manual_from_index}
                          onChange={(e) =>
                            setTimelineAdvanced((a) => ({
                              ...a,
                              manual_from_index: Math.max(
                                0,
                                Math.floor(Number(e.target.value)) || 0,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="adv-to">End before clip index (optional)</Label>
                        <Input
                          id="adv-to"
                          type="number"
                          min={0}
                          className="font-mono"
                          placeholder={`Through end (${draft.segments.length})`}
                          value={timelineAdvanced.manual_to_exclusive}
                          onChange={(e) =>
                            setTimelineAdvanced((a) => ({
                              ...a,
                              manual_to_exclusive: e.target.value,
                            }))
                          }
                        />
                        <p className="text-muted-foreground text-xs">
                          Leave empty to render through the last clip. Otherwise must be greater than
                          start.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="adv-seed-delta">Seed delta (variation)</Label>
                      <Input
                        id="adv-seed-delta"
                        type="number"
                        className="font-mono"
                        value={timelineAdvanced.seed_delta}
                        onChange={(e) =>
                          setTimelineAdvanced((a) => ({
                            ...a,
                            seed_delta: Number(e.target.value),
                          }))
                        }
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={timelineAdvanced.pause_mode}
                        onCheckedChange={(v) =>
                          setTimelineAdvanced((a) => ({
                            ...a,
                            pause_mode: v === true,
                          }))
                        }
                      />
                      Pause between segments (when pause-for-review is on)
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        timelineRenderMutation.isPending || draft.segments.length === 0
                      }
                      onClick={() => {
                        const from = Math.max(
                          0,
                          Math.floor(Number(timelineAdvanced.manual_from_index)) || 0,
                        );
                        const rawTo = timelineAdvanced.manual_to_exclusive.trim();
                        let toExclusive: number | undefined;
                        if (rawTo !== "") {
                          const t = Math.floor(Number(rawTo));
                          if (
                            !Number.isFinite(t) ||
                            t <= from ||
                            t > draft.segments.length
                          ) {
                            window.alert(
                              `End index must be empty or an integer greater than ${from} and at most ${draft.segments.length}.`,
                            );
                            return;
                          }
                          toExclusive = t;
                        }
                        timelineRenderMutation.mutate({
                          from_segment_index: from,
                          ...(toExclusive !== undefined
                            ? { to_segment_index_exclusive: toExclusive }
                            : {}),
                        });
                      }}
                    >
                      Render custom range
                    </Button>
                  </div>
                ) : null}
              </div>

              {activeRunId ? (
                <>
                  <Separator />
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                    <div className="text-muted-foreground space-y-0.5 text-xs">
                      <div className="text-foreground text-sm font-medium">
                        Active run
                      </div>
                      <p className="font-mono leading-tight">
                        <Link
                          href={`/project/${projectId}/runs`}
                          className="text-foreground underline"
                        >
                          Snapshots
                        </Link>
                        <span> · {activeRunId}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() =>
                          fetch(`/api/projects/${projectId}/runs/${activeRunId}/resume`, {
                            method: "POST",
                          })}
                      >
                        <PlayCircle className="mr-1.5 size-4" aria-hidden />
                        Resume
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() =>
                          fetch(`/api/projects/${projectId}/runs/${activeRunId}/stop`, {
                            method: "POST",
                          })}
                      >
                        <StopCircle className="mr-1.5 size-4" aria-hidden />
                        Stop
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
              {forgeRender ? <ForgeRunRenderStatus state={forgeRender} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-3">
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="text-base">Player</CardTitle>
                <p className="text-muted-foreground max-w-prose text-xs leading-snug">
                  Anchors to the most recently rendered clip; switches to the merged
                  timeline after multi-clip renders finish.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={togglePreviewMuted}>
                {previewMuted ? "Unmute" : "Mute"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs
                value={playbackTab}
                onValueChange={(v) => {
                  if (v === "single" || v === "merged") setPlaybackTab(v);
                }}
              >
                <TabsList variant="line" className="w-full justify-start">
                  <TabsTrigger value="single">Latest clip</TabsTrigger>
                  <TabsTrigger
                    value="merged"
                    disabled={!(lastCompletedMergedRel ?? bootstrapMergedRel)}
                  >
                    Merged timeline
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {playbackVideoSrc ? (
                <video
                  key={playbackVideoSrc}
                  className="w-full rounded-md border bg-black"
                  controls
                  muted={previewMuted}
                  src={playbackVideoSrc}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {playbackTab === "merged"
                    ? "No merged video yet. Finish a render that produces final.mp4, or open Snapshots."
                    : "Nothing to play yet. Render a clip or pick one on the timeline that already has output."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="text-base">Log</CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground -mr-2 h-8 shrink-0 gap-1 px-2"
                onClick={() => setLogOpen((o) => !o)}
                aria-expanded={logOpen}
              >
                {logOpen ? "Hide" : "Show"}
                <ChevronDown
                  className={cn("size-4 transition-transform", logOpen && "rotate-180")}
                  aria-hidden
                />
              </Button>
            </CardHeader>
            {logOpen ? (
              <CardContent className="pt-0">
                <ScrollArea className="h-48 rounded-md border p-2">
                  <pre className="whitespace-pre-wrap font-mono text-xs">
                    {logs.join("\n")}
                  </pre>
                </ScrollArea>
              </CardContent>
            ) : null}
          </Card>
        </div>
      </div>

      <Sheet open={scriptSheetOpen} onOpenChange={setScriptSheetOpen}>
        <SheetContent
          side="right"
          showCloseButton
          className={cn(
            "flex w-[min(100vw,28rem)] flex-col gap-0 overflow-hidden border-l bg-background p-0",
            "sm:max-w-[min(28rem,calc(100vw-1.5rem))]",
          )}
        >
          <SheetHeader className="shrink-0 border-b px-4 pt-12 pb-4 sm:px-6">
            <SheetTitle>Whole script</SheetTitle>
            <SheetDescription>
              Read-only overview of every clip prompt in order. Edit prompts in the selected clip
              below the timeline.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <ol className="flex flex-col gap-3 px-4 py-4 sm:px-6">
              {draft.segments.map((s, i) => (
                <li
                  key={s.id}
                  className="bg-muted/30 rounded-lg border px-3 py-2.5"
                >
                  <div className="text-muted-foreground mb-1 text-xs font-medium">
                    Clip {i + 1}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.prompt}</p>
                </li>
              ))}
            </ol>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
