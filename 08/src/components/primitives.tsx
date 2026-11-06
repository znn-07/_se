import {
  AlertTriangle,
  CalendarDays,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Constructor, Driver } from '../../shared/types'
import { driverInitials, teamColor } from '../../shared/teams'
import { useSeasonParam } from '../lib/season'
import { useSeasons } from '../lib/api'

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function Panel({
  children,
  className,
  accent = false,
  flat = false,
}: {
  children: ReactNode
  className?: string
  accent?: boolean
  flat?: boolean
}) {
  return (
    <div
      className={cx(
        flat ? 'panel-flat' : 'panel panel-soft',
        accent && 'panel-accent',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-xs leading-relaxed text-white/45">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-5 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-apex-red shadow-[0_0_12px_rgba(225,6,0,0.9)]" />
          <span className="eyebrow">{eyebrow}</span>
        </div>
        <h1 className="text-3xl font-black leading-none tracking-[-0.045em] text-white sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/50">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function TeamDot({
  constructor,
  size = 'md',
}: {
  constructor: Constructor | string
  size?: 'sm' | 'md' | 'lg'
}) {
  const id = typeof constructor === 'string' ? constructor : constructor.id
  const color = teamColor(id)
  const sizeClass = size === 'sm' ? 'h-2 w-2' : size === 'lg' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'
  return (
    <span
      className={cx('inline-block shrink-0 rounded-full', sizeClass)}
      style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}55` }}
    />
  )
}

export function DriverBadge({
  driver,
  constructorId,
  size = 'md',
  showNumber = false,
}: {
  driver: Driver
  constructorId?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showNumber?: boolean
}) {
  const color = constructorId ? teamColor(constructorId) : '#8b8f9a'
  const sizeClass =
    size === 'xl'
      ? 'h-20 w-20 text-2xl rounded-2xl'
      : size === 'lg'
        ? 'h-12 w-12 text-sm'
        : size === 'sm'
          ? 'h-7 w-7 text-[9px]'
          : 'h-9 w-9 text-[10px]'
  return (
    <div
      className={cx(
        'relative grid shrink-0 place-items-center rounded-xl border font-mono font-bold',
        sizeClass,
      )}
      style={{
        borderColor: `${color}66`,
        background: `linear-gradient(145deg, ${color}2e, rgba(255,255,255,0.03))`,
        color: '#fff',
        boxShadow: `inset 0 0 18px ${color}12`,
      }}
      title={driver.fullName}
    >
      {showNumber && driver.number ? driver.number : driverInitials(driver.fullName)}
      <span
        className="absolute -bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  )
}

export function PositionBadge({ position }: { position: number | null }) {
  return (
    <span className={cx('rank-badge', position !== null && position <= 3 && 'rank-podium')}>
      {position ?? '—'}
    </span>
  )
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  accent = false,
}: {
  label: string
  value: ReactNode
  unit?: string
  hint?: string
  icon?: ReactNode
  accent?: boolean
}) {
  return (
    <Panel className="group p-4 sm:p-5" accent={accent}>
      <div className="flex items-start justify-between gap-3">
        <div className="eyebrow">{label}</div>
        {icon ? (
          <div className="text-white/30 transition group-hover:text-apex-red">{icon}</div>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="metric text-2xl font-bold text-white sm:text-3xl">{value}</span>
        {unit ? <span className="text-xs font-semibold text-white/40">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1.5 text-[11px] text-white/38">{hint}</div> : null}
    </Panel>
  )
}

export function LoadingPanel({
  rows = 5,
  className,
  label = '正在載入賽事資料…',
}: {
  rows?: number
  className?: string
  label?: string
}) {
  return (
    <Panel className={cx('p-5', className)}>
      <div className="mb-4 flex items-center gap-2 text-xs text-white/45">
        <Loader2 size={14} className="animate-spin text-apex-red" />
        {label}
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="skeleton h-8 w-8 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-2.5" style={{ width: `${52 + index * 4}%` }} />
              <div className="skeleton h-2 w-1/3" />
            </div>
            <div className="skeleton h-3 w-10" />
          </div>
        ))}
      </div>
    </Panel>
  )
}

export function ErrorPanel({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <Panel className={cx('p-6', className)}>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-apex-red/10 text-apex-red">
          <WifiOff size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">資料載入失敗</div>
          <p className="mt-1 break-words text-xs leading-relaxed text-white/45">{message}</p>
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <RefreshCw size={13} />
            重新載入
          </button>
        ) : null}
      </div>
    </Panel>
  )
}

export function EmptyPanel({
  title,
  description,
  icon,
}: {
  title: string
  description?: string
  icon?: ReactNode
}) {
  return (
    <Panel className="grid place-items-center p-10 text-center">
      <div className="mb-3 text-white/25">
        {icon ?? <AlertTriangle size={24} />}
      </div>
      <div className="text-sm font-bold text-white">{title}</div>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/40">{description}</p>
      ) : null}
    </Panel>
  )
}

export function SeasonPicker() {
  const season = useSeasonParam()
  const [, setSearchParams] = useSearchParams()
  const { data } = useSeasons()
  const latestYear = data?.seasons?.[0]?.season ?? String(new Date().getFullYear())
  const years = (data?.seasons ?? [])
    .map((entry) => entry.season)
    .filter((year) => year !== latestYear)
    .slice(0, 12)
  const value = season === 'current' ? 'current' : season

  const onChange = (next: string) => {
    const params = new URLSearchParams(window.location.search)
    if (next === 'current') {
      params.delete('season')
    } else {
      params.set('season', next)
    }
    setSearchParams(params, { replace: true })
  }

  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-carbon-900/80 px-2.5 py-1.5 text-xs text-white/60 transition focus-within:border-apex-red/60">
      <CalendarDays size={14} className="text-apex-red" />
      <span className="sr-only">選擇賽季</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer bg-transparent pr-1 font-mono text-xs font-medium text-white outline-none"
      >
        <option value="current" className="bg-carbon-900">
          {latestYear} · 本季
        </option>
        {years.map((year) => (
          <option key={year} value={year} className="bg-carbon-900">
            {year}
          </option>
        ))}
      </select>
    </label>
  )
}
