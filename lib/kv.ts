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
