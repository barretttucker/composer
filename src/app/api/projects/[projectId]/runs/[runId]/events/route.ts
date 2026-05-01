import { subscribeOrchestrator } from "@/lib/orchestrator/broadcast";

export const runtime = "nodejs";

type Params = { params: Promise<{ projectId: string; runId: string }> };

export async function GET(_req: Request, context: Params) {
  const { projectId, runId } = await context.params;
  const encoder = new TextEncoder();

  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      send({ type: "connected", projectId, runId });

      const unsub = subscribeOrchestrator(projectId, runId, (payload) => {
        send(payload);
      });

      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", ts: Date.now() });
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
