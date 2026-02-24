import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useRef, useState } from 'react'

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp)$/i

// Convert [[Target]] and [[Target|Display]] to markdown links with wl: scheme.
// Skips wikilinks inside backtick code spans to avoid rendering raw link syntax.
function preprocessWikilinks(text) {
  return text.replace(/`[^`]+`|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, display) => {
    if (!target) return match // backtick span — pass through unchanged
    return `[${display || target}](#wl:${encodeURIComponent(target.trim())})`
  })
}

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
        <span className="badge badge-sm bg-base-300 text-accent border-none">
          {fm.project}
        </span>
      )}
      {fm.tags && fm.tags.map(tag => (
        <span key={tag} className="badge badge-sm bg-base-300 text-secondary border-none">
          {tag}
        </span>
      ))}
    </div>
  )
}

function ImageRenderer({ src, alt }) {
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

function WikiLink({ href, children, onWikilinkClick }) {
  if (href && href.startsWith('#wl:')) {
    const target = decodeURIComponent(href.slice(4))
    return (
      <span
        className="cursor-pointer underline underline-offset-2 decoration-dotted text-accent"
        onClick={() => onWikilinkClick(target)}
      >
        {children}
      </span>
    )
  }
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}

function BacklinksPanel({ filePath, onNavigate }) {
  const [links, setLinks] = useState(null)

  useEffect(() => {
    if (!filePath) return
    setLinks(null)
    fetch(`/api/vault/links/${filePath}`)
      .then(r => r.json())
      .then(setLinks)
      .catch(() => setLinks({ backlinks: [] }))
  }, [filePath])

  if (!links) return null
  const { backlinks = [], forward_links = [] } = links
  if (backlinks.length === 0 && forward_links.length === 0) return null

  return (
    <div className="mt-10 pt-6 border-t border-base-300 text-sm">
      {backlinks.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-neutral-content opacity-40 uppercase tracking-wider mb-2">
            Linked from ({backlinks.length})
          </div>
          <div className="flex flex-col gap-1">
            {backlinks.map(path => (
              <span
                key={path}
                className="text-accent opacity-70 text-xs font-mono cursor-pointer hover:opacity-100 hover:underline"
                onClick={() => onNavigate(path)}
              >
                {path}
              </span>
            ))}
          </div>
        </div>
      )}
      {forward_links.length > 0 && (
        <div>
          <div className="text-xs text-neutral-content opacity-40 uppercase tracking-wider mb-2">
            Links to ({forward_links.length})
          </div>
          <div className="flex flex-col gap-1">
            {forward_links.map(path => (
              <span
                key={path}
                className="text-accent opacity-70 text-xs font-mono cursor-pointer hover:opacity-100 hover:underline"
                onClick={() => onNavigate(path)}
              >
                {path}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EditorPanel({ filePath, initialContent, onSaved, onCancel }) {
  const [content, setContent] = useState(initialContent || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/vault/file/${filePath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await r.json()
      if (!r.ok || data.error) {
        setError(data.error || `HTTP ${r.status}`)
      } else {
        onSaved()
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e) {
    // Ctrl+S / Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      onCancel()
    }
    // Tab inserts 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = e.target.selectionStart
      const end = e.target.selectionEnd
      const next = content.slice(0, start) + '  ' + content.slice(end)
      setContent(next)
      requestAnimationFrame(() => {
        textareaRef.current.selectionStart = start + 2
        textareaRef.current.selectionEnd = start + 2
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Editor toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 bg-base-200 shrink-0">
        <span className="text-xs text-neutral-content opacity-50 flex-1">
          Ctrl+S to save · Esc to cancel
        </span>
        {error && (
          <span className="text-xs text-error">{error}</span>
        )}
        <button
          className="btn btn-ghost btn-xs"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary btn-xs"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
        </button>
      </div>

      {/* Editor textarea */}
      <textarea
        ref={textareaRef}
        className="flex-1 bg-base-100 text-base-content resize-none outline-none p-6 font-mono text-sm leading-relaxed"
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
    </div>
  )
}

export default function FileViewer({ filePath, data, loading, error, onWikilinkClick, onNavigate, onSaved }) {
  const [editing, setEditing] = useState(false)

  // Exit edit mode when file changes
  useEffect(() => {
    setEditing(false)
  }, [filePath])

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

  if (editing) {
    return (
      <EditorPanel
        filePath={filePath}
        initialContent={data.content || ''}
        onSaved={() => {
          setEditing(false)
          onSaved()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const { frontmatter, body, path } = data
  const filename = path ? path.split('/').pop() : filePath.split('/').pop()
  const title = frontmatter?.title || filename

  return (
    <div className="p-6 max-w-3xl">
      {/* Title + edit button */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h1 className="text-xl font-semibold text-base-content">{title}</h1>
        <button
          className="btn btn-ghost btn-xs opacity-40 hover:opacity-100 shrink-0 mt-0.5"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>

      <FrontmatterBadges fm={frontmatter} />

      <div className="prose-vault">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ node, ...props }) => <ImageRenderer {...props} />,
            a: ({ node, href, children, ...props }) => (
              <WikiLink href={href} onWikilinkClick={onWikilinkClick} {...props}>
                {children}
              </WikiLink>
            ),
          }}
        >
          {preprocessWikilinks(body || data.content || '')}
        </Markdown>
      </div>

      <BacklinksPanel filePath={filePath} onNavigate={onNavigate} />
    </div>
  )
}
