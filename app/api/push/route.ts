/**
 * POST /api/push
 *
 * Manual push endpoint: copies a page from the Main workspace to the Other
 * workspace and stores the page ID pair in Vercel KV for ongoing sync.
 *
 * Request body:
 *   { pageId: string }   — the Main workspace page ID to push
 *
 * This endpoint is called from the Mapping UI dashboard.
 * All Notion API calls are server-side only.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TODO: import getMainNotionClient, getOtherNotionClient, kv once
// full push logic is implemented.

export async function POST(request: NextRequest) {
  let pageId: string;
  try {
    const body = (await request.json()) as { pageId?: string };
    if (!body.pageId || typeof body.pageId !== "string") {
      return NextResponse.json(
        { error: "pageId is required" },
        { status: 400 }
      );
    }
    pageId = body.pageId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // TODO: implement full push flow:
  //   1. Fetch page + blocks from Main workspace
  //   2. Download + re-upload Notion-hosted images to Other workspace
  //   3. Recreate page in Other workspace block by block
  //   4. Store sync:page:{pageId} → { other_id, synced_at } in KV
  //   5. Return both page IDs

  console.log(`[push] Push requested for page: ${pageId}`);

  return NextResponse.json({
    ok: true,
    message: "Push endpoint scaffolded — full implementation pending",
    pageId,
  });
}
