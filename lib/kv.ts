/**
 * Vercel KV helpers for the sync engine.
 *
 * Key schema:
 *   sync:page:{main_page_id}          → SyncPagePair
 *   sync:lock:{page_id}               → SyncLock  (Feature 2 — loop prevention)
 *   mapping:project:{main_project_id} → { other_project_id }  (Feature 5)
 *   mapping:sprint:{main_sprint_id}   → { other_sprint_id }   (Feature 5)
 *   mapping:user:{delegate_value}     → { other_notion_user_id } (Feature 5)
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

// ---------------------------------------------------------------------------
// Entity mappings — populated by Feature 5 (Mapping UI)
// ---------------------------------------------------------------------------

export async function getProjectMapping(
  mainProjectId: string
): Promise<string | null> {
  const val = await kv.get<{ other_id: string }>(
    `mapping:project:${mainProjectId}`
  );
  return val?.other_id ?? null;
}

export async function getReverseProjectMapping(
  otherProjectId: string
): Promise<string | null> {
  const val = await kv.get<{ main_id: string }>(
    `mapping:project:reverse:${otherProjectId}`
  );
  return val?.main_id ?? null;
}

export async function getSprintMapping(
  mainSprintId: string
): Promise<string | null> {
  const val = await kv.get<{ other_id: string }>(
    `mapping:sprint:${mainSprintId}`
  );
  return val?.other_id ?? null;
}

export async function getReverseSprintMapping(
  otherSprintId: string
): Promise<string | null> {
  const val = await kv.get<{ main_id: string }>(
    `mapping:sprint:reverse:${otherSprintId}`
  );
  return val?.main_id ?? null;
}

/** Maps a "Delegated To" select value (e.g. "Marek") → Other workspace user ID. */
export async function getUserMapping(
  delegateValue: string
): Promise<string | null> {
  const val = await kv.get<{ other_user_id: string }>(
    `mapping:user:${delegateValue}`
  );
  return val?.other_user_id ?? null;
}

/** Reverse: Other workspace user ID → "Delegated To" select value. */
export async function getReverseUserMapping(
  otherUserId: string
): Promise<string | null> {
  const val = await kv.get<{ delegate_value: string }>(
    `mapping:user:reverse:${otherUserId}`
  );
  return val?.delegate_value ?? null;
}
