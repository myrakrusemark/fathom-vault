export default function ViewTabs({ currentView, setCurrentView, disabledViews = [], onDisabledClick, activeWorkspace }) {
  const mementoUrl = activeWorkspace
    ? `https://hifathom.com/dashboard/?workspace=${encodeURIComponent(activeWorkspace)}`
    : 'https://hifathom.com/dashboard/'

  const views = [
    { id: 'memento', label: 'Memento', color: '#06B6D4', external: mementoUrl },
    { id: 'vault', label: 'Vault', color: '#8B5CF6' },
    { id: 'activation', label: 'Activation', color: '#F4A261' },
    { id: 'communication', label: 'Comms', color: '#4ADE80' },
  ]

  return (
    <div className="flex items-center gap-0.5 bg-base-300/40 rounded-lg px-1 py-0.5">
      {views.map(v => {
        const isActive = v.id === currentView
        const isDisabled = disabledViews.includes(v.id)

        if (isDisabled) {
          return (
            <button
              key={v.id}
              className="px-2.5 py-1 rounded-md text-xs font-medium cursor-default transition-colors hover:bg-base-100/10"
              style={{ color: `${v.color}25` }}
              onClick={() => onDisabledClick?.(v.id)}
            >
              {v.label}
            </button>
          )
        }

        if (v.external) {
          return (
            <a
              key={v.id}
              href={v.external}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors hover:bg-base-100/30 underline decoration-1 underline-offset-2"
              style={{ color: `${v.color}66`, textDecorationColor: `${v.color}33` }}
              onMouseEnter={e => { e.currentTarget.style.color = `${v.color}cc`; e.currentTarget.style.textDecorationColor = `${v.color}66` }}
              onMouseLeave={e => { e.currentTarget.style.color = `${v.color}66`; e.currentTarget.style.textDecorationColor = `${v.color}33` }}
            >
              {v.label}
              <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="opacity-50 shrink-0">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )
        }

        return (
          <button
            key={v.id}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isActive
                ? 'bg-base-100 shadow-sm'
                : 'hover:bg-base-100/30'
            }`}
            style={{ color: isActive ? v.color : `${v.color}60` }}
            onClick={() => setCurrentView(v.id)}
          >
            {v.label}
          </button>
        )
      })}
    </div>
  )
}
