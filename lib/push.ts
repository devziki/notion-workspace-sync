/**
 * Core push logic — Feature 1: Manual Push (Main → Other workspace).
 *
 * Flow:
 *   1. Check KV for existing sync pair (bail early if already pushed and !force)
 *   2. Fetch source page + all blocks recursively from Main workspace
 *   3. Convert blocks (re-upload Notion-hosted images)
 *   4. Create the page in the Other workspace under the given parent
 *   5. Append any overflow blocks (Notion limit: 100 per request)
 *   6. Store page ID pair in KV (both forward and reverse lookups)
 */

import type {
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { getMainNotionClient, getOtherNotionClient } from "./notion";
import { setFullSyncPair, getSyncPair } from "./kv";
import { convertBlocks, type BlockWithChildren } from "./blocks";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PushOptions {
  /** Page ID in the Main workspace to push. */
  mainPageId: string;
  /** Database or page ID in the Other workspace to create the new page under. */
  targetParentId: string;
  /** Whether the parent is a database or a page. Defaults to "database_id". */
  targetParentType?: "database_id" | "page_id";
  /**
   * The exact name of the title property in the Other workspace's database.
   * Only relevant when targetParentType is "database_id". Defaults to "Name".
   */
  titlePropertyName?: string;
  /**
   * When true, push even if a sync pair already exists (overwrites body).
   * Defaults to false.
   */
  force?: boolean;
}

export interface PushResult {
  mainPageId: string;
  otherPageId: string;
  syncedAt: string;
  /** True when a sync pair already existed and force was false — no push done. */
  alreadyExisted: boolean;
}

export async function pushPageToOther(
  options: PushOptions
): Promise<PushResult> {
  const {
    mainPageId,
    targetParentId,
    targetParentType = "database_id",
    titlePropertyName = "Name",
    force = false,
  } = options;

  // ── 1. Check for existing sync pair ──────────────────────────────────────
  const existing = await getSyncPair(mainPageId);
  if (existing && !force) {
    return {
      mainPageId,
      otherPageId: existing.other_id,
      syncedAt: existing.synced_at,
      alreadyExisted: true,
    };
  }

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  // ── 2. Fetch source page ──────────────────────────────────────────────────
  const sourcePage = (await main.pages.retrieve({
    page_id: mainPageId,
  })) as PageObjectResponse;

  const titleProp = Object.values(sourcePage.properties).find(
    (p) => p.type === "title"
  );
  const titleRichText: RichTextItemResponse[] =
    titleProp?.type === "title" ? titleProp.title : [];

  // ── 3. Fetch + convert blocks ─────────────────────────────────────────────
  const rawBlocks = await fetchBlocksRecursively(main, mainPageId);
  const convertedBlocks = await convertBlocks(rawBlocks);

  // ── 4. Build parent + properties ─────────────────────────────────────────
  const parent =
    targetParentType === "database_id"
      ? { database_id: targetParentId }
      : { page_id: targetParentId };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> =
    targetParentType === "database_id"
      ? { [titlePropertyName]: { title: titleRichText } }
      : { title: { title: titleRichText } };

  // ── 5. Create page with first 100 blocks ─────────────────────────────────
  const CHUNK = 100;
  const firstChunk = convertedBlocks.slice(0, CHUNK);
  const remainder = convertedBlocks.slice(CHUNK);

  const newPage = await other.pages.create({
    parent,
    properties,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: firstChunk as any,
  });

  // ── 6. Append remaining blocks in chunks ──────────────────────────────────
  for (let i = 0; i < remainder.length; i += CHUNK) {
    await other.blocks.children.append({
      block_id: newPage.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children: remainder.slice(i, i + CHUNK) as any,
    });
  }

  // ── 7. Persist KV pair ───────────────────────────────────────────────────
  const syncedAt = new Date().toISOString();
  await setFullSyncPair(mainPageId, newPage.id, syncedAt);

  return {
    mainPageId,
    otherPageId: newPage.id,
    syncedAt,
    alreadyExisted: false,
  };
}

// ---------------------------------------------------------------------------
// Block fetching
// ---------------------------------------------------------------------------

async function fetchBlocksRecursively(
  client: ReturnType<typeof getMainNotionClient>,
  blockId: string,
  depth = 0
): Promise<BlockWithChildren[]> {
  // Cap recursion to avoid runaway fetches on deeply nested pages
  if (depth > 3) return [];

  const blocks: BlockWithChildren[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const raw of response.results) {
      if (!("type" in raw)) continue;
      const block = raw as BlockWithChildren;

      if (block.has_children && depth < 3) {
        block._children = await fetchBlocksRecursively(
          client,
          block.id,
          depth + 1
        );
      }

      blocks.push(block);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}
