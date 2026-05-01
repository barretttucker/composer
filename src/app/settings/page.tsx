"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

type ProfilesResponse = {
  activeProfileId: string;
  profiles: {
    id: string;
    name: string;
    description?: string;
    forge: { baseUrl: string; requestTimeoutMs?: number };
  }[];
};

export default function SettingsPage() {
  const qc = useQueryClient();

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const res = await fetch("/api/config/profiles");
      if (!res.ok) throw new Error("profiles");
      return res.json() as Promise<ProfilesResponse>;
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch("/api/config/profiles/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) throw new Error("Failed to set active profile");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; baseUrl: string }) => {
      const res = await fetch("/api/config/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          forge: { baseUrl: payload.baseUrl },
        }),
      });
      if (!res.ok) throw new Error("create failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      name: string;
      baseUrl: string;
    }) => {
      const res = await fetch(`/api/config/profiles/${payload.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          forge: { baseUrl: payload.baseUrl },
        }),
      });
      if (!res.ok) throw new Error("update failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/config/profiles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("http://127.0.0.1:7860");

  return (
    <AppShell subtitle={<ActiveProfileSubtitle />}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-muted-foreground text-sm">
            Forge endpoints live in COMPOSER_DATA_DIR/profiles.json. Remembered WAN / Forge defaults
            (from Project setup) are stored in COMPOSER_DATA_DIR/project-setup-defaults.json.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>New profile</CardTitle>
            <CardDescription>
              Usually points at Forge Neo with{" "}
              <span className="font-mono text-xs">--api</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="np-name">Name</Label>
              <Input
                id="np-name"
                value={newName}
                placeholder="Local Forge alt port"
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="np-url">Forge base URL</Label>
              <Input
                id="np-url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <Button
              onClick={() =>
                createMutation.mutate({
                  name: newName.trim() || "Profile",
                  baseUrl: newUrl.trim(),
                })}
              disabled={createMutation.isPending}
            >
              Save profile
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <h2 className="text-lg font-medium">Profiles</h2>
          {(profilesQuery.data?.profiles ?? []).map((p) => {
            const isActive = p.id === profilesQuery.data?.activeProfileId;
            return (
              <Card key={p.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 pb-2">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {p.forge.baseUrl}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!isActive ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setActiveMutation.mutate(p.id)}
                      >
                        Use active
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">Active</span>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={(profilesQuery.data?.profiles.length ?? 0) <= 1}
                      onClick={() => deleteMutation.mutate(p.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <ProfileEditor
                    profile={p}
                    onSave={(name, baseUrl) =>
                      updateMutation.mutate({ id: p.id, name, baseUrl })}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function ProfileEditor({
  profile,
  onSave,
}: {
  profile: { id: string; name: string; forge: { baseUrl: string } };
  onSave: (name: string, baseUrl: string) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [baseUrl, setBaseUrl] = useState(profile.forge.baseUrl);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1">
        <Label className="text-xs">Display name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex-[2] space-y-1">
        <Label className="text-xs">Base URL</Label>
        <Input
          className="font-mono text-xs"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSave(name.trim(), baseUrl.trim())}
      >
        Update
      </Button>
    </div>
  );
}
