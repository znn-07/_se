const TEAM_COLORS: Record<string, string> = {
  red_bull: '#3671C6',
  mercedes: '#27F4D2',
  ferrari: '#E8002D',
  mclaren: '#FF8000',
  aston_martin: '#229971',
  alpine: '#FF87BC',
  williams: '#64C4FF',
  rb: '#6692FF',
  haas: '#B6BABD',
  audi: '#00B8A9',
  cadillac: '#C8A464',
  sauber: '#52E252',
  racing_point: '#F596C8',
  renault: '#FFF500',
  toro_rosso: '#469BFF',
  alphatauri: '#5E8FAA',
  alfa: '#C92D4B',
  force_india: '#F596C8',
  lotus_f1: '#FFB800',
  toyota: '#CC0000',
  brawn: '#B8FD5D',
  jordan: '#F7D417',
  minardi: '#F2D100',
}

const FALLBACK_COLORS = [
  '#E10600',
  '#33C4E8',
  '#F7A600',
  '#9B7BFF',
  '#36D399',
  '#FF6D9E',
  '#FACC15',
  '#60A5FA',
]

export function teamColor(constructorId: string): string {
  if (TEAM_COLORS[constructorId]) return TEAM_COLORS[constructorId]
  let hash = 0
  for (const char of constructorId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

export function contrastText(color: string): string {
  const hex = color.replace('#', '')
  if (hex.length !== 6) return '#07080c'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#07080c' : '#ffffff'
}

export function driverInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}
