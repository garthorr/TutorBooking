import { useState, useEffect } from 'react'
import { adminFetch } from '../auth'

const WIDTH_OPTIONS = [
  { value: '100%',  label: '100% — full width' },
  { value: '90%',   label: '90%' },
  { value: '800px', label: '800 px' },
  { value: '720px', label: '720 px' },
  { value: '640px', label: '640 px' },
  { value: '480px', label: '480 px' },
]

const HEIGHT_OPTIONS = [
  { value: '1000px', label: '1000 px — tall' },
  { value: '900px',  label: '900 px' },
  { value: '820px',  label: '820 px — default' },
  { value: '700px',  label: '700 px' },
  { value: '600px',  label: '600 px — compact' },
]

const RADIUS_OPTIONS = [
  { value: '0',    label: 'Square' },
  { value: '8px',  label: 'Slight' },
  { value: '16px', label: 'Rounded' },
  { value: '24px', label: 'Very rounded' },
]

const BORDER_OPTIONS = [
  { value: 'none',    label: 'None',     css: 'none' },
  { value: 'subtle',  label: 'Subtle',   css: '1px solid #e2e8f0' },
  { value: 'visible', label: 'Visible',  css: '2px solid #94a3b8' },
]

const SHADOW_OPTIONS = [
  { value: 'none',      label: 'None',       css: 'none' },
  { value: 'subtle',    label: 'Subtle',     css: '0 4px 24px rgba(0,0,0,0.08)' },
  { value: 'prominent', label: 'Prominent',  css: '0 8px 40px rgba(0,0,0,0.18)' },
]

const SCROLL_OPTIONS = [
  { value: 'auto', label: 'Scrollable (recommended)' },
  { value: 'no',   label: 'No scrollbar (requires tall height)' },
]

export default function EmbedBuilder() {
  const origin = window.location.origin
  const [width,  setWidth]  = useState('100%')
  const [height, setHeight] = useState('820px')
  const [radius, setRadius] = useState('16px')
  const [border, setBorder] = useState('none')
  const [shadow, setShadow] = useState('subtle')
  const [scroll, setScroll] = useState('auto')
  const [copied, setCopied] = useState(false)
  const [meetingTypes, setMeetingTypes] = useState([])
  const [typeId, setTypeId] = useState('')

  useEffect(() => {
    // Admin endpoint so secret types are offered too (the public list hides them).
    adminFetch('/api/meeting-types/all')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data)) {
          setMeetingTypes(data.filter(t => t.enabled).sort((a, b) => a.order - b.order))
        }
      })
      .catch(() => {})
  }, [])

  const embedUrl = typeId ? `${origin}/book/${typeId}` : `${origin}/`
  const embedTitle = typeId
    ? `Book: ${meetingTypes.find(t => t.id === typeId)?.label || typeId}`
    : 'Book a tutoring session'

  const borderCss = BORDER_OPTIONS.find(o => o.value === border)?.css ?? 'none'
  const shadowCss = SHADOW_OPTIONS.find(o => o.value === shadow)?.css ?? 'none'

  const styleParts = [
    `border: ${borderCss}`,
    radius !== '0' ? `border-radius: ${radius}` : null,
    shadowCss !== 'none' ? `box-shadow: ${shadowCss}` : null,
    scroll === 'no' ? 'overflow: hidden' : null,
    'display: block',
  ].filter(Boolean)

  const iframeCode = [
    '<iframe',
    `  src="${embedUrl}"`,
    `  width="${width}"`,
    `  height="${height}"`,
    `  style="${styleParts.join('; ')}"`,
    `  title="${embedTitle}"`,
    '  loading="lazy"',
    '></iframe>',
  ].join('\n')

  const handleCopy = () => {
    navigator.clipboard.writeText(iframeCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const previewFrameStyle = {
    border: borderCss,
    borderRadius: radius !== '0' ? radius : undefined,
    boxShadow: shadowCss !== 'none' ? shadowCss : undefined,
    overflow: scroll === 'no' ? 'hidden' : undefined,
    display: 'block',
    width: width.endsWith('%') ? width : width,
    height,
    maxWidth: '100%',
  }

  return (
    <div>
      <div className="info-box">
        <h3>Embed the booking form</h3>
        <p>
          Copy the snippet below and paste it into any webpage to embed the booking widget.
          Use the options to match your site's style — the preview updates live.
        </p>
        <p style={{ margin: 0 }}>
          The widget loads from <code>{embedUrl}</code>. Make sure your site can reach that URL.
        </p>
      </div>

      {/* ── Options ─────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h2>Customization</h2>
        <div className="embed-options">
          <div className="embed-option-group">
            <label>Booking options</label>
            <select value={typeId} onChange={e => setTypeId(e.target.value)}>
              <option value="">All meeting types</option>
              {meetingTypes.map(t => (
                <option key={t.id} value={t.id}>{t.label} only{t.secret ? ' (secret)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="embed-option-group">
            <label>Width</label>
            <select value={width} onChange={e => setWidth(e.target.value)}>
              {WIDTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="embed-option-group">
            <label>Height</label>
            <select value={height} onChange={e => setHeight(e.target.value)}>
              {HEIGHT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="embed-option-group">
            <label>Corners</label>
            <select value={radius} onChange={e => setRadius(e.target.value)}>
              {RADIUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="embed-option-group">
            <label>Border</label>
            <select value={border} onChange={e => setBorder(e.target.value)}>
              {BORDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="embed-option-group">
            <label>Shadow</label>
            <select value={shadow} onChange={e => setShadow(e.target.value)}>
              {SHADOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="embed-option-group">
            <label>Scrolling</label>
            <select value={scroll} onChange={e => setScroll(e.target.value)}>
              {SCROLL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Code ────────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h2>Embed code</h2>
        <div className="embed-code-wrap">
          <pre className="embed-code">{iframeCode}</pre>
          <button
            className={`btn btn-sm ${copied ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleCopy}
          >
            {copied ? '✓ Copied' : 'Copy code'}
          </button>
        </div>
      </div>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h2>Live preview</h2>
        <p className="field-hint">Scroll inside the frame to walk through the full booking flow.</p>
        <div className="embed-preview-wrap">
          <iframe
            key={`${typeId}-${width}-${height}-${radius}-${border}-${shadow}-${scroll}`}
            src={embedUrl}
            style={previewFrameStyle}
            title={embedTitle}
          />
        </div>
      </div>
    </div>
  )
}
