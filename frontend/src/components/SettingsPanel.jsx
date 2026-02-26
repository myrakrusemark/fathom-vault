import { useEffect, useState } from 'react'

export default function SettingsPanel({ onClose }) {
  const [authStatus, setAuthStatus] = useState(null)
  const [fullApiKey, setFullApiKey] = useState(null)
  const [keyCopied, setKeyCopied] = useState(false)

  // Load auth status
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => setAuthStatus(data))
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
      </div>
    </div>
  )
}
