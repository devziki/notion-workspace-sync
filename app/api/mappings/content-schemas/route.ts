/**
 * GET /api/mappings/content-schemas?contentType=files|meetings|updates
 *
 * Returns the property schemas of the Main and Other databases for a given
 * content type, so the mapping UI can populate its dropdowns.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { getMainNotionClient, getOtherNotionClient } from "@/lib/notion";

const DB_ID_MAP: Record<string, { mainEnv: string; otherEnv: string }> = {
  files: { mainEnv: "FILES_MAIN_DB_ID", otherEnv: "FILES_OTHER_DB_ID" },
  meetings: { mainEnv: "MEETINGS_MAIN_DB_ID", otherEnv: "MEETINGS_OTHER_DB_ID" },
  updates: { mainEnv: "UPDATES_MAIN_DB_ID", otherEnv: "UPDATES_OTHER_DB_ID" },
};

interface PropertyInfo {
  name: string;
  type: string;
  options?: string[];
}

/** Extract property info from a Notion database schema response (`db.properties`). */
function extractProperties(dbResponse: any): PropertyInfo[] {
  return _parseProps(dbResponse.properties ?? {});
}

/** Extract property info from page-level properties (fallback when schema is inaccessible). */
function extractPropertiesFromPage(pageProps: Record<string, any>): PropertyInfo[] {
  return _parseProps(pageProps);
}

function _parseProps(props: Record<string, any>): PropertyInfo[] {
  const result: PropertyInfo[] = [];
  for (const [key, prop] of Object.entries(props)) {
    const p = prop as any;
    const name: string = p.name ?? key;
    const type: string = p.type;
    const info: PropertyInfo = { name, type };

    if (type === "select") {
      // schema format: p.select.options[]; page format: p.select (single option object)
      if (Array.isArray(p.select?.options)) {
        info.options = p.select.options.map((o: any) => o.name as string);
      }
    } else if (type === "status") {
      if (Array.isArray(p.status?.options)) {
        info.options = p.status.options.map((o: any) => o.name as string);
      }
    } else if (type === "multi_select") {
      if (Array.isArray(p.multi_select?.options)) {
        info.options = p.multi_select.options.map((o: any) => o.name as string);
      }
    }

    result.push(info);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Retrieves DB properties, handling:
 * 1. Old API format (properties on db object directly)
 * 2. New 2026-03-11 format (container has data_sources; retrieve each source)
 * 3. Fallback: data source not accessible → query a sample page for property names/types
 */
async function fetchDbProperties(client: any, dbId: string): Promise<PropertyInfo[]> {
  const db = await client.databases.retrieve({ database_id: dbId }) as any;

  // Old format: properties directly on the database object
  if (db.properties && Object.keys(db.properties).length > 0) {
    return extractProperties(db);
  }

  // New format: retrieve schema via data source
  const sources: any[] = db.data_sources ?? [];
  if (sources.length > 0) {
    const dsId = sources[0].id;

    // Try dataSources.retrieve first (v5.x SDK, returns full schema with options)
    try {
      const dsResult = await (client as any).dataSources.retrieve({ data_source_id: dsId }) as any;
      const schema = dsResult?.schema ?? dsResult?.properties;
      if (schema && Object.keys(schema).length > 0) {
        return extractProperties({ properties: schema });
      }
    } catch {
      // ignore — try next method
    }

    // Try databases.retrieve on the data source ID
    try {
      const sourceDb = await client.databases.retrieve({ database_id: dsId }) as any;
      if (sourceDb.properties && Object.keys(sourceDb.properties).length > 0) {
        return extractProperties(sourceDb);
      }
    } catch {
      console.warn(`[content-schemas] databases.retrieve failed for data source ${dsId}`);
    }

    // Fallback: query a page and infer types (no select options)
    try {
      const queryResult = await (client as any).dataSources.query({ data_source_id: dsId, page_size: 1 }) as any;
      const pages: any[] = queryResult.results ?? [];
      if (pages.length > 0) {
        return extractPropertiesFromPage(pages[0].properties ?? {});
      }
    } catch {
      console.warn(`[content-schemas] dataSources.query failed for ${dsId}`);
    }
  }

  return [];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contentType = searchParams.get("contentType");

  if (!contentType || !DB_ID_MAP[contentType]) {
    return NextResponse.json(
      { error: "contentType must be one of: files, meetings, updates" },
      { status: 400 }
    );
  }

  const { mainEnv, otherEnv } = DB_ID_MAP[contentType];
  const mainDbId = process.env[mainEnv];
  const otherDbId = process.env[otherEnv];

  if (!mainDbId) return NextResponse.json({ error: `${mainEnv} is not set` }, { status: 500 });
  if (!otherDbId) return NextResponse.json({ error: `${otherEnv} is not set` }, { status: 500 });

  const main = getMainNotionClient();
  const other = getOtherNotionClient();

  // Fetch each workspace independently so one failure doesn't block the other
  const [mainResult, otherResult] = await Promise.allSettled([
    fetchDbProperties(main, mainDbId),
    fetchDbProperties(other, otherDbId),
  ]);

  const mainProps = mainResult.status === "fulfilled" ? mainResult.value : [];
  const otherProps = otherResult.status === "fulfilled" ? otherResult.value : [];

  if (mainResult.status === "rejected") {
    console.error("[content-schemas] Main DB error:", mainResult.reason);
  }
  if (otherResult.status === "rejected") {
    console.error("[content-schemas] Other DB error:", otherResult.reason);
  }

  return NextResponse.json({
    main: { properties: mainProps },
    other: { properties: otherProps },
    ...(mainResult.status === "rejected" ? { mainError: String(mainResult.reason) } : {}),
    ...(otherResult.status === "rejected" ? { otherError: String(otherResult.reason) } : {}),
  });
}
