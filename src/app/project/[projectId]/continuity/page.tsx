import { ContinuityDashboard } from "@/components/continuity-dashboard";

export default async function ContinuityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ContinuityDashboard projectId={projectId} />;
}
