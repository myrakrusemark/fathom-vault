import Markdown from 'react-markdown'

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp)$/i

function FrontmatterBadges({ fm }) {
  if (!fm || Object.keys(fm).length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-base-300 text-sm">
      {fm.date && (
        <span className="text-neutral-content opacity-60">{fm.date}</span>
      )}
      {fm.status && (
        <span className={`badge badge-sm ${
          fm.status === 'published' ? 'badge-success' :
          fm.status === 'archived' ? 'badge-ghost' : 'badge-warning'
        }`}>
          {fm.status}
        </span>
      )}
      {fm.project && (
        <span className="badge badge-sm" style={{ backgroundColor: '#252545', color: '#06B6D4', border: 'none' }}>
          {fm.project}
        </span>
      )}
      {fm.tags && fm.tags.map(tag => (
        <span key={tag} className="badge badge-sm" style={{ backgroundColor: '#252545', color: '#8B5CF6', border: 'none' }}>
          {tag}
        </span>
      ))}
    </div>
  )
}

function ImageRenderer({ src, alt }) {
  // Rewrite relative image paths through /api/vault/raw/
  const resolvedSrc = src && !src.startsWith('http') && !src.startsWith('/')
    ? `/api/vault/raw/${src}`
    : src
  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      className="max-w-full rounded-lg my-4"
      style={{ maxHeight: '600px', objectFit: 'contain' }}
    />
  )
}

export default function FileViewer({ filePath, data, loading, error }) {
  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-content opacity-30 text-sm">
        Select a file to view
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-error text-sm">
        Error: {error}
      </div>
    )
  }

  if (!data) return null

  const isImage = IMAGE_EXTS.test(filePath)

  if (isImage) {
    return (
      <div className="p-6 flex flex-col items-center">
        <div className="text-sm text-neutral-content opacity-50 mb-4">
          {filePath.split('/').pop()}
        </div>
        <img
          src={`/api/vault/raw/${filePath}`}
          alt={filePath.split('/').pop()}
          className="max-w-full rounded-xl"
          style={{ maxHeight: '80vh', objectFit: 'contain' }}
        />
      </div>
    )
  }

  const { frontmatter, body, path } = data
  const filename = path ? path.split('/').pop() : filePath.split('/').pop()
  const title = frontmatter?.title || filename

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-base-content mb-3">{title}</h1>
      <FrontmatterBadges fm={frontmatter} />
      <div className="prose-vault">
        <Markdown
          components={{
            img: ({ node, ...props }) => <ImageRenderer {...props} />,
          }}
        >
          {body || data.content || ''}
        </Markdown>
      </div>
    </div>
  )
}
