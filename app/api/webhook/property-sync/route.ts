/**
 * POST /api/webhook/property-sync
 *
 * Triggered by a Notion database automation ("When property is edited →
 * Send HTTP request"). Receives the same full-page payload as the button
 * webhook but only syncs mapped metadata (no block re-sync).
 *
 * Flow:
 *   1. Extract page ID + current properties from the automation payload
 *   2. Look up the sync pair — if not pushed yet, ignore
 *   3. Translate properties via buildOtherUpdate
 *   4. PATCH the Other workspace page (properties only, body unchanged)
 */

import { NextRequest, NextResponse } from "next/server";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { getOtherNotionClient } from "@/lib/notion";
import { getSyncPair, getSyncLock, setSyncLock } from "@/lib/kv";
import { buildOtherUpdate } from "@/lib/sync";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  console.log("[webhook/property-sync] Raw payload:", rawBody.slice(0, 300));

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Extract page ID and properties from the Notion automation payload
  const data = (body?.data ?? {}) as Record<string, unknown>;
  const pageId = data?.id as string | undefined;
  const properties = data?.properties as PageObjectResponse["properties"] | undefined;

  if (!pageId) {
    console.error("[webhook/property-sync] No page ID in payload");
    return NextResponse.json({ error: "No page ID", received: body }, { status: 400 });
  }

  console.log(`[webhook/property-sync] Property change on Main page ${pageId}`);

  try {
    // Loop prevention: if Main page is locked, we just wrote to it via other→main sync
    if (await getSyncLock(pageId)) {
      console.log(`[webhook/property-sync] Main page ${pageId} is locked — skipping`);
      return NextResponse.json({ received: true, pageId, skipped: true });
    }

    // Check if this page has been pushed to Other workspace
    const pair = await getSyncPair(pageId);
    if (!pair) {
      console.log(`[webhook/property-sync] Page ${pageId} not yet pushed — skipping`);
      return NextResponse.json({ received: true, pageId, skipped: true });
    }

    if (!properties) {
      console.error(`[webhook/property-sync] No properties in payload for ${pageId}`);
      return NextResponse.json({ received: true, pageId, skipped: true });
    }

    // Translate properties for the Other workspace
    const update = await buildOtherUpdate(properties);
    if (Object.keys(update).length === 0) {
      console.log(`[webhook/property-sync] No mapped properties changed for ${pageId}`);
      return NextResponse.json({ received: true, pageId, skipped: true });
    }

    const other = getOtherNotionClient();
    // Lock Other page before writing to suppress the return trip
    await setSyncLock(pair.other_id);
    await other.pages.update({
      page_id: pair.other_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: update as any,
    });

    console.log(
      `[webhook/property-sync] Synced [${Object.keys(update).join(", ")}] to Other page ${pair.other_id}`
    );

    return NextResponse.json({ received: true, pageId, synced: Object.keys(update) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[webhook/property-sync] Error for page ${pageId}:`, msg);
    await getSupabaseClient().from("sync_errors").insert({ page_id: pageId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
