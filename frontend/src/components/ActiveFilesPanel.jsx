import { useCallback, useEffect, useState } from "react"
import { useWorkspace, wsUrl } from "../WorkspaceContext.jsx"

function relativeTime(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - ts * 1000) / 1000)
  if (diff < 60) return diff + "s ago"
  if (diff < 3600) return Math.floor(diff / 60) + "m ago"
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago"
  return Math.floor(diff / 86400) + "d ago"
}

function heatClass(score) {
  if (score > 1.5) return "text-primary"
  if (score >= 0.5) return "text-secondary"
  return "text-neutral-content opacity-40"
}

function FileCard({ file, onNavigate }) {
  const folder = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : ""
  const name = file.path.split("/").pop()
  const cls = heatClass(file.score)

  return (
    <div
      className="rounded-lg p-3 cursor-pointer transition-colors hover:bg-base-300 border border-base-300"
      onClick={() => onNavigate(file.path)}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 shrink-0 text-[8px] ${cls}`}
          title={"Score: " + file.score.toFixed(3)}
        >
          {"●"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-base-content truncate">
            {file.title || name.replace(/\.md$/, "")}
          </div>
          {folder && (
            <div className="text-xs text-neutral-content opacity-40 truncate mt-0.5">
              {folder}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-neutral-content opacity-50">
              {file.open_count} open{file.open_count !== 1 ? "s" : ""}
            </span>
            {file.last_opened && (
              <span className="text-xs text-neutral-content opacity-40">
                {relativeTime(file.last_opened)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ActiveFilesPanel({ onClose, onNavigate }) {
  const { activeWorkspace } = useWorkspace()
  const [files, setFiles] = useState(null)
  const [coldExpanded, setColdExpanded] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    fetch(wsUrl("/api/vault/activity?limit=50", activeWorkspace))
      .then(r => r.json())
      .then(data => setFiles(data.files || []))
      .catch(e => setError(e.message))
  }, [activeWorkspace])

  useEffect(() => { load() }, [load])

  const warmFiles = (files || []).filter(f => f.score >= 0.5)
  const coldFiles = (files || []).filter(f => f.score < 0.5)

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-sm font-semibold text-primary">Active Files</span>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="text-neutral-content opacity-60 hover:opacity-100 text-xs"
            title="Refresh"
          >
            ↺
          </button>
          <button
            onClick={onClose}
            className="text-neutral-content opacity-60 hover:opacity-100 text-lg leading-none"
            aria-label="Close active files"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {error && (
          <p className="text-xs text-error p-2">{error}</p>
        )}

        {!files && !error && (
          <div className="flex justify-center pt-8">
            <span className="loading loading-spinner loading-sm text-primary" />
          </div>
        )}

        {files && files.length === 0 && (
          <p className="text-sm text-neutral-content opacity-50 text-center pt-8">
            No files opened yet.
          </p>
        )}

        {warmFiles.length > 0 && (
          <>
            <div className="text-xs text-neutral-content opacity-40 uppercase tracking-wider pb-1">
              Active ({warmFiles.length})
            </div>
            {warmFiles.map(f => (
              <FileCard key={f.path} file={f} onNavigate={onNavigate} />
            ))}
          </>
        )}

        {coldFiles.length > 0 && (
          <>
            <button
              className="w-full text-left text-xs text-neutral-content opacity-40 uppercase tracking-wider py-2 hover:opacity-60 flex items-center gap-1"
              onClick={() => setColdExpanded(v => !v)}
            >
              <span>{coldExpanded ? "▾" : "▸"}</span>
              <span>Cold ({coldFiles.length})</span>
            </button>
            {coldExpanded && coldFiles.map(f => (
              <FileCard key={f.path} file={f} onNavigate={onNavigate} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
