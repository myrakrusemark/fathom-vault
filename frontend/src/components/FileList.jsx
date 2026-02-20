export default function FileList({ folder, files, selectedFile, onSelect }) {
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

  const md = files.filter(f => f.type === 'markdown')
  const images = files.filter(f => f.type === 'image')

  function formatDate(iso) {
    if (!iso) return null
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fileKey(f) {
    return folder ? `${folder}/${f.name}` : f.name
  }

  return (
    <div className="py-2 overflow-y-auto h-full">
      {md.map(f => {
        const key = fileKey(f)
        const isSelected = selectedFile === key
        return (
          <div
            key={f.name}
            className={`px-3 py-2.5 mx-2 mb-1 rounded-lg cursor-pointer transition-colors
              ${isSelected
                ? 'bg-primary/20 border border-primary/30'
                : 'hover:bg-base-300 border border-transparent'
              }`}
            onClick={() => onSelect(key)}
          >
            <div className="text-sm font-medium text-base-content truncate leading-snug">
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
                    className="badge badge-sm text-xs"
                    style={{ backgroundColor: '#252545', color: '#8B5CF6', border: 'none' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {f.status && f.status !== 'draft' && (
              <div className="mt-1">
                <span className={`badge badge-xs ${
                  f.status === 'published' ? 'badge-success' : 'badge-ghost'
                }`}>
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
                className={`px-3 py-2 mx-2 mb-1 rounded-lg cursor-pointer transition-colors flex items-center gap-2
                  ${isSelected
                    ? 'bg-primary/20 border border-primary/30'
                    : 'hover:bg-base-300 border border-transparent'
                  }`}
                onClick={() => onSelect(key)}
              >
                <span className="text-accent text-sm">🖼</span>
                <span className="text-sm text-neutral-content truncate">{f.name}</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
