import "server-only";

import fs from "node:fs";

import { getProjectsRoot } from "@/lib/env";
import { projectRoot } from "@/lib/project-store";

export function deleteProject(projectId: string): void {
  const root = projectRoot(projectId);
  if (!fs.existsSync(root)) {
    throw new Error("Project not found");
  }
  fs.rmSync(root, { recursive: true, force: true });
}

export function projectsRootExists(): boolean {
  return fs.existsSync(getProjectsRoot());
}
