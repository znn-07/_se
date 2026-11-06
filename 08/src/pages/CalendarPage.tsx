import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Flag,
  MapPin,
  Search,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RaceWeekend, ResultRow } from '../../shared/types'
import { teamColor } from '../../shared/teams'
import {
  ErrorPanel,
  LoadingPanel,
  PageHeader,
  Panel,
  StatCard,
  TeamDot,
  cx,
} from '../components/primitives'
import { useSeason } from '../lib/api'
import {
  formatDateLong,
  formatLocalDateTime,
  getNextRace,
  raceEnd,
  shortRaceName,
} from '../lib/analytics'
import { useSeasonLink, useSeasonParam } from '../lib/season'

type StatusFilter = 'all' | 'upcoming' | 'completed'

function formatMonth(date: string): string {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

export default function CalendarPage() {
  const seasonParam = useSeasonParam()
  const link = useSeasonLink()
  const { data: season, loading, error, refetch } = useSeason(seasonParam)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const now = new Date()

  const resultByRound = useMemo(
    () => new Map((season?.raceResults ?? []).map((race) => [race.round, race])),
    [season],
  )

  if (loading && !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Season calendar" title="賽季賽程" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <LoadingPanel key={index} rows={1} />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <LoadingPanel key={index} rows={3} />
          ))}
        </div>
      </div>
    )
  }

  if (error || !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Season calendar" title="賽季賽程" />
        <ErrorPanel message={error ?? '無法取得賽程資料'} onRetry={refetch} />
      </div>
    )
  }

  const nextRace = getNextRace(season.schedule, now)
  const completedRaces = season.schedule.filter(
    (race) => raceEnd(race).getTime() <= now.getTime(),
  )
  const sprintRounds = season.schedule.filter((race) => race.sessions.sprint).length
  const normalizedQuery = query.trim().toLowerCase()

  const filtered = season.schedule.filter((race) => {
    const isCompleted = raceEnd(race).getTime() <= now.getTime()
    if (filter === 'completed' && !isCompleted) return false
    if (filter === 'upcoming' && isCompleted) return false
    if (!normalizedQuery) return true
    const haystack = [
      race.raceName,
      race.circuit.name,
      race.circuit.locality,
      race.circuit.country,
      String(race.round),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })

  const grouped = new Map<string, RaceWeekend[]>()
  for (const race of filtered) {
    const month = race.date.slice(0, 7)
    const bucket = grouped.get(month) ?? []
    bucket.push(race)
    grouped.set(month, bucket)
  }

  const filters: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: 'all', label: '全部', count: season.schedule.length },
    { id: 'completed', label: '已完成', count: completedRaces.length },
    {
      id: 'upcoming',
      label: '即將登場',
      count: season.schedule.length - completedRaces.length,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${season.season} race calendar`}
        title="賽季賽程"
        description="完整分站列表、賽事狀態與各站冠軍。點擊任一賽站查看比賽結果、排位賽與進站數據。"
        actions={
          <Link
            to={link('/standings')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-white/65 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <Trophy size={14} />
            積分榜
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="賽季分站"
          value={season.schedule.length}
          unit="races"
          hint={`${season.season} 年`}
          icon={<CalendarDays size={17} />}
        />
        <StatCard
          label="已完成"
          value={completedRaces.length}
          unit="races"
          hint={`${((completedRaces.length / season.schedule.length) * 100).toFixed(0)}% 賽季進度`}
          icon={<CheckCircle2 size={17} />}
        />
        <StatCard
          label="剩餘分站"
          value={season.schedule.length - completedRaces.length}
          unit="races"
          hint={nextRace ? `下一站 ${shortRaceName(nextRace.raceName)}` : '賽季已結束'}
          icon={<Flag size={17} />}
          accent
        />
        <StatCard
          label="衝刺賽週末"
          value={sprintRounds}
          unit="weekends"
          hint="含 Sprint 與 Sprint Qualifying"
          icon={<Zap size={17} />}
        />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cx(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition',
                filter === item.id
                  ? 'border-apex-red/35 bg-apex-red/12 text-white'
                  : 'border-white/8 bg-white/[0.025] text-white/45 hover:border-white/15 hover:text-white/75',
              )}
            >
              {item.label}
              <span className="font-mono text-[9px] text-white/30">{item.count}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-carbon-900/70 px-3 py-2 text-xs text-white/45 transition focus-within:border-apex-red/50 sm:w-64">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋賽站、賽道或國家"
            className="w-full bg-transparent text-xs text-white placeholder:text-white/25 focus:outline-none"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <Panel className="grid place-items-center p-12 text-center">
          <Search size={22} className="mb-3 text-white/20" />
          <div className="text-sm font-bold text-white">找不到符合條件的賽站</div>
          <p className="mt-1 text-xs text-white/35">試著清除搜尋或切換篩選條件。</p>
        </Panel>
      ) : (
        <div className="space-y-7">
          {[...grouped.entries()].map(([month, races]) => (
            <section key={month}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-sm font-bold tracking-wide text-white/70">
                  {formatMonth(races[0].date)}
                </h2>
                <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                <span className="font-mono text-[9px] tracking-[0.16em] text-white/25">
                  {races.length} ROUNDS
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {races.map((race) => (
                  <RaceCard
                    key={race.round}
                    race={race}
                    completed={raceEnd(race).getTime() <= now.getTime()}
                    isNext={nextRace?.round === race.round}
                    winner={resultByRound.get(race.round)?.results[0] ?? null}
                    to={link(`/races/${race.round}`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Panel className="flex flex-col gap-3 p-5 text-[11px] text-white/35 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <Timer size={13} className="text-apex-red" />
          比賽時間以瀏覽器所在時區顯示，賽程日期以 UTC 標示。
        </span>
        <span className="font-mono tracking-[0.1em]">
          NEXT: {nextRace ? formatLocalDateTime(nextRace.date, nextRace.time) : 'SEASON COMPLETE'}
        </span>
      </Panel>
    </div>
  )
}

function RaceCard({
  race,
  completed,
  isNext,
  winner,
  to,
}: {
  race: RaceWeekend
  completed: boolean
  isNext: boolean
  winner: ResultRow | null
  to: string
}) {
  const winnerColor = winner ? teamColor(winner.constructor.id) : null

  return (
    <Link
      to={to}
      className={cx(
        'group relative overflow-hidden rounded-2xl border bg-carbon-900/60 p-4 transition duration-200',
        isNext
          ? 'border-apex-red/35 bg-apex-red/[0.06] shadow-[0_20px_60px_-32px_rgba(225,6,0,0.55)]'
          : 'border-white/[0.07] hover:border-white/15 hover:bg-white/[0.035]',
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: isNext
            ? 'linear-gradient(90deg, #e10600, transparent)'
            : winnerColor
              ? `linear-gradient(90deg, ${winnerColor}, transparent 75%)`
              : 'linear-gradient(90deg, rgba(255,255,255,0.12), transparent)',
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="metric text-[10px] font-bold text-white/35">
            R{String(race.round).padStart(2, '0')}
          </span>
          {race.sessions.sprint ? (
            <span className="chip border-apex-amber/20 px-2 py-0.5 text-[8px] text-apex-amber">
              <Zap size={9} />
              Sprint
            </span>
          ) : null}
        </div>
        <span
          className={cx(
            'chip px-2 py-0.5 text-[8px]',
            isNext
              ? 'border-apex-red/30 text-apex-red-soft'
              : completed
                ? 'text-white/40'
                : 'text-white/30',
          )}
        >
          {isNext ? 'Next' : completed ? 'Completed' : 'Upcoming'}
        </span>
      </div>

      <div className="mt-3 flex gap-3">
        <div className="min-w-[46px] text-center">
          <div className="metric text-2xl font-black leading-none text-white">
            {race.date.slice(8, 10)}
          </div>
          <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-white/30">
            {new Intl.DateTimeFormat('en-US', {
              month: 'short',
              timeZone: 'UTC',
            }).format(new Date(`${race.date}T00:00:00Z`))}
          </div>
        </div>
        <div className="h-12 w-px bg-white/[0.08]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold tracking-tight text-white/90 transition group-hover:text-white">
            {shortRaceName(race.raceName)}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-white/35">
            <MapPin size={10} />
            <span className="truncate">
              {race.circuit.locality}, {race.circuit.country}
            </span>
          </div>
          <div className="mt-1 text-[9px] text-white/25">
            {formatDateLong(race.date)} · {formatLocalDateTime(race.date, race.time)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        {winner ? (
          <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <TeamDot constructor={winner.constructor} size="sm" />
            <span className="truncate text-white/55">{winner.driver.fullName}</span>
            <span className="font-mono text-[8px] text-white/25">P1</span>
          </div>
        ) : (
          <span className="text-[10px] text-white/30">
            {isNext ? '下一站賽事' : completed ? '尚無結果' : '尚未開始'}
          </span>
        )}
        <ChevronRight
          size={14}
          className="shrink-0 text-white/20 transition group-hover:translate-x-0.5 group-hover:text-white/55"
        />
      </div>
    </Link>
  )
}
