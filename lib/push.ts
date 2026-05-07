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
import { appendBlocksRecursively, type BlockWithChildren } from "./blocks";
import { buildOtherUpdate } from "./sync";

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
}

export interface PushResult {
  mainPageId: string;
  otherPageId: string;
  syncedAt: string;
  /** True when a sync pair already existed — page was updated, not created. */
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
  } = options;

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  // ── 1 & 2 & 3. Fetch page + blocks + sync pair in parallel ───────────────
  const [sourcePage, rawBlocks, existing] = await Promise.all([
    main.pages.retrieve({ page_id: mainPageId }) as Promise<PageObjectResponse>,
    fetchBlocksRecursively(main, mainPageId),
    getSyncPair(mainPageId),
  ]);

  const titleProp = Object.values(sourcePage.properties).find(
    (p) => p.type === "title"
  );
  const titleRichText: RichTextItemResponse[] =
    titleProp?.type === "title" ? titleProp.title : [];

  const [mappedPropsBase] = await Promise.all([
    buildOtherUpdate(sourcePage.properties),
  ]);

  const syncedAt = new Date().toISOString();

  if (existing) {
    // ── UPDATE path ──────────────────────────────────────────────────────────
    let otherPageId = existing.other_id;

    // Unarchive if needed, delete existing blocks — in parallel
    try {
      const otherPage = await other.pages.retrieve({ page_id: otherPageId }) as PageObjectResponse;
      const [propUpdate] = await Promise.all([
        Promise.resolve({ ...mappedPropsBase, [titlePropertyName]: { title: titleRichText } }),
        otherPage.archived
          ? other.pages.update({ page_id: otherPageId, archived: false })
          : Promise.resolve(null),
      ]);
      await Promise.all([
        other.pages.update({ page_id: otherPageId, properties: propUpdate }),
        deleteAllBlocks(other, otherPageId),
      ]);
    } catch {
      console.warn(`[push] Other page ${otherPageId} not found, will recreate`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newPage = await other.pages.create({
        parent: { database_id: targetParentId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: { [titlePropertyName]: { title: titleRichText } } as any,
      });
      otherPageId = newPage.id;
      await setFullSyncPair(mainPageId, otherPageId, syncedAt);
    }

    await appendBlocksRecursively(other, otherPageId, rawBlocks);
    await setFullSyncPair(mainPageId, otherPageId, syncedAt);
    console.log(`[push] updated existing Other page ${otherPageId} for Main ${mainPageId}`);

    return { mainPageId, otherPageId, syncedAt, alreadyExisted: true };
  }

  // ── CREATE path ───────────────────────────────────────────────────────────
  const parent =
    targetParentType === "database_id"
      ? { database_id: targetParentId }
      : { page_id: targetParentId };

  // Determine whether this task is delegated (Delegated To is set)
  const delegatedToProp = sourcePage.properties["Delegated To"];
  const isDelegated = delegatedToProp?.type === "select" && delegatedToProp.select !== null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {
    ...mappedPropsBase,
    [targetParentType === "database_id" ? titlePropertyName : "title"]: { title: titleRichText },
    // Delegated to someone → force "To Do" regardless of current Main status.
    // Self-assigned (empty Delegated To) → buildOtherUpdate already mapped the
    // real status into mappedPropsBase; only fall back to "To Do" if no mapping.
    ...(targetParentType === "database_id" && isDelegated
      ? { Status: { status: { name: "To Do" } } }
      : targetParentType === "database_id" && !mappedPropsBase["Status"]
        ? { Status: { status: { name: "To Do" } } }
        : {}),
  };

  const newPage = await other.pages.create({
    parent,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
  });

  await appendBlocksRecursively(other, newPage.id, rawBlocks);

  await setFullSyncPair(mainPageId, newPage.id, syncedAt);

  // Mark the Main page as synced
  await main.pages.update({
    page_id: mainPageId,
    properties: { "Synced To NS": { checkbox: true } },
  });

  console.log(`[push] created new Other page ${newPage.id} for Main ${mainPageId}`);

  return { mainPageId, otherPageId: newPage.id, syncedAt, alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

/** Delete all top-level blocks on a page (used during upsert to replace body). */
async function deleteAllBlocks(
  client: ReturnType<typeof getOtherNotionClient>,
  pageId: string
): Promise<void> {
  let cursor: string | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    await Promise.all(
      response.results.map((block) => client.blocks.delete({ block_id: block.id }))
    );
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
}

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
