/**
 * GET    /api/mappings/select-options?contentType=x&mainProperty=y
 * POST   /api/mappings/select-options   { contentType, mainProperty, mainValue, otherValue }
 * DELETE /api/mappings/select-options   { contentType, mainProperty, mainValue }
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { getSupabaseClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contentType = searchParams.get("contentType");
  const mainProperty = searchParams.get("mainProperty");

  if (!contentType) {
    return NextResponse.json({ error: "contentType query param is required" }, { status: 400 });
  }

  try {
    let query = getSupabaseClient()
      .from("select_option_mappings")
      .select("id, content_type, main_property, main_value, other_value, created_at")
      .eq("content_type", contentType)
      .order("main_property")
      .order("main_value");

    if (mainProperty) {
      query = query.eq("main_property", mainProperty);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ mappings: data ?? [] });
  } catch (err) {
    console.error("[api/mappings/select-options] GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contentType, mainProperty, mainValue, otherValue } = body as {
      contentType: string;
      mainProperty: string;
      mainValue: string;
      otherValue: string;
    };

    if (!contentType || !mainProperty || !mainValue || !otherValue) {
      return NextResponse.json(
        { error: "contentType, mainProperty, mainValue, and otherValue are required" },
        { status: 400 }
      );
    }

    const { error } = await getSupabaseClient()
      .from("select_option_mappings")
      .upsert(
        {
          content_type: contentType,
          main_property: mainProperty,
          main_value: mainValue,
          other_value: otherValue,
        },
        { onConflict: "content_type,main_property,main_value" }
      );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/mappings/select-options] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { contentType, mainProperty, mainValue } = body as {
      contentType: string;
      mainProperty: string;
      mainValue: string;
    };

    if (!contentType || !mainProperty || !mainValue) {
      return NextResponse.json(
        { error: "contentType, mainProperty, and mainValue are required" },
        { status: 400 }
      );
    }

    const { error } = await getSupabaseClient()
      .from("select_option_mappings")
      .delete()
      .eq("content_type", contentType)
      .eq("main_property", mainProperty)
      .eq("main_value", mainValue);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/mappings/select-options] DELETE error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
