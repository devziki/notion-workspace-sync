/**
 * Feature 2 — Webhook Property Sync (bidirectional).
 *
 * After a page has been pushed (Feature 1), changes to mapped properties in
 * either workspace are automatically mirrored to the counterpart page.
 *
 * Mapped properties:
 *   Main "Name / Title"  ↔  Other "Name / Title"   (direct copy)
 *   Main "Due Date"      ↔  Other "Due Date"        (direct copy)
 *   Main "Project"       ↔  Other "Project"         (translated via Supabase mapping)
 *   Main "Sprints"       ↔  Other "Sprints"         (translated via Supabase mapping)
 *   Main "Delegated To"  →  Other "Assignee"        (translated via Supabase user mapping)
 *   Other "Assignee"     →  Main "Delegated To"     (reverse user mapping)
 *
 * Property names default to sensible values but can be overridden per env var.
 * The Mapping UI (Feature 5) will let you configure them from the dashboard.
 *
 * Loop prevention:
 *   Before writing to page X, a 10-second KV lock is set on X.
 *   When the resulting webhook arrives for X, the handler detects the lock
 *   and skips processing — breaking the A→B→A cycle.
 */

import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { getMainNotionClient, getOtherNotionClient } from "./notion";
import {
  getSyncPair,
  getMainIdForOther,
  getSyncLock,
  setSyncLock,
} from "./kv";
import {
  getProjectMapping,
  getReverseProjectMapping,
  getSprintMapping,
  getReverseSprintMapping,
  getUserMapping,
  getReverseUserMapping,
} from "./mappings";

// ---------------------------------------------------------------------------
// Property name configuration
// Override via Vercel environment variables once the exact Other workspace
// schema is known. The Mapping UI (Feature 5) will surface these in the UI.
// ---------------------------------------------------------------------------

const PROPS = {
  main: {
    title: process.env.SYNC_MAIN_TITLE_PROP ?? "Name",
    dueDate: process.env.SYNC_MAIN_DUE_DATE_PROP ?? "Due Date",
    project: process.env.SYNC_MAIN_PROJECT_PROP ?? "Project",
    sprints: process.env.SYNC_MAIN_SPRINTS_PROP ?? "Sprints",
    delegatedTo: process.env.SYNC_MAIN_DELEGATED_TO_PROP ?? "Delegated To",
  },
  other: {
    title: process.env.SYNC_OTHER_TITLE_PROP ?? "Name",
    dueDate: process.env.SYNC_OTHER_DUE_DATE_PROP ?? "Due Date",
    project: process.env.SYNC_OTHER_PROJECT_PROP ?? "Project",
    sprints: process.env.SYNC_OTHER_SPRINTS_PROP ?? "Sprints",
    assignee: process.env.SYNC_OTHER_ASSIGNEE_PROP ?? "Assignee",
  },
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called when the Main workspace fires a page.updated webhook.
 * Syncs changed mapped properties → Other workspace.
 */
export async function syncMainToOther(mainPageId: string): Promise<void> {
  // If this page is locked, we just wrote to it ourselves — skip to break loop.
  if (await getSyncLock(mainPageId)) {
    console.log(`[sync] main→other skipped: ${mainPageId} is locked`);
    return;
  }

  const pair = await getSyncPair(mainPageId);
  if (!pair) return; // page not pushed yet

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  const page = (await main.pages.retrieve({
    page_id: mainPageId,
  })) as PageObjectResponse;

  const update = await buildOtherUpdate(page.properties);
  if (Object.keys(update).length === 0) return;

  // Lock the Other page BEFORE writing (suppress the resulting webhook)
  await setSyncLock(pair.other_id);
  await other.pages.update({ page_id: pair.other_id, properties: update });

  console.log(
    `[sync] main→other: synced [${Object.keys(update).join(", ")}] to ${pair.other_id}`
  );
}

/**
 * Called when the Other workspace fires a page.updated webhook.
 * Syncs changed mapped properties → Main workspace.
 */
export async function syncOtherToMain(otherPageId: string): Promise<void> {
  // If this page is locked, we just wrote to it — skip.
  if (await getSyncLock(otherPageId)) {
    console.log(`[sync] other→main skipped: ${otherPageId} is locked`);
    return;
  }

  const mainPageId = await getMainIdForOther(otherPageId);
  if (!mainPageId) return; // page not part of a sync pair

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  const page = (await other.pages.retrieve({
    page_id: otherPageId,
  })) as PageObjectResponse;

  const update = await buildMainUpdate(page.properties);
  if (Object.keys(update).length === 0) return;

  // Lock the Main page BEFORE writing (suppress the resulting webhook)
  await setSyncLock(mainPageId);
  await main.pages.update({ page_id: mainPageId, properties: update });

  console.log(
    `[sync] other→main: synced [${Object.keys(update).join(", ")}] to ${mainPageId}`
  );
}

// ---------------------------------------------------------------------------
// Property translation helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = PageObjectResponse["properties"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpdatePayload = Record<string, any>;

/** Build the properties update for the Other workspace page. */
async function buildOtherUpdate(props: Props): Promise<UpdatePayload> {
  const update: UpdatePayload = {};

  // Title — direct copy
  const titleProp = props[PROPS.main.title];
  if (titleProp?.type === "title") {
    update[PROPS.other.title] = { title: titleProp.title };
  }

  // Due Date — direct copy
  const dueDateProp = props[PROPS.main.dueDate];
  if (dueDateProp?.type === "date") {
    update[PROPS.other.dueDate] = { date: dueDateProp.date };
  }

  // Project (relation) — translate IDs via mapping table
  const projectProp = props[PROPS.main.project];
  if (projectProp?.type === "relation" && projectProp.relation.length > 0) {
    const otherIds = (
      await Promise.all(
        projectProp.relation.map(({ id }) => getProjectMapping(id))
      )
    ).filter((id): id is string => id !== null);
    if (otherIds.length > 0) {
      update[PROPS.other.project] = {
        relation: otherIds.map((id) => ({ id })),
      };
    }
  }

  // Sprints (relation) — translate IDs via mapping table
  const sprintsProp = props[PROPS.main.sprints];
  if (sprintsProp?.type === "relation" && sprintsProp.relation.length > 0) {
    const otherIds = (
      await Promise.all(
        sprintsProp.relation.map(({ id }) => getSprintMapping(id))
      )
    ).filter((id): id is string => id !== null);
    if (otherIds.length > 0) {
      update[PROPS.other.sprints] = {
        relation: otherIds.map((id) => ({ id })),
      };
    }
  }

  // Delegated To (select) → Assignee (people) — translate via user mapping
  const delegatedProp = props[PROPS.main.delegatedTo];
  if (delegatedProp?.type === "select" && delegatedProp.select) {
    const otherUserId = await getUserMapping(delegatedProp.select.name);
    if (otherUserId) {
      update[PROPS.other.assignee] = { people: [{ object: "user", id: otherUserId }] };
    }
  }

  return update;
}

/** Build the properties update for the Main workspace page. */
async function buildMainUpdate(props: Props): Promise<UpdatePayload> {
  const update: UpdatePayload = {};

  // Title — direct copy
  const titleProp = props[PROPS.other.title];
  if (titleProp?.type === "title") {
    update[PROPS.main.title] = { title: titleProp.title };
  }

  // Due Date — direct copy
  const dueDateProp = props[PROPS.other.dueDate];
  if (dueDateProp?.type === "date") {
    update[PROPS.main.dueDate] = { date: dueDateProp.date };
  }

  // Project (relation) — reverse translate IDs
  const projectProp = props[PROPS.other.project];
  if (projectProp?.type === "relation" && projectProp.relation.length > 0) {
    const mainIds = (
      await Promise.all(
        projectProp.relation.map(({ id }) => getReverseProjectMapping(id))
      )
    ).filter((id): id is string => id !== null);
    if (mainIds.length > 0) {
      update[PROPS.main.project] = {
        relation: mainIds.map((id) => ({ id })),
      };
    }
  }

  // Sprints (relation) — reverse translate IDs
  const sprintsProp = props[PROPS.other.sprints];
  if (sprintsProp?.type === "relation" && sprintsProp.relation.length > 0) {
    const mainIds = (
      await Promise.all(
        sprintsProp.relation.map(({ id }) => getReverseSprintMapping(id))
      )
    ).filter((id): id is string => id !== null);
    if (mainIds.length > 0) {
      update[PROPS.main.sprints] = {
        relation: mainIds.map((id) => ({ id })),
      };
    }
  }

  // Assignee (people) → Delegated To (select) — reverse user mapping
  const assigneeProp = props[PROPS.other.assignee];
  if (assigneeProp?.type === "people" && assigneeProp.people.length > 0) {
    const firstUser = assigneeProp.people[0];
    const delegateValue = await getReverseUserMapping(firstUser.id);
    if (delegateValue) {
      update[PROPS.main.delegatedTo] = { select: { name: delegateValue } };
    }
  }

  return update;
}
