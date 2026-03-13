/**
 * GET /api/health
 *
 * Verifies that both Notion integrations can connect and returns their status.
 * Used by Vercel deployment checks and the Mapping UI settings page.
 *
 * Response shape:
 * {
 *   ok: boolean,
 *   main:  { ok: boolean, botName?: string, error?: string },
 *   other: { ok: boolean, botName?: string, error?: string },
 *   checkedAt: string   // ISO timestamp
 * }
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import {
  getMainNotionClient,
  getOtherNotionClient,
  checkNotionConnection,
} from "@/lib/notion";

export async function GET() {
  const [mainResult, otherResult] = await Promise.allSettled([
    checkNotionConnection(getMainNotionClient()),
    checkNotionConnection(getOtherNotionClient()),
  ]);

  const main =
    mainResult.status === "fulfilled"
      ? mainResult.value
      : { ok: false as const, error: String((mainResult as PromiseRejectedResult).reason) };

  const other =
    otherResult.status === "fulfilled"
      ? otherResult.value
      : { ok: false as const, error: String((otherResult as PromiseRejectedResult).reason) };

  const allOk = main.ok && other.ok;

  return NextResponse.json(
    {
      ok: allOk,
      main,
      other,
      checkedAt: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
