import { useEffect, useState } from 'react'

export default function SettingsPanel({ onClose }) {
  const [authStatus, setAuthStatus] = useState(null)
  const [fullApiKey, setFullApiKey] = useState(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [retentionDays, setRetentionDays] = useState(7)
  const [retentionUnlimited, setRetentionUnlimited] = useState(false)
  const [retentionSaving, setRetentionSaving] = useState(false)

  // Load auth status + settings
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setAuthStatus(data))
      .catch(console.error)
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const rd = data.rooms?.retention_days
        if (rd === null) {
          setRetentionUnlimited(true)
          setRetentionDays(7)
        } else {
          setRetentionUnlimited(false)
          setRetentionDays(rd ?? 7)
        }
      })
      .catch(console.error)
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-sm font-semibold text-primary">Server Settings</span>
        <button
          onClick={onClose}
          className="text-neutral-content opacity-60 hover:opacity-100 text-lg leading-none"
          aria-label="Close settings"
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* API Key & Auth section */}
        <section>
          <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
            API Key &amp; Auth
          </h3>

          {!authStatus && (
            <p className="text-sm text-neutral-content opacity-60">Loading...</p>
          )}

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

        {/* Rooms section */}
        <section>
          <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
            Rooms
          </h3>

          {/* Retention toggle */}
          <label className="flex items-center justify-between gap-3 cursor-pointer mb-2">
            <span className="text-sm text-base-content">Unlimited retention</span>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={retentionUnlimited}
              onChange={e => {
                const unlimited = e.target.checked
                setRetentionUnlimited(unlimited)
                setRetentionSaving(true)
                fetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rooms: { retention_days: unlimited ? null : retentionDays } }),
                })
                  .then(r => r.json())
                  .then(() => setRetentionSaving(false))
                  .catch(() => setRetentionSaving(false))
              }}
            />
          </label>

          {/* Retention days input */}
          {!retentionUnlimited && (
            <div className="mb-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={retentionDays}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    if (v >= 1 && v <= 60) setRetentionDays(v)
                  }}
                  onBlur={() => {
                    setRetentionSaving(true)
                    fetch('/api/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ rooms: { retention_days: retentionDays } }),
                    })
                      .then(r => r.json())
                      .then(() => setRetentionSaving(false))
                      .catch(() => setRetentionSaving(false))
                  }}
                  className="w-16 px-2 py-1 rounded-md bg-base-100 border border-base-300 text-sm text-base-content
                    focus:outline-none focus:border-primary/50 transition-colors text-center"
                />
                <span className="text-sm text-base-content opacity-70">days</span>
                {retentionSaving && (
                  <span className="text-[10px] text-primary opacity-60">saving...</span>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-neutral-content opacity-50">
            Messages older than this are pruned automatically. Applies to all rooms.
          </p>
        </section>
      </div>
    </div>
  )
}
