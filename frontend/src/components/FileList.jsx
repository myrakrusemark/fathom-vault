// Returns a heat dot element based on activity score
function heatDot(score) {
  if (score === undefined || score === null || score === 0) return null
  if (score > 1.5) return <span className="mr-1 text-[8px] text-primary" title={"Score: " + score.toFixed(2)}>&#9679;</span>
  if (score >= 0.5) return <span className="mr-1 text-[8px] text-secondary" title={"Score: " + score.toFixed(2)}>&#9679;</span>
  return null
}

export default function FileList({ folder, files, selectedFile, onSelect, sortBy, onSortChange, showHeatDots }) {
  if (!files) {
    return (
      <div className="p-4 text-sm text-neutral-content opacity-50">
        Select a folder
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="p-4 text-sm text-neutral-content opacity-50">
        No files
      </div>
    )
  }

  const md = files.filter(f => f.type === "markdown")
  const images = files.filter(f => f.type === "image")

  // Sort markdown files
  const currentSort = sortBy || "modified"
  const sortedMd = [...md].sort((a, b) => {
    if (currentSort === "activity") {
      return (b.activity_score || 0) - (a.activity_score || 0)
    }
    if (currentSort === "name") {
      return (a.title || a.name).localeCompare(b.title || b.name)
    }
    return (b.modified || "").localeCompare(a.modified || "")
  })

  function fileKey(f) {
    return folder ? folder + "/" + f.name : f.name
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {onSortChange && (
        <div className="flex items-center gap-1 px-3 py-2 shrink-0 border-b border-base-300">
          <span className="text-xs text-neutral-content opacity-40 mr-1">Sort:</span>
          {[["modified", "Recent"], ["name", "Name"], ["activity", "Activity"]].map(([val, label]) => (
            <button
              key={val}
              className={[
                "text-xs px-2 py-0.5 rounded transition-colors",
                currentSort === val ? "bg-primary/20 text-primary" : "text-neutral-content opacity-50 hover:opacity-80"
              ].join(" ")}
              onClick={() => onSortChange(val)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-2">
      {sortedMd.map(f => {
        const key = fileKey(f)
        const isSelected = selectedFile === key
        return (
          <div
            key={f.name}
            className={[
              "px-3 py-2.5 mx-2 mb-1 rounded-lg cursor-pointer transition-colors border",
              isSelected ? "bg-primary/20 border-primary/30" : "hover:bg-base-300 border-transparent"
            ].join(" ")}
            onClick={() => onSelect(key)}
          >
            <div className="text-sm font-medium text-base-content truncate leading-snug flex items-center">
              {showHeatDots !== false && heatDot(f.activity_score)}
              {f.title || f.name}
            </div>

            {f.date && (
              <div className="text-xs text-neutral-content opacity-60 mt-0.5">
                {f.date}
              </div>
            )}

            {f.preview && (
              <div className="text-xs text-neutral-content opacity-50 mt-1 line-clamp-2 leading-relaxed">
                {f.preview}
              </div>
            )}

            {f.tags && f.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {f.tags.slice(0, 4).map(tag => (
                  <span
                    key={tag}
                    className="badge badge-sm text-xs bg-base-300 text-secondary border-none"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {f.status && f.status !== "draft" && (
              <div className="mt-1">
                <span className={["badge badge-xs", f.status === "published" ? "badge-success" : "badge-ghost"].join(" ")}>
                  {f.status}
                </span>
              </div>
            )}
          </div>
        )
      })}

      {images.length > 0 && (
        <>
          <div className="px-4 pt-3 pb-1 text-xs text-neutral-content opacity-40 uppercase tracking-wider">
            Images ({images.length})
          </div>
          {images.map(f => {
            const key = fileKey(f)
            const isSelected = selectedFile === key
            return (
              <div
                key={f.name}
                className={[
                  "px-3 py-2 mx-2 mb-1 rounded-lg cursor-pointer transition-colors flex items-center gap-2 border",
                  isSelected ? "bg-primary/20 border-primary/30" : "hover:bg-base-300 border-transparent"
                ].join(" ")}
                onClick={() => onSelect(key)}
              >
                <span className="text-accent text-sm">&#128444;</span>
                <span className="text-sm text-neutral-content truncate">{f.name}</span>
              </div>
            )
          })}
        </>
      )}
      </div>
    </div>
  )
}
