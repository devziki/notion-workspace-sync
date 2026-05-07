/**
 * POST /api/webhook/property-sync-other
 *
 * Triggered by a Notion database automation in the Other (Notion State)
 * workspace ("When property is edited → Send HTTP request"). Receives the
 * same full-page payload format and syncs mapped metadata back to Main.
 *
 * Flow:
 *   1. Extract Other page ID + current properties from the automation payload
 *   2. Look up the sync pair (reverse) — if not a synced page, ignore
 *   3. Fetch the Main page to determine if the task is delegated
 *   4. Translate properties via buildMainUpdate (with isDelegated flag)
 *   5. PATCH the Main workspace page (properties only)
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
export const dynamic = "force-dynamic";

import { getMainNotionClient } from "@/lib/notion";
import { getMainIdForOther, getSyncLock, setSyncLock } from "@/lib/kv";
import { buildMainUpdate } from "@/lib/sync";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  console.log("[webhook/property-sync-other] Raw payload:", rawBody.slice(0, 300));

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = (body?.data ?? {}) as Record<string, unknown>;
  const otherPageId = data?.id as string | undefined;
  const properties = data?.properties as PageObjectResponse["properties"] | undefined;

  if (!otherPageId) {
    return NextResponse.json({ error: "No page ID" }, { status: 400 });
  }

  console.log(`[webhook/property-sync-other] Property change on Other page ${otherPageId}`);

  waitUntil(
    (async () => {
      // Loop prevention: if Other page is locked, we just wrote to it via main→other sync
      if (await getSyncLock(otherPageId)) {
        console.log(`[webhook/property-sync-other] Other page ${otherPageId} is locked — skipping`);
        return;
      }

      const mainPageId = await getMainIdForOther(otherPageId);
      if (!mainPageId) {
        console.log(`[webhook/property-sync-other] Other page ${otherPageId} not in a sync pair — skipping`);
        return;
      }

      if (!properties) {
        console.error(`[webhook/property-sync-other] No properties in payload for ${otherPageId}`);
        return;
      }

      // Fetch the Main page to check if this is a delegated task
      const main = getMainNotionClient();
      const mainPage = await main.pages.retrieve({ page_id: mainPageId }) as PageObjectResponse;
      const delegatedToProp = mainPage.properties["Delegated To"];
      const isDelegated = delegatedToProp?.type === "select" && delegatedToProp.select !== null;
      console.log(`[webhook/property-sync-other] isDelegated=${isDelegated}, delegatedToProp=`, JSON.stringify(delegatedToProp));

      const update = await buildMainUpdate(properties, isDelegated);
      if (Object.keys(update).length === 0) {
        console.log(`[webhook/property-sync-other] No mapped properties to update`);
        return;
      }

      // Lock Main page before writing to suppress the return trip
      await setSyncLock(mainPageId);
      await main.pages.update({
        page_id: mainPageId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: update as any,
      });

      console.log(
        `[webhook/property-sync-other] Synced [${Object.keys(update).join(", ")}] to Main page ${mainPageId} (isDelegated=${isDelegated})`
      );
    })().catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[webhook/property-sync-other] Error for Other page ${otherPageId}:`, msg);
      await getSupabaseClient().from("sync_errors").insert({ page_id: otherPageId, error: msg });
    })
  );

  return NextResponse.json({ received: true, otherPageId });
}
