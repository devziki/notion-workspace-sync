/**
 * POST /api/webhook/other
 *
 * Receives Notion webhook events from the Other workspace integration
 * (ziki-sync-other). Signature is verified before any processing.
 *
 * Supported event types (to be implemented):
 *   - page.updated  → sync mapped properties back to the Main workspace
 *   - comment.created → relay comment from Other → Main
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { validateWebhook } from "@/lib/webhook";
import { syncOtherToMain } from "@/lib/sync";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    ({ body } = await validateWebhook(
      request,
      process.env.NOTION_WEBHOOK_SECRET_OTHER
    ));
  } catch (response) {
    if (response instanceof Response) return response;
    throw response;
  }

  const event = body as Record<string, unknown>;
  const eventType = (event?.type as string) ?? "unknown";

  console.log(`[webhook/other] Received event: ${eventType}`);

  if (eventType === "page.updated") {
    const pageId = (event?.entity as Record<string, unknown>)?.id as
      | string
      | undefined;
    if (pageId) {
      syncOtherToMain(pageId).catch((err) =>
        console.error(`[webhook/other] syncOtherToMain error for ${pageId}:`, err)
      );
    }
  }

  return NextResponse.json({ received: true, event: eventType });
}
