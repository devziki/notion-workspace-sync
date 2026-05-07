/**
 * Page pair and sync lock helpers — backed by Supabase (Postgres).
 *
 * Tables:
 *   page_pairs   (main_id, other_id, synced_at)
 *   sync_locks   (page_id, expires_at)
 */

import { getSupabaseClient } from "./supabase";

// ---------------------------------------------------------------------------
// Page pair (created by Feature 1, consumed by Features 2, 3, 4)
// ---------------------------------------------------------------------------

export interface SyncPagePair {
  other_id: string;
  synced_at: string;
}

export async function getSyncPair(mainPageId: string): Promise<SyncPagePair | null> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from("page_pairs")
    .select("other_id, synced_at")
    .eq("main_id", mainPageId)
    .maybeSingle();
  if (!data) return null;
  return { other_id: data.other_id, synced_at: data.synced_at };
}

export async function getMainIdForOther(otherPageId: string): Promise<string | null> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from("page_pairs")
    .select("main_id")
    .eq("other_id", otherPageId)
    .maybeSingle();
  return data?.main_id ?? null;
}

export async function setFullSyncPair(
  mainPageId: string,
  otherPageId: string,
  syncedAt: string
): Promise<void> {
  const sb = getSupabaseClient();
  await sb.from("page_pairs").upsert({
    main_id: mainPageId,
    other_id: otherPageId,
    synced_at: syncedAt,
  });
}

// ---------------------------------------------------------------------------
// Sync lock — loop prevention (Feature 2)
// ---------------------------------------------------------------------------

const LOCK_TTL_SECONDS = 10;

export async function getSyncLock(pageId: string): Promise<boolean> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from("sync_locks")
    .select("expires_at")
    .eq("page_id", pageId)
    .maybeSingle();
  if (!data) return false;
  return new Date(data.expires_at) > new Date();
}

export async function setSyncLock(pageId: string): Promise<void> {
  const sb = getSupabaseClient();
  const expiresAt = new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString();
  await sb.from("sync_locks").upsert({ page_id: pageId, expires_at: expiresAt });
}

// ---------------------------------------------------------------------------
// Comment pairs — loop prevention for comment relay (Feature 3)
// ---------------------------------------------------------------------------

export async function setCommentPair(
  mainCommentId: string,
  otherCommentId: string
): Promise<void> {
  await getSupabaseClient()
    .from("comment_pairs")
    .insert({ main_comment_id: mainCommentId, other_comment_id: otherCommentId });
}

/** Returns true if this Main comment was already relayed FROM Other (skip it). */
export async function isMainCommentSynced(mainCommentId: string): Promise<boolean> {
  const { data } = await getSupabaseClient()
    .from("comment_pairs")
    .select("main_comment_id")
    .eq("main_comment_id", mainCommentId)
    .maybeSingle();
  return data !== null;
}

/** Returns true if this Other comment was already relayed FROM Main (skip it). */
export async function isOtherCommentSynced(otherCommentId: string): Promise<boolean> {
  const { data } = await getSupabaseClient()
    .from("comment_pairs")
    .select("other_comment_id")
    .eq("other_comment_id", otherCommentId)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Content-type-aware page pairs (files, meetings, updates)
// ---------------------------------------------------------------------------

export async function getContentSyncPair(
  mainPageId: string,
  contentType: string
): Promise<{ other_id: string; synced_at: string } | null> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from("page_pairs")
    .select("other_id, synced_at")
    .eq("main_id", mainPageId)
    .eq("content_type", contentType)
    .maybeSingle();
  if (!data) return null;
  return { other_id: data.other_id, synced_at: data.synced_at };
}

export async function setContentSyncPair(
  mainPageId: string,
  otherPageId: string,
  contentType: string,
  syncedAt: string
): Promise<void> {
  const sb = getSupabaseClient();
  await sb.from("page_pairs").upsert({
    main_id: mainPageId,
    other_id: otherPageId,
    content_type: contentType,
    synced_at: syncedAt,
  });
}

export async function getMainIdForOtherContent(
  otherPageId: string,
  contentType: string
): Promise<string | null> {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from("page_pairs")
    .select("main_id")
    .eq("other_id", otherPageId)
    .eq("content_type", contentType)
    .maybeSingle();
  return data?.main_id ?? null;
}
