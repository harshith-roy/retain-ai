import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";

/**
 * Inngest serve endpoint. Public by design: the SDK verifies every request's
 * signature with INNGEST_SIGNING_KEY. We refuse to serve at all without the
 * key and force cloud mode so dev-mode (unsigned) handling can never apply.
 */
async function handle(request: Request) {
  if (!process.env["INNGEST_SIGNING_KEY"])
    return new Response("Workflow endpoint is not configured.", { status: 503 });
  const { inngest, functions } = await import("@/lib/notify/workflows.server");
  return serve({ client: inngest, functions })(request);
}

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      PUT: ({ request }) => handle(request),
    },
  },
});
