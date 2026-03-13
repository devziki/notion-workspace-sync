/**
 * Mapping UI — Dashboard (placeholder)
 *
 * This will become the full sync control panel once the Mapping UI feature
 * (Feature 5 in the PRD) is implemented. For now it renders the skeleton
 * layout and navigation structure.
 */

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-semibold text-gray-900 text-lg">
            Notion Workspace Sync
          </span>
          <span className="text-xs text-gray-400 font-mono">skeleton v0.1</span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Sync engine control plane — manage page pairs, mappings, and
            settings.
          </p>
        </div>

        {/* Section placeholders */}
        <div className="grid gap-6 md:grid-cols-2">
          <PlaceholderCard
            title="Synced Pages"
            description="List of all Main ↔ Other page pairs with sync status and last-synced timestamp."
            badge="Feature 1 & 4"
          />
          <PlaceholderCard
            title="Manual Push"
            description="Select a page from the Main workspace and push it to Other on demand."
            badge="Feature 1"
          />
          <PlaceholderCard
            title="Project Mapping"
            description="Map project entities between the two workspaces so properties translate correctly."
            badge="Feature 2"
          />
          <PlaceholderCard
            title="Sprint Mapping"
            description="Map sprint entities between workspaces."
            badge="Feature 2"
          />
          <PlaceholderCard
            title="User Mapping"
            description="Map Delegated To select values in Main to Notion users in Other."
            badge="Feature 2"
          />
          <PlaceholderCard
            title="Settings"
            description="View integration connection status and webhook endpoint URLs."
            badge="Feature 5"
          />
        </div>
      </div>
    </main>
  );
}

function PlaceholderCard({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <span className="text-[10px] font-mono bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-2 py-0.5 whitespace-nowrap">
          {badge}
        </span>
      </div>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
      <div className="mt-2 rounded-md bg-gray-50 border border-dashed border-gray-200 h-16 flex items-center justify-center">
        <span className="text-xs text-gray-400">— not yet implemented —</span>
      </div>
    </div>
  );
}
