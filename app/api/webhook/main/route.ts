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
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
import { verifyNotionSignature } from "@/lib/webhook";
import { syncMainToOther, syncCommentToOther } from "@/lib/sync";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  console.log(`[webhook/main] HIT — body: ${rawBody.slice(0, 500)}`);
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(rawBody); } catch { /* ignore */ }

  // Notion verification challenge — respond before signature check
  if (parsed.verification_token) {
    console.log(`[webhook/main] Verification token: ${parsed.verification_token}`);
    return NextResponse.json({ verification_token: parsed.verification_token });
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET_MAIN;
  if (secret) {
    const sig = request.headers.get("x-notion-signature");
    if (!verifyNotionSignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let event: Record<string, unknown> = {};
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = (event?.type as string) ?? "unknown";
  console.log(`[webhook/main] Received event: ${eventType} — full:`, JSON.stringify(event).slice(0, 1000));

  if (eventType === "page.updated") {
    // entity.id is the page that was updated
    const pageId = (event?.entity as Record<string, unknown>)?.id as
      | string
      | undefined;
    if (pageId) {
      waitUntil(
        syncMainToOther(pageId).catch((err) =>
          console.error(`[webhook/main] syncMainToOther error for ${pageId}:`, err)
        )
      );
    }
  }

  if (eventType === "comment.created") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (event?.data as Record<string, any>) ?? {};
    const mainPageId = (data?.page_id ?? data?.parent?.id) as string | undefined;
    const mainCommentId = (event?.entity as Record<string, unknown>)?.id as string | undefined;

    if (mainPageId && mainCommentId) {
      waitUntil(
        syncCommentToOther(mainPageId, mainCommentId).catch((err) =>
          console.error(`[webhook/main] syncCommentToOther error:`, err)
        )
      );
    }
  }

  // Always acknowledge promptly — Notion will retry if we don't respond
  // within a few seconds.
  return NextResponse.json({ received: true, event: eventType });
}
