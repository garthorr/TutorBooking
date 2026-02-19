// ── Theme presets ─────────────────────────────────────────────────────────────
// Each preset defines primary, hover, light (tint for selected backgrounds),
// and subtle (very light tint for SVG placeholder circles).

export const THEME_PRESETS = [
  {
    id: 'indigo',
    label: 'Indigo',
    primary: '#4f46e5',
    hover: '#4338ca',
    light: '#eef2ff',
    subtle: '#c7d2fe'
  },
  {
    id: 'blue',
    label: 'Blue',
    primary: '#2563eb',
    hover: '#1d4ed8',
    light: '#eff6ff',
    subtle: '#bfdbfe'
  },
  {
    id: 'teal',
    label: 'Teal',
    primary: '#0d9488',
    hover: '#0f766e',
    light: '#f0fdfa',
    subtle: '#99f6e4'
  },
  {
    id: 'purple',
    label: 'Purple',
    primary: '#9333ea',
    hover: '#7e22ce',
    light: '#faf5ff',
    subtle: '#e9d5ff'
  }
]

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

function darkenHex(hex, factor = 0.15) {
  const [r, g, b] = hexToRgb(hex)
  return toHex(r * (1 - factor), g * (1 - factor), b * (1 - factor))
}

function lightenHex(hex, factor = 0.88) {
  const [r, g, b] = hexToRgb(hex)
  return toHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor)
}

// ── Apply theme to document root ─────────────────────────────────────────────

export function applyTheme(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return
  const root = document.documentElement
  const preset = THEME_PRESETS.find(p => p.primary.toLowerCase() === hex.toLowerCase())
  if (preset) {
    root.style.setProperty('--primary-color', preset.primary)
    root.style.setProperty('--primary-hover', preset.hover)
    root.style.setProperty('--primary-light', preset.light)
    root.style.setProperty('--primary-subtle', preset.subtle)
  } else {
    root.style.setProperty('--primary-color', hex)
    root.style.setProperty('--primary-hover', darkenHex(hex, 0.15))
    root.style.setProperty('--primary-light', lightenHex(hex, 0.9))
    root.style.setProperty('--primary-subtle', lightenHex(hex, 0.78))
  }
}
