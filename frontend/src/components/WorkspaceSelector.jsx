import { useState, useRef, useEffect } from 'react'
import { useWorkspace, wsUrl } from '../WorkspaceContext.jsx'
import WorkspaceSettingsModal from './WorkspaceSettingsModal.jsx'

export default function WorkspaceSelector() {
  const { activeWorkspace, setActiveWorkspace, workspaces, defaultWorkspace, reloadWorkspaces } = useWorkspace()
  const wsNames = Object.keys(workspaces)
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState({})
  const [kebabTarget, setKebabTarget] = useState(null) // workspace name with open context menu
  const [modalTarget, setModalTarget] = useState(null) // workspace name with open settings modal
  const [wsError, setWsError] = useState('')
  const ref = useRef(null)
  const kebabRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setKebabTarget(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close kebab menu on outside click
  useEffect(() => {
    if (!kebabTarget) return
    function handleClick(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) {
        setKebabTarget(null)
      }
    }
    // Small delay so the kebab button click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [kebabTarget])

  // Fetch profiles when dropdown opens
  useEffect(() => {
    if (!open) return
    fetch(wsUrl('/api/workspaces/profiles', activeWorkspace))
      .then(r => r.json())
      .then(data => setProfiles(data.profiles || {}))
      .catch(console.error)
  }, [open, activeWorkspace])

  function handleMakePrimary(name) {
    fetch(wsUrl('/api/settings', activeWorkspace), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_workspace: name }),
    })
      .then(r => r.json())
      .then(() => reloadWorkspaces())
      .catch(console.error)
    setKebabTarget(null)
  }

  function handleRemoveWorkspace(name) {
    fetch(`/api/workspaces/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(data => {
        if (data.error) { setWsError(data.error); return }
        reloadWorkspaces()
      })
      .catch(e => setWsError(e.message || 'Failed to remove workspace'))
    setKebabTarget(null)
  }

  if (wsNames.length <= 1) return null

  const activeProfile = profiles[activeWorkspace] || {}
  const activeType = activeProfile.type || (typeof workspaces[activeWorkspace] === 'object' ? workspaces[activeWorkspace]?.type : null) || 'local'

  // Status dot color
  function dotColor(name) {
    const profile = profiles[name] || {}
    const entry = workspaces[name]
    const type = profile.type || (typeof entry === 'object' ? entry?.type : null) || 'local'
    if (type === 'human') return 'bg-rose-400'
    if (profile.running) return 'bg-success'
    return 'bg-base-content/30'
  }

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-base-300/50 hover:bg-base-300 transition-colors text-xs text-base-content"
          onClick={() => { setOpen(o => !o); setKebabTarget(null) }}
          aria-label="Select workspace"
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor(activeWorkspace)}`} />
          <span className="font-medium">{activeWorkspace || 'default'}</span>
          {defaultWorkspace === activeWorkspace && (
            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24"
              fill="currentColor" className="opacity-40 shrink-0">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          )}
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`opacity-40 transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 bg-base-200 border border-base-300 rounded-lg shadow-lg z-30 w-[280px] py-1">
            {wsNames.map(name => {
              const profile = profiles[name] || {}
              const entry = workspaces[name]
              const type = profile.type || (typeof entry === 'object' ? entry?.type : null) || 'local'
              const desc = profile.description || (typeof entry === 'object' ? entry?.description : '') || ''
              const isPrimary = defaultWorkspace === name

              return (
                <div key={name} className="relative group">
                  <button
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left text-xs transition-colors ${
                      name === activeWorkspace
                        ? 'bg-base-300/50'
                        : 'hover:bg-base-300/30'
                    }`}
                    onClick={() => { setActiveWorkspace(name); setOpen(false); setKebabTarget(null) }}
                  >
                    {/* Status dot */}
                    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${dotColor(name)}`} />

                    {/* Name + badges + description */}
                    <div className="flex-1 min-w-0 pr-5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-medium ${name === activeWorkspace ? 'text-primary' : 'text-base-content'}`}>
                          {name}
                        </span>
                        {isPrimary && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24"
                            fill="currentColor" className="opacity-40 shrink-0" title="Primary workspace">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        )}
                        {type === 'human' && (
                          <span className="text-[9px] px-1 py-0 rounded bg-rose-500/15 text-rose-400 font-medium leading-tight">
                            human
                          </span>
                        )}
                        {profile.architecture && (
                          <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary opacity-60 font-medium leading-tight">
                            {profile.architecture}
                          </span>
                        )}
                      </div>
                      {desc && (
                        <p className="text-[10px] text-neutral-content opacity-50 truncate mt-0.5">
                          {desc}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Kebab menu trigger */}
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-base-300 transition-all"
                    onClick={e => {
                      e.stopPropagation()
                      setKebabTarget(kebabTarget === name ? null : name)
                    }}
                    aria-label={`Options for ${name}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                      fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>

                  {/* Kebab context menu */}
                  {kebabTarget === name && (
                    <div
                      ref={kebabRef}
                      className="absolute right-1 top-full mt-0.5 bg-base-100 border border-base-300 rounded-lg shadow-lg z-40 py-1 w-[160px]"
                    >
                      <button
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-base-300/50 transition-colors text-base-content"
                        onClick={e => {
                          e.stopPropagation()
                          setModalTarget(name)
                          setKebabTarget(null)
                          setOpen(false)
                        }}
                      >
                        Settings
                      </button>
                      <button
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-base-300/50 transition-colors text-base-content disabled:opacity-30"
                        disabled={isPrimary}
                        onClick={e => {
                          e.stopPropagation()
                          handleMakePrimary(name)
                        }}
                      >
                        Make primary
                        {!isPrimary && (
                          <span className="block text-[10px] text-neutral-content opacity-50 mt-0.5">
                            MCP tools use this by default
                          </span>
                        )}
                      </button>
                      <div className="divider my-0.5 mx-2"></div>
                      <button
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-error/10 transition-colors text-error/70 hover:text-error disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-error/70"
                        disabled={isPrimary}
                        onClick={e => {
                          e.stopPropagation()
                          handleRemoveWorkspace(name)
                        }}
                        title={isPrimary ? 'Cannot remove primary workspace' : `Remove ${name}`}
                      >
                        Remove workspace
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {wsError && (
              <p className="text-xs text-error px-3 py-1">{wsError}</p>
            )}
          </div>
        )}
      </div>

      {/* Settings modal */}
      {modalTarget && (
        <WorkspaceSettingsModal
          workspaceName={modalTarget}
          profile={profiles[modalTarget] || {}}
          wsEntry={workspaces[modalTarget]}
          onClose={() => setModalTarget(null)}
        />
      )}
    </>
  )
}
