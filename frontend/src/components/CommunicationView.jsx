// CommunicationView — MVAC "C" layer, chatroom UI

import { useState, useEffect, useRef, useCallback } from 'react'

function relativeTime(ts) {
  if (!ts) return ''
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 0) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Deterministic color from sender name
function senderColor(name) {
  if (name === 'myra') return '#F472B6'  // pink
  if (name === 'fathom') return '#8B5CF6'  // purple
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 60%, 65%)`
}

// Format "last active" time for tooltip
function lastActiveLabel(isoStr) {
  if (!isoStr) return null
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 0) return 'just now'
  if (diff < 60) return `active ${diff}s ago`
  if (diff < 3600) return `active ${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `active ${Math.floor(diff / 3600)}h ago`
  return `active ${Math.floor(diff / 86400)}d ago`
}

// Sender tooltip component — pure CSS, no library
function SenderName({ name, profiles }) {
  const profile = profiles[name]
  const isHuman = profile?.type === 'human'

  // Status dot color: pink for humans, green/gray for agents
  function dotColor() {
    if (isHuman) return '#F472B6'
    if (profile?.running) return '#34D399'
    return '#6B7280'
  }

  return (
    <span className="relative group/tip inline-block">
      <span
        className="text-xs font-semibold cursor-default"
        style={{ color: senderColor(name) }}
      >
        {name}
      </span>
      {profile && (
        <span
          className="pointer-events-none absolute left-0 top-full mt-1 z-50
            opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 delay-150
            bg-neutral text-neutral-content text-[11px] leading-snug
            rounded-lg px-3 py-2 shadow-lg whitespace-nowrap min-w-[140px]"
        >
          <span className="flex items-center gap-1.5 font-semibold mb-0.5">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: dotColor() }}
            />
            {name}
            {profile.type && profile.type !== 'local' && (
              <span className="font-normal opacity-50 text-[10px]">({profile.type})</span>
            )}
          </span>
          {profile.architecture && (
            <span className="block opacity-70">{profile.architecture}</span>
          )}
          {profile.description && (
            <span className="block opacity-50 text-[10px]">{profile.description}</span>
          )}
          {!isHuman && profile.last_ping && (
            <span className="block opacity-40 text-[10px] mt-0.5">
              {lastActiveLabel(profile.last_ping)}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

export default function CommunicationView() {
  const [rooms, setRooms] = useState([])
  const [selectedRoom, setSelectedRoom] = useState('general')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [profiles, setProfiles] = useState({})
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const prevMessageCount = useRef(0)

  // Sanitize room name: strip #, lowercase, trim, spaces → hyphens
  function sanitizeRoomName(raw) {
    return raw.replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-')
  }

  function handleCreateRoom() {
    const name = sanitizeRoomName(newRoomName)
    if (!name) return
    setSelectedRoom(name)
    setNewRoomName('')
  }

  function handleNewRoomKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreateRoom()
    }
  }

  // Get description for selected room
  const selectedRoomData = rooms.find(r => r.name === selectedRoom)
  const roomDescription = selectedRoomData?.description || ''

  function startEditingDesc() {
    setDescDraft(roomDescription)
    setEditingDesc(true)
  }

  async function saveDescription() {
    const desc = descDraft.trim()
    try {
      await fetch(`/api/room/${encodeURIComponent(selectedRoom)}/description`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc }),
      })
      fetchRooms()
    } catch (e) {
      console.error('Failed to save description:', e)
    }
    setEditingDesc(false)
  }

  function handleDescKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveDescription()
    } else if (e.key === 'Escape') {
      setEditingDesc(false)
    }
  }

  // Fetch workspace profiles (mostly static — on mount + when rooms refresh)
  const fetchProfiles = useCallback(() => {
    fetch('/api/workspaces/profiles')
      .then(r => r.json())
      .then(data => setProfiles(data.profiles || {}))
      .catch(() => {}) // graceful fallback — no tooltips
  }, [])

  // Fetch room list
  const fetchRooms = useCallback(() => {
    fetch('/api/room/list')
      .then(r => r.json())
      .then(data => setRooms(data.rooms || []))
      .catch(console.error)
  }, [])

  // Fetch messages for selected room
  const fetchMessages = useCallback(() => {
    if (!selectedRoom) return
    fetch(`/api/room/${encodeURIComponent(selectedRoom)}?hours=168`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))
      .catch(console.error)
  }, [selectedRoom])

  // Initial load
  useEffect(() => {
    fetchRooms()
    fetchProfiles()
  }, [fetchRooms, fetchProfiles])

  // Fetch messages when room changes
  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  // Poll messages every 5s
  useEffect(() => {
    const id = setInterval(fetchMessages, 5000)
    return () => clearInterval(id)
  }, [fetchMessages])

  // Poll rooms every 30s
  useEffect(() => {
    const id = setInterval(fetchRooms, 30000)
    return () => clearInterval(id)
  }, [fetchRooms])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessageCount.current = messages.length
  }, [messages])

  // Send message
  async function handleSend() {
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      await fetch(`/api/room/${encodeURIComponent(selectedRoom)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draft.trim(), sender: 'myra' }),
      })
      setDraft('')
      fetchMessages()
      fetchRooms()
    } catch (e) {
      console.error('Send failed:', e)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Room list sidebar */}
      <div className="w-56 shrink-0 bg-base-200 border-r border-base-300 overflow-y-auto">
        <div className="px-3 py-2.5">
          <h3 className="text-xs font-semibold text-neutral-content opacity-50 uppercase tracking-wider mb-2">
            Rooms
          </h3>
          <div className="flex gap-1 mb-2">
            <input
              type="text"
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              onKeyDown={handleNewRoomKeyDown}
              placeholder="New room..."
              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-base-100 border border-base-300
                text-xs text-base-content placeholder:text-neutral-content/30
                focus:outline-none focus:border-primary/50 transition-colors"
            />
            <button
              onClick={handleCreateRoom}
              disabled={!newRoomName.trim()}
              className="px-2 py-1 rounded-md bg-primary/15 text-primary text-xs font-semibold
                hover:bg-primary/25 transition-colors disabled:opacity-30 disabled:cursor-default
                shrink-0"
            >
              +
            </button>
          </div>
          {rooms.length === 0 ? (
            <p className="text-xs text-neutral-content opacity-40 px-1">
              No rooms yet. Post a message to create one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {rooms.map(room => (
                <li key={room.name}>
                  <button
                    onClick={() => setSelectedRoom(room.name)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                      selectedRoom === room.name
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-base-content/70 hover:bg-base-300/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">#{room.name}</span>
                      <span className="text-[10px] opacity-40 ml-1 shrink-0">
                        {room.message_count}
                      </span>
                    </div>
                    {room.last_sender && (
                      <div className="text-[10px] opacity-40 mt-0.5 truncate">
                        {room.last_sender} — {relativeTime(room.last_activity)}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Messages area + input */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Room header */}
        <div className="px-4 py-2 border-b border-base-300 bg-base-200/50 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-base-content">
              #{selectedRoom}
            </h2>
            {!editingDesc && (
              <span className="text-xs text-base-content/40 truncate flex-1">
                {roomDescription && <>&mdash; {roomDescription}</>}
              </span>
            )}
          </div>
          {editingDesc ? (
            <div className="flex gap-1.5 mt-1">
              <input
                type="text"
                value={descDraft}
                onChange={e => setDescDraft(e.target.value)}
                onKeyDown={handleDescKeyDown}
                onBlur={saveDescription}
                autoFocus
                placeholder="Room topic..."
                className="flex-1 px-2 py-0.5 rounded-md bg-base-100 border border-base-300
                  text-xs text-base-content placeholder:text-neutral-content/30
                  focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          ) : (
            <button
              onClick={startEditingDesc}
              className="text-[10px] text-base-content/30 hover:text-base-content/60 transition-colors mt-0.5"
            >
              {roomDescription ? 'edit topic' : '+ add topic'}
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-neutral-content opacity-40">
                No messages in the last 7 days.
              </p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className="group">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <SenderName name={msg.sender} profiles={profiles} />
                  <span className="text-[10px] text-neutral-content opacity-30">
                    {relativeTime(msg.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-base-content/85 leading-relaxed whitespace-pre-wrap break-words pl-0.5">
                  {msg.message}
                </p>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="px-4 py-3 border-t border-base-300 bg-base-200/30 shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${selectedRoom}...`}
              disabled={sending}
              className="flex-1 px-3 py-1.5 rounded-lg bg-base-100 border border-base-300
                text-sm text-base-content placeholder:text-neutral-content/30
                focus:outline-none focus:border-primary/50 transition-colors
                disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-content text-sm font-medium
                hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-default
                shrink-0"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
