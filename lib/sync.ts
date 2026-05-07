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
  setCommentPair,
  isMainCommentSynced,
  isOtherCommentSynced,
} from "./kv";
import {
  getProjectMapping,
  getReverseProjectMapping,
  getSprintMapping,
  getReverseSprintMapping,
  getUserMapping,
  getReverseUserMapping,
  getStatusMapping,
  getReverseStatusMapping,
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
    status: process.env.SYNC_MAIN_STATUS_PROP ?? "Status",
  },
  other: {
    title: process.env.SYNC_OTHER_TITLE_PROP ?? "Task",
    dueDate: process.env.SYNC_OTHER_DUE_DATE_PROP ?? "Due Date",
    project: process.env.SYNC_OTHER_PROJECT_PROP ?? "Project",
    sprints: process.env.SYNC_OTHER_SPRINTS_PROP ?? "Sprints",
    assignee: process.env.SYNC_OTHER_ASSIGNEE_PROP ?? "Assignee",
    status: process.env.SYNC_OTHER_STATUS_PROP ?? "Status",
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

/**
 * Relay a new comment from Other workspace → Main workspace.
 * Fetches comment content from API (webhook payload doesn't include rich_text).
 */
export async function syncCommentToMain(
  otherPageId: string,
  otherCommentId: string
): Promise<void> {
  if (await isOtherCommentSynced(otherCommentId)) {
    console.log(`[sync] comment ${otherCommentId} already relayed — skipping`);
    return;
  }

  const mainPageId = await getMainIdForOther(otherPageId);
  if (!mainPageId) return;

  const other = getOtherNotionClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comment = await (other.comments as any).retrieve({ comment_id: otherCommentId });
  console.log(`[sync] syncCommentToMain: comment raw=`, JSON.stringify(comment).slice(0, 2000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const richText: any[] = comment.rich_text ?? [];
  const authorName = await fetchUserName(other, comment.created_by?.id);

  const main = getMainNotionClient();
  const resolved = await resolveMentions(richText, main);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachments = await relayAttachments(comment.attachments ?? [], main);
  const created = await main.comments.create({
    parent: { page_id: mainPageId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rich_text: buildPrefixedRichText(authorName, resolved) as any,
    ...(attachments.length > 0 && { attachments }),
  });

  await setCommentPair(created.id, otherCommentId);
  console.log(`[sync] comment relayed: other ${otherPageId} → main ${mainPageId}`);
}

/**
 * Relay a comment.updated from Other workspace → Main workspace as a new comment.
 */
export async function syncCommentUpdateToMain(
  otherPageId: string,
  otherCommentId: string
): Promise<void> {
  const mainPageId = await getMainIdForOther(otherPageId);
  if (!mainPageId) return;

  const other = getOtherNotionClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comment = await (other.comments as any).retrieve({ comment_id: otherCommentId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const richText: any[] = comment.rich_text ?? [];
  const authorName = await fetchUserName(other, comment.created_by?.id);

  const main = getMainNotionClient();
  const resolved = await resolveMentions(richText, main);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachments = await relayAttachments(comment.attachments ?? [], main);
  const created = await main.comments.create({
    parent: { page_id: mainPageId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rich_text: buildPrefixedRichText(authorName, resolved) as any,
    ...(attachments.length > 0 && { attachments }),
  });

  await setCommentPair(created.id, `${otherCommentId}_u_${Date.now()}`);
  console.log(`[sync] comment update relayed: other ${otherPageId} → main ${mainPageId}`);
}

/**
 * Relay a new comment from Main workspace → Other workspace.
 * Fetches comment content from API (webhook payload doesn't include rich_text).
 */
export async function syncCommentToOther(
  mainPageId: string,
  mainCommentId: string
): Promise<void> {
  if (await isMainCommentSynced(mainCommentId)) {
    console.log(`[sync] comment ${mainCommentId} already relayed — skipping`);
    return;
  }

  const pair = await getSyncPair(mainPageId);
  if (!pair) return;

  const main = getMainNotionClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comment = await (main.comments as any).retrieve({ comment_id: mainCommentId });
  console.log(`[sync] syncCommentToOther: comment raw=`, JSON.stringify(comment).slice(0, 2000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const richText: any[] = comment.rich_text ?? [];
  const authorName = await fetchUserName(main, comment.created_by?.id);

  const other = getOtherNotionClient();
  const resolved = await resolveMentions(richText, other);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachments = await relayAttachments(comment.attachments ?? [], other);
  const created = await other.comments.create({
    parent: { page_id: pair.other_id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rich_text: buildPrefixedRichText(authorName, resolved) as any,
    ...(attachments.length > 0 && { attachments }),
  });

  await setCommentPair(mainCommentId, created.id);
  console.log(`[sync] comment relayed: main ${mainPageId} → other ${pair.other_id}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchUserName(client: any, userId: string | undefined): Promise<string> {
  if (!userId) return "Unknown";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await client.users.retrieve({ user_id: userId }) as any;
    return user.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Resolves user mentions from source workspace to target workspace.
 * Uses plain_text (@Name) to find the matching user by name in the target workspace.
 * Paginates through all workspace users to ensure complete coverage.
 * Falls back to plain text "@Name" if no match is found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveMentions(richText: any[], targetClient: any): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetUsers: { id: string; name: string }[] = [];
  const hasMention = richText.some(
    (item) =>
      (item?.type === "mention" && item?.mention?.type === "user") ||
      (item?.type === "text" && typeof item?.text?.content === "string" && (item.text.content as string).startsWith("@"))
  );
  if (hasMention) {
    try {
      // Paginate through all users to ensure we don't miss anyone
      let cursor: string | undefined = undefined;
      do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await targetClient.users.list({ start_cursor: cursor, page_size: 100 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const page = (res.results ?? []).map((u: any) => ({ id: u.id, name: u.name ?? "" }));
        targetUsers.push(...page);
        cursor = res.has_more ? res.next_cursor : undefined;
      } while (cursor);
      console.log(`[sync] resolveMentions: target users=`, targetUsers.map(u => u.name));
    } catch (err) {
      console.warn(`[sync] resolveMentions: could not list users`, err);
    }
  }

  // Match by full name first, then fall back to first name only (case-insensitive)
  const findUser = (query: string) => {
    const qLower = query.toLowerCase();
    const exact = targetUsers.find((u) => u.name.toLowerCase() === qLower);
    if (exact) return exact;
    const firstName = qLower.split(" ")[0];
    return targetUsers.find((u) => u.name.toLowerCase().split(" ")[0] === firstName) ?? undefined;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return richText.map((item): any => {
    // Handle real mention blocks
    if (item?.type === "mention" && item?.mention?.type === "user") {
      const displayName = (item.plain_text as string | undefined)?.replace(/^@/, "").trim() ?? "";
      console.log(`[sync] resolveMentions: mention displayName="${displayName}"`);
      const match = findUser(displayName);
      if (match) {
        console.log(`[sync] resolveMentions: matched "${displayName}" → ${match.id}`);
        return {
          ...item,
          mention: { type: "user", user: { object: "user", id: match.id } },
        };
      }
      console.log(`[sync] resolveMentions: no match for mention "${displayName}" — keeping as plain text`);
      return {
        type: "text",
        text: { content: displayName ? `@${displayName}` : "@Unknown" },
        annotations: item.annotations ?? {},
      };
    }

    // Handle plain text "@Name" — typed directly rather than via mention picker
    if (item?.type === "text" && typeof item?.text?.content === "string") {
      const content: string = item.text.content;
      const atMatch = content.match(/^@(.+)$/);
      if (atMatch && targetUsers.length > 0) {
        const name = atMatch[1].trim();
        const match = findUser(name);
        if (match) {
          console.log(`[sync] resolveMentions: text "@${name}" resolved to mention → ${match.id}`);
          return {
            type: "mention",
            mention: { type: "user", user: { object: "user", id: match.id } },
            annotations: item.annotations ?? {},
          };
        }
      }
    }

    return item;
  });
}

/**
 * Downloads each attachment from the source comment URL and re-uploads it
 * to the target Notion workspace. Returns an array ready for comments.create.
 *
 * Skips any attachment that fails to download or upload (logs a warning).
 * Handles only single-part uploads (≤20 MB); larger files are skipped.
 */
async function relayAttachments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceAttachments: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetClient: any
): Promise<Array<{ file_upload_id: string; type: "file_upload" }>> {
  if (!Array.isArray(sourceAttachments) || sourceAttachments.length === 0) return [];

  const results: Array<{ file_upload_id: string; type: "file_upload" }> = [];

  for (const att of sourceAttachments) {
    const fileUrl: string | undefined = att?.file?.url;
    if (!fileUrl) continue;
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        console.warn(`[sync] relayAttachments: download failed (${response.status}) for ${fileUrl.slice(0, 80)}`);
        continue;
      }

      // Guard against large files (>20 MB — single-part limit)
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > 20 * 1024 * 1024) {
        console.warn(`[sync] relayAttachments: file too large (${contentLength} bytes) — skipping`);
        continue;
      }

      const rawContentType = response.headers.get("content-type") ?? "application/octet-stream";
      const contentType = rawContentType.split(";")[0].trim();
      const buffer = await response.arrayBuffer();

      // Extract filename from URL path
      let filename = "attachment";
      try {
        const pathname = new URL(fileUrl).pathname;
        const decoded = decodeURIComponent(pathname.split("/").pop() ?? "");
        if (decoded) filename = decoded;
      } catch { /* keep default */ }

      // Create upload slot in target workspace
      const uploadObj = await targetClient.fileUploads.create({
        mode: "single_part",
        filename,
        content_type: contentType,
      });

      // Send file bytes
      await targetClient.fileUploads.send({
        file_upload_id: uploadObj.id,
        file: {
          filename,
          data: new Blob([buffer], { type: contentType }),
        },
      });

      results.push({ file_upload_id: uploadObj.id, type: "file_upload" as const });
      console.log(`[sync] relayAttachments: relayed "${filename}" → upload ${uploadObj.id}`);
    } catch (err) {
      console.warn(`[sync] relayAttachments: failed to relay attachment:`, err);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Comment rich text helpers
// ---------------------------------------------------------------------------

/**
 * Builds a rich text array prefixed with "AuthorName | " and the original content.
 * Strips read-only fields (href, plain_text) and sanitises link URLs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildPrefixedRichText(authorName: string, richText: any[]): any[] {
  const prefix = {
    type: "text",
    text: { content: `${authorName} | ` },
    annotations: {
      bold: true,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default" as const,
    },
  };
  return [prefix, ...sanitiseCommentRichText(richText)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitiseCommentRichText(richText: any[]): any[] {
  if (!Array.isArray(richText)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return richText.map((item): any => {
    if (!item) return null;
    // Strip read-only response fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { href: _href, plain_text: _pt, ...rest } = item;

    // Fix relative/invalid link URLs in text blocks
    if (rest.type === "text" && rest.text?.link?.url) {
      const fixed = fixCommentUrl(rest.text.link.url);
      return fixed
        ? { ...rest, text: { ...rest.text, link: { url: fixed } } }
        : { ...rest, text: { ...rest.text, link: null } };
    }

    // File/attachment mentions — convert to a plain text link using the file URL
    if (rest.type === "mention" && rest.mention?.type === "link_preview") {
      const url = rest.mention.link_preview?.url;
      if (url) return { type: "text", text: { content: url, link: { url } }, annotations: rest.annotations ?? {} };
      return null;
    }
    if (rest.type === "mention" && rest.mention?.type === "file") {
      const url = rest.mention.file?.url ?? rest.mention.file?.external?.url;
      if (url) return { type: "text", text: { content: url, link: { url } }, annotations: rest.annotations ?? {} };
      return null;
    }

    return rest;
  }).filter(Boolean);
}

function fixCommentUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return `https://www.notion.so${url.split("?")[0]}`;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") return url;
  } catch { /* invalid URL */ }
  return null;
}

// ---------------------------------------------------------------------------
// Property translation helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = PageObjectResponse["properties"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpdatePayload = Record<string, any>;

/** Build the properties update for the Other workspace page. */
export async function buildOtherUpdate(props: Props): Promise<UpdatePayload> {
  const update: UpdatePayload = {};

  // Title — find by type (property name varies across databases e.g. "Title*", "Name")
  const titleProp = Object.values(props).find((p) => p.type === "title");
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
  console.log(`[sync] buildOtherUpdate: looking for Main sprints prop "${PROPS.main.sprints}", found:`, sprintsProp?.type, sprintsProp?.type === 'relation' ? JSON.stringify(sprintsProp.relation) : '(not relation)');
  if (sprintsProp?.type === "relation" && sprintsProp.relation.length > 0) {
    const otherIds = (
      await Promise.all(
        sprintsProp.relation.map(({ id }) => getSprintMapping(id))
      )
    ).filter((id): id is string => id !== null);
    console.log(`[sync] buildOtherUpdate: sprint mapping result otherIds=`, otherIds);
    if (otherIds.length > 0) {
      update[PROPS.other.sprints] = {
        relation: otherIds.map((id) => ({ id })),
      };
    }
  }

  // Delegated To (select) → Assignee (people) — translate via user mapping
  // Falls back to Eva if no Delegated To is set or no mapping found
  const DEFAULT_ASSIGNEE_ID = "1eefed34-a2bc-46a6-bdcb-5289015aea83";
  const delegatedProp = props[PROPS.main.delegatedTo];
  if (delegatedProp?.type === "select" && delegatedProp.select) {
    const otherUserId = await getUserMapping(delegatedProp.select.name);
    update[PROPS.other.assignee] = { people: [{ object: "user", id: otherUserId ?? DEFAULT_ASSIGNEE_ID }] };
  } else {
    update[PROPS.other.assignee] = { people: [{ object: "user", id: DEFAULT_ASSIGNEE_ID }] };
  }

  // Status — translate via status mapping table.
  // "Delegated" is skipped — it means "handed off to NS" and has no Other equivalent.
  const statusProp = props[PROPS.main.status];
  console.log(`[sync] buildOtherUpdate: Status prop=`, JSON.stringify(statusProp));
  if (statusProp?.type === "status" && statusProp.status && statusProp.status.name !== "Delegated") {
    const otherStatus = await getStatusMapping(statusProp.status.name);
    console.log(`[sync] buildOtherUpdate: getStatusMapping(${statusProp.status.name}) =>`, otherStatus);
    if (otherStatus) {
      update[PROPS.other.status] = { status: { name: otherStatus } };
    }
  }

  console.log(`[sync] buildOtherUpdate: final update keys=`, Object.keys(update));
  return update;
}

/**
 * Build the properties update for the Main workspace page.
 *
 * @param isDelegated  True when the Main page has "Delegated To" set.
 *   - Delegated tasks: only Done/Cancelled sync back; everything else
 *     forces Main status back to "Delegated" (the hand-off state).
 *   - Non-delegated tasks: sync whatever the reverse mapping returns.
 */
export async function buildMainUpdate(
  props: Props,
  isDelegated = false
): Promise<UpdatePayload> {
  const update: UpdatePayload = {};

  // Title is intentionally NOT synced Other→Main.
  // Main is the source of truth for titles; Main→Other handles that direction.

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

  // Status — reverse translate via status mapping table.
  //
  // Delegated tasks: Other status maps to Done/Cancelled → write that to Main.
  //   Any other Other status (in-progress, backlog, etc.) → force Main back to
  //   "Delegated" so the hand-off state is preserved until the task is finished.
  //
  // Non-delegated tasks: sync whatever the reverse mapping returns.
  // Terminal states by Other status name — when Other reaches these, sync back to Main
  const TERMINAL_OTHER_STATUSES = new Set(["Done", "Deleted"]);
  const statusProp = props[PROPS.other.status];
  if (statusProp?.type === "status" && statusProp.status) {
    const otherStatusName = statusProp.status.name;
    const mainStatus = await getReverseStatusMapping(otherStatusName);
    if (isDelegated) {
      if (TERMINAL_OTHER_STATUSES.has(otherStatusName) && mainStatus) {
        // Delegated task finished → write the terminal state to Main
        update[PROPS.main.status] = { status: { name: mainStatus } };
      }
      // Non-terminal change on a delegated task → do NOT touch Main status
      // (keep "Delegated" in Main until the task is actually done)
    } else if (mainStatus) {
      update[PROPS.main.status] = { status: { name: mainStatus } };
    }
  }

  return update;
}
