/**
 * Mapping table helpers — backed by Supabase (Postgres).
 *
 * Three tables store the entity ID translations used by the sync engine
 * (Feature 2) and populated by the Mapping UI (Feature 5):
 *
 *   project_mappings  (main_id, other_id)
 *   sprint_mappings   (main_id, other_id)
 *   user_mappings     (delegate_value, other_user_id)
 *
 * Sprint mappings are auto-discovered by matching Timeframe date ranges across
 * the two sprint databases and cached in sprint_mappings for reuse.
 *
 * See supabase/schema.sql for the CREATE TABLE statements.
 */

import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { getMainNotionClient, getOtherNotionClient } from "./notion";
import { getSupabaseClient } from "./supabase";

// ---------------------------------------------------------------------------
// Project mappings
// ---------------------------------------------------------------------------

export async function getProjectMapping(
  mainId: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("project_mappings")
    .select("other_id")
    .eq("main_id", mainId)
    .maybeSingle();
  return data?.other_id ?? null;
}

export async function getReverseProjectMapping(
  otherId: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("project_mappings")
    .select("main_id")
    .eq("other_id", otherId)
    .maybeSingle();
  return data?.main_id ?? null;
}

// ---------------------------------------------------------------------------
// Sprint mappings — auto-discovered by Timeframe, cached in Supabase
// ---------------------------------------------------------------------------

/**
 * Given a Main sprint page ID, find the matching Other sprint page ID by
 * comparing Timeframe (start + end date). Result is cached in sprint_mappings.
 */
export async function getSprintMapping(mainId: string): Promise<string | null> {
  const sb = getSupabaseClient();

  // Fast path: cached mapping
  const { data: cached } = await sb
    .from("sprint_mappings")
    .select("other_id")
    .eq("main_id", mainId)
    .maybeSingle();
  if (cached?.other_id) return cached.other_id;

  // Slow path: match by Timeframe across sprint databases
  const otherId = await matchOtherSprintByTimeframe(mainId);
  if (!otherId) return null;

  // Cache for future lookups
  await sb.from("sprint_mappings").upsert({ main_id: mainId, other_id: otherId });
  return otherId;
}

export async function getReverseSprintMapping(
  otherId: string
): Promise<string | null> {
  const sb = getSupabaseClient();

  // Fast path: cached mapping
  const { data: cached } = await sb
    .from("sprint_mappings")
    .select("main_id")
    .eq("other_id", otherId)
    .maybeSingle();
  if (cached?.main_id) return cached.main_id;

  // Slow path: match by Timeframe in reverse
  const mainId = await matchMainSprintByTimeframe(otherId);
  if (!mainId) return null;

  // Cache for future lookups
  await sb.from("sprint_mappings").upsert({ main_id: mainId, other_id: otherId });
  return mainId;
}

/**
 * Fetch a Main sprint's Timeframe, then find an Other sprint with the same
 * start + end date in the Other sprints database.
 */
async function matchOtherSprintByTimeframe(
  mainSprintId: string
): Promise<string | null> {
  const otherSprintsDbId = process.env.OTHER_SPRINTS_DATABASE_ID;
  if (!otherSprintsDbId) {
    console.warn("[mappings] OTHER_SPRINTS_DATABASE_ID not set — sprint matching skipped");
    return null;
  }

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  // Fetch the Main sprint to read its Timeframe
  let mainSprint: PageObjectResponse;
  try {
    mainSprint = (await main.pages.retrieve({ page_id: mainSprintId })) as PageObjectResponse;
  } catch (err) {
    console.error(`[mappings] Failed to fetch Main sprint ${mainSprintId}:`, err instanceof Error ? err.message : err);
    await getSupabaseClient().from("sync_errors").insert({ page_id: mainSprintId, error: `Sprint fetch failed: ${err instanceof Error ? err.message : String(err)}` });
    return null;
  }

  const tf = mainSprint.properties["Timeframe"];
  if (tf?.type !== "date" || !tf.date) {
    console.warn(`[mappings] Main sprint ${mainSprintId} has no Timeframe property`);
    return null;
  }
  const { start, end } = tf.date;

  // Fetch all Other sprints and match by Timeframe in code
  const allOtherSprints: PageObjectResponse[] = [];
  let cursor: string | undefined;
  try {
    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryResult = await (other as any).dataSources.query({
        data_source_id: otherSprintsDbId,
        ...(cursor ? { start_cursor: cursor } : {}),
        page_size: 100,
      });
      const results: PageObjectResponse[] = queryResult?.results ?? [];
      allOtherSprints.push(...results);
      cursor = queryResult?.has_more ? queryResult.next_cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`[mappings] Failed to query Other sprints DB ${otherSprintsDbId}:`, err instanceof Error ? err.message : err);
    await getSupabaseClient().from("sync_errors").insert({ page_id: mainSprintId, error: `Other sprints query failed: ${err instanceof Error ? err.message : String(err)}` });
    return null;
  }

  console.log(`[mappings] Fetched ${allOtherSprints.length} Other sprints, looking for Timeframe ${start}→${end}`);

  for (const page of allOtherSprints) {
    if (!("properties" in page)) continue;
    const otherTf = (page as PageObjectResponse).properties["Timeframe"];
    if (otherTf?.type !== "date" || !otherTf.date) continue;
    console.log(`  Other sprint ${page.id}: ${otherTf.date.start}→${otherTf.date.end}`);
    if (otherTf.date.start === start && otherTf.date.end === end) {
      console.log(`[mappings] Matched Other sprint ${page.id}`);
      return page.id;
    }
  }

  console.warn(`[mappings] No Other sprint found matching Timeframe ${start} → ${end}`);
  return null;
}

/**
 * Fetch an Other sprint's Timeframe, then find a Main sprint with the same
 * start + end date in the Main sprints database.
 */
async function matchMainSprintByTimeframe(
  otherSprintId: string
): Promise<string | null> {
  const mainSprintsDbId = process.env.MAIN_SPRINTS_DATABASE_ID;
  if (!mainSprintsDbId) {
    console.warn("[mappings] MAIN_SPRINTS_DATABASE_ID not set — sprint matching skipped");
    return null;
  }

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  // Fetch the Other sprint to read its Timeframe
  const otherSprint = (await other.pages.retrieve({
    page_id: otherSprintId,
  })) as PageObjectResponse;

  const tf = otherSprint.properties["Timeframe"];
  if (tf?.type !== "date" || !tf.date) return null;
  const { start, end } = tf.date;

  // Fetch all Main sprints and match by Timeframe in code
  const allMainSprints: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryResult = await (main as any).dataSources.query({
      data_source_id: mainSprintsDbId,
      ...(cursor ? { start_cursor: cursor } : {}),
      page_size: 100,
    });
    const results: PageObjectResponse[] = queryResult?.results ?? [];
    allMainSprints.push(...results);
    cursor = queryResult?.has_more ? queryResult.next_cursor : undefined;
  } while (cursor);

  for (const page of allMainSprints) {
    if (!("properties" in page)) continue;
    const mainTf = (page as PageObjectResponse).properties["Timeframe"];
    if (mainTf?.type !== "date" || !mainTf.date) continue;
    if (mainTf.date.start === start && mainTf.date.end === end) {
      return page.id;
    }
  }

  console.warn(`[mappings] No Main sprint found matching Timeframe ${start} → ${end}`);
  return null;
}

// ---------------------------------------------------------------------------
// User mappings
// ---------------------------------------------------------------------------

/** "Delegated To" select value (e.g. "Marek") → Other workspace Notion user ID. */
export async function getUserMapping(
  delegateValue: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("user_mappings")
    .select("other_user_id")
    .eq("delegate_value", delegateValue)
    .maybeSingle();
  return data?.other_user_id ?? null;
}

/** Other workspace Notion user ID → "Delegated To" select value. */
export async function getReverseUserMapping(
  otherUserId: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("user_mappings")
    .select("delegate_value")
    .eq("other_user_id", otherUserId)
    .maybeSingle();
  return data?.delegate_value ?? null;
}

// ---------------------------------------------------------------------------
// Status mappings — Main status name → Other status name
// ---------------------------------------------------------------------------

/** Main status name → Other status name. */
export async function getStatusMapping(
  mainStatus: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("status_mappings")
    .select("other_status")
    .eq("main_status", mainStatus)
    .maybeSingle();
  return data?.other_status ?? null;
}

/** Other status name → Main status name. */
export async function getReverseStatusMapping(
  otherStatus: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("status_mappings")
    .select("main_status")
    .eq("other_status", otherStatus)
    .limit(1);
  return data && data.length > 0 ? data[0].main_status : null;
}
