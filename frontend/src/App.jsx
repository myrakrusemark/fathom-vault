import { useEffect, useState } from 'react'
import FileList from './components/FileList.jsx'
import FileViewer from './components/FileViewer.jsx'
import FolderTree from './components/FolderTree.jsx'

export default function App() {
  const [folders, setFolders] = useState([])
  const [selectedFolder, setSelectedFolder] = useState(null)
  const [files, setFiles] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileData, setFileData] = useState(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState(null)

  // Load folder tree on mount
  useEffect(() => {
    fetch('/api/vault')
      .then(r => r.json())
      .then(data => {
        setFolders(data)
        // Auto-select first folder
        if (data.length > 0) setSelectedFolder(data[0].path)
      })
      .catch(console.error)
  }, [])

  // Load files when folder changes
  useEffect(() => {
    if (selectedFolder === null) return
    const endpoint = selectedFolder === ''
      ? '/api/vault/folder/'
      : `/api/vault/folder/${selectedFolder}`
    fetch(endpoint)
      .then(r => r.json())
      .then(data => setFiles(data.files || []))
      .catch(console.error)
  }, [selectedFolder])

  // Load file content when file selection changes
  useEffect(() => {
    if (!selectedFile) return
    setFileLoading(true)
    setFileError(null)
    setFileData(null)

    const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp)$/i
    if (IMAGE_EXTS.test(selectedFile)) {
      // Images don't need JSON fetch — FileViewer renders via /api/vault/raw/
      setFileData({ isImage: true })
      setFileLoading(false)
      return
    }

    fetch(`/api/vault/file/${selectedFile}`)
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
  }, [selectedFile])

  function handleFolderSelect(path) {
    setSelectedFolder(path)
    setSelectedFile(null)
    setFileData(null)
  }

  return (
    <div className="flex h-screen bg-base-100 text-base-content overflow-hidden">
      {/* Header bar */}
      <div className="fixed top-0 left-0 right-0 z-10 h-10 bg-base-200 border-b border-base-300
        flex items-center px-4 gap-3">
        <span className="text-primary font-semibold text-sm tracking-wide">Fathom Vault</span>
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
      </div>

      {/* 3-panel layout below header */}
      <div className="flex flex-1 pt-10 overflow-hidden">
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
          />
        </div>

        {/* Right panel: file viewer */}
        <div className="flex-1 overflow-y-auto bg-base-100">
          <FileViewer
            filePath={selectedFile}
            data={fileData}
            loading={fileLoading}
            error={fileError}
          />
        </div>
      </div>
    </div>
  )
}
