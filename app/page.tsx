"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ── Existing interfaces ────────────────────────────────────────────────────────
interface NamedItem { id: string; name: string; }
interface ProjectMapping { main_id: string; other_id: string; }
interface UserMapping { delegate_value: string; other_user_id: string; }
interface StatusMapping { main_status: string; other_status: string; }
interface MappingData {
  mainProjects: NamedItem[];
  otherProjects: NamedItem[];
  projectMappings: ProjectMapping[];
  delegatedToOptions: { value: string }[];
  otherUsers: NamedItem[];
  userMappings: UserMapping[];
  mainStatusOptions: string[];
  otherStatusOptions: string[];
  statusMappings: StatusMapping[];
  missingMainProjects?: boolean;
  assigneePropName?: string;
}

// ── New interfaces ─────────────────────────────────────────────────────────────
interface SchemaProperty { name: string; type: string; options?: string[]; }
interface DbSchema { main: { properties: SchemaProperty[] }; other: { properties: SchemaProperty[] }; }
interface PropertyNameMapping { content_type: string; main_property: string; other_property: string; is_title: boolean; }
interface SelectOptionMapping { content_type: string; main_property: string; main_value: string; other_value: string; }

// ── Toast ──────────────────────────────────────────────────────────────────────
function useToast() {
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState("");
  const t = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => {
    setMsg(m); setVisible(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setVisible(false), 2200);
  }, []);
  return { visible, msg, show };
}

// ── Existing MappingRow ────────────────────────────────────────────────────────
function MappingRow({ label, tag, options, initialValue, onSave }: {
  label: string; tag?: string;
  options: NamedItem[]; initialValue: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [saved, setSaved] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  const [editing, setEditing] = useState(!initialValue);
  const [saving, setSaving] = useState(false);
  const savedName = options.find(o => o.id === saved)?.name;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setSaved(draft);
      setEditing(false);
    } finally { setSaving(false); }
  }, [draft, onSave]);

  return (
    <div className="flex items-center gap-4 py-4 border-b border-gray-100 last:border-0">
      <div className="w-40 shrink-0">
        <p className="text-sm font-semibold text-[#1D1739] leading-tight">{label}</p>
        {tag && <p className="text-[11px] text-gray-400 mt-0.5">{tag}</p>}
      </div>

      {editing ? (
        <>
          <div className="relative flex-1">
            <select
              value={draft}
              disabled={saving}
              onChange={e => setDraft(e.target.value)}
              className="w-full appearance-none text-sm text-[#1D1739] font-medium bg-white border border-gray-300 rounded-md px-3 py-2 pr-7 focus:outline-none focus:border-[#382A79] focus:ring-1 focus:ring-[#382A79] transition-all cursor-pointer disabled:opacity-50"
            >
              <option value="">— Not mapped —</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▾</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="shrink-0 px-4 py-2 rounded-md text-sm font-semibold bg-[#1D1739] hover:bg-[#382A79] text-white transition-colors disabled:opacity-50">
            {saving ? "…" : "Save"}
          </button>
          {saved && (
            <button onClick={() => { setDraft(saved); setEditing(false); }}
              className="shrink-0 text-gray-400 hover:text-gray-600 text-sm transition-colors">✕</button>
          )}
        </>
      ) : (
        <>
          <div className="flex-1">
            {savedName ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#382A79]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F67020] shrink-0" />
                {savedName}
              </span>
            ) : (
              <span className="text-sm text-gray-400">Not mapped</span>
            )}
          </div>
          <button onClick={() => { setDraft(saved); setEditing(true); }}
            className="shrink-0 px-4 py-2 rounded-md text-sm font-semibold text-[#1D1739] border border-gray-300 hover:border-[#1D1739] hover:bg-gray-50 transition-all">
            Edit
          </button>
        </>
      )}
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────
function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 animate-pulse">
      {Array.from({ length: n }).map((_, j) => (
        <div key={j} className="flex items-center gap-4 py-4 border-b border-gray-100 last:border-0">
          <div className="w-40 space-y-1.5">
            <div className="h-3.5 bg-gray-100 rounded w-28" />
            <div className="h-2.5 bg-gray-50 rounded w-16" />
          </div>
          <div className="flex-1 h-9 bg-gray-100 rounded-md" />
          <div className="w-16 h-9 bg-gray-100 rounded-md" />
        </div>
      ))}
    </div>
  );
}

// ── StringSelectRow: for select/status option mapping ──────────────────────────
function StringSelectRow({
  label, tag, options, initialValue, onSave,
}: {
  label: string; tag?: string;
  options: string[]; initialValue: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [saved, setSaved] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  const [editing, setEditing] = useState(!initialValue);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setSaved(draft);
      setEditing(false);
    } finally { setSaving(false); }
  }, [draft, onSave]);

  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-100 last:border-0">
      <div className="w-40 shrink-0">
        <p className="text-sm font-semibold text-[#1D1739] leading-tight">{label}</p>
        {tag && <p className="text-[11px] text-gray-400 mt-0.5">{tag}</p>}
      </div>

      {editing ? (
        <>
          <div className="relative flex-1">
            <select
              value={draft}
              disabled={saving}
              onChange={e => setDraft(e.target.value)}
              className="w-full appearance-none text-sm text-[#1D1739] font-medium bg-white border border-gray-300 rounded-md px-3 py-2 pr-7 focus:outline-none focus:border-[#382A79] focus:ring-1 focus:ring-[#382A79] transition-all cursor-pointer disabled:opacity-50"
            >
              <option value="">— Not mapped —</option>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▾</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="shrink-0 px-4 py-2 rounded-md text-sm font-semibold bg-[#1D1739] hover:bg-[#382A79] text-white transition-colors disabled:opacity-50">
            {saving ? "…" : "Save"}
          </button>
          {saved && (
            <button onClick={() => { setDraft(saved); setEditing(false); }}
              className="shrink-0 text-gray-400 hover:text-gray-600 text-sm transition-colors">✕</button>
          )}
        </>
      ) : (
        <>
          <div className="flex-1">
            {saved ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#382A79]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F67020] shrink-0" />
                {saved}
              </span>
            ) : (
              <span className="text-sm text-gray-400">Not mapped</span>
            )}
          </div>
          <button onClick={() => { setDraft(saved); setEditing(true); }}
            className="shrink-0 px-4 py-2 rounded-md text-sm font-semibold text-[#1D1739] border border-gray-300 hover:border-[#1D1739] hover:bg-gray-50 transition-all">
            Edit
          </button>
        </>
      )}
    </div>
  );
}

// ── Types for a content type definition ──────────────────────────────────────
type ContentType = "files" | "meetings" | "updates";

interface MappableProperty { name: string; type: "title" | "select" | "status" | "date" | "relation"; isTitle?: boolean; }

const CONTENT_TYPE_DEFS: Record<ContentType, { label: string; properties: MappableProperty[] }> = {
  files: {
    label: "Files",
    properties: [
      { name: "Title*", type: "title", isTitle: true },
      { name: "Type*", type: "select" },
      { name: "Status*", type: "status" },
      { name: "Project", type: "relation" },
    ],
  },
  meetings: {
    label: "Meetings",
    properties: [
      { name: "Title*", type: "title", isTitle: true },
      { name: "Date*", type: "date" },
      { name: "Project", type: "relation" },
      { name: "Type*", type: "select" },
    ],
  },
  updates: {
    label: "Updates",
    properties: [
      { name: "Title", type: "title", isTitle: true },
      { name: "Project", type: "relation" },
      { name: "Health", type: "select" },
      { name: "Date", type: "date" },
    ],
  },
};

// ── SelectOptionBlock: renders option mapping for one select/status property ──
function SelectOptionBlock({
  contentType, mainProperty, mainOptions, otherOptions,
  show,
}: {
  contentType: ContentType;
  mainProperty: string;
  mainOptions: string[];
  otherOptions: string[];
  show: (m: string) => void;
}) {
  const [optionMappings, setOptionMappings] = useState<SelectOptionMapping[]>([]);

  useEffect(() => {
    fetch(`/api/mappings/select-options?contentType=${contentType}&mainProperty=${encodeURIComponent(mainProperty)}`)
      .then(r => r.json())
      .then(d => Array.isArray(d?.mappings) && setOptionMappings(d.mappings))
      .catch(() => {});
  }, [contentType, mainProperty]);

  const saveOptionMapping = useCallback((mainValue: string) => async (otherValue: string) => {
    const r = await fetch("/api/mappings/select-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType, mainProperty, mainValue, otherValue: otherValue || null }),
    });
    if (!r.ok) throw new Error();
    show("Saved");
  }, [contentType, mainProperty, show]);

  if (mainOptions.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-4 px-5 mb-1">
        <div className="w-40 shrink-0 text-[11px] font-bold uppercase tracking-widest text-gray-400">
          Main · {mainProperty}
        </div>
        <div className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Other Option</div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 px-5 shadow-sm">
        {mainOptions.map(mainVal => {
          const existing = optionMappings.find(m => m.main_value === mainVal);
          return (
            <StringSelectRow
              key={mainVal}
              label={mainVal}
              options={otherOptions}
              initialValue={existing?.other_value ?? ""}
              onSave={saveOptionMapping(mainVal)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── ContentTypeMappings: full section for one content type ─────────────────────
function ContentTypeMappings({ contentType, show }: { contentType: ContentType; show: (m: string) => void }) {
  const def = CONTENT_TYPE_DEFS[contentType];
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [propMappings, setPropMappings] = useState<PropertyNameMapping[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/mappings/content-schemas?contentType=${contentType}`).then(r => r.json()),
      fetch(`/api/mappings/property-names?contentType=${contentType}`).then(r => r.json()),
    ])
      .then(([s, p]) => {
        if (s.error) { setSchemaError(s.error); return; }
        setSchema(s as DbSchema);
        if (Array.isArray(p?.mappings)) setPropMappings(p.mappings as PropertyNameMapping[]);
      })
      .catch(e => setSchemaError(String(e)))
      .finally(() => setLoadingSchema(false));
  }, [contentType]);

  const savePropMapping = useCallback((mainProperty: string, isTitle: boolean) => async (otherProperty: string) => {
    const r = await fetch("/api/mappings/property-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType, mainProperty, otherProperty: otherProperty || null, isTitle }),
    });
    if (!r.ok) throw new Error();
    // Refresh prop mappings so option blocks pick up the new mapping
    const updated = await fetch(`/api/mappings/property-names?contentType=${contentType}`).then(r2 => r2.json());
    if (Array.isArray(updated?.mappings)) setPropMappings(updated.mappings as PropertyNameMapping[]);
    show("Saved");
  }, [contentType, show]);

  if (loadingSchema) return <SkeletonRows n={def.properties.length} />;

  if (schemaError) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-100 p-5">
        <p className="font-bold text-red-600 text-sm">Failed to load schema</p>
        <p className="text-xs text-red-400 font-mono mt-1 break-all">{schemaError}</p>
      </div>
    );
  }

  // Build other property options (all properties from other workspace)
  const otherProps: NamedItem[] = (schema?.other.properties ?? []).map(p => ({ id: p.name, name: p.name }));

  return (
    <div className="space-y-8">
      {/* Property Name Mappings */}
      <div>
        <div className="flex items-center gap-4 px-5 mb-1">
          <div className="w-40 shrink-0 text-[11px] font-bold uppercase tracking-widest text-gray-400">Main Property</div>
          <div className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Other Property</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 shadow-sm">
          {def.properties.map(prop => {
            const existing = propMappings.find(m => m.main_property === prop.name);
            return (
              <MappingRow
                key={prop.name}
                label={prop.name}
                tag={prop.isTitle ? "Title property (required)" : prop.type}
                options={otherProps}
                initialValue={existing?.other_property ?? ""}
                onSave={savePropMapping(prop.name, prop.isTitle ?? false)}
              />
            );
          })}
        </div>
      </div>

      {/* Select/Status Option Mappings */}
      {def.properties.filter(p => p.type === "select" || p.type === "status").map(prop => {
        const mapped = propMappings.find(m => m.main_property === prop.name);
        if (!mapped?.other_property) return null;

        // Main options: from main schema for this property
        const mainSchemaProp = schema?.main.properties.find(p2 => p2.name === prop.name);
        const mainOptions = mainSchemaProp?.options ?? [];

        // Other options: from other schema for the mapped other property
        const otherSchemaProp = schema?.other.properties.find(p2 => p2.name === mapped.other_property);
        const otherOptions = otherSchemaProp?.options ?? [];

        return (
          <SelectOptionBlock
            key={prop.name}
            contentType={contentType}
            mainProperty={prop.name}
            mainOptions={mainOptions}
            otherOptions={otherOptions}
            show={show}
          />
        );
      })}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
const TABS = [
  {
    id: "projects", label: "Projects",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
  },
  {
    id: "users", label: "Users",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    id: "status", label: "Status",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
  {
    id: "files", label: "Files",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
    ),
  },
  {
    id: "meetings", label: "Meetings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    id: "updates", label: "Updates",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
] as const;
type TabId = typeof TABS[number]["id"];

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Page() {
  const [data, setData] = useState<MappingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("projects");
  const { visible, msg, show } = useToast();

  useEffect(() => {
    fetch("/api/mappings")
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const saveProject = useCallback((mainId: string) => async (otherId: string) => {
    const r = await fetch("/api/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "project", main_id: mainId, other_id: otherId || null }) });
    if (!r.ok) throw new Error();
    show("Saved");
  }, [show]);

  const saveUser = useCallback((val: string) => async (userId: string) => {
    const r = await fetch("/api/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", delegate_value: val, other_user_id: userId || null }) });
    if (!r.ok) throw new Error();
    show("Saved");
  }, [show]);

  const saveStatus = useCallback((mainStatus: string) => async (otherStatus: string) => {
    const r = await fetch("/api/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "status", main_status: mainStatus, other_status: otherStatus || null }) });
    if (!r.ok) throw new Error();
    show("Saved");
  }, [show]);

  const isContentTab = (t: TabId): t is ContentType => t === "files" || t === "meetings" || t === "updates";

  return (
    <div className="min-h-screen bg-[#F8F7FC]">

      {/* Header */}
      <header className="bg-[#1D1739]">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <img src="/Logo - White.png" alt="zikisolutions" className="h-7 w-auto" />
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-white/40 text-xs font-medium">Live</span>
          </div>
        </div>
      </header>

      {/* Page title */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 pt-8 pb-0">
          <h1 className="text-2xl font-extrabold text-[#1D1739] tracking-tight">Mappings</h1>
          <p className="text-gray-500 text-sm mt-1 mb-6">
            Link entities between <strong className="text-[#1D1739] font-semibold">Ziki Solutions</strong> and <strong className="text-[#1D1739] font-semibold">Notion State</strong>.
          </p>

          {/* Tabs */}
          <div className="flex gap-1 flex-wrap">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-all border-b-2 ${
                  tab === t.id
                    ? "text-[#1D1739] border-[#1D1739] bg-[#F8F7FC]"
                    : "text-gray-400 border-transparent hover:text-gray-600 hover:border-gray-200"
                }`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* ── Existing tabs (tasks mappings) ── */}
        {loading && !isContentTab(tab) && <SkeletonRows n={tab === "projects" ? 5 : 2} />}

        {error && !isContentTab(tab) && (
          <div className="rounded-xl bg-red-50 border border-red-100 p-5">
            <p className="font-bold text-red-600 text-sm">Failed to load</p>
            <p className="text-xs text-red-400 font-mono mt-1 break-all">{error}</p>
          </div>
        )}

        {data && tab === "projects" && (
          <div>
            {/* Column headers */}
            <div className="flex items-center gap-4 px-5 mb-1">
              <div className="w-40 shrink-0 text-[11px] font-bold uppercase tracking-widest text-gray-400">Ziki Solutions</div>
              <div className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Notion State</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-5 shadow-sm">
              {data.missingMainProjects ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  Add <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded text-[#382A79]">MAIN_PROJECTS_DS_ID</code> to enable
                </div>
              ) : data.mainProjects.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No active projects found</div>
              ) : data.mainProjects.map(p => {
                const m = data.projectMappings.find(x => x.main_id === p.id);
                return <MappingRow key={p.id} label={p.name} options={data.otherProjects} initialValue={m?.other_id ?? ""} onSave={saveProject(p.id)} />;
              })}
            </div>
          </div>
        )}

        {data && tab === "users" && (
          <div>
            <div className="flex items-center gap-4 px-5 mb-1">
              <div className="w-40 shrink-0 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                Ziki Solutions
                <span className="ml-2 normal-case tracking-normal font-medium text-gray-300">· Delegated To</span>
              </div>
              <div className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                Notion State
                {data.assigneePropName && (
                  <span className="ml-2 normal-case tracking-normal font-medium text-gray-300">· {data.assigneePropName}</span>
                )}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-5 shadow-sm">
              {data.delegatedToOptions.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No options found</div>
              ) : data.delegatedToOptions.map(({ value }) => {
                const m = data.userMappings.find(x => x.delegate_value === value);
                return <MappingRow key={value} label={value} options={data.otherUsers} initialValue={m?.other_user_id ?? ""} onSave={saveUser(value)} />;
              })}
            </div>
          </div>
        )}

        {data && tab === "status" && (
          <div>
            <div className="flex items-center gap-4 px-5 mb-1">
              <div className="w-40 shrink-0 text-[11px] font-bold uppercase tracking-widest text-gray-400">Ziki Solutions</div>
              <div className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Notion State</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-5 shadow-sm">
              {data.mainStatusOptions.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No statuses found</div>
              ) : data.mainStatusOptions.map(status => {
                const m = data.statusMappings.find(x => x.main_status === status);
                const otherOptions = data.otherStatusOptions.map(s => ({ id: s, name: s }));
                return <MappingRow key={status} label={status} options={otherOptions} initialValue={m?.other_status ?? ""} onSave={saveStatus(status)} />;
              })}
            </div>
          </div>
        )}

        {/* ── New content-type tabs ── */}
        {isContentTab(tab) && (
          <ContentTypeMappings key={tab} contentType={tab} show={show} />
        )}
      </div>

      {visible && (
        <div className="fixed bottom-6 right-6 toast-in">
          <div className="flex items-center gap-2 bg-[#1D1739] text-white text-sm font-semibold px-4 py-3 rounded-xl shadow-xl">
            <span className="text-[#FECC49]">✓</span> {msg}
          </div>
        </div>
      )}
    </div>
  );
}
