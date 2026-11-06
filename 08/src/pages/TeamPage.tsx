import {
  ArrowLeft,
  ChevronRight,
  Flag,
  Gauge,
  Medal,
  Trophy,
  Users,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
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
  buildConstructorProgression,
  formatPoints,
  getConstructorSeasonStats,
  isDnf,
  shortRaceName,
} from '../lib/analytics'
import { useSeasonLink, useSeasonParam } from '../lib/season'

export default function TeamPage() {
  const { constructorId } = useParams()
  const seasonParam = useSeasonParam()
  const link = useSeasonLink()
  const { data: season, loading, error, refetch } = useSeason(seasonParam)

  if (loading && !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Constructor profile" title="車隊資料" />
        <LoadingPanel rows={4} />
        <LoadingPanel rows={8} />
      </div>
    )
  }

  if (error || !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Constructor profile" title="車隊資料" />
        <ErrorPanel message={error ?? '無法取得車隊資料'} onRetry={refetch} />
      </div>
    )
  }

  const stats = constructorId ? getConstructorSeasonStats(season, constructorId) : null
  if (!stats) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Constructor profile" title="找不到車隊" />
        <EmptyPanel
          title="此賽季沒有這支車隊的資料"
          description="請從積分榜選擇車隊，或切換至其他賽季。"
          icon={<Users size={24} />}
        />
        <Link
          to={link('/standings?tab=teams')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-white/45 transition hover:text-white"
        >
          <ArrowLeft size={14} />
          返回車隊積分榜
        </Link>
      </div>
    )
  }

  const color = teamColor(stats.constructor.id)
  const driverStats = stats.drivers
    .map((entry) => ({
      standing: entry,
      podiums: season.raceResults
        .flatMap((race) => race.results)
        .filter(
          (row) =>
            row.driver.id === entry.driver.id &&
            !isDnf(row) &&
            row.position !== null &&
            row.position <= 3,
        ).length,
    }))
    .sort((a, b) => a.standing.position - b.standing.position)

  const allConstructors = buildConstructorProgression(
    season,
    season.constructorStandings.length,
  )
  const series = allConstructors.series.filter((entry) => entry.id === stats.constructor.id)
  const pointsRows = allConstructors.points.map((point) => ({
    label: point.label,
    points: point.values[stats.constructor.id] ?? 0,
    raceName: point.raceName,
  }))
  const cumulativePoints = allConstructors.points.map((point) => ({
    ...point,
    values: { [stats.constructor.id]: point.values[stats.constructor.id] ?? 0 },
  }))
  const constructorPointsLeader = season.constructorStandings[0]?.points ?? 0

  const teamRaces = season.raceResults
    .map((race) => {
      const rows = race.results.filter(
        (row) => row.constructor.id === stats.constructor.id,
      )
      const sprintRows = season.sprintResults
        .find((sprint) => sprint.round === race.round)
        ?.results.filter((row) => row.constructor.id === stats.constructor.id)
      return {
        round: race.round,
        raceName: race.raceName,
        rows,
        sprintRows: sprintRows ?? [],
        points:
          rows.reduce((sum, row) => sum + row.points, 0) +
          (sprintRows ?? []).reduce((sum, row) => sum + row.points, 0),
      }
    })
    .filter((race) => race.rows.length > 0)

  const allRows = season.raceResults
    .flatMap((race) => race.results)
    .filter((row) => row.constructor.id === stats.constructor.id && !isDnf(row))
  const avgFinish =
    allRows.length > 0
      ? allRows.reduce((sum, row) => sum + (row.position ?? 0), 0) / allRows.length
      : null
  const gap = constructorPointsLeader - stats.points

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${season.season} constructor profile`}
        title={stats.constructor.name}
        description={`${stats.constructor.nationality} · ${stats.drivers.length} drivers · ${formatPoints(stats.points)} points`}
        actions={
          <Link
            to={link('/standings?tab=teams')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={14} />
            返回車隊積分榜
          </Link>
        }
      />

      <Panel className="relative overflow-hidden p-5 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: `radial-gradient(circle at 15% 15%, ${color}26, transparent 38%), linear-gradient(120deg, ${color}12, transparent 50%)`,
          }}
        />
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ backgroundColor: color }}
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="chip" style={{ borderColor: `${color}55`, color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                TEAM
              </span>
              <span className="chip">{stats.constructor.nationality}</span>
              {gap === 0 ? (
                <span className="chip border-apex-mint/25 text-apex-mint">CHAMPIONSHIP LEADER</span>
              ) : (
                <span className="chip">-{formatPoints(gap)} PTS</span>
              )}
            </div>
            <h1 className="text-3xl font-black leading-none tracking-[-0.04em] text-white sm:text-5xl">
              {stats.constructor.name}
            </h1>
            <div className="mt-3 flex items-center gap-2 text-sm text-white/45">
              <TeamDot constructor={stats.constructor} />
              {stats.drivers.map((entry) => entry.driver.fullName).join(' / ')}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[320px]">
            <HeroMetric label="排名" value={stats.position ? `P${stats.position}` : '—'} />
            <HeroMetric label="積分" value={formatPoints(stats.points)} accent />
            <HeroMetric label="分站冠軍" value={stats.wins} />
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="車隊排名"
          value={stats.position ? `P${stats.position}` : '—'}
          icon={<Trophy size={16} />}
          accent={stats.position === 1}
        />
        <StatCard label="積分" value={formatPoints(stats.points)} unit="pts" icon={<Gauge size={16} />} />
        <StatCard label="分站冠軍" value={stats.wins} unit="wins" icon={<Flag size={16} />} />
        <StatCard label="頒獎台" value={stats.podiums} unit="podiums" icon={<Medal size={16} />} />
        <StatCard
          label="平均完賽"
          value={avgFinish ? avgFinish.toFixed(1) : '—'}
          icon={<Users size={16} />}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {driverStats.map(({ standing, podiums }) => (
          <Panel key={standing.driver.id} className="group p-5">
            <div className="flex items-center gap-3.5">
              <DriverBadge
                driver={standing.driver}
                constructorId={stats.constructor.id}
                size="lg"
                showNumber
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={link(`/drivers/${standing.driver.id}`)}
                  className="block truncate text-lg font-black tracking-tight text-white transition hover:text-apex-red-soft"
                >
                  {standing.driver.fullName}
                </Link>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">
                  #{standing.driver.number ?? '—'} · {standing.driver.nationality}
                </div>
              </div>
              <Link
                to={link(`/drivers/${standing.driver.id}`)}
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/35 transition group-hover:bg-white/10 group-hover:text-white"
                aria-label={`查看 ${standing.driver.fullName}`}
              >
                <ChevronRight size={14} />
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-4 divide-x divide-white/[0.07] rounded-xl border border-white/[0.07] bg-black/20 py-2.5 text-center">
              <MiniStat label="POS" value={standing.position ? `P${standing.position}` : '—'} />
              <MiniStat label="PTS" value={formatPoints(standing.points)} />
              <MiniStat label="WINS" value={standing.wins} />
              <MiniStat label="PODIUMS" value={podiums} />
            </div>
          </Panel>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="p-5 xl:col-span-7 sm:p-6">
          <SectionHeading
            eyebrow="Constructor trajectory"
            title="車隊積分走勢"
            subtitle="本季每站累計積分，包含衝刺賽。"
          />
          <div className="mt-5">
            <ProgressionChart
              points={cumulativePoints}
              series={series}
              height={280}
            />
          </div>
        </Panel>

        <Panel className="p-5 xl:col-span-5 sm:p-6">
          <SectionHeading
            eyebrow="Points per round"
            title="每站進帳"
            subtitle="兩位車手於正賽與衝刺賽合計。"
          />
          <div className="mt-5">
            <PointsByRoundChart rows={pointsRows} />
          </div>
        </Panel>
      </section>

      <Panel className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Race by race"
          title="車隊逐站成績"
          subtitle="每位車手的名次與該站車隊總積分。"
          action={<span className="chip">{teamRaces.length} RACES</span>}
        />
        <div className="mt-5 overflow-x-auto">
          <table className="data-table min-w-[660px]">
            <thead>
              <tr>
                <th className="w-14">Round</th>
                <th>Grand Prix</th>
                <th>Drivers</th>
                <th className="text-right">Sprint</th>
                <th className="text-right">Pts</th>
              </tr>
            </thead>
            <tbody>
              {teamRaces.map((race) => (
                <tr key={race.round}>
                  <td className="font-mono text-[10px] text-white/35">
                    R{String(race.round).padStart(2, '0')}
                  </td>
                  <td>
                    <Link
                      to={link(`/races/${race.round}`)}
                      className="font-semibold text-white/80 transition hover:text-white"
                    >
                      {shortRaceName(race.raceName)}
                    </Link>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {race.rows.map((row) => (
                        <span
                          key={row.driver.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[9px]"
                        >
                          <span
                            className="h-1 w-1 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-mono text-white/40">{row.driver.code}</span>
                          <PositionBadge position={isDnf(row) ? null : row.position} />
                          <span className="metric text-white/35">+{row.points}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-right">
                    {race.sprintRows.length > 0 ? (
                      <span className="font-mono text-[10px] text-white/45">
                        {race.sprintRows
                          .map((row) => `${row.driver.code} ${isDnf(row) ? 'R' : row.positionText}`)
                          .join(' · ')}
                      </span>
                    ) : (
                      <span className="text-white/15">—</span>
                    )}
                  </td>
                  <td className="metric text-right font-bold text-white">
                    {formatPoints(race.points)}
                  </td>
                </tr>
              ))}
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

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="metric text-sm font-bold text-white">{value}</div>
      <div className="mt-0.5 font-mono text-[7px] tracking-[0.14em] text-white/25">{label}</div>
    </div>
  )
}
