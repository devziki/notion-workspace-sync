/**
 * Notion API client singletons — server-side only.
 *
 * Two separate clients are initialised: one for the Main workspace and one
 * for the Other (client/collaborator) workspace. Both are instantiated lazily
 * using environment variables so they are never accessible in browser bundles.
 *
 * All exports from this file must only be used in:
 *   - Next.js API route handlers (app/api/**)
 *   - Server Actions
 *   - Server Components
 */

import { Client } from "@notionhq/client";

// ---------------------------------------------------------------------------
// Singleton factory — re-use the same client instance across requests within
// a single serverless function invocation.
// ---------------------------------------------------------------------------

let mainClient: Client | null = null;
let otherClient: Client | null = null;

export function getMainNotionClient(): Client {
  if (!mainClient) {
    const token = process.env.NOTION_MAIN_TOKEN;
    if (!token) {
      throw new Error(
        "NOTION_MAIN_TOKEN is not set. Add it to your Vercel environment variables."
      );
    }
    mainClient = new Client({ auth: token });
  }
  return mainClient;
}

export function getOtherNotionClient(): Client {
  if (!otherClient) {
    const token = process.env.NOTION_OTHER_TOKEN;
    if (!token) {
      throw new Error(
        "NOTION_OTHER_TOKEN is not set. Add it to your Vercel environment variables."
      );
    }
    otherClient = new Client({ auth: token });
  }
  return otherClient;
}

// ---------------------------------------------------------------------------
// Health check helpers
// ---------------------------------------------------------------------------

/**
 * Verifies a Notion client can connect by calling users.me().
 * Returns the bot user name on success, or throws on failure.
 */
export async function checkNotionConnection(
  client: Client
): Promise<{ ok: true; botName: string }> {
  const me = await client.users.me({});
  const name =
    me.type === "bot" && me.bot?.owner?.type === "workspace"
      ? (me.name ?? "unknown bot")
      : (me.name ?? "unknown");
  return { ok: true, botName: name };
}
