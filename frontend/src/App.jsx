import { useCallback, useEffect, useState } from 'react'
import FileList from './components/FileList.jsx'
import FileViewer from './components/FileViewer.jsx'
import FolderTree from './components/FolderTree.jsx'
import ActiveFilesPanel from './components/ActiveFilesPanel.jsx'
import SearchPanel from './components/SearchPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import TerminalPanel from './components/TerminalPanel.jsx'
import ActivationView from './components/ActivationView.jsx'
import CommunicationView from './components/CommunicationView.jsx'
import WorkspaceSelector from './components/WorkspaceSelector.jsx'
import ViewTabs from './components/ViewTabs.jsx'
import { WorkspaceProvider, useWorkspace, wsUrl } from './WorkspaceContext.jsx'

export default function App() {
  return (
    <WorkspaceProvider>
      <AppInner />
    </WorkspaceProvider>
  )
}

function AppInner() {
  const { activeWorkspace, workspaces } = useWorkspace()
  const [folders, setFolders] = useState([])
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [files, setFiles] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileData, setFileData] = useState(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeFilesOpen, setActiveFilesOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [currentView, setCurrentView] = useState('vault') // 'vault' | 'activation'
  const [theme, setTheme] = useState(() => localStorage.getItem('fathom-theme') || 'fathom-v')
  const [sortBy, setSortBy] = useState('modified')
  const [showHeatDots, setShowHeatDots] = useState(true)
  const [disabledToast, setDisabledToast] = useState(null)

  // Derive workspace type for active workspace
  const wsEntry = workspaces[activeWorkspace]
  const wsType = (typeof wsEntry === 'object' ? wsEntry?.type : null) || 'local'
  const disabledViews = wsType === 'human' ? ['memento', 'activation'] : []

  // Apply theme to DOM and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fathom-theme', theme)
  }, [theme])

  // Auto-switch theme when view changes
  useEffect(() => {
    if (currentView === 'vault') setTheme('fathom-v')
    else if (currentView === 'activation') setTheme('fathom-a')
    else if (currentView === 'communication') setTheme('fathom-c')
  }, [currentView])

  // Load activity settings on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const act = data.activity || {}
        setShowHeatDots(act.show_heat_indicator !== false)
        if (act.activity_sort_default) setSortBy('activity')
      })
      .catch(() => {})
  }, [])

  // Load folder tree on mount and when workspace changes
  useEffect(() => {
    if (!activeWorkspace) return
    fetch(wsUrl('/api/vault', activeWorkspace))
      .then(r => r.json())
      .then(data => {
        setFolders(data)
        setSelectedFile(null)
        setFileData(null)
        if (data.length > 0) setSelectedFolder(data[0].path)
        else setSelectedFolder(null)
      })
      .catch(console.error)
  }, [activeWorkspace])

  // Load files when folder or workspace changes
  useEffect(() => {
    if (selectedFolder === null || !activeWorkspace) return
    const endpoint = selectedFolder === ''
      ? '/api/vault/folder/'
      : `/api/vault/folder/${selectedFolder}`
    fetch(wsUrl(endpoint, activeWorkspace))
      .then(r => r.json())
      .then(data => setFiles(data.files || []))
      .catch(console.error)
  }, [selectedFolder, activeWorkspace])

  // Load file content when file selection or refreshKey changes
  useEffect(() => {
    if (!selectedFile) return
    const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp)$/i
    if (IMAGE_EXTS.test(selectedFile)) {
      setFileData({ isImage: true })
      setFileLoading(false)
      return
    }

    setFileLoading(true)
    setFileError(null)
    setFileData(null)

    fetch(wsUrl(`/api/vault/file/${selectedFile}`, activeWorkspace))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setFileData(data)
        setFileLoading(false)
      })
      .catch(e => {
        setFileError(e.message)
        setFileLoading(false)
      })
  }, [selectedFile, refreshKey, activeWorkspace])

  function handleFolderSelect(path) {
    setSelectedFolder(path)
    setSelectedFile(null)
    setFileData(null)
  }

  // Navigate to a file by full relative path (used by wikilink clicks)
  function navigateToFile(relPath) {
    const lastSlash = relPath.lastIndexOf('/')
    const folder = lastSlash >= 0 ? relPath.slice(0, lastSlash) : ''
    setSelectedFolder(folder)
    setSelectedFile(relPath)
  }

  // Resolve a wikilink name → path, then navigate (V-5)
  const handleWikilinkClick = useCallback(async (name) => {
    try {
      const r = await fetch(wsUrl(`/api/vault/resolve?name=${encodeURIComponent(name)}`, activeWorkspace))
      const data = await r.json()
      if (data.path) {
        navigateToFile(data.path)
      }
    } catch (e) {
      console.error('Wikilink resolve failed:', e)
    }
  }, [activeWorkspace])

  // After a save, reload file content (V-11)
  const handleSaved = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div className="flex h-screen bg-base-100 text-base-content overflow-hidden">
      {/* Header bar */}
      <div className="fixed top-0 left-0 right-0 z-30 h-10 bg-base-200 border-b border-base-300
        flex items-center px-4 gap-3">
        <ViewTabs
          currentView={currentView}
          setCurrentView={setCurrentView}
          disabledViews={disabledViews}
          activeWorkspace={activeWorkspace}
          onDisabledClick={(viewId) => {
            const label = viewId === 'memento' ? 'Memento' : viewId === 'activation' ? 'Activation' : viewId
            setDisabledToast(`Humans don't have ${label}.`)
            setTimeout(() => setDisabledToast(null), 2500)
          }}
        />
        {currentView === 'vault' && (
          <>
            {selectedFolder !== null && (
              <>
                <span className="text-neutral-content opacity-40">/</span>
                <span className="text-sm text-neutral-content opacity-70">
                  {selectedFolder || '(root)'}
                </span>
              </>
            )}
            {selectedFile && (
              <>
                <span className="text-neutral-content opacity-40">/</span>
                <span className="text-sm text-accent opacity-80">
                  {selectedFile.split('/').pop()}
                </span>
              </>
            )}
          </>
        )}
        <button
          onClick={() => { setActiveFilesOpen(o => !o); setSearchOpen(false); setSettingsOpen(false); setTerminalOpen(false) }}
          className={`ml-auto p-1 rounded hover:bg-base-300 transition-colors ${
            activeFilesOpen ? 'text-primary' : 'text-neutral-content opacity-60 hover:opacity-100'
          }`}
          aria-label="Toggle file activity"
          title="File activity"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <circle cx="12" cy="14" r="2" />
            <path d="M12 12v-2" />
          </svg>
        </button>
        <button
          onClick={() => { setSearchOpen(o => !o); setSettingsOpen(false); setTerminalOpen(false) }}
          className={`p-1 rounded hover:bg-base-300 transition-colors ${
            searchOpen ? 'text-primary' : 'text-neutral-content opacity-60 hover:opacity-100'
          }`}
          aria-label="Toggle search"
          title="Search vault"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          onClick={() => { setTerminalOpen(o => !o); setSearchOpen(false); setSettingsOpen(false); setActiveFilesOpen(false) }}
          className={`p-1 rounded hover:bg-base-300 transition-colors ${
            terminalOpen ? 'text-primary' : 'text-neutral-content opacity-60 hover:opacity-100'
          }`}
          aria-label="Toggle terminal"
          title={wsType === 'human' ? 'Inbox' : 'Claude Agent'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
        <button
          onClick={() => { setSettingsOpen(o => !o); setSearchOpen(false); setTerminalOpen(false) }}
          className={`p-1 rounded hover:bg-base-300 transition-colors ${
            settingsOpen ? 'text-primary' : 'text-neutral-content opacity-60 hover:opacity-100'
          }`}
          aria-label="Toggle settings"
          title="Vault settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
              a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
              A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06
              A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
              A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06
              A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
              a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06
              A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
              a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <WorkspaceSelector />
      </div>

      {/* Toast for disabled views */}
      {disabledToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-neutral text-neutral-content text-sm shadow-lg animate-fade-in">
          {disabledToast}
        </div>
      )}

      {/* Main content below header */}
      <div className="relative flex flex-1 pt-10 overflow-hidden">
        {disabledViews.includes(currentView) ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-sm text-neutral-content opacity-40">
              Not available for human workspaces.
            </p>
          </div>
        ) : currentView === 'activation' ? (
          <ActivationView />
        ) : currentView === 'communication' ? (
          <CommunicationView />
        ) : (
          <>
            {/* Left panel: folder tree */}
            <div className="w-60 shrink-0 bg-base-200 border-r border-base-300 overflow-y-auto">
              <FolderTree
                folders={folders}
                selectedFolder={selectedFolder}
                onSelect={handleFolderSelect}
              />
            </div>

            {/* Center panel: file list */}
            <div className="w-80 shrink-0 border-r border-base-300 overflow-y-auto bg-base-100">
              <FileList
                folder={selectedFolder}
                files={files}
                selectedFile={selectedFile}
                onSelect={setSelectedFile}
                sortBy={sortBy}
                onSortChange={setSortBy}
                showHeatDots={showHeatDots}
              />
            </div>

            {/* Right panel: file viewer */}
            <div className="flex-1 overflow-y-auto bg-base-100">
              <FileViewer
                filePath={selectedFile}
                data={fileData}
                loading={fileLoading}
                error={fileError}
                onWikilinkClick={handleWikilinkClick}
                onNavigate={navigateToFile}
                onSaved={handleSaved}
              />
            </div>
          </>
        )}

        {/* Overlay panels — rendered over any view */}
        {activeFilesOpen && (
          <div className="fixed right-0 top-10 bottom-0 w-[360px] border-l border-base-300 bg-base-200 overflow-y-auto z-20 shadow-xl">
            <ActiveFilesPanel
              onClose={() => setActiveFilesOpen(false)}
              onNavigate={(path) => { navigateToFile(path); setActiveFilesOpen(false) }}
            />
          </div>
        )}
        {searchOpen && (
          <div className="fixed right-0 top-10 bottom-0 w-[360px] border-l border-base-300 bg-base-200 overflow-y-auto z-20 shadow-xl">
            <SearchPanel
              onClose={() => setSearchOpen(false)}
              onNavigate={navigateToFile}
            />
          </div>
        )}
        {settingsOpen && (
          <div className="fixed right-0 top-10 bottom-0 w-[360px] border-l border-base-300 bg-base-200 overflow-y-auto z-20 shadow-xl">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        )}
        {terminalOpen && (
          <div className="fixed right-0 top-10 bottom-0 w-[520px] border-l border-base-300 bg-base-200 overflow-hidden z-20 shadow-xl">
            <TerminalPanel
              onClose={() => setTerminalOpen(false)}
              filePath={selectedFile}
            />
          </div>
        )}
      </div>
    </div>
  )
}
