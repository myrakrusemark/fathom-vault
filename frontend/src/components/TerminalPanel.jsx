import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function TerminalPanel({ onClose, filePath }) {
  const containerRef = useRef(null)
  const wsRef = useRef(null)
  const [lastSelection, setLastSelection] = useState('')
  const [copied, setCopied] = useState(false)
  const [connectionKey, setConnectionKey] = useState(0)
  const [restarting, setRestarting] = useState(false)

  // Track text selections — only store non-empty so clicking buttons doesn't wipe it
  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection()?.toString() ?? ''
      if (sel) setLastSelection(sel)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  useEffect(() => {
    // Persist session ID across tab closes and browser restarts
    let sessionId = localStorage.getItem('terminalSessionId')
    if (!sessionId) {
      sessionId = crypto.randomUUID()
      localStorage.setItem('terminalSessionId', sessionId)
    }

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal?session=${sessionId}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data))
      } else {
        term.write(e.data)
      }
    }
    ws.onclose = () => term.write('\r\n[session ended]\r\n')

    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      ws.close()
      term.dispose()
      wsRef.current = null
    }
  }, [connectionKey])

  function sendToSession(text) {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(text)
  }

  function handleInsertContext() {
    const parts = []
    if (filePath) parts.push(`Fathom Vault: ${filePath}`)
    if (lastSelection) {
      const quoted = lastSelection
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')
      parts.push(quoted)
    }
    if (parts.length) sendToSession(parts.join('\n') + '\n')
  }

  function handleCopy() {
    if (!lastSelection) return
    navigator.clipboard.writeText(lastSelection).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  async function handleRestart() {
    setRestarting(true)
    try {
      const res = await fetch('/api/activation/session/restart', { method: 'POST' })
      if (!res.ok) throw new Error('restart failed')
      // Wait for new session to initialize
      await new Promise(r => setTimeout(r, 3000))
      setConnectionKey(k => k + 1)
    } catch (e) {
      console.error('Restart failed:', e)
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0 bg-base-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary">Claude Agent</span>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="btn btn-xs btn-ghost text-neutral-content opacity-60 hover:opacity-100"
            title="Kill and restart session with --continue"
          >
            {restarting ? 'Restarting...' : 'Restart'}
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-neutral-content opacity-60 hover:opacity-100 text-lg leading-none"
          aria-label="Close terminal"
        >
          ×
        </button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 overflow-hidden p-1" />

      {/* Action toolbar */}
      <div className="shrink-0 border-t border-base-300 bg-base-200 px-2 py-1.5 flex items-center gap-2">
        <button
          className="btn btn-xs btn-outline"
          onClick={handleInsertContext}
          disabled={!filePath && !lastSelection}
          title={
            filePath && lastSelection ? `Insert path + selection`
            : filePath ? `Insert: ${filePath}`
            : lastSelection ? 'Insert selection'
            : 'No file open or text selected'
          }
        >
          Insert context
        </button>
        <button
          className="btn btn-xs btn-outline"
          onClick={handleCopy}
          disabled={!lastSelection}
          title="Copy selection to clipboard"
        >
          {copied ? 'Copied!' : 'Copy context'}
        </button>
      </div>
    </div>
  )
}
