import { useCallback, useEffect, useState } from 'react'
import FileList from './components/FileList.jsx'
import FileViewer from './components/FileViewer.jsx'
import FolderTree from './components/FolderTree.jsx'
import ActiveFilesPanel from './components/ActiveFilesPanel.jsx'
import SearchPanel from './components/SearchPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import TerminalPanel from './components/TerminalPanel.jsx'
import ActivationView from './components/ActivationView.jsx'
import WorkspaceSelector from './components/WorkspaceSelector.jsx'
import { WorkspaceProvider, useWorkspace, wsUrl } from './WorkspaceContext.jsx'

export default function App() {
  return (
    <WorkspaceProvider>
      <AppInner />
    </WorkspaceProvider>
  )
}

function AppInner() {
  const { activeWorkspace } = useWorkspace()
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

  // Apply theme to DOM and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fathom-theme', theme)
  }, [theme])

  // Auto-switch theme when view changes
  useEffect(() => {
    if (currentView === 'vault') setTheme('fathom-v')
    else if (currentView === 'activation') setTheme('fathom-a')
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
      <div className="fixed top-0 left-0 right-0 z-10 h-10 bg-base-200 border-b border-base-300
        flex items-center px-4 gap-3">
        <div className="dropdown">
          <div tabIndex={0} role="button" className="flex items-center gap-1 cursor-pointer select-none">
            <span className="text-primary font-semibold text-sm tracking-wide">
              {currentView === 'activation' ? 'Activation' : 'Fathom Vault'}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="text-primary opacity-60">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          <ul tabIndex={0} className="dropdown-content menu bg-base-200 border border-base-300 rounded-box z-20 w-48 p-1 shadow-lg mt-1">
            <li>
              <a href="https://hifathom.com/dashboard/" target="_blank" rel="noopener noreferrer"
                className="text-sm flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#06B6D4' }} />
                Memento
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="opacity-50 ml-auto">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </li>
            <li>
              {currentView === 'vault' ? (
                <span className="text-primary font-semibold text-sm pointer-events-none flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#8B5CF6' }} />
                  Vault
                  <span className="ml-auto text-[10px] opacity-50 font-normal">current</span>
                </span>
              ) : (
                <button
                  className="text-sm text-left w-full flex items-center gap-2"
                  onClick={() => { setCurrentView('vault'); document.activeElement.blur() }}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#8B5CF6' }} />
                  Vault
                </button>
              )}
            </li>
            <li>
              {currentView === 'activation' ? (
                <span className="text-primary font-semibold text-sm pointer-events-none flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#F4A261' }} />
                  Activation
                  <span className="ml-auto text-[10px] opacity-50 font-normal">current</span>
                </span>
              ) : (
                <button
                  className="text-sm text-left w-full flex items-center gap-2"
                  onClick={() => { setCurrentView('activation'); document.activeElement.blur() }}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#F4A261' }} />
                  Activation
                </button>
              )}
            </li>
            <li>
              <span className="text-sm flex items-center gap-2 opacity-40 pointer-events-none">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#4ADE80' }} />
                Crystallization
                <span className="ml-auto text-[10px] font-normal">soon</span>
              </span>
            </li>
          </ul>
        </div>
        {currentView !== 'activation' && (
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
          aria-label="Toggle active files"
          title="Active files"
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
          title="Claude Agent"
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

      {/* Main content below header */}
      <div className="relative flex flex-1 pt-10 overflow-hidden">
        {currentView === 'activation' ? (
          <ActivationView />
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
