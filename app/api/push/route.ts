/**
 * POST /api/push
 *
 * Manually pushes a page from the Main workspace into the Other workspace.
 * Called from the Mapping UI dashboard (Feature 5) or directly via curl/Postman.
 *
 * Request body:
 * {
 *   pageId:            string   — Main workspace page ID to push (required)
 *   targetParentId:    string   — Other workspace database or page ID (required)
 *   targetParentType?: "database_id" | "page_id"  (default: "database_id")
 *   titlePropertyName?: string  — title property name in Other DB (default: "Name")
 *   force?:            boolean  — overwrite even if already pushed (default: false)
 * }
 *
 * Response 200 — page pushed successfully:
 * { ok: true, alreadyExisted: false, mainPageId, otherPageId, syncedAt }
 *
 * Response 200 — page already pushed, force not set:
 * { ok: true, alreadyExisted: true, mainPageId, otherPageId, syncedAt, message }
 *
 * Response 400 — missing / invalid params
 * Response 500 — push failed (detail included)
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { pushPageToOther } from "@/lib/push";

export async function POST(request: NextRequest) {
  // ── Parse body ────────────────────────────────────────────────────────────
  let body: {
    pageId?: string;
    targetParentId?: string;
    targetParentType?: "database_id" | "page_id";
    titlePropertyName?: string;
    force?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.pageId || typeof body.pageId !== "string") {
    return NextResponse.json(
      { error: "pageId is required and must be a string" },
      { status: 400 }
    );
  }
  if (!body.targetParentId || typeof body.targetParentId !== "string") {
    return NextResponse.json(
      { error: "targetParentId is required and must be a string" },
      { status: 400 }
    );
  }
  if (
    body.targetParentType !== undefined &&
    body.targetParentType !== "database_id" &&
    body.targetParentType !== "page_id"
  ) {
    return NextResponse.json(
      { error: 'targetParentType must be "database_id" or "page_id"' },
      { status: 400 }
    );
  }

  // ── Execute push ──────────────────────────────────────────────────────────
  try {
    const result = await pushPageToOther({
      mainPageId: body.pageId,
      targetParentId: body.targetParentId,
      targetParentType: body.targetParentType,
      titlePropertyName: body.titlePropertyName,
      force: body.force,
    });

    if (result.alreadyExisted) {
      return NextResponse.json({
        ok: true,
        alreadyExisted: true,
        mainPageId: result.mainPageId,
        otherPageId: result.otherPageId,
        syncedAt: result.syncedAt,
        message:
          "Page already synced. Pass force:true to overwrite the body, or call the re-sync endpoint to update properties only.",
      });
    }

    return NextResponse.json({
      ok: true,
      alreadyExisted: false,
      mainPageId: result.mainPageId,
      otherPageId: result.otherPageId,
      syncedAt: result.syncedAt,
    });
  } catch (err) {
    console.error("[push] Push failed:", err);
    return NextResponse.json(
      { error: "Push failed", detail: String(err) },
      { status: 500 }
    );
  }
}
