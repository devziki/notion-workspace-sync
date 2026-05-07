/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET  /api/mappings  — returns all data needed to render the mapping UI
 * POST /api/mappings  — upserts a project or user mapping
 */

import { NextResponse } from "next/server";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { getMainNotionClient, getOtherNotionClient } from "@/lib/notion";
import { getSupabaseClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch all pages from a data_source via dataSources.query (paginated). */
async function queryAllPages(
  client: any,
  dsId: string,
  filter?: object
): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.dataSources.query({
      data_source_id: dsId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      ...(filter ? { filter } : {}),
    });
    pages.push(...(res.results ?? []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/** Extract the title string from a page */
function getTitle(page: PageObjectResponse): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && prop.title.length > 0) {
      return prop.title.map((t: any) => t.plain_text).join("");
    }
  }
  return page.id;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const main = getMainNotionClient();
    const other = getOtherNotionClient();
    const sb = getSupabaseClient();

    const mainTasksDsId = process.env.MAIN_TASKS_DS_ID!;
    const otherProjectsDsId = process.env.OTHER_PROJECTS_DS_ID!;
    const mainProjectsDsId = process.env.MAIN_PROJECTS_DS_ID; // optional — may not be set yet

    // ---- Get Main tasks schema for Delegated To options ----
    const mainTasksDs = await (main as any).dataSources.retrieve({ data_source_id: mainTasksDsId });
    const mainProps: Record<string, any> = mainTasksDs?.properties ?? {};
    const delegatedToProp = Object.values(mainProps).find(
      (p: any) => p.name === "Delegated To"
    ) as any;
    const delegatedToOptions: { value: string }[] =
      delegatedToProp?.select?.options?.map((o: any) => ({ value: o.name })) ?? [];

    // ---- Fetch projects from both workspaces ----
    const mainProjectFilter = {
      and: [
        { property: "Type", select: { equals: "Client" } },
        { property: "Stream", select: { equals: "Notion State" } },
        {
          or: [
            { property: "Status", status: { equals: "To Do" } },
            { property: "Status", status: { equals: "Active" } },
            { property: "Status", status: { equals: "Blocked" } },
          ],
        },
      ],
    };

    const EVA_USER_ID = "1eefed34-a2bc-46a6-bdcb-5289015aea83";
    const otherProjectFilter = {
      and: [
        {
          or: [
            { property: "Status", status: { equals: "Planned" } },
            { property: "Status", status: { equals: "Active" } },
          ],
        },
        {
          or: [
            { property: "Project Owner", people: { contains: EVA_USER_ID } },
            { property: "Project Team", people: { contains: EVA_USER_ID } },
          ],
        },
      ],
    };

    const [mainProjectPages, otherProjectPages] = await Promise.all([
      mainProjectsDsId
        ? queryAllPages(main, mainProjectsDsId, mainProjectFilter).catch(() => [])
        : Promise.resolve([]),
      queryAllPages(other, otherProjectsDsId, otherProjectFilter).catch(() => []),
    ]);

    const mainProjects = mainProjectPages
      .filter((p) => !p.in_trash)
      .map((p) => ({ id: p.id, name: getTitle(p) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const otherProjects = otherProjectPages
      .filter((p) => !p.in_trash)
      .map((p) => ({ id: p.id, name: getTitle(p) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // ---- Fetch Other workspace users ----
    const usersRes = await other.users.list({});
    const otherUsers = (usersRes.results ?? [])
      .filter((u: any) => u.type === "person")
      .map((u: any) => ({ id: u.id, name: u.name }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    // ---- Get status options from both workspaces ----
    const mainTasksSchema = await (main as any).dataSources.retrieve({ data_source_id: mainTasksDsId });
    const mainStatusProp = Object.values(mainTasksSchema?.properties ?? {}).find(
      (p: any) => p.name === "Status"
    ) as any;
    const mainStatusOptions: string[] = mainStatusProp?.status?.options?.map((o: any) => o.name) ?? [];

    const otherTasksDsId = process.env.OTHER_TASKS_DS_ID!;
    const otherTasksSchema = await (other as any).dataSources.retrieve({ data_source_id: otherTasksDsId });
    const otherStatusProp = Object.values(otherTasksSchema?.properties ?? {}).find(
      (p: any) => p.name === (process.env.SYNC_OTHER_STATUS_PROP ?? "Status")
    ) as any;
    const otherStatusOptions: string[] = otherStatusProp?.status?.options?.map((o: any) => o.name) ?? [];

    // ---- Fetch existing mappings ----
    const [{ data: projectMappings }, { data: userMappings }, { data: statusMappings }] = await Promise.all([
      sb.from("project_mappings").select("main_id, other_id"),
      sb.from("user_mappings").select("delegate_value, other_user_id"),
      sb.from("status_mappings").select("main_status, other_status"),
    ]);

    return NextResponse.json({
      mainProjects,
      otherProjects,
      projectMappings: projectMappings ?? [],
      delegatedToOptions,
      otherUsers,
      userMappings: userMappings ?? [],
      mainStatusOptions,
      otherStatusOptions,
      statusMappings: statusMappings ?? [],
      missingMainProjects: !mainProjectsDsId,
      assigneePropName: process.env.SYNC_OTHER_ASSIGNEE_PROP ?? "Assignee",
    });
  } catch (err) {
    console.error("[api/mappings] GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sb = getSupabaseClient();

    if (body.type === "project") {
      const { main_id, other_id } = body;
      if (other_id) {
        await sb.from("project_mappings").upsert({ main_id, other_id });
      } else {
        await sb.from("project_mappings").delete().eq("main_id", main_id);
      }
      return NextResponse.json({ ok: true });
    }

    if (body.type === "user") {
      const { delegate_value, other_user_id } = body;
      if (other_user_id) {
        await sb.from("user_mappings").upsert({ delegate_value, other_user_id });
      } else {
        await sb.from("user_mappings").delete().eq("delegate_value", delegate_value);
      }
      return NextResponse.json({ ok: true });
    }

    if (body.type === "status") {
      const { main_status, other_status } = body;
      if (other_status) {
        await sb.from("status_mappings").upsert({ main_status, other_status });
      } else {
        await sb.from("status_mappings").delete().eq("main_status", main_status);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  } catch (err) {
    console.error("[api/mappings] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
