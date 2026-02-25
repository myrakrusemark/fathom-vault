import { useState, useRef, useEffect } from 'react'
import { useWorkspace } from '../WorkspaceContext.jsx'

export default function WorkspaceSelector() {
  const { activeWorkspace, setActiveWorkspace, workspaces } = useWorkspace()
  const wsNames = Object.keys(workspaces)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (wsNames.length <= 1) return null

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-base-300/50 hover:bg-base-300 transition-colors text-xs text-base-content"
        onClick={() => setOpen(o => !o)}
        aria-label="Select workspace"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
        <span className="font-medium">{activeWorkspace || 'default'}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`opacity-40 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-base-200 border border-base-300 rounded-lg shadow-lg z-30 min-w-[140px] py-1">
          {wsNames.map(name => (
            <button
              key={name}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                name === activeWorkspace
                  ? 'text-primary font-semibold bg-base-300/50'
                  : 'text-base-content hover:bg-base-300/50'
              }`}
              onClick={() => { setActiveWorkspace(name); setOpen(false) }}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                name === activeWorkspace ? 'bg-primary' : 'bg-base-300'
              }`} />
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
