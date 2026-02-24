/**
 * Smoke tests for all vault UI components.
 * Each test verifies the component renders without crashing given minimal props.
 * Fetch is globally mocked so no real HTTP calls are made.
 */
import { act, render, screen } from '@testing-library/react'
import { describe, it, vi, beforeEach } from 'vitest'

import FolderTree from '../components/FolderTree.jsx'
import FileList from '../components/FileList.jsx'
import FileViewer from '../components/FileViewer.jsx'
import SearchPanel from '../components/SearchPanel.jsx'
import ActiveFilesPanel from '../components/ActiveFilesPanel.jsx'
import SettingsPanel from '../components/SettingsPanel.jsx'
import ActivationView from '../components/ActivationView.jsx'
import ActivationPanel from '../components/ActivationPanel.jsx'

// ---------------------------------------------------------------------------
// Global fetch mock — intercepts all API calls made by components
// ---------------------------------------------------------------------------

const SETTINGS_RESPONSE = {
  background_index: { enabled: true, interval_minutes: 15, excluded_dirs: [] },
  mcp: { query_timeout_seconds: 120, search_results: 10, search_mode: 'hybrid' },
  activity: {
    decay_halflife_days: 7,
    recency_window_hours: 48,
    max_access_boost: 2.0,
    activity_sort_default: false,
    show_heat_indicator: true,
    excluded_from_scoring: ['daily'],
  },
  terminal: { working_dir: '/data/Dropbox/Work' },
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url?.includes('/api/settings')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SETTINGS_RESPONSE) })
    }
    if (url?.includes('/api/vault/activity')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ files: [] }) })
    }
    if (url?.includes('/api/vault/links')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ forward: [], backlinks: [] }),
      })
    }
    if (url?.includes('/api/vault/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [], excluded: 0 }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

// ---------------------------------------------------------------------------
// FolderTree
// ---------------------------------------------------------------------------

describe('FolderTree', () => {
  it('renders without crashing with empty folders', async () => {
    await act(async () => {
      render(<FolderTree folders={[]} selectedFolder={null} onFolderSelect={vi.fn()} />)
    })
  })

  it('renders with folders', async () => {
    const folders = [
      { name: 'thinking', path: 'thinking', file_count: 3, image_count: 0, children: [] },
    ]
    await act(async () => {
      render(<FolderTree folders={folders} selectedFolder={null} onFolderSelect={vi.fn()} />)
    })
    expect(screen.getByText('thinking')).toBeDefined()
  })

  it('highlights selected folder', async () => {
    const folders = [
      { name: 'thinking', path: 'thinking', file_count: 1, image_count: 0, children: [] },
    ]
    await act(async () => {
      render(
        <FolderTree folders={folders} selectedFolder="thinking" onFolderSelect={vi.fn()} />,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// FileList
// ---------------------------------------------------------------------------

describe('FileList', () => {
  it('renders without crashing with no files', async () => {
    await act(async () => {
      render(
        <FileList
          files={null}
          selectedFile={null}
          onFileSelect={vi.fn()}
          sortBy="modified"
          showHeatDots={true}
        />,
      )
    })
  })

  it('renders a list of files', async () => {
    const files = [
      {
        name: 'note.md',
        type: 'markdown',
        title: 'My Note',
        date: '2026-01-01',
        size: 500,
        modified: '2026-01-01T00:00:00',
        tags: [],
        preview: 'Some preview text',
        activity_score: 0,
        open_count: 0,
        last_opened: null,
      },
    ]
    await act(async () => {
      render(
        <FileList
          files={files}
          selectedFile={null}
          onFileSelect={vi.fn()}
          sortBy="modified"
          showHeatDots={false}
        />,
      )
    })
    expect(screen.getByText('My Note')).toBeDefined()
  })

  it('renders with activity sort', async () => {
    const files = [
      {
        name: 'note.md',
        type: 'markdown',
        title: 'Test',
        date: '2026-01-01',
        size: 100,
        modified: '2026-01-01T00:00:00',
        tags: [],
        preview: '',
        activity_score: 1.5,
        open_count: 5,
        last_opened: null,
      },
    ]
    await act(async () => {
      render(
        <FileList
          files={files}
          selectedFile="note.md"
          onFileSelect={vi.fn()}
          sortBy="activity"
          showHeatDots={true}
        />,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// FileViewer
// ---------------------------------------------------------------------------

describe('FileViewer', () => {
  it('renders without crashing with no file selected', async () => {
    await act(async () => {
      render(
        <FileViewer
          selectedFile={null}
          fileData={null}
          loading={false}
          error={null}
          onWikilinkClick={vi.fn()}
          onSaved={vi.fn()}
          refreshKey={0}
        />,
      )
    })
  })

  it('renders loading state', async () => {
    await act(async () => {
      render(
        <FileViewer
          selectedFile="thinking/note.md"
          fileData={null}
          loading={true}
          error={null}
          onWikilinkClick={vi.fn()}
          onSaved={vi.fn()}
          refreshKey={0}
        />,
      )
    })
  })

  it('renders error state', async () => {
    await act(async () => {
      render(
        <FileViewer
          selectedFile="thinking/note.md"
          fileData={null}
          loading={false}
          error="File not found"
          onWikilinkClick={vi.fn()}
          onSaved={vi.fn()}
          refreshKey={0}
        />,
      )
    })
  })

  it('renders file content with frontmatter', async () => {
    const fileData = {
      frontmatter: { title: 'My Note', date: '2026-01-01', status: 'draft' },
      body: 'Body content here.',
      raw: '---\ntitle: My Note\ndate: 2026-01-01\n---\nBody content here.',
    }
    await act(async () => {
      render(
        <FileViewer
          selectedFile="thinking/note.md"
          fileData={fileData}
          loading={false}
          error={null}
          onWikilinkClick={vi.fn()}
          onSaved={vi.fn()}
          refreshKey={0}
        />,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// SearchPanel
// ---------------------------------------------------------------------------

describe('SearchPanel', () => {
  it('renders without crashing', async () => {
    await act(async () => {
      render(<SearchPanel onClose={vi.fn()} onNavigate={vi.fn()} />)
    })
  })

  it('shows a search input', async () => {
    await act(async () => {
      render(<SearchPanel onClose={vi.fn()} onNavigate={vi.fn()} />)
    })
    // Should have some kind of text input for search
    const inputs = document.querySelectorAll('input')
    expect(inputs.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// ActiveFilesPanel
// ---------------------------------------------------------------------------

describe('ActiveFilesPanel', () => {
  it('renders without crashing', async () => {
    await act(async () => {
      render(
        <ActiveFilesPanel
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          onFolderSelect={vi.fn()}
        />,
      )
    })
  })

  it('renders with activity data', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            files: [
              {
                path: 'thinking/note.md',
                title: 'Hot Note',
                score: 2.5,
                open_count: 10,
                last_opened: Math.floor(Date.now() / 1000) - 3600,
              },
            ],
          }),
      }),
    )
    await act(async () => {
      render(
        <ActiveFilesPanel
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          onFolderSelect={vi.fn()}
        />,
      )
    })
  })
})

// ---------------------------------------------------------------------------
// SettingsPanel
// ---------------------------------------------------------------------------

describe('SettingsPanel', () => {
  it('renders without crashing', async () => {
    await act(async () => {
      render(<SettingsPanel onClose={vi.fn()} />)
    })
  })

  it('renders after settings load', async () => {
    await act(async () => {
      render(<SettingsPanel onClose={vi.fn()} />)
    })
    // Settings panel fetches on mount — after act it should have rendered
  })
})

// ---------------------------------------------------------------------------
// ActivationView
// ---------------------------------------------------------------------------

describe('ActivationView', () => {
  it('renders without crashing', async () => {
    await act(async () => {
      render(<ActivationView />)
    })
  })

  it('shows spawn button in settings column', async () => {
    await act(async () => {
      render(<ActivationView />)
    })
    const btn = document.querySelector('button')
    expect(btn).not.toBeNull()
  })

  it('renders stat grid', async () => {
    await act(async () => {
      render(<ActivationView />)
    })
    expect(document.body.textContent).toContain('Crystal age')
    expect(document.body.textContent).toContain('Memento')
  })
})

// ---------------------------------------------------------------------------
// ActivationPanel
// ---------------------------------------------------------------------------

describe('ActivationPanel', () => {
  it('renders without crashing', async () => {
    await act(async () => {
      render(<ActivationPanel onClose={vi.fn()} />)
    })
  })

  it('shows the spawn button', async () => {
    await act(async () => {
      render(<ActivationPanel onClose={vi.fn()} />)
    })
    expect(document.body.textContent).toContain('Spawn crystallization agent')
  })

  it('renders identity crystal section', async () => {
    await act(async () => {
      render(<ActivationPanel onClose={vi.fn()} />)
    })
    expect(document.body.textContent).toContain('Identity Crystal')
  })
})
