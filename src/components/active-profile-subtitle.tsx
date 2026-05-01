"use client";

import { useQuery } from "@tanstack/react-query";

export function ActiveProfileSubtitle() {
  const { data } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const res = await fetch("/api/config/profiles");
      if (!res.ok) throw new Error("Failed profiles");
      return res.json() as Promise<{
        activeProfileId: string;
        profiles: { id: string; name: string; forge: { baseUrl: string } }[];
      }>;
    },
  });

  const active = data?.profiles.find((p) => p.id === data.activeProfileId);
  if (!active) return null;
  return (
    <>
      Profile: <span className="font-medium text-foreground">{active.name}</span> ·{" "}
      <span className="font-mono">{active.forge.baseUrl}</span>
    </>
  );
}
