/**
 * POST /api/webhook/button/files
 *
 * Notion button webhook — pushes a Files page from Main → Other workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
export const dynamic = "force-dynamic";

import { pushContentToOther } from "@/lib/content-push";
import { getSupabaseClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  console.log("[webhook/button/files] Raw payload:", rawBody);

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data = (body?.data ?? body?.entity ?? body?.page ?? body) as Record<string, unknown>;
  const pageId = (data?.id ?? body?.id) as string | undefined;

  if (!pageId) {
    console.error("[webhook/button/files] No page ID in payload:", body);
    return NextResponse.json(
      { error: "Could not determine page ID", received: body },
      { status: 400 }
    );
  }

  console.log(`[webhook/button/files] Pushing file page ${pageId}`);

  waitUntil(
    pushContentToOther("files", pageId)
      .then((result) => {
        console.log(
          `[webhook/button/files] Push complete — ${result.alreadyExisted ? "updated" : "created"} Other page ${result.otherPageId}`
        );
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[webhook/button/files] Push failed for page ${pageId}:`, msg);
        await getSupabaseClient().from("sync_errors").insert({ page_id: pageId, error: msg });
      })
  );

  return NextResponse.json({ received: true, pageId });
}
