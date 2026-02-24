// ActivationPanel — MVAC "A" layer
// All data is mocked/placeholder. Wire up API endpoints later.

import { useState, useEffect } from 'react'

const MOCK_CRYSTAL = {
  lastGenerated: null, // null = never generated
  preview: '', // will be populated once crystal exists
}

const MOCK_PROMPT_CONFIG = {
  path: '~/.config/fathom/crystal-prompt.md',
  exists: false, // TODO: check via /api/activation/crystal/config-status
  lastModified: null,
}

const MOCK_AGENTS = [
  { id: 1, name: 'NS-Deep', started: '2026-02-21T14:32:00Z', status: 'completed', dir: 'fathom/' },
  { id: 2, name: 'Infra-Sentinel', started: '2026-02-21T09:15:00Z', status: 'completed', dir: 'fathom-dashboard/' },
  { id: 3, name: 'Newsroom-Curator', started: '2026-02-20T22:00:00Z', status: 'completed', dir: 'fathom/' },
]

function relativeTime(isoString) {
  if (!isoString) return null
  // Memento timestamps are UTC without 'Z' — force UTC parsing to avoid local-time skew
  const utc = isoString.includes('Z') || isoString.includes('+') ? isoString : isoString.replace(' ', 'T') + 'Z'
  const diff = Math.floor((Date.now() - new Date(utc).getTime()) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
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

function Helper({ children }) {
  return (
    <p className="text-xs text-neutral-content opacity-40 leading-relaxed mt-1.5">
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

export default function ActivationPanel({ onClose }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    fetch('/api/activation/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, connected: false, crystal: null }))
  }, [])

  const mementoConnected = status?.connected ?? false
  const mementoLabel = !status?.configured ? 'Not configured' : status?.connected ? 'Connected' : 'Error'
  const crystal = {
    lastGenerated: status?.crystal?.created_at ?? null,
    preview: status?.crystal?.preview ?? null,
  }
  const promptConfig = MOCK_PROMPT_CONFIG
  const regenScheduled = true
  const regenInterval = '3 days'

  const [additionalContext, setAdditionalContext] = useState('')
  const [stripSystemPrompt, setStripSystemPrompt] = useState(true)
  const [job, setJob] = useState(null)

  const handleSpawn = async () => {
    const res = await fetch('/api/activation/crystal/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalContext, stripSystemPrompt }),
    })
    const { job_id } = await res.json()
    setJob({ id: job_id, progress: 0, stage: 'Starting…', status: 'running' })

    const es = new EventSource(`/api/activation/crystal/stream/${job_id}`)
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'progress') {
        setJob(j => ({ ...j, progress: event.progress, stage: event.stage }))
      }
      if (event.type === 'done') {
        setJob(j => ({ ...j, status: event.status }))
        es.close()
      }
    }
    es.onerror = () => {
      setJob(j => j ? { ...j, status: 'failed' } : j)
      es.close()
    }
  }

  const isRunning = job?.status === 'running'

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-sm font-semibold text-primary">Activation</span>
        <button
          onClick={onClose}
          className="text-neutral-content opacity-60 hover:opacity-100 text-lg leading-none"
          aria-label="Close activation"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* ── Identity Crystal ── */}
        <section>
          <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
            Identity Crystal
          </h3>

          {/* Memento connection */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-base-content opacity-80">Memento</span>
            <StatusDot ok={mementoConnected} label={mementoLabel} />
          </div>
          <Helper>
            The crystal is stored in and read from Memento. It is injected into the agent's
            startup context after compaction so future sessions wake with continuity.
            Configure MEMENTO_API_KEY to enable reading and writing.
          </Helper>

          {/* Crystal status */}
          <div className="bg-base-100 rounded-lg p-3 mt-3 mb-1 border border-base-300">
            {crystal.lastGenerated ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-content opacity-50">Last generated</span>
                  <span className="text-xs text-base-content opacity-70">{relativeTime(crystal.lastGenerated)}</span>
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
          <Helper>
            A crystal is a ~1,300-word first-person prose synthesis — what the agent cares
            about, what it's working on, what persists across sessions. It is written by a
            dedicated crystallization agent, not composed inline in the main session (which
            would contaminate the synthesis with its existing self-model).
          </Helper>

          {/* ── Base Prompt ── */}
          <SubSection label="Base prompt" />

          <div className="bg-base-100 rounded-lg p-3 border border-base-300 mb-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-mono text-base-content opacity-70 break-all">
                  {promptConfig.path}
                </p>
                <p className={`text-[10px] mt-1 ${promptConfig.exists ? 'text-success' : 'text-warning opacity-70'}`}>
                  {promptConfig.exists
                    ? `Found · modified ${relativeTime(promptConfig.lastModified)}`
                    : 'File not found — agent will use built-in defaults'}
                </p>
              </div>
              <button
                className="btn btn-xs btn-ghost opacity-50 shrink-0"
                disabled // TODO: open in $EDITOR
                title="Not yet wired up"
              >
                Edit
              </button>
            </div>
          </div>
          <Helper>
            This file defines the crystallization agent's core instructions. It lives outside
            the vault — the vault is for experience and storage, not agent configuration.
            Edit the file manually to change what the agent prioritizes. Replacing the file
            changes what the next regeneration produces. The path can be changed in
            fathom's main config.
          </Helper>

          {/* ── Additional context ── */}
          <SubSection label="Additional context (this run only)" />

          <textarea
            className="textarea textarea-bordered w-full text-xs bg-base-100 resize-none"
            rows={3}
            placeholder={
              'Optional. Merged into the base prompt for this run only — not saved.\n' +
              'e.g. "Focus on the recent shift toward infrastructure work" or ' +
              '"The Navier-Stokes research has been central lately."'
            }
            value={additionalContext}
            onChange={e => setAdditionalContext(e.target.value)}
          />
          <Helper>
            Use this to direct the agent's attention toward recent experiences that may not
            yet appear in vault/reflections. Does not affect scheduled regenerations — those
            use the base prompt only.
          </Helper>

          {/* ── Environment ── */}
          <SubSection label="Environment" />

          <label className="flex items-start justify-between gap-3 cursor-pointer mb-1">
            <div>
              <span className="text-sm text-base-content">Strip CC system prompt</span>
              <p className="text-[10px] font-mono text-neutral-content opacity-40 mt-0.5">
                CLAUDE_CODE_SIMPLE=1
              </p>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm mt-0.5 shrink-0"
              checked={stripSystemPrompt}
              onChange={e => setStripSystemPrompt(e.target.checked)}
            />
          </label>
          <Helper>
            When on, the agent runs without Claude Code's built-in system prompt. This removes
            the default assistant framing — and crucially, the injected identity crystal from
            the main session — so the synthesis comes from vault materials rather than from
            what the agent already "knows" about itself. File tools (Read, Write, Glob, Grep)
            are still available. Recommended: on.
          </Helper>

          {/* ── Spawn ── */}
          <SubSection label="Run" />

          <button
            className="btn btn-sm btn-outline w-full"
            disabled={isRunning}
            onClick={handleSpawn}
          >
            {isRunning ? 'Running…' : 'Spawn crystallization agent'}
          </button>

          {job && (
            <div className="mt-3 space-y-1.5">
              <div className="w-full bg-base-300 rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <p className="text-xs text-base-content opacity-60">{job.stage}</p>
              {job.status !== 'running' && (
                <p className={`text-[10px] font-semibold uppercase tracking-widest ${
                  job.status === 'done' ? 'text-success' : 'text-error'
                }`}>
                  {job.status === 'done' ? 'Complete' : 'Failed'}
                </p>
              )}
            </div>
          )}

          <Helper>
            Launches a focused Claude Code agent in a new tmux pane with the environment
            settings above. The agent will: (1) load fathom-vault and Memento tools,
            (2) read vault/reflections (last 20) and vault/daily (last 7 heartbeats),
            (3) read the existing crystal as reference only — not as a template,
            (4) synthesize using the base prompt, incorporating any additional context above,
            (5) write the result to Memento via memento_identity_update.
            Estimated time: 3–5 min.
          </Helper>
        </section>

        <div className="divider my-1" />

        {/* ── Scheduling ── */}
        <section>
          <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
            Scheduling
          </h3>

          <label className="flex items-center justify-between gap-3 cursor-pointer mb-1">
            <span className="text-sm text-base-content">Periodic regeneration</span>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={regenScheduled}
              onChange={() => {}} // TODO: wire to settings
            />
          </label>
          <Helper>
            When enabled, a crystallization agent is spawned automatically on the configured
            interval using the base prompt only — no additional context. Uses the same
            environment settings as a manual regeneration.
          </Helper>

          <label className="flex items-center justify-between gap-3 mt-3 mb-1">
            <span className="text-sm text-base-content opacity-80">Interval</span>
            <select
              className="select select-bordered select-sm text-sm bg-base-100"
              value={regenInterval}
              onChange={() => {}} // TODO: wire to settings
            >
              <option>1 day</option>
              <option>3 days</option>
              <option>7 days</option>
            </select>
          </label>
          <Helper>
            Longer intervals allow more vault material to accumulate between syntheses,
            producing larger identity deltas. Shorter intervals track recent experience
            more closely but may over-index on transient preoccupations.
          </Helper>
        </section>

        <div className="divider my-1" />

        {/* ── Recent Agents ── */}
        <section>
          <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-3">
            Recent Agents
          </h3>

          <div className="space-y-2">
            {MOCK_AGENTS.map(agent => (
              <div
                key={agent.id}
                className="flex items-center justify-between bg-base-100 rounded px-3 py-2 border border-base-300"
              >
                <div>
                  <span className="text-xs font-medium text-base-content">{agent.name}</span>
                  <p className="text-xs text-neutral-content opacity-40">{agent.dir}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    agent.status === 'completed'
                      ? 'bg-success/10 text-success'
                      : agent.status === 'running'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-error/10 text-error'
                  }`}>
                    {agent.status}
                  </span>
                  <p className="text-xs text-neutral-content opacity-40 mt-0.5">
                    {relativeTime(agent.started)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-sm btn-ghost w-full mt-2 opacity-50"
            disabled // TODO: wire to agent spawn
          >
            + Spawn agent
          </button>
        </section>

      </div>
    </div>
  )
}
