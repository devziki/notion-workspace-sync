/**
 * Generic content push — Main → Other workspace for Files, Meetings, Updates.
 *
 * Uses property_name_mappings and select_option_mappings tables in Supabase to
 * drive property translation, keeping all config data-driven.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { getMainNotionClient, getOtherNotionClient } from "./notion";
import { getSupabaseClient } from "./supabase";
import { getContentSyncPair, setContentSyncPair } from "./kv";
import { appendBlocksRecursively, type BlockWithChildren } from "./blocks";
import { getProjectMapping } from "./mappings";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONTENT_CONFIGS = {
  files: {
    mainDbIdEnv: "FILES_MAIN_DB_ID",
    otherDbIdEnv: "FILES_OTHER_DB_ID",
    syncBody: false,
    skipBlockTypes: [] as string[],
  },
  meetings: {
    mainDbIdEnv: "MEETINGS_MAIN_DB_ID",
    otherDbIdEnv: "MEETINGS_OTHER_DB_ID",
    syncBody: true,
    skipBlockTypes: ["child_database", "link_to_page"],
  },
  updates: {
    mainDbIdEnv: "UPDATES_MAIN_DB_ID",
    otherDbIdEnv: "UPDATES_OTHER_DB_ID",
    syncBody: true,
    skipBlockTypes: [] as string[],
  },
} as const;

export type ContentType = keyof typeof CONTENT_CONFIGS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PropNameMapping {
  main_property: string;
  other_property: string;
  is_title: boolean;
}

interface SelectOptionMapping {
  main_property: string;
  main_value: string;
  other_value: string;
}

// ---------------------------------------------------------------------------
// Supabase loaders
// ---------------------------------------------------------------------------

async function loadPropMappings(contentType: ContentType): Promise<PropNameMapping[]> {
  const { data, error } = await getSupabaseClient()
    .from("property_name_mappings")
    .select("main_property, other_property, is_title")
    .eq("content_type", contentType);
  if (error) {
    console.error(`[content-push] Failed to load property_name_mappings for ${contentType}:`, error.message);
    return [];
  }
  return data ?? [];
}

async function loadOptionMappings(contentType: ContentType): Promise<SelectOptionMapping[]> {
  const { data, error } = await getSupabaseClient()
    .from("select_option_mappings")
    .select("main_property, main_value, other_value")
    .eq("content_type", contentType);
  if (error) {
    console.error(`[content-push] Failed to load select_option_mappings for ${contentType}:`, error.message);
    return [];
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Property builder
// ---------------------------------------------------------------------------

async function buildContentProperties(
  contentType: ContentType,
  sourceProps: PageObjectResponse["properties"],
  propMappings: PropNameMapping[],
  optionMappings: SelectOptionMapping[]
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  // Build a lookup: (mainProperty, mainValue) → otherValue
  const optionLookup = new Map<string, string>();
  for (const om of optionMappings) {
    optionLookup.set(`${om.main_property}::${om.main_value}`, om.other_value);
  }

  for (const pm of propMappings) {
    const sourceProp = sourceProps[pm.main_property];
    if (!sourceProp) continue;

    // Title
    if (pm.is_title) {
      if (sourceProp.type === "title") {
        result[pm.other_property] = { title: sourceProp.title };
      }
      continue;
    }

    // Date
    if (sourceProp.type === "date") {
      if (sourceProp.date) {
        result[pm.other_property] = {
          date: { start: sourceProp.date.start, end: sourceProp.date.end ?? null },
        };
      }
      continue;
    }

    // Select
    if (sourceProp.type === "select") {
      const mainValue = sourceProp.select?.name;
      if (mainValue) {
        const otherValue = optionLookup.get(`${pm.main_property}::${mainValue}`);
        if (otherValue) {
          result[pm.other_property] = { select: { name: otherValue } };
        }
        // no mapping found → skip
      }
      continue;
    }

    // Status
    if (sourceProp.type === "status") {
      const mainValue = sourceProp.status?.name;
      if (mainValue) {
        const otherValue = optionLookup.get(`${pm.main_property}::${mainValue}`);
        if (otherValue) {
          result[pm.other_property] = { status: { name: otherValue } };
        }
        // no mapping found → skip
      }
      continue;
    }

    // Relation named "Project" — translate via project_mappings
    if (sourceProp.type === "relation" && pm.main_property === "Project") {
      const otherRelations: { id: string }[] = [];
      for (const rel of sourceProp.relation) {
        const otherId = await getProjectMapping(rel.id);
        if (otherId) otherRelations.push({ id: otherId });
      }
      if (otherRelations.length > 0) {
        result[pm.other_property] = { relation: otherRelations };
      }
      continue;
    }

    // Person — skip cross-workspace
    if (sourceProp.type === "people") {
      continue;
    }

    // Rich text (non-title)
    if (sourceProp.type === "rich_text") {
      result[pm.other_property] = { rich_text: sourceProp.rich_text };
      continue;
    }

    // Checkbox
    if (sourceProp.type === "checkbox") {
      result[pm.other_property] = { checkbox: sourceProp.checkbox };
      continue;
    }

    // Number
    if (sourceProp.type === "number") {
      result[pm.other_property] = { number: sourceProp.number };
      continue;
    }

    // URL
    if (sourceProp.type === "url") {
      result[pm.other_property] = { url: sourceProp.url };
      continue;
    }

    // Email
    if (sourceProp.type === "email") {
      result[pm.other_property] = { email: sourceProp.email };
      continue;
    }

    // Phone
    if (sourceProp.type === "phone_number") {
      result[pm.other_property] = { phone_number: sourceProp.phone_number };
      continue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Block fetch
// ---------------------------------------------------------------------------

async function fetchBlocksRecursively(
  client: ReturnType<typeof getMainNotionClient>,
  blockId: string,
  depth = 0
): Promise<BlockWithChildren[]> {
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
        block._children = await fetchBlocksRecursively(client, block.id, depth + 1);
      }

      blocks.push(block);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function pushContentToOther(
  contentType: ContentType,
  mainPageId: string
): Promise<{ mainPageId: string; otherPageId: string; alreadyExisted: boolean }> {
  const config = CONTENT_CONFIGS[contentType];

  const otherDbId = process.env[config.otherDbIdEnv];
  if (!otherDbId) {
    throw new Error(`${config.otherDbIdEnv} is not set`);
  }

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  // Load all mappings + source page in parallel
  const [sourcePage, propMappings, optionMappings, existing] = await Promise.all([
    main.pages.retrieve({ page_id: mainPageId }) as Promise<PageObjectResponse>,
    loadPropMappings(contentType),
    loadOptionMappings(contentType),
    getContentSyncPair(mainPageId, contentType),
  ]);

  // Build translated properties
  const builtProps = await buildContentProperties(
    contentType,
    sourcePage.properties,
    propMappings,
    optionMappings
  );

  // Fetch blocks if body sync is needed
  let filteredRawBlocks: BlockWithChildren[] = [];
  if (config.syncBody) {
    const rawBlocks = await fetchBlocksRecursively(main, mainPageId);
    filteredRawBlocks = rawBlocks.filter(
      (b) => !(config.skipBlockTypes as readonly string[]).includes(b.type)
    );
  }

  const syncedAt = new Date().toISOString();

  if (existing) {
    // ── UPDATE path ────────────────────────────────────────────────────────
    const otherPageId = existing.other_id;

    try {
      const otherPage = await other.pages.retrieve({ page_id: otherPageId }) as PageObjectResponse;
      if (otherPage.archived) {
        await other.pages.update({ page_id: otherPageId, archived: false });
      }
      await Promise.all([
        other.pages.update({ page_id: otherPageId, properties: builtProps }),
        config.syncBody ? deleteAllBlocks(other, otherPageId) : Promise.resolve(),
      ]);
    } catch {
      console.warn(`[content-push] Other page ${otherPageId} not found, will recreate`);
      const newPage = await other.pages.create({
        parent: { database_id: otherDbId },
        properties: builtProps as any,
      });
      await setContentSyncPair(mainPageId, newPage.id, contentType, syncedAt);
      if (filteredRawBlocks.length) await appendBlocksRecursively(other, newPage.id, filteredRawBlocks);
      await main.pages.update({ page_id: mainPageId, properties: { "Synced to NS": { checkbox: true } } });
      return { mainPageId, otherPageId: newPage.id, alreadyExisted: true };
    }

    if (filteredRawBlocks.length) await appendBlocksRecursively(other, otherPageId, filteredRawBlocks);
    await setContentSyncPair(mainPageId, otherPageId, contentType, syncedAt);
    await main.pages.update({ page_id: mainPageId, properties: { "Synced to NS": { checkbox: true } } });

    console.log(`[content-push/${contentType}] updated Other page ${otherPageId} for Main ${mainPageId}`);
    return { mainPageId, otherPageId, alreadyExisted: true };
  }

  // ── CREATE path ──────────────────────────────────────────────────────────
  const newPage = await other.pages.create({
    parent: { database_id: otherDbId },
    properties: builtProps as any,
  });

  if (filteredRawBlocks.length) await appendBlocksRecursively(other, newPage.id, filteredRawBlocks);
  await setContentSyncPair(mainPageId, newPage.id, contentType, syncedAt);

  await main.pages.update({
    page_id: mainPageId,
    properties: { "Synced to NS": { checkbox: true } },
  });

  console.log(`[content-push/${contentType}] created Other page ${newPage.id} for Main ${mainPageId}`);
  return { mainPageId, otherPageId: newPage.id, alreadyExisted: false };
}
