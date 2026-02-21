import { useEffect, useRef, useState } from 'react'

export default function SearchPanel({ onClose, onNavigate }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setError(null)
      setSearched(false)
      return
    }

    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      setSearched(true)

      fetch(`/api/vault/search?q=${encodeURIComponent(query.trim())}`)
        .then(r => r.json())
        .then(data => {
          if (data.error) {
            setError(data.error)
            setResults([])
          } else {
            setResults(data.results || [])
          }
          setLoading(false)
        })
        .catch(() => {
          setError('Search failed — check connection')
          setResults([])
          setLoading(false)
        })
    }, 400)

    return () => clearTimeout(timer)
  }, [query])

  function highlight(text, q) {
    if (!text) return null
    const snippet = text.slice(0, 160)
    if (!q.trim()) return snippet
    const terms = q.trim().split(/\s+/).filter(t => t.length > 1)
    if (terms.length === 0) return snippet
    const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
    const parts = snippet.split(pattern)
    return parts.map((part, i) =>
      i % 2 === 1
        ? <mark key={i} className="bg-primary/25 text-primary not-italic rounded px-0.5 font-medium">{part}</mark>
        : part
    )
  }

  function folderFromFile(file) {
    const idx = file.lastIndexOf('/')
    return idx >= 0 ? file.slice(0, idx) : '(root)'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-sm font-semibold text-primary">Search</span>
        <button
          onClick={onClose}
          className="text-neutral-content opacity-60 hover:opacity-100 text-lg leading-none"
          aria-label="Close search"
        >
          ×
        </button>
      </div>

      {/* Search input */}
      <div className="px-3 py-2 border-b border-base-300 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search Fathom Vault"
          className="w-full px-3 py-1.5 text-sm bg-base-100 border border-base-300 rounded
            focus:outline-none focus:border-primary text-base-content placeholder:opacity-50"
        />
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto px-1">
        {loading && (
          <p className="text-sm text-neutral-content opacity-60 px-3 py-4">Searching…</p>
        )}

        {error && !loading && (
          <p className="text-sm text-error px-3 py-4">{error}</p>
        )}

        {!loading && !error && searched && results.length === 0 && (
          <p className="text-sm text-neutral-content opacity-60 px-3 py-4">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}

        {!loading && results.length > 0 && (
          <ul className="py-1">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => onNavigate(r.file)}
                  className="w-full text-left px-3 py-2 hover:bg-base-300 rounded transition-colors"
                >
                  <div className="text-sm font-medium text-accent truncate">
                    {r.title || r.file.split('/').pop()}
                  </div>
                  <div className="text-xs text-neutral-content opacity-50 truncate">
                    {folderFromFile(r.file)}
                    {r.score > 0 && <span className="ml-2">{r.score}%</span>}
                  </div>
                  {r.excerpt && (
                    <div className="text-xs text-neutral-content opacity-70 mt-0.5 line-clamp-2">
                      {highlight(r.excerpt, query)}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
