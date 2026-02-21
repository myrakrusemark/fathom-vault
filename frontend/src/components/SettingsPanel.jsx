import { useEffect, useRef, useState } from 'react'

const INTERVAL_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
]

function relativeTime(isoString) {
  if (!isoString) return 'Not yet indexed'
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function SettingsPanel({ onClose }) {
  const [settings, setSettings] = useState(null)
  const [indexingNow, setIndexingNow] = useState(false)
  const [tick, setTick] = useState(0)
  const debounceRef = useRef(null)

  // Load settings on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => setSettings(data))
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
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ background_index: updated.background_index }),
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
    fetch('/api/settings/index-now', { method: 'POST' })
      .catch(console.error)
      .finally(() => {
        setTimeout(() => setIndexingNow(false), 5_000)
      })
  }

  const bi = settings?.background_index

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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {!settings && (
          <p className="text-sm text-neutral-content opacity-60">Loading…</p>
        )}

        {settings && (
          <>
            {/* Background indexing section */}
            <section>
              <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
                Background Indexing
              </h3>

              {/* Enabled toggle */}
              <label className="flex items-center justify-between gap-3 cursor-pointer mb-3">
                <span className="text-sm text-base-content">Background indexing</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={bi.enabled}
                  onChange={handleToggle}
                />
              </label>

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
              {/* tick is used to force re-render every 30s for relative time */}
              {/* eslint-disable-next-line no-unused-expressions */}
              <p className="text-xs text-neutral-content opacity-50 mb-4" aria-live="polite">
                {tick >= 0 && `Last indexed: ${relativeTime(bi.last_indexed)}`}
              </p>

              {/* Re-index now button */}
              <button
                className="btn btn-sm btn-outline"
                onClick={handleIndexNow}
                disabled={indexingNow}
              >
                {indexingNow ? 'Indexing…' : 'Re-index now'}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
