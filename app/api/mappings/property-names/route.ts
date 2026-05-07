/**
 * GET    /api/mappings/property-names?contentType=x
 * POST   /api/mappings/property-names   { contentType, mainProperty, otherProperty, isTitle }
 * DELETE /api/mappings/property-names   { contentType, mainProperty }
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

import { getSupabaseClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contentType = searchParams.get("contentType");

  if (!contentType) {
    return NextResponse.json({ error: "contentType query param is required" }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseClient()
      .from("property_name_mappings")
      .select("id, content_type, main_property, other_property, is_title, created_at")
      .eq("content_type", contentType)
      .order("main_property");

    if (error) throw error;
    return NextResponse.json({ mappings: data ?? [] });
  } catch (err) {
    console.error("[api/mappings/property-names] GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contentType, mainProperty, otherProperty, isTitle } = body as {
      contentType: string;
      mainProperty: string;
      otherProperty: string;
      isTitle?: boolean;
    };

    if (!contentType || !mainProperty || !otherProperty) {
      return NextResponse.json(
        { error: "contentType, mainProperty, and otherProperty are required" },
        { status: 400 }
      );
    }

    const { error } = await getSupabaseClient()
      .from("property_name_mappings")
      .upsert(
        {
          content_type: contentType,
          main_property: mainProperty,
          other_property: otherProperty,
          is_title: isTitle ?? false,
        },
        { onConflict: "content_type,main_property" }
      );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/mappings/property-names] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { contentType, mainProperty } = body as {
      contentType: string;
      mainProperty: string;
    };

    if (!contentType || !mainProperty) {
      return NextResponse.json(
        { error: "contentType and mainProperty are required" },
        { status: 400 }
      );
    }

    const { error } = await getSupabaseClient()
      .from("property_name_mappings")
      .delete()
      .eq("content_type", contentType)
      .eq("main_property", mainProperty);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/mappings/property-names] DELETE error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
