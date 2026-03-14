/**
 * POST /api/webhook/main
 *
 * Receives Notion webhook events from the Main workspace integration
 * (ziki-sync-main). Signature is verified before any processing.
 *
 * Supported event types (to be implemented):
 *   - page.updated  → sync mapped properties to the Other workspace
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { validateWebhook } from "@/lib/webhook";
import { syncMainToOther } from "@/lib/sync";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    ({ body } = await validateWebhook(
      request,
      process.env.NOTION_WEBHOOK_SECRET_MAIN
    ));
  } catch (response) {
    // validateWebhook throws a Response on auth/validation failure.
    if (response instanceof Response) return response;
    throw response;
  }

  const event = body as Record<string, unknown>;
  const eventType = (event?.type as string) ?? "unknown";

  console.log(`[webhook/main] Received event: ${eventType}`);

  if (eventType === "page.updated") {
    // entity.id is the page that was updated
    const pageId = (event?.entity as Record<string, unknown>)?.id as
      | string
      | undefined;
    if (pageId) {
      // Fire-and-forget — acknowledge Notion immediately, sync in background
      syncMainToOther(pageId).catch((err) =>
        console.error(`[webhook/main] syncMainToOther error for ${pageId}:`, err)
      );
    }
  }

  // Always acknowledge promptly — Notion will retry if we don't respond
  // within a few seconds.
  return NextResponse.json({ received: true, event: eventType });
}
