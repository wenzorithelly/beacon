import { getVersion } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// Server-Sent Events: emits the sync version whenever it changes (server-side
// poll feeding a client push). The client refreshes the open map on change.
export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      let last = -1;
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      const tick = async () => {
        if (closed) return;
        try {
          const v = await getVersion();
          if (v !== last) {
            last = v;
            controller.enqueue(encoder.encode(`data: ${v}\n\n`));
          }
        } catch {
          // ignore transient DB errors; keep the stream alive
        }
        if (!closed) setTimeout(tick, 1000);
      };
      void tick();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
