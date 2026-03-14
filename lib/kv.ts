/**
 * Vercel KV helpers for the sync engine.
 *
 * Key schema:
 *   sync:page:{main_page_id}   → SyncPagePair  (Feature 1)
 *   sync:reverse:{other_id}    → main_page_id  (Feature 1)
 *   sync:lock:{page_id}        → 1 (10 s TTL)  (Feature 2 — loop prevention)
 *
 * Entity mappings (project / sprint / user) live in Supabase — see lib/mappings.ts.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Page pair (created by Feature 1, consumed by Features 2, 3, 4)
// ---------------------------------------------------------------------------

export interface SyncPagePair {
  other_id: string;
  synced_at: string; // ISO timestamp of last push
}

export async function getSyncPair(
  mainPageId: string
): Promise<SyncPagePair | null> {
  return kv.get<SyncPagePair>(`sync:page:${mainPageId}`);
}

export async function setSyncPair(
  mainPageId: string,
  pair: SyncPagePair
): Promise<void> {
  await kv.set(`sync:page:${mainPageId}`, pair);
}

/** Reverse lookup: given an Other workspace page ID, find the Main page ID. */
export async function getMainIdForOther(
  otherPageId: string
): Promise<string | null> {
  return kv.get<string>(`sync:reverse:${otherPageId}`);
}

/** Store both the forward (main→other) and reverse (other→main) lookups. */
export async function setFullSyncPair(
  mainPageId: string,
  otherPageId: string,
  syncedAt: string
): Promise<void> {
  await Promise.all([
    kv.set(`sync:page:${mainPageId}`, {
      other_id: otherPageId,
      synced_at: syncedAt,
    } satisfies SyncPagePair),
    kv.set(`sync:reverse:${otherPageId}`, mainPageId),
  ]);
}

// ---------------------------------------------------------------------------
// Sync lock — loop prevention (Feature 2)
// ---------------------------------------------------------------------------

const LOCK_TTL_SECONDS = 10;

/**
 * Returns true if the given page ID has an active sync lock.
 * A lock means we just wrote a property update to this page and the resulting
 * webhook should be ignored to prevent an A→B→A infinite loop.
 */
export async function getSyncLock(pageId: string): Promise<boolean> {
  const val = await kv.get(`sync:lock:${pageId}`);
  return val !== null;
}

/**
 * Sets a sync lock on the given page for LOCK_TTL_SECONDS seconds.
 * Call this BEFORE writing a property update to a page.
 */
export async function setSyncLock(pageId: string): Promise<void> {
  await kv.set(`sync:lock:${pageId}`, 1, { ex: LOCK_TTL_SECONDS });
}
