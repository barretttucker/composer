import { ComposerPanel } from "@/components/composer-panel";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ComposerPanel projectId={projectId} />;
}
