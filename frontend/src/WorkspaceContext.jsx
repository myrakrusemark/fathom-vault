import { createContext, useContext, useEffect, useState } from 'react'

const WorkspaceContext = createContext({
  activeWorkspace: null,
  setActiveWorkspace: () => {},
  workspaces: {},
  defaultWorkspace: null,
  reloadWorkspaces: () => {},
})

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState({})
  const [defaultWorkspace, setDefaultWorkspace] = useState(null)
  const [activeWorkspace, setActiveWorkspaceRaw] = useState(() =>
    localStorage.getItem('fathom-workspace') || null
  )

  function reloadWorkspaces() {
    return fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const ws = data.workspaces || {}
        const dw = data.default_workspace || null
        setWorkspaces(ws)
        setDefaultWorkspace(dw)
        return { ws, dw }
      })
      .catch(() => ({ ws: {}, dw: null }))
  }

  // Load workspaces on mount
  useEffect(() => {
    reloadWorkspaces().then(({ ws, dw }) => {
      // If stored workspace is no longer valid, fall back to default
      const stored = localStorage.getItem('fathom-workspace')
      if (stored && ws[stored]) {
        setActiveWorkspaceRaw(stored)
      } else if (dw) {
        setActiveWorkspaceRaw(dw)
      } else {
        const first = Object.keys(ws)[0] || null
        setActiveWorkspaceRaw(first)
      }
    })
  }, [])

  function setActiveWorkspace(name) {
    setActiveWorkspaceRaw(name)
    if (name) localStorage.setItem('fathom-workspace', name)
    else localStorage.removeItem('fathom-workspace')
  }

  return (
    <WorkspaceContext.Provider value={{
      activeWorkspace,
      setActiveWorkspace,
      workspaces,
      defaultWorkspace,
      reloadWorkspaces,
    }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}

/**
 * Build a URL with workspace query param appended.
 * If workspace is the default, omit it (server uses default automatically).
 */
export function wsUrl(baseUrl, workspace) {
  if (!workspace) return baseUrl
  const sep = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${sep}workspace=${encodeURIComponent(workspace)}`
}
