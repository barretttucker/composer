import "server-only";

const waiters = new Map<string, () => void>();

export function resumeKey(projectId: string, runId: string): string {
  return `${projectId}:${runId}`;
}

export function waitForContinue(projectId: string, runId: string): Promise<void> {
  const key = resumeKey(projectId, runId);
  return new Promise((resolve) => {
    waiters.set(key, resolve);
  });
}

export function signalContinue(projectId: string, runId: string): boolean {
  const key = resumeKey(projectId, runId);
  const fn = waiters.get(key);
  if (!fn) return false;
  waiters.delete(key);
  fn();
  return true;
}

export function clearContinue(projectId: string, runId: string): void {
  waiters.delete(resumeKey(projectId, runId));
}
