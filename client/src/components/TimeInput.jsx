import { useState, useEffect } from 'react'

// Canonical storage format is 24-hour "HH:MM". Display is always explicit
// 12-hour with AM/PM so the rendering never depends on browser locale
// (native <input type="time"> hides the AM/PM segment in 24-hour locales
// and blocks 24-hour entry in 12-hour locales).

export function formatTime12h(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value || '')
  if (!m) return value || ''
  const h = Number(m[1])
  if (h > 23) return value
  const meridiem = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m[2]} ${meridiem}`
}

// Accepts "17:00", "1730", "9", "9:30", "5pm", "5:30 PM", "530pm", "12am"…
// Returns canonical "HH:MM" (24-hour) or null if unparseable.
export function parseTimeInput(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase().replace(/\./g, '')
  const m = /^(\d{1,2})(?::?([0-5]\d))?\s*(am|pm|a|p)?$/.exec(s)
  if (!m) return null
  let hours = Number(m[1])
  const minutes = m[2] ? Number(m[2]) : 0
  const meridiem = m[3] ? m[3][0] : null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    if (meridiem === 'p' && hours !== 12) hours += 12
    if (meridiem === 'a' && hours === 12) hours = 0
  } else if (hours > 23) {
    return null
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export default function TimeInput({ value, onChange, className = '', ...rest }) {
  const [text, setText] = useState(() => formatTime12h(value))

  useEffect(() => { setText(formatTime12h(value)) }, [value])

  const invalid = parseTimeInput(text) === null

  const commit = () => {
    const parsed = parseTimeInput(text)
    if (parsed && parsed !== value) onChange(parsed)
    else setText(formatTime12h(value))
  }

  return (
    <input
      type="text"
      className={`time-input${invalid ? ' time-input-invalid' : ''}${className ? ` ${className}` : ''}`}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur() }
        else if (e.key === 'Escape') setText(formatTime12h(value))
      }}
      placeholder="9:00 AM"
      title="Enter a time like 5:00 PM or 17:00"
      autoComplete="off"
      spellCheck={false}
      {...rest}
    />
  )
}
