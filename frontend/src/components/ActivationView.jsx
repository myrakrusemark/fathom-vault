// ActivationView — MVAC "A" layer, full-page view

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspace, wsUrl } from '../WorkspaceContext.jsx'

// ── Shared utilities ─────────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return null
  // Memento timestamps are UTC without 'Z' — force UTC parsing to avoid local-time skew
  const utc = iso.includes('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z'
  const diff = Math.floor((Date.now() - new Date(utc).getTime()) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatCountdown(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function formatInterval(minutes) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`
  return `${minutes}m`
}

function useCountdown(isoTimestamp, enabled) {
  const [countdown, setCountdown] = useState(0)
  useEffect(() => {
    if (!isoTimestamp || !enabled) { setCountdown(0); return }
    const target = new Date(isoTimestamp).getTime()
    const tick = () => setCountdown(Math.max(0, Math.floor((target - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isoTimestamp, enabled])
  return countdown
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function Helper({ children }) {
  return (
    <p className="text-xs text-neutral-content opacity-50 leading-relaxed mt-1.5">
      {children}
    </p>
  )
}

function SubSection({ label }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-2">
      <span className="text-[10px] font-semibold text-neutral-content opacity-30 uppercase tracking-widest whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 border-t border-base-300 opacity-40" />
    </div>
  )
}

function StatusDot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? 'bg-success' : 'bg-base-300'}`} />
      <span className={ok ? 'text-base-content opacity-70' : 'text-neutral-content opacity-40'}>
        {label}
      </span>
    </span>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      className="btn btn-xs btn-ghost opacity-50 hover:opacity-100 shrink-0"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

function Accordion({ label, description, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-base-300">
      <button
        className="flex items-center justify-between w-full py-2.5 gap-2 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider">
          {label}
        </span>
        <span className={`text-neutral-content opacity-30 shrink-0 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {description && (
        <p className="text-xs text-neutral-content opacity-50 leading-relaxed mb-2">
          {description}
        </p>
      )}
      {open && <div className="pb-4">{children}</div>}
    </div>
  )
}

// ── Left column: settings ────────────────────────────────────────────────────
function SettingsColumn({ status, onSpawn, job, schedule, onScheduleChange }) {
  const [additionalContext, setAdditionalContext] = useState(
    () => localStorage.getItem('fv-additional-context') || ''
  )
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (job?.status !== 'running') { setElapsed(0); return }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [job?.status])

  const mementoConnected = status?.connected ?? false
  const mementoLabel = !status?.configured ? 'Not configured' : status?.connected ? 'Connected' : 'Error'
  const crystal = {
    lastGenerated: status?.crystal?.created_at ?? null,
    preview: status?.crystal?.preview ?? null,
    exists: status?.crystal?.exists ?? false,
  }
  const crystalDesc = (() => {
    if (!crystal.exists) return 'No crystal yet'
    const age = relativeTime(crystal.lastGenerated)
    const words = crystal.preview ? crystal.preview.trim().split(/\s+/).length : null
    return words ? `${age} · ~${words.toLocaleString()} words` : age
  })()
  const isRunning = job?.status === 'running'
  const isDone = job?.status === 'done'
  const isFailed = job?.status === 'failed'

  const handleContextChange = (e) => {
    setAdditionalContext(e.target.value)
    if (e.target.value.trim()) {
      localStorage.setItem('fv-additional-context', e.target.value)
    } else {
      localStorage.removeItem('fv-additional-context')
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-5 border-r border-base-300 bg-base-200">

      {/* ── Identity Crystal ── */}
      <h2 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-1">
        Identity Crystal
      </h2>
      <p className="text-xs text-neutral-content opacity-50 leading-relaxed mb-2">
        First-person self-synthesis — what you care about, what persists across sessions
      </p>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-base-content opacity-80">Memento</span>
        <StatusDot ok={mementoConnected} label={mementoLabel} />
      </div>

      {!mementoConnected && (
        <div className="bg-base-100 border border-base-300 rounded-lg p-3 mb-3">
          <p className="text-xs text-base-content opacity-70 mb-3">
            The identity crystal is stored in and read from Memento. Memento also provides
            working memory, skip lists, and memory consolidation — the full M in MVAC.{' '}
            <a
              href="https://hifathom.com/projects/memento/"
              target="_blank"
              rel="noreferrer"
              className="text-primary opacity-80 hover:opacity-100 underline"
            >
              Learn more
            </a>
          </p>
          <p className="text-xs text-neutral-content opacity-50 mb-1.5">Get started:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-base-200 rounded px-2 py-1.5 text-base-content opacity-80 select-all cursor-text">
              npx memento-mcp init
            </code>
            <CopyButton text="npx memento-mcp init" />
          </div>
        </div>
      )}

      {mementoConnected && (
        <>
          <Accordion
            label="Crystal"
            description={crystalDesc}
            defaultOpen={false}
          >
            <div className="bg-base-100 rounded-lg p-3 mt-1 mb-1 border border-base-300">
              {crystal.lastGenerated ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-neutral-content opacity-50">Last generated</span>
                    <span className="text-xs text-base-content opacity-70">
                      {relativeTime(crystal.lastGenerated)}
                    </span>
                  </div>
                  {crystal.preview && (
                    <pre className="text-xs text-neutral-content opacity-70 leading-relaxed whitespace-pre-wrap font-sans max-h-96 overflow-y-auto">
                      {crystal.preview}
                    </pre>
                  )}
                </>
              ) : (
                <p className="text-xs text-neutral-content opacity-40 italic">
                  No crystal generated yet.
                </p>
              )}
            </div>
            <Helper>Written by a dedicated agent from raw vault materials — not a self-report.</Helper>
          </Accordion>

          <Accordion
            label="Additional context"
            description={additionalContext.trim() ? `${additionalContext.trim().split(/\s+/).length} words saved` : 'None saved'}
            defaultOpen={!!additionalContext}
          >
            <textarea
              className="textarea textarea-bordered w-full text-xs bg-base-100 resize-none"
              rows={4}
              placeholder={'e.g. "Focus on the recent shift toward infrastructure work."'}
              value={additionalContext}
              onChange={handleContextChange}
            />
            <Helper>Merged into the base prompt every run. Saved locally. Clear to disable.</Helper>
          </Accordion>

          {/* ── Run ── */}
          <SubSection label="Run" />

          <button
            className="btn btn-sm btn-outline w-full"
            disabled={isRunning}
            onClick={() => onSpawn({ additionalContext })}
          >
            {isRunning ? 'Running…' : 'Regenerate Now'}
          </button>
          <Helper>Reads vault reflections + heartbeats, synthesizes, writes to Memento. ~3–5 min.</Helper>

          {isRunning && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-neutral-content opacity-50">{job.stage}</span>
                <span className="text-xs text-neutral-content opacity-30">
                  {formatElapsed(elapsed)} · {job.progress}%
                </span>
              </div>
              <div className="w-full bg-base-300 rounded-full h-1">
                <div
                  className="bg-primary h-1 rounded-full transition-all duration-500"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {isDone && (
            <p className="text-xs text-success mt-2">Crystal generated successfully.</p>
          )}
          {isFailed && (
            <p className="text-xs text-error mt-2">Failed — check the terminal for errors.</p>
          )}

          <label className="flex items-center justify-between gap-3 cursor-pointer mt-4">
            <span className="text-sm text-base-content">Auto-regenerate</span>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={schedule.enabled}
              onChange={e => onScheduleChange({ enabled: e.target.checked })}
            />
          </label>

          {schedule.enabled && (
            <label className="flex items-center justify-between gap-3 mt-2">
              <span className="text-sm text-base-content opacity-70">Every</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input input-bordered input-sm w-16 text-sm bg-base-100 text-right"
                  min={1}
                  max={30}
                  value={schedule.intervalDays}
                  onChange={e => onScheduleChange({ intervalDays: Math.max(1, parseInt(e.target.value) || 1) })}
                />
                <span className="text-sm text-base-content opacity-50">days</span>
              </div>
            </label>
          )}
          <Helper>When on, spawns automatically on the configured interval. Base prompt only.</Helper>
        </>
      )}

    </div>
  )
}

// ── Prompt preview builder (client-side approximation) ───────────────────────
function buildPromptPreview(ping) {
  const src = ping.context_sources ?? {}
  const parts = []

  // Header line: time only
  const headerParts = []
  if (src.time) {
    const now = new Date()
    headerParts.push(
      `Time: ${now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    )
  }
  if (headerParts.length > 0) parts.push(`[Ping — ${headerParts.join(' · ')}]`)

  // Script sections: each gets its own block
  ;(src.scripts ?? []).filter(s => s.enabled && s.label).forEach(s => {
    const placeholder = s.command
      ? `[Output for \`${s.command}\` will display here.]`
      : '[Output will display here.]'
    parts.push(`[${s.label}]\n${placeholder}`)
  })

  // Text blocks
  ;(src.texts ?? []).filter(t => t.enabled && t.content?.trim()).forEach(t => {
    parts.push(t.content.trim())
  })

  return parts.join('\n\n')
}

// ── Script/Text row subcomponents (local draft state, persist on blur) ────────
function ScriptRow({ script, index, onUpdate, onRemove }) {
  const [label, setLabel] = useState(script.label)
  const [command, setCommand] = useState(script.command)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLabel(script.label), [script.label])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setCommand(script.command), [script.command])
  const save = () => onUpdate(index, { label, command })
  return (
    <div className="flex items-center gap-2 mt-1">
      <input type="text" className="input input-bordered input-xs w-24 bg-base-100 text-xs"
        placeholder="Label" value={label}
        onChange={e => setLabel(e.target.value)} onBlur={save} />
      <input type="text" className="input input-bordered input-xs flex-1 bg-base-100 text-xs font-mono"
        placeholder="command" value={command}
        onChange={e => setCommand(e.target.value)} onBlur={save} />
      <button className="btn btn-xs btn-ghost opacity-40 hover:opacity-100 shrink-0"
        onClick={() => onRemove(index)} title="Remove">×</button>
      <input type="checkbox" className="toggle toggle-primary toggle-xs shrink-0"
        checked={script.enabled}
        onChange={e => onUpdate(index, { enabled: e.target.checked })} />
    </div>
  )
}

function TextRow({ text, index, onUpdate, onRemove }) {
  const [label, setLabel] = useState(text.label)
  const [content, setContent] = useState(text.content)
  const labelRef = useRef(null)
  const contentRef = useRef(null)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLabel(text.label), [text.label])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setContent(text.content), [text.content])
  // Read from DOM on blur — captures values set by CDP fill / evaluate_script
  // that bypass React's synthetic event system
  const save = () => {
    const l = labelRef.current?.value ?? label
    const c = contentRef.current?.value ?? content
    onUpdate(index, { label: l, content: c })
  }
  return (
    <div className="rounded-lg border border-base-300 bg-base-200 p-2 mt-1 space-y-1.5">
      <div className="flex items-center gap-2">
        <input ref={labelRef} type="text" className="input input-bordered input-xs flex-1 bg-base-100 text-xs"
          placeholder="Label" value={label}
          onChange={e => setLabel(e.target.value)} onBlur={save} />
        <button className="btn btn-xs btn-ghost opacity-40 hover:opacity-100 shrink-0"
          onClick={() => onRemove(index)} title="Remove">×</button>
        <input type="checkbox" className="toggle toggle-primary toggle-xs shrink-0"
          checked={text.enabled}
          onChange={e => onUpdate(index, { enabled: e.target.checked })} />
      </div>
      <textarea ref={contentRef} className="textarea textarea-bordered w-full text-xs bg-base-100 resize-y font-mono leading-relaxed"
        rows={5} placeholder="Text to inject into the prompt…"
        value={content}
        onChange={e => setContent(e.target.value)} onBlur={save} />
    </div>
  )
}

// ── Routine selector accordion ───────────────────────────────────────────────
function RoutineRow({ routine, isSelected, onClick }) {
  const cd = useCountdown(routine.next_ping_at, routine.enabled)
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-left transition-colors ${
        isSelected ? 'bg-base-200/60' : 'hover:bg-base-200/30'
      }`}
      onClick={onClick}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${routine.enabled ? 'bg-success' : 'bg-base-300'}`} />
      <span className={`text-sm truncate ${isSelected ? 'font-medium text-base-content' : 'text-base-content opacity-60'}`}>
        {routine.name ?? 'Untitled'}
      </span>
      <span className="text-[10px] text-neutral-content opacity-25 font-mono">
        {formatInterval(routine.interval_minutes ?? 60)}
      </span>
      <span className="flex-1" />
      {routine.enabled && routine.next_ping_at ? (
        <span className={`text-[10px] font-mono tabular-nums ${isSelected ? 'text-primary' : 'text-neutral-content opacity-40'}`}>
          {new Date(routine.next_ping_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          {' · '}{formatCountdown(cd)}
        </span>
      ) : (
        <span className="text-[10px] text-neutral-content opacity-20">off</span>
      )}
    </button>
  )
}

function RoutineSelector({ routines, selectedId, onSelect, onAdd }) {
  const [open, setOpen] = useState(false)
  const selected = routines.find(r => r.id === selectedId) ?? routines[0]
  const others = routines.filter(r => r.id !== selectedId)

  return (
    <div className="border-b border-base-300">
      {/* Selected routine header — always visible */}
      <button
        className="w-full flex items-center gap-2.5 px-5 py-2.5 text-left hover:bg-base-200/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${selected.enabled ? 'bg-success' : 'bg-base-300'}`} />
        <span className="text-sm font-medium text-base-content truncate">
          {selected.name ?? 'Untitled'}
        </span>
        <span className="text-[10px] text-neutral-content opacity-25 font-mono">
          {formatInterval(selected.interval_minutes ?? 60)}
        </span>
        <span className="flex-1" />
        {!open && others.length > 0 && (
          <span className="text-[10px] text-neutral-content opacity-25">
            {others.length} more
          </span>
        )}
        <span className={`text-neutral-content opacity-30 text-xs shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {/* Other routines + add button — collapsible */}
      {open && (
        <>
          {others.map(r => (
            <RoutineRow
              key={r.id}
              routine={r}
              isSelected={false}
              onClick={() => { onSelect(r.id); setOpen(false) }}
            />
          ))}
          <button
            className="w-full flex items-center gap-2.5 px-5 py-2 text-left hover:bg-base-200/30 transition-colors"
            onClick={() => { onAdd(); setOpen(false) }}
          >
            <span className="inline-block w-1.5 h-1.5 shrink-0" />
            <span className="text-sm text-neutral-content opacity-40">+ New routine</span>
          </button>
        </>
      )}
    </div>
  )
}

// ── Right column: ping control ───────────────────────────────────────────────
function PingColumn({ routines, selectedRoutineId, onSelectRoutine, onAddRoutine, onDeleteRoutine, ping, onPingChange, onFireNow }) {
  const countdown = useCountdown(ping.next_ping_at, ping.enabled)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [intervalInput, setIntervalInput] = useState(String(ping.interval_minutes ?? 60))

  useEffect(() => {
    setIntervalInput(String(ping.interval_minutes ?? 60))
  }, [ping.interval_minutes])

  const src = ping.context_sources ?? {}
  const scripts = src.scripts ?? []
  const texts = src.texts ?? []

  const patchSrc = (patch) => onPingChange({ context_sources: { ...src, ...patch } })

  const addScript = () =>
    patchSrc({ scripts: [...scripts, { label: '', command: '', enabled: true }] })
  const removeScript = (i) =>
    patchSrc({ scripts: scripts.filter((_, idx) => idx !== i) })
  const updateScript = (i, patch) =>
    patchSrc({ scripts: scripts.map((s, idx) => idx === i ? { ...s, ...patch } : s) })

  const addText = () =>
    patchSrc({ texts: [...texts, { label: '', content: '', enabled: true }] })
  const removeText = (i) =>
    patchSrc({ texts: texts.filter((_, idx) => idx !== i) })
  const updateText = (i, patch) =>
    patchSrc({ texts: texts.map((t, idx) => idx === i ? { ...t, ...patch } : t) })

  const handleIntervalBlur = () => {
    const val = Math.max(1, parseInt(intervalInput) || 1)
    setIntervalInput(String(val))
    onPingChange({ interval_minutes: val })
  }

  return (
    <div className="flex-1 h-full overflow-y-auto bg-base-100 flex flex-col">

      {/* Routine selector or empty state */}
      {routines.length > 0 ? (
        <RoutineSelector
          routines={routines}
          selectedId={selectedRoutineId}
          onSelect={onSelectRoutine}
          onAdd={onAddRoutine}
        />
      ) : (
        <div className="border-b border-base-300 px-5 py-4 flex items-center justify-between">
          <span className="text-sm text-neutral-content opacity-40">No routines</span>
          <button className="btn btn-sm btn-primary" onClick={onAddRoutine}>
            + New Routine
          </button>
        </div>
      )}

      {/* Big countdown */}
      <div className="flex flex-col items-center justify-center py-14 px-8 border-b border-base-300">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-content opacity-40 mb-4">
          Next ping
        </p>
        {ping.enabled && ping.next_ping_at ? (
          <>
            <div className="font-mono text-6xl font-light text-primary tabular-nums tracking-tight">
              {new Date(ping.next_ping_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
            <p className="text-xs text-neutral-content opacity-30 mt-3 tabular-nums">
              in {formatCountdown(countdown)}
            </p>
          </>
        ) : (
          <div className="font-mono text-5xl font-light text-neutral-content opacity-20 tracking-tight">
            paused
          </div>
        )}
        {!ping.enabled && (
          <p className="text-xs text-neutral-content opacity-30 mt-1">
            Ping rhythm is disabled
          </p>
        )}
        <button className="btn btn-sm btn-outline mt-5" onClick={onFireNow}>
          Fire Now
        </button>
      </div>

      {/* Controls */}
      <div className="px-5 py-4 border-b border-base-300 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-content opacity-30">
          Controls
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-base-content flex-1">Name</span>
          <input
            type="text"
            className="input input-bordered input-sm text-sm bg-base-100 w-48 text-right"
            value={ping.name ?? ''}
            onChange={e => onPingChange({ name: e.target.value })}
            placeholder="Untitled"
          />
        </div>
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm text-base-content">Enable ping rhythm</span>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={ping.enabled}
            onChange={e => onPingChange({ enabled: e.target.checked })}
          />
        </label>
        <div className="flex items-center gap-3">
          <span className="text-sm text-base-content flex-1">Every</span>
          <input
            type="number"
            className="input input-bordered input-sm w-20 text-sm bg-base-100 text-right"
            min={1}
            value={intervalInput}
            onChange={e => setIntervalInput(e.target.value)}
            onBlur={handleIntervalBlur}
          />
          <span className="text-sm text-base-content opacity-50">min</span>
        </div>
      </div>

      {/* Inject on ping */}
      <div className="px-5 py-4 border-b border-base-300 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-content opacity-30 mb-3">
          Inject on ping
        </p>

        {/* Time/Date */}
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm text-base-content">Time/Date</span>
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={src.time ?? true}
            onChange={e => patchSrc({ time: e.target.checked })}
          />
        </label>

        {/* Custom scripts */}
        <SubSection label="Custom scripts" />
        {scripts.map((script, i) => (
          <ScriptRow key={i} script={script} index={i} onUpdate={updateScript} onRemove={removeScript} />
        ))}
        <button
          className="btn btn-xs btn-ghost opacity-50 hover:opacity-100 mt-1"
          onClick={addScript}
        >
          + Add script
        </button>

        {/* Custom texts */}
        <SubSection label="Custom text" />
        {texts.map((text, i) => (
          <TextRow key={i} text={text} index={i} onUpdate={updateText} onRemove={removeText} />
        ))}
        <button
          className="btn btn-xs btn-ghost opacity-50 hover:opacity-100 mt-1"
          onClick={addText}
        >
          + Add text
        </button>
      </div>

      {/* Prompt preview */}
      <div className="px-5 py-4 border-b border-base-300">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setPreviewOpen(o => !o)}
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-content opacity-30">
            Prompt preview
          </p>
          <span className={`text-neutral-content opacity-30 text-xs transition-transform ${previewOpen ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </button>
        {previewOpen && (
          <pre className="mt-3 text-[11px] font-mono text-base-content opacity-60 leading-relaxed whitespace-pre-wrap bg-base-200 rounded-lg p-3 max-h-96 overflow-y-auto border border-base-300">
            {buildPromptPreview(ping)}
          </pre>
        )}
      </div>

      {/* Delete routine */}
      <div className="px-5 py-6">
        <button
          className="btn btn-error btn-block"
          onClick={() => {
            if (window.confirm(`Delete "${ping.name ?? 'this routine'}"?`)) onDeleteRoutine(ping.id)
          }}
        >
          Delete Routine
        </button>
      </div>

    </div>
  )
}

// ── API helpers (workspace-aware) ─────────────────────────────────────────────
const ROUTINES_URL = '/api/activation/ping/routines'

function fetchRoutines(workspace) {
  return fetch(wsUrl(ROUTINES_URL, workspace))
    .then(res => res.json())
    .then(data => data.routines ?? [])
}

function apiCreateRoutine(workspace) {
  return fetch(wsUrl(ROUTINES_URL, workspace), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Routine', enabled: false, intervalMinutes: 60 }),
  }).then(res => res.json())
}

function apiUpdateRoutine(id, patch, workspace) {
  const body = {}
  if ('name' in patch) body.name = patch.name
  if ('enabled' in patch) body.enabled = patch.enabled
  if ('interval_minutes' in patch) body.intervalMinutes = patch.interval_minutes
  if ('context_sources' in patch) body.contextSources = patch.context_sources
  return fetch(wsUrl(`${ROUTINES_URL}/${id}`, workspace), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(res => res.json())
}

function apiDeleteRoutine(id, workspace) {
  return fetch(wsUrl(`${ROUTINES_URL}/${id}`, workspace), { method: 'DELETE' })
}

function apiFireNow(id, workspace) {
  return fetch(wsUrl(`${ROUTINES_URL}/${id}/now`, workspace), { method: 'POST' })
}

// ── Main export ──────────────────────────────────────────────────────────────
export default function ActivationView() {
  const { activeWorkspace } = useWorkspace()
  const [status, setStatus] = useState(null)
  const [job, setJob] = useState(null)
  const [schedule, setSchedule] = useState({ enabled: false, intervalDays: 7 })
  const [routines, setRoutines] = useState([])
  const [selectedRoutineId, setSelectedRoutineId] = useState(null)
  const pollRef = useRef(null)

  // Derive the active ping object from selected routine
  const ping = routines.find(r => r.id === selectedRoutineId) ?? routines[0] ?? {
    id: null, name: '', enabled: false, interval_minutes: 60,
    next_ping_at: null, last_ping_at: null, context_sources: { time: true, scripts: [], texts: [] },
  }

  const loadRoutines = useCallback(async () => {
    try {
      const data = await fetchRoutines(activeWorkspace)
      setRoutines(data)
      setSelectedRoutineId(prev => {
        if (prev && data.some(r => r.id === prev)) return prev
        return data[0]?.id ?? null
      })
    } catch {
      // leave current state
    }
  }, [activeWorkspace])

  const fetchStatus = useCallback(() => {
    fetch(wsUrl('/api/activation/status', activeWorkspace))
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, connected: false, crystal: null }))
  }, [activeWorkspace])

  // Reload everything when workspace changes
  useEffect(() => {
    fetchStatus()
    loadRoutines()
  }, [fetchStatus, loadRoutines])

  // Poll routines every 10s to keep countdowns and status fresh
  useEffect(() => {
    pollRef.current = setInterval(loadRoutines, 10000)
    return () => clearInterval(pollRef.current)
  }, [loadRoutines])

  useEffect(() => {
    fetch(wsUrl('/api/activation/schedule', activeWorkspace))
      .then(r => r.json())
      .then(s => setSchedule({ enabled: s.enabled, intervalDays: s.interval_days }))
      .catch(() => {})
  }, [activeWorkspace])

  const handleScheduleChange = (patch) => {
    const next = { ...schedule, ...patch }
    setSchedule(next)
    fetch(wsUrl('/api/activation/schedule', activeWorkspace), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next.enabled, intervalDays: next.intervalDays }),
    }).catch(() => {})
  }

  const handlePingChange = async (patch) => {
    const updated = {
      ...ping,
      ...patch,
      context_sources: {
        ...ping.context_sources,
        ...(patch.context_sources ?? {}),
      },
    }
    setRoutines(prev => prev.map(r => r.id === ping.id ? updated : r))

    try {
      const result = await apiUpdateRoutine(ping.id, updated, activeWorkspace)
      setRoutines(prev => prev.map(r => r.id === ping.id ? result : r))
    } catch {
      // Revert on failure — next poll will correct
    }
  }

  const handleFireNow = () => {
    if (ping.id) apiFireNow(ping.id, activeWorkspace)
  }

  const handleAddRoutine = async () => {
    try {
      const newRoutine = await apiCreateRoutine(activeWorkspace)
      setRoutines(prev => [...prev, newRoutine])
      setSelectedRoutineId(newRoutine.id)
    } catch {
      // ignore
    }
  }

  const handleDeleteRoutine = async (id) => {
    try {
      await apiDeleteRoutine(id, activeWorkspace)
      setRoutines(prev => {
        const next = prev.filter(r => r.id !== id)
        if (selectedRoutineId === id && next.length) setSelectedRoutineId(next[0].id)
        return next
      })
    } catch {
      // ignore
    }
  }

  const handleSpawn = async ({ additionalContext }) => {
    const res = await fetch(wsUrl('/api/activation/crystal/spawn', activeWorkspace), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalContext }),
    })
    const { job_id } = await res.json()
    setJob({ id: job_id, progress: 0, stage: 'Starting…', status: 'running' })

    const es = new EventSource(wsUrl(`/api/activation/crystal/stream/${job_id}`, activeWorkspace))
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'progress') {
        setJob(j => ({ ...j, progress: event.progress, stage: event.stage }))
      }
      if (event.type === 'done') {
        setJob(j => ({ ...j, status: event.status }))
        es.close()
        fetchStatus()
      }
    }
    es.onerror = () => {
      setJob(j => j ? { ...j, status: 'failed' } : j)
      es.close()
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-80 shrink-0">
        <SettingsColumn status={status} onSpawn={handleSpawn} job={job} schedule={schedule} onScheduleChange={handleScheduleChange} />
      </div>
      <PingColumn
        routines={routines}
        selectedRoutineId={selectedRoutineId}
        onSelectRoutine={setSelectedRoutineId}
        onAddRoutine={handleAddRoutine}
        onDeleteRoutine={handleDeleteRoutine}
        ping={ping}
        onPingChange={handlePingChange}
        onFireNow={handleFireNow}
      />
    </div>
  )
}
