import {
  ArrowLeft,
  Flag,
  Gauge,
  Medal,
  Timer,
  TrendingUp,
  Trophy,
  UserRound,
  Zap,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import type { DriverSeasonStats } from '../lib/analytics'
import { teamColor } from '../../shared/teams'
import { PointsByRoundChart, ProgressionChart } from '../components/charts'
import {
  DriverBadge,
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  PageHeader,
  Panel,
  PositionBadge,
  SectionHeading,
  StatCard,
  TeamDot,
  cx,
} from '../components/primitives'
import { useSeason } from '../lib/api'
import {
  formatPoints,
  getDriverSeasonStats,
  isDnf,
  shortRaceName,
} from '../lib/analytics'
import { useSeasonLink, useSeasonParam } from '../lib/season'

export default function DriverPage() {
  const { driverId } = useParams()
  const seasonParam = useSeasonParam()
  const link = useSeasonLink()
  const { data: season, loading, error, refetch } = useSeason(seasonParam)

  if (loading && !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Driver profile" title="車手資料" />
        <LoadingPanel rows={4} />
        <LoadingPanel rows={8} />
      </div>
    )
  }

  if (error || !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Driver profile" title="車手資料" />
        <ErrorPanel message={error ?? '無法取得車手資料'} onRetry={refetch} />
      </div>
    )
  }

  const stats = driverId ? getDriverSeasonStats(season, driverId) : null
  if (!stats) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Driver profile" title="找不到車手" />
        <EmptyPanel
          title="此賽季沒有這位車手的資料"
          description="請從積分榜選擇車手，或切換至其他賽季。"
          icon={<UserRound size={24} />}
        />
        <Link
          to={link('/standings')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-white/45 transition hover:text-white"
        >
          <ArrowLeft size={14} />
          返回積分榜
        </Link>
      </div>
    )
  }

  const color = stats.constructor ? teamColor(stats.constructor.id) : '#8b8f9a'
  const teammate = season.driverStandings.find(
    (entry) =>
      entry.constructor.id === stats.constructor?.id && entry.driver.id !== stats.driver.id,
  )
  const teammateStats = teammate ? getDriverSeasonStats(season, teammate.driver.id) : null
  const recent = [...stats.results].reverse().slice(0, 5)
  const progressionSeries = [
    {
      id: stats.driver.id,
      code: stats.driver.code,
      name: stats.driver.fullName,
      color,
      points: stats.progression.map((entry) => entry.cumulative),
    },
  ]
  const progressionPoints = stats.progression.map((entry) => ({
    round: entry.round,
    label: entry.label,
    raceName: entry.raceName,
    date: stats.results.find((result) => result.round === entry.round)?.date ?? '',
    values: { [stats.driver.id]: entry.cumulative },
  }))
  const pointsRows = stats.progression.map((entry) => ({
    label: entry.label,
    points: entry.points,
    raceName: entry.raceName,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${season.season} driver profile`}
        title={stats.driver.fullName}
        description={`${stats.driver.nationality} · ${stats.constructor?.name ?? '—'} · #${stats.driver.number ?? '—'}`}
        actions={
          <Link
            to={link('/standings')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={14} />
            返回積分榜
          </Link>
        }
      />

      <Panel className="relative overflow-hidden p-5 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background: `radial-gradient(circle at 12% 20%, ${color}24, transparent 36%), linear-gradient(120deg, ${color}12, transparent 45%)`,
          }}
        />
        <div className="pointer-events-none absolute -right-2 -top-10 font-mono text-[180px] font-black leading-none text-white/[0.03] sm:text-[240px]">
          {stats.driver.number ?? stats.driver.code}
        </div>
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-4 sm:gap-5">
            <DriverBadge
              driver={stats.driver}
              constructorId={stats.constructor?.id}
              size="xl"
              showNumber
            />
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="chip" style={{ borderColor: `${color}55`, color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                  {stats.driver.code}
                </span>
                <span className="chip">#{stats.driver.number ?? '—'}</span>
                <span className="chip">{stats.driver.nationality}</span>
              </div>
              <h1 className="text-3xl font-black leading-none tracking-[-0.04em] text-white sm:text-5xl">
                {stats.driver.fullName}
              </h1>
              {stats.constructor ? (
                <Link
                  to={link(`/teams/${stats.constructor.id}`)}
                  className="mt-3 inline-flex items-center gap-2 text-sm text-white/50 transition hover:text-white"
                >
                  <TeamDot constructor={stats.constructor} />
                  {stats.constructor.name}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[320px]">
            <HeroMetric label="排名" value={stats.position ? `P${stats.position}` : '—'} />
            <HeroMetric label="積分" value={formatPoints(stats.points)} accent />
            <HeroMetric label="分站冠軍" value={stats.wins} />
          </div>
        </div>

        <div className="relative mt-6 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/25">
            最近五站
          </span>
          {recent.length > 0 ? (
            recent.map((entry) => {
              const row = entry.race
              const dnf = row ? isDnf(row) : true
              const podium =
                row && !dnf && row.position !== null && row.position <= 3
              return (
                <span
                  key={entry.round}
                  title={shortRaceName(entry.raceName)}
                  className={cx(
                    'grid h-6 min-w-6 place-items-center rounded-md px-1.5 font-mono text-[9px] font-bold',
                    dnf
                      ? 'bg-apex-red/15 text-apex-red-soft'
                      : podium
                        ? 'bg-apex-mint/15 text-apex-mint'
                        : 'bg-white/[0.06] text-white/45',
                  )}
                >
                  {dnf ? 'R' : row?.positionText}
                </span>
              )
            })
          ) : (
            <span className="text-[10px] text-white/25">尚無完賽紀錄</span>
          )}
          {stats.sprintWins > 0 ? (
            <span className="chip ml-auto border-apex-amber/25 text-apex-amber">
              <Zap size={10} />
              {stats.sprintWins} sprint wins
            </span>
          ) : null}
        </div>
      </Panel>

      <section className="grid gap-4 grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="分站冠軍"
          value={stats.wins}
          unit="wins"
          icon={<Trophy size={16} />}
          accent={stats.wins > 0}
        />
        <StatCard
          label="頒獎台"
          value={stats.podiums}
          unit="podiums"
          icon={<Medal size={16} />}
        />
        <StatCard
          label="起跑場次"
          value={stats.starts}
          unit="starts"
          icon={<Flag size={16} />}
        />
        <StatCard
          label="最佳完賽"
          value={stats.bestFinish ? `P${stats.bestFinish}` : '—'}
          icon={<TrendingUp size={16} />}
        />
        <StatCard
          label="平均完賽"
          value={stats.avgFinish ? stats.avgFinish.toFixed(1) : '—'}
          icon={<Gauge size={16} />}
        />
        <StatCard
          label="未完賽"
          value={stats.dnfs}
          unit="dnf"
          icon={<Timer size={16} />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="p-5 xl:col-span-7 sm:p-6">
          <SectionHeading
            eyebrow="Points trajectory"
            title="積分走勢"
            subtitle="本季每站累計積分，包含衝刺賽。"
          />
          <div className="mt-5">
            <ProgressionChart
              points={progressionPoints}
              series={progressionSeries}
              height={280}
            />
          </div>
        </Panel>

        <Panel className="p-5 xl:col-span-5 sm:p-6">
          <SectionHeading
            eyebrow="Points per round"
            title="每站進帳"
            subtitle="各站正賽與衝刺賽合計積分。"
          />
          <div className="mt-5">
            <PointsByRoundChart rows={pointsRows} />
          </div>
        </Panel>
      </section>

      {teammateStats ? (
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            eyebrow="Teammate battle"
            title="隊友對決"
            subtitle="同隊兩位車手的賽季數據比較。"
          />
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <TeammateColumn stats={stats} highlight />
            <TeammateColumn stats={teammateStats} />
          </div>
          <div className="mt-5 grid gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
            <CompareRow
              label="積分"
              left={formatPoints(stats.points)}
              right={formatPoints(teammateStats.points)}
              leftLead={stats.points >= teammateStats.points}
            />
            <CompareRow
              label="分站冠軍"
              left={String(stats.wins)}
              right={String(teammateStats.wins)}
              leftLead={stats.wins >= teammateStats.wins}
            />
            <CompareRow
              label="頒獎台"
              left={String(stats.podiums)}
              right={String(teammateStats.podiums)}
              leftLead={stats.podiums >= teammateStats.podiums}
            />
            <CompareRow
              label="平均完賽"
              left={stats.avgFinish?.toFixed(1) ?? '—'}
              right={teammateStats.avgFinish?.toFixed(1) ?? '—'}
              leftLead={
                stats.avgFinish !== null &&
                teammateStats.avgFinish !== null &&
                stats.avgFinish <= teammateStats.avgFinish
              }
            />
          </div>
        </Panel>
      ) : null}

      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Race by race"
          title="賽季逐站成績"
          subtitle="點擊賽站可查看完整比賽結果、排位賽與進站數據。"
          action={<span className="chip">{stats.starts} RACES</span>}
        />
        <div className="mt-5 overflow-x-auto">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th className="w-14">Round</th>
                <th>Grand Prix</th>
                <th className="text-right">Grid</th>
                <th className="text-right">Finish</th>
                <th className="text-right">Sprint</th>
                <th className="text-right">Pts</th>
                <th>Status</th>
                <th className="text-right">Fastest lap</th>
              </tr>
            </thead>
            <tbody>
              {stats.results.map((entry) => {
                const row = entry.race
                const dnf = row ? isDnf(row) : false
                const fastest = row?.fastestLap?.time
                return (
                  <tr key={entry.round}>
                    <td className="font-mono text-[10px] text-white/35">
                      R{String(entry.round).padStart(2, '0')}
                    </td>
                    <td>
                      <Link
                        to={link(`/races/${entry.round}`)}
                        className="font-semibold text-white/80 transition hover:text-white"
                      >
                        {shortRaceName(entry.raceName)}
                      </Link>
                    </td>
                    <td className="metric text-right text-white/40">{row?.grid ?? '—'}</td>
                    <td className="text-right">
                      {row ? (
                        <PositionBadge position={dnf ? null : row.position} />
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      {entry.sprint ? (
                        <span
                          className={cx(
                            'font-mono text-[10px]',
                            isDnf(entry.sprint) ? 'text-apex-red' : 'text-white/50',
                          )}
                        >
                          {isDnf(entry.sprint) ? 'R' : entry.sprint.positionText}
                          {entry.sprint.points > 0 ? (
                            <span className="ml-1 text-apex-mint">+{entry.sprint.points}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-white/15">—</span>
                      )}
                    </td>
                    <td className="metric text-right font-bold text-white">
                      {row ? formatPoints(row.points) : '—'}
                    </td>
                    <td>
                      <span
                        className={cx(
                          'text-[10px]',
                          dnf ? 'text-apex-red-soft' : 'text-white/38',
                        )}
                      >
                        {row?.status ?? '—'}
                      </span>
                    </td>
                    <td className="metric text-right text-[10px] text-white/40">
                      {fastest ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function HeroMetric({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string | number
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-3 text-center">
      <div
        className={cx(
          'metric text-2xl font-bold',
          accent ? 'text-apex-mint' : 'text-white',
        )}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[8px] tracking-[0.14em] text-white/30">{label}</div>
    </div>
  )
}

function TeammateColumn({
  stats,
  highlight = false,
}: {
  stats: DriverSeasonStats
  highlight?: boolean
}) {
  const color = stats.constructor ? teamColor(stats.constructor.id) : '#8b8f9a'
  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-xl border p-3',
        highlight ? 'border-white/15 bg-white/[0.045]' : 'border-white/[0.06] bg-white/[0.02]',
      )}
    >
      <DriverBadge
        driver={stats.driver}
        constructorId={stats.constructor?.id}
        size="lg"
        showNumber
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white">{stats.driver.fullName}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-white/38">
          <span className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
          {stats.position ? `P${stats.position}` : '—'} · {formatPoints(stats.points)} pts
        </div>
      </div>
      <div className="text-right">
        <div className="metric text-lg font-bold text-white">{formatPoints(stats.points)}</div>
        <div className="font-mono text-[8px] tracking-[0.12em] text-white/25">PTS</div>
      </div>
    </div>
  )
}

function CompareRow({
  label,
  left,
  right,
  leftLead,
}: {
  label: string
  left: string
  right: string
  leftLead: boolean
}) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-black/15 px-3 py-2">
      <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/25">
        {label}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className={leftLead ? 'font-bold text-white' : 'text-white/40'}>{left}</span>
        <span className="h-3 w-px bg-white/10" />
        <span className={!leftLead ? 'font-bold text-white' : 'text-white/40'}>{right}</span>
      </div>
    </div>
  )
}
