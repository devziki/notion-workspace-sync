/**
 * GET /api/cron/meetings-eod
 *
 * End-of-day cron — auto-pushes meetings from Main → Other workspace.
 * Currently disabled; will be enabled in a later iteration.
 */

import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ skipped: true, reason: "not enabled" });
}
