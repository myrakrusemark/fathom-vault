import { useEffect, useRef, useState } from 'react'
import { useWorkspace, wsUrl } from '../WorkspaceContext.jsx'

const INTERVAL_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
]

const SEARCH_RESULTS_OPTIONS = [5, 10, 20, 50]

function relativeTime(isoString) {
  if (!isoString) return 'Not yet indexed'
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function SettingsPanel({ onClose }) {
  const { activeWorkspace, reloadWorkspaces } = useWorkspace()
  const [settings, setSettings] = useState(null)
  const [indexingNow, setIndexingNow] = useState(false)
  const [tick, setTick] = useState(0)
  const [dirInput, setDirInput] = useState('')
  const [dirError, setDirError] = useState('')
  const [newWsName, setNewWsName] = useState('')
  const [newWsPath, setNewWsPath] = useState('')
  const [wsError, setWsError] = useState('')
  const [authStatus, setAuthStatus] = useState(null)
  const [fullApiKey, setFullApiKey] = useState(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const debounceRef = useRef(null)

  // Load settings on mount and when workspace changes
  useEffect(() => {
    fetch(wsUrl('/api/settings', activeWorkspace))
      .then(r => r.json())
      .then(data => setSettings(data))
      .catch(console.error)
  }, [activeWorkspace])

  // Load auth status
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setAuthStatus(data))
      .catch(console.error)
  }, [])

  // Refresh relative time every 30s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  function saveSettings(updated) {
    setSettings(updated)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetch(wsUrl('/api/settings', activeWorkspace), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          background_index: updated.background_index,
          mcp: updated.mcp,
          activity: updated.activity,
          workspaces: updated.workspaces,
          default_workspace: updated.default_workspace,
        }),
      })
        .then(r => r.json())
        .then(data => setSettings(data))
        .catch(console.error)
    }, 500)
  }

  function handleToggle(e) {
    if (!settings) return
    saveSettings({
      ...settings,
      background_index: { ...settings.background_index, enabled: e.target.checked },
    })
  }

  function handleInterval(e) {
    if (!settings) return
    saveSettings({
      ...settings,
      background_index: { ...settings.background_index, interval_minutes: Number(e.target.value) },
    })
  }

  function handleIndexNow() {
    setIndexingNow(true)
    fetch(wsUrl('/api/settings/index-now', activeWorkspace), { method: 'POST' })
      .catch(console.error)
      .finally(() => {
        setTimeout(() => setIndexingNow(false), 5_000)
      })
  }

  function handleAddDir() {
    const dir = dirInput.trim()
    if (!dir.startsWith('/')) {
      setDirError('Path must start with /')
      return
    }
    setDirError('')
    setDirInput('')
    const current = settings.background_index.excluded_dirs || []
    if (current.includes(dir)) return
    saveSettings({
      ...settings,
      background_index: { ...settings.background_index, excluded_dirs: [...current, dir] },
    })
  }

  function handleRemoveDir(dir) {
    const current = settings.background_index.excluded_dirs || []
    saveSettings({
      ...settings,
      background_index: {
        ...settings.background_index,
        excluded_dirs: current.filter(d => d !== dir),
      },
    })
  }

  function handleAddWorkspace() {
    const name = newWsName.trim()
    const path = newWsPath.trim()
    if (!name) { setWsError('Name is required'); return }
    if (!path || !path.startsWith('/')) { setWsError('Path must be absolute'); return }
    if (settings?.workspaces?.[name]) { setWsError(`"${name}" already exists`); return }

    setWsError('')
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(data => {
        if (data.error) { setWsError(data.error); return }
        setNewWsName('')
        setNewWsPath('')
        fetch(wsUrl('/api/settings', activeWorkspace)).then(r => r.json()).then(s => { setSettings(s); reloadWorkspaces() })
      })
      .catch(e => setWsError(e.message || 'Failed to add workspace'))
  }

  function handleRemoveWorkspace(name) {
    fetch(`/api/workspaces/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(data => {
        if (data.error) { setWsError(data.error); return }
        fetch(wsUrl('/api/settings', activeWorkspace)).then(r => r.json()).then(s => { setSettings(s); reloadWorkspaces() })
      })
      .catch(e => setWsError(e.message || 'Failed to remove workspace'))
  }

  const bi = settings?.background_index
  const mcp = settings?.mcp
  const act = settings?.activity

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-sm font-semibold text-primary">Vault Settings</span>
        <button
          onClick={onClose}
          className="text-neutral-content opacity-60 hover:opacity-100 text-lg leading-none"
          aria-label="Close settings"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {!settings && (
          <p className="text-sm text-neutral-content opacity-60">Loading…</p>
        )}

        {settings && (
          <>
            {/* Workspaces section */}
            <section>
              <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
                Workspaces
              </h3>

              <p className="text-xs text-neutral-content opacity-40 mb-1.5">Select default</p>
              {/* Workspace table */}
              <div className="space-y-1 mb-3">
                {Object.entries(settings?.workspaces || {}).map(([name, path]) => (
                  <div key={name} className="flex items-center gap-2 px-2 py-1.5 rounded bg-base-100 border border-base-300">
                    <input
                      type="radio"
                      name="default-workspace"
                      className="radio radio-primary radio-xs"
                      checked={settings?.default_workspace === name}
                      onChange={() => {
                        const updated = { ...settings, default_workspace: name }
                        saveSettings(updated)
                        reloadWorkspaces()
                      }}
                      title="Set as default"
                    />
                    <span className="text-sm text-base-content font-medium min-w-[80px]">{name}</span>
                    <span className="text-xs text-neutral-content opacity-50 flex-1 truncate" title={path}>
                      {path}
                    </span>
                    <button
                      className="text-xs text-neutral-content opacity-40 hover:opacity-100 hover:text-error leading-none disabled:opacity-20"
                      onClick={() => handleRemoveWorkspace(name)}
                      disabled={settings?.default_workspace === name}
                      title={settings?.default_workspace === name ? 'Cannot remove default workspace' : `Remove ${name}`}
                      aria-label={`Remove workspace ${name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Add workspace */}
              <div className="flex gap-1.5 mb-1">
                <input
                  type="text"
                  className="input input-bordered input-sm text-xs bg-base-100 w-24"
                  placeholder="name"
                  value={newWsName}
                  onChange={e => { setNewWsName(e.target.value); setWsError('') }}
                />
                <input
                  type="text"
                  className="input input-bordered input-sm text-xs bg-base-100 flex-1"
                  placeholder="/path/to/project"
                  value={newWsPath}
                  onChange={e => { setNewWsPath(e.target.value); setWsError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleAddWorkspace()}
                />
                <button
                  className="btn btn-sm btn-outline"
                  onClick={handleAddWorkspace}
                >
                  Add
                </button>
              </div>
              {wsError && (
                <p className="text-xs text-error mb-1">{wsError}</p>
              )}
              <p className="text-xs text-neutral-content opacity-50 mb-1">
                Project root path (must contain vault/ subfolder). Radio selects default.
              </p>
            </section>

            <div className="divider my-1"></div>

            {/* Indexing section */}
            <section>
              <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
                Indexing
              </h3>

              {/* Excluded directories */}
              <div>
                <p className="text-xs font-medium text-base-content opacity-70 mb-1">
                  Excluded directories
                </p>
                <p className="text-xs text-neutral-content opacity-50 mb-2">
                  Also excluded from search results.
                </p>
                <div className="flex gap-2 mb-1">
                  <input
                    type="text"
                    className="input input-bordered input-sm text-xs flex-1 bg-base-100"
                    placeholder="/path/to/exclude"
                    value={dirInput}
                    onChange={e => { setDirInput(e.target.value); setDirError('') }}
                    onKeyDown={e => e.key === 'Enter' && handleAddDir()}
                  />
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={handleAddDir}
                  >
                    Add
                  </button>
                </div>
                {dirError && (
                  <p className="text-xs text-error mb-1">{dirError}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1">
                  {(bi.excluded_dirs || []).map(dir => (
                    <span
                      key={dir}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-base-200 text-xs text-base-content"
                    >
                      {dir}
                      <button
                        onClick={() => handleRemoveDir(dir)}
                        className="opacity-50 hover:opacity-100 leading-none"
                        aria-label={`Remove ${dir}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="divider my-1"></div>

              {/* Enabled toggle */}
              <label className="flex items-center justify-between gap-3 cursor-pointer mb-1">
                <span className="text-sm text-base-content">Background indexing</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={bi.enabled}
                  onChange={handleToggle}
                />
              </label>
              <p className="text-xs text-neutral-content opacity-50 mb-3">
                Indexes automatically at idle priority — won't slow down searches.
              </p>

              {/* Interval select — only shown when enabled */}
              {bi.enabled && (
                <label className="flex items-center justify-between gap-3 mb-3">
                  <span className="text-sm text-base-content opacity-80">Interval</span>
                  <select
                    className="select select-bordered select-sm text-sm bg-base-100"
                    value={bi.interval_minutes}
                    onChange={handleInterval}
                  >
                    {INTERVAL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              )}

              {/* Last indexed */}
              { }
              <p className="text-xs text-neutral-content opacity-50 mb-4" aria-live="polite">
                {tick >= 0 && `Last indexed: ${relativeTime(bi.last_indexed)}`}
              </p>

              {/* Re-index now button */}
              <button
                className="btn btn-sm btn-outline mb-4"
                onClick={handleIndexNow}
                disabled={indexingNow}
              >
                {indexingNow ? 'Indexing…' : 'Re-index now'}
              </button>
            </section>

            <div className="divider my-1"></div>

            {/* Search & MCP section */}
            <section>
              <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
                Search &amp; MCP
              </h3>

              {/* Query timeout */}
              <label className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm text-base-content">Query timeout</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input input-bordered input-sm text-sm bg-base-100 w-20 text-right"
                    min={10}
                    max={300}
                    step={10}
                    value={mcp.query_timeout_seconds}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (v >= 10 && v <= 300) {
                        saveSettings({ ...settings, mcp: { ...mcp, query_timeout_seconds: v } })
                      }
                    }}
                  />
                  <span className="text-xs text-neutral-content opacity-60">s</span>
                </div>
              </label>
              <p className="text-xs text-neutral-content opacity-50 mb-3">
                How long fathom_query waits before failing.
              </p>

              {/* Search results */}
              <label className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm text-base-content opacity-80">Results per search</span>
                <select
                  className="select select-bordered select-sm text-sm bg-base-100"
                  value={mcp.search_results}
                  onChange={e =>
                    saveSettings({ ...settings, mcp: { ...mcp, search_results: Number(e.target.value) } })
                  }
                >
                  {SEARCH_RESULTS_OPTIONS.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>

              {/* Search mode */}
              <div className="mb-1">
                <span className="text-sm text-base-content opacity-80 block mb-2">Search mode</span>
                <div className="flex gap-2">
                  {['hybrid', 'keyword'].map(mode => (
                    <button
                      key={mode}
                      className={`btn btn-sm ${mcp.search_mode === mode ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() =>
                        saveSettings({ ...settings, mcp: { ...mcp, search_mode: mode } })
                      }
                    >
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-content opacity-50 mt-2">
                  Hybrid: BM25 + vectors + reranking. Slower but more accurate.
                </p>
              </div>
            </section>

            <div className="divider my-1"></div>

            {/* Activity Tracking section */}
            <section>
              <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
                Activity Tracking
              </h3>

              {/* show_heat_indicator */}
              <label className="flex items-center justify-between gap-3 cursor-pointer mb-3">
                <span className="text-sm text-base-content">Heat indicator dots</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={act?.show_heat_indicator ?? true}
                  onChange={e => saveSettings({ ...settings, activity: { ...act, show_heat_indicator: e.target.checked } })}
                />
              </label>

              {/* activity_sort_default */}
              <label className="flex items-center justify-between gap-3 cursor-pointer mb-3">
                <span className="text-sm text-base-content">Default sort: activity</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={act?.activity_sort_default ?? false}
                  onChange={e => saveSettings({ ...settings, activity: { ...act, activity_sort_default: e.target.checked } })}
                />
              </label>

              {/* decay_halflife_days */}
              <label className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm text-base-content opacity-80">Decay half-life</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input input-bordered input-sm text-sm bg-base-100 w-20 text-right"
                    min={1} max={365} step={1}
                    value={act?.decay_halflife_days ?? 7}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (v >= 1) saveSettings({ ...settings, activity: { ...act, decay_halflife_days: v } })
                    }}
                  />
                  <span className="text-xs text-neutral-content opacity-60">days</span>
                </div>
              </label>

              {/* recency_window_hours */}
              <label className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm text-base-content opacity-80">Recency window</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input input-bordered input-sm text-sm bg-base-100 w-20 text-right"
                    min={1} max={720} step={1}
                    value={act?.recency_window_hours ?? 48}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (v >= 1) saveSettings({ ...settings, activity: { ...act, recency_window_hours: v } })
                    }}
                  />
                  <span className="text-xs text-neutral-content opacity-60">hours</span>
                </div>
              </label>

              {/* max_access_boost */}
              <label className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm text-base-content opacity-80">Max access boost</span>
                <input
                  type="number"
                  className="input input-bordered input-sm text-sm bg-base-100 w-20 text-right"
                  min={0.5} max={10} step={0.5}
                  value={act?.max_access_boost ?? 2.0}
                  onChange={e => {
                    const v = Number(e.target.value)
                    if (v >= 0.5) saveSettings({ ...settings, activity: { ...act, max_access_boost: v } })
                  }}
                />
              </label>

              {/* excluded_from_scoring */}
              <div>
                <p className="text-xs font-medium text-base-content opacity-70 mb-1">
                  Excluded folders
                </p>
                <p className="text-xs text-neutral-content opacity-50 mb-2">
                  Folders excluded from activity scoring (comma-separated).
                </p>
                <input
                  type="text"
                  className="input input-bordered input-sm text-xs w-full bg-base-100"
                  placeholder="daily, archive"
                  value={(act?.excluded_from_scoring ?? ["daily"]).join(", ")}
                  onChange={e => {
                    const folders = e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                    saveSettings({ ...settings, activity: { ...act, excluded_from_scoring: folders } })
                  }}
                />
              </div>
            </section>

            <div className="divider my-1"></div>

            {/* API Key & Auth section */}
            <section>
              <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
                API Key &amp; Auth
              </h3>

              {authStatus && (
                <>
                  {/* Auth toggle */}
                  <label className="flex items-center justify-between gap-3 cursor-pointer mb-3">
                    <span className="text-sm text-base-content">Require API key</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={authStatus.auth_enabled}
                      onChange={e => {
                        const enabled = e.target.checked
                        fetch('/api/auth/toggle', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ enabled }),
                        })
                          .then(r => r.json())
                          .then(data => setAuthStatus(s => ({ ...s, auth_enabled: data.auth_enabled })))
                          .catch(console.error)
                      }}
                    />
                  </label>
                  <p className="text-xs text-neutral-content opacity-50 mb-3">
                    When enabled, MCP clients must include the API key in requests.
                  </p>

                  {/* API Key display */}
                  <div className="mb-3">
                    <p className="text-xs font-medium text-base-content opacity-70 mb-1">API Key</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-base-100 border border-base-300 rounded px-2 py-1 flex-1 font-mono truncate">
                        {fullApiKey || authStatus.api_key_masked}
                      </code>
                      {!fullApiKey ? (
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => {
                            fetch('/api/auth/key')
                              .then(r => r.json())
                              .then(data => setFullApiKey(data.api_key))
                              .catch(console.error)
                          }}
                        >
                          Reveal
                        </button>
                      ) : (
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => {
                            navigator.clipboard.writeText(fullApiKey)
                            setKeyCopied(true)
                            setTimeout(() => setKeyCopied(false), 2000)
                          }}
                        >
                          {keyCopied ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-neutral-content opacity-50 mt-1">
                      Use this key in .fathom.json for MCP client auth.
                    </p>
                  </div>

                  {/* Regenerate */}
                  <button
                    className="btn btn-xs btn-outline btn-warning"
                    onClick={() => {
                      if (!confirm('Regenerate API key? Existing clients will need updating.')) return
                      fetch('/api/auth/key/regenerate', { method: 'POST' })
                        .then(r => r.json())
                        .then(data => {
                          setFullApiKey(data.api_key)
                          setAuthStatus(s => ({
                            ...s,
                            api_key_masked: data.api_key.slice(0, 7) + '...' + data.api_key.slice(-4),
                          }))
                        })
                        .catch(console.error)
                    }}
                  >
                    Regenerate key
                  </button>
                </>
              )}
            </section>

          </>
        )}
      </div>
    </div>
  )
}
