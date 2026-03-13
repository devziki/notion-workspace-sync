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

// Wrap each check so synchronous throws (e.g. missing token) are also caught.
async function checkWorkspace(getClient: () => ReturnType<typeof getMainNotionClient>) {
  try {
    return await checkNotionConnection(getClient());
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

export async function GET() {
  const [mainResult, otherResult] = await Promise.allSettled([
    checkWorkspace(getMainNotionClient),
    checkWorkspace(getOtherNotionClient),
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
