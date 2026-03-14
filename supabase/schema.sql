-- =============================================================================
-- Notion Workspace Sync Engine — Supabase Schema
-- =============================================================================
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- These tables store the entity ID translations used by Feature 2 (sync engine)
-- and are managed by Feature 5 (Mapping UI).
-- =============================================================================

-- Maps a Main workspace Project page ID ↔ Other workspace Project page ID.
CREATE TABLE IF NOT EXISTS project_mappings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  main_id    TEXT        NOT NULL UNIQUE,
  other_id   TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Maps a Main workspace Sprint page ID ↔ Other workspace Sprint page ID.
CREATE TABLE IF NOT EXISTS sprint_mappings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  main_id    TEXT        NOT NULL UNIQUE,
  other_id   TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Maps a "Delegated To" select value (e.g. "Marek") ↔ a Notion user ID in the
-- Other workspace. The delegate_value must match exactly what appears in the
-- Main workspace "Delegated To" select property.
CREATE TABLE IF NOT EXISTS user_mappings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  delegate_value  TEXT        NOT NULL UNIQUE,
  other_user_id   TEXT        NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables.
-- All access is via the service_role key (server-side only), which bypasses RLS
-- automatically. No public policies are needed — this just blocks anon key access.
ALTER TABLE public.project_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprint_mappings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_mappings    ENABLE ROW LEVEL SECURITY;
