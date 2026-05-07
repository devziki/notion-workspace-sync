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
import { waitUntil } from "@vercel/functions";

export const dynamic = "force-dynamic";
import { verifyNotionSignature } from "@/lib/webhook";
import { syncOtherToMain, syncCommentToMain, syncCommentUpdateToMain } from "@/lib/sync";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(rawBody); } catch { /* ignore */ }

  // Notion verification challenge — respond before signature check
  if (parsed.verification_token) {
    console.log(`[webhook/other] Verification token: ${parsed.verification_token}`);
    return NextResponse.json({ verification_token: parsed.verification_token });
  }

  const secret = process.env.NOTION_WEBHOOK_SECRET_OTHER;
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
  console.log(`[webhook/other] Received event: ${eventType} — full:`, JSON.stringify(event).slice(0, 1000));

  if (eventType === "page.updated") {
    const pageId = (event?.entity as Record<string, unknown>)?.id as
      | string
      | undefined;
    if (pageId) {
      waitUntil(
        syncOtherToMain(pageId).catch((err) =>
          console.error(`[webhook/other] syncOtherToMain error for ${pageId}:`, err)
        )
      );
    }
  }

  if (eventType === "comment.created") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (event?.data as Record<string, any>) ?? {};
    const otherPageId = (data?.page_id ?? data?.parent?.id) as string | undefined;
    const otherCommentId = (event?.entity as Record<string, unknown>)?.id as string | undefined;

    if (otherPageId && otherCommentId) {
      waitUntil(
        syncCommentToMain(otherPageId, otherCommentId).catch((err) =>
          console.error(`[webhook/other] syncCommentToMain error:`, err)
        )
      );
    }
  }

  if (eventType === "comment.updated") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (event?.data as Record<string, any>) ?? {};
    const otherPageId = (data?.page_id ?? data?.parent?.id) as string | undefined;
    const otherCommentId = (event?.entity as Record<string, unknown>)?.id as string | undefined;

    if (otherPageId && otherCommentId) {
      waitUntil(
        syncCommentUpdateToMain(otherPageId, otherCommentId).catch((err) =>
          console.error(`[webhook/other] syncCommentUpdateToMain error:`, err)
        )
      );
    }
  }

  return NextResponse.json({ received: true, event: eventType });
}
