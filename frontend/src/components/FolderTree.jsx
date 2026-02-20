import { useState } from 'react'

function FolderNode({ node, selectedFolder, onSelect, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedFolder === node.path

  function toggle(e) {
    e.stopPropagation()
    setExpanded(v => !v)
  }

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer select-none
          text-sm transition-colors
          ${isSelected
            ? 'bg-primary/20 text-primary font-medium'
            : 'text-neutral-content hover:bg-base-300'
          }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelect(node.path)}
      >
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-xs opacity-60 hover:opacity-100"
            onClick={toggle}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="truncate flex-1">{node.name}</span>
        <span className="text-xs opacity-40 shrink-0">
          {node.file_count > 0 && <span>{node.file_count}</span>}
          {node.image_count > 0 && <span className="ml-1 text-accent">+{node.image_count}</span>}
        </span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <FolderNode
              key={child.path}
              node={child}
              selectedFolder={selectedFolder}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderTree({ folders, selectedFolder, onSelect }) {
  if (!folders || folders.length === 0) {
    return (
      <div className="p-4 text-sm text-neutral-content opacity-50">
        No folders found
      </div>
    )
  }

  return (
    <div className="py-2">
      {folders.map(node => (
        <FolderNode
          key={node.path}
          node={node}
          selectedFolder={selectedFolder}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
