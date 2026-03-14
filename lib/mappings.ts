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
 * See supabase/schema.sql for the CREATE TABLE statements.
 */

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
// Sprint mappings
// ---------------------------------------------------------------------------

export async function getSprintMapping(mainId: string): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("sprint_mappings")
    .select("other_id")
    .eq("main_id", mainId)
    .maybeSingle();
  return data?.other_id ?? null;
}

export async function getReverseSprintMapping(
  otherId: string
): Promise<string | null> {
  const { data } = await getSupabaseClient()
    .from("sprint_mappings")
    .select("main_id")
    .eq("other_id", otherId)
    .maybeSingle();
  return data?.main_id ?? null;
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
