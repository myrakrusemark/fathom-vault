import { render } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import App from '../App'

// Suppress fetch calls in tests
global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
  })
})
