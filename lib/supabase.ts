/**
 * Supabase client singleton (server-side only).
 *
 * Uses the service role key so API routes can read/write mapping tables
 * without row-level security getting in the way.
 *
 * Tables (create via supabase/schema.sql):
 *   project_mappings  — main_id ↔ other_id for Project relations
 *   sprint_mappings   — main_id ↔ other_id for Sprint relations
 *   user_mappings     — delegate_value ↔ other_user_id for Delegated To / Assignee
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}
