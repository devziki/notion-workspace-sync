/**
 * POST /api/webhook/button
 *
 * Receives Notion database button webhook actions from the Main workspace.
 * Extracts the page ID and triggers a full push (properties + content) to
 * the Other workspace. Fire-and-forget so Notion gets a fast 200 response.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
export const dynamic = "force-dynamic";

import { pushPageToOther } from "@/lib/push";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  console.log("[webhook/button] Raw payload:", rawBody);

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Extract page ID — try all known Notion button webhook payload shapes
  const data = (body?.data ?? body?.entity ?? body?.page ?? body) as Record<string, unknown>;
  const pageId = (data?.id ?? body?.id) as string | undefined;

  if (!pageId) {
    console.error("[webhook/button] No page ID in payload:", body);
    return NextResponse.json(
      { error: "Could not determine page ID", received: body },
      { status: 400 }
    );
  }

  const targetParentId = process.env.OTHER_DATABASE_ID;
  if (!targetParentId) {
    return NextResponse.json({ error: "OTHER_DATABASE_ID not set" }, { status: 500 });
  }

  console.log(`[webhook/button] Pushing page ${pageId} → Other DB ${targetParentId}`);

  // Use waitUntil so Vercel keeps the function alive after responding
  waitUntil(pushPageToOther({
    mainPageId: pageId,
    targetParentId,
    targetParentType: "database_id",
    titlePropertyName: "Task",
  }).then((result) => {
    console.log(
      `[webhook/button] Push complete — ${result.alreadyExisted ? "updated" : "created"} Other page ${result.otherPageId}`
    );
  }).catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[webhook/button] Push failed for page ${pageId}:`, msg);
    await getSupabaseClient().from("sync_errors").insert({ page_id: pageId, error: msg });
  }));

  return NextResponse.json({ received: true, pageId });
}
