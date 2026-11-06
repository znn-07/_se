import {
  ArrowUpRight,
  ChevronRight,
  Trophy,
  Users,
} from 'lucide-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ConstructorStanding, DriverStanding, ResultRow } from '../../shared/types'
import { teamColor } from '../../shared/teams'
import { ProgressionChart } from '../components/charts'
import {
  DriverBadge,
  ErrorPanel,
  LoadingPanel,
  PageHeader,
  Panel,
  PositionBadge,
  SectionHeading,
  TeamDot,
  cx,
} from '../components/primitives'
import { useSeason } from '../lib/api'
import {
  buildConstructorProgression,
  buildDriverProgression,
  formatPoints,
  isDnf,
} from '../lib/analytics'
import { useSeasonLink, useSeasonParam } from '../lib/season'

type Tab = 'drivers' | 'teams'

export default function StandingsPage() {
  const seasonParam = useSeasonParam()
  const link = useSeasonLink()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'teams' ? 'teams' : 'drivers'
  const { data: season, loading, error, refetch } = useSeason(seasonParam)

  const formByDriver = useMemo(() => {
    const map = new Map<string, ResultRow[]>()
    if (!season) return map
    const recent = [...season.raceResults].sort((a, b) => a.round - b.round).slice(-5)
    for (const race of recent) {
      for (const row of race.results) {
        const rows = map.get(row.driver.id) ?? []
        rows.push(row)
        map.set(row.driver.id, rows)
      }
    }
    return map
  }, [season])

  const podiumByDriver = useMemo(() => {
    const map = new Map<string, number>()
    if (!season) return map
    for (const race of season.raceResults) {
      for (const row of race.results) {
        if (!isDnf(row) && row.position !== null && row.position <= 3) {
          map.set(row.driver.id, (map.get(row.driver.id) ?? 0) + 1)
        }
      }
    }
    return map
  }, [season])

  if (loading && !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Championship" title="積分榜" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <LoadingPanel key={index} rows={3} />
          ))}
        </div>
        <LoadingPanel rows={10} />
      </div>
    )
  }

  if (error || !season) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Championship" title="積分榜" />
        <ErrorPanel message={error ?? '無法載入積分資料'} onRetry={refetch} />
      </div>
    )
  }

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'drivers') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  const driverProgression = buildDriverProgression(season, 6)
  const constructorProgression = buildConstructorProgression(season, 5)
  const leaderPoints = season.driverStandings[0]?.points ?? 0
  const constructorLeaderPoints = season.constructorStandings[0]?.points ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${season.season} championship`}
        title="積分榜"
        description="追蹤車手與車隊錦標賽排名、積分差距、頒獎台次數與最近五站表現。"
        actions={
          <>
            <button
              type="button"
              onClick={() => setTab('drivers')}
              className={cx(
                'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition',
                tab === 'drivers'
                  ? 'border-apex-red/35 bg-apex-red/12 text-white'
                  : 'border-white/10 bg-white/[0.035] text-white/50 hover:text-white',
              )}
            >
              <Trophy size={14} />
              車手
            </button>
            <button
              type="button"
              onClick={() => setTab('teams')}
              className={cx(
                'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition',
                tab === 'teams'
                  ? 'border-apex-red/35 bg-apex-red/12 text-white'
                  : 'border-white/10 bg-white/[0.035] text-white/50 hover:text-white',
              )}
            >
              <Users size={14} />
              車隊
            </button>
          </>
        }
      />

      {tab === 'drivers' ? (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {season.driverStandings.slice(0, 3).map((entry) => (
              <DriverPodiumCard
                key={entry.driver.id}
                entry={entry}
                leaderPoints={leaderPoints}
                to={link(`/drivers/${entry.driver.id}`)}
              />
            ))}
          </section>

          <Panel className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Drivers championship"
              title="車手積分榜"
              subtitle="最近五站以顏色呈現完賽名次；R 代表退賽。"
              action={
                <span className="chip">
                  {season.driverStandings.length} DRIVERS
                </span>
              }
            />
            <div className="mt-5 overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-12">Pos</th>
                    <th>Driver</th>
                    <th>Team</th>
                    <th>Form</th>
                    <th className="text-right">Wins</th>
                    <th className="text-right">Podiums</th>
                    <th className="w-[140px] text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {season.driverStandings.map((entry) => (
                    <tr key={entry.driver.id} className="group">
                      <td>
                        <PositionBadge position={entry.position} />
                      </td>
                      <td>
                        <Link
                          to={link(`/drivers/${entry.driver.id}`)}
                          className="flex items-center gap-2.5"
                        >
                          <DriverBadge
                            driver={entry.driver}
                            constructorId={entry.constructor.id}
                            size="sm"
                          />
                          <span>
                            <span className="block font-semibold text-white/85 transition group-hover:text-white">
                              {entry.driver.fullName}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/25">
                              {entry.driver.code} · {entry.driver.nationality}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Link
                          to={link(`/teams/${entry.constructor.id}`)}
                          className="inline-flex items-center gap-1.5 text-white/45 transition hover:text-white/75"
                        >
                          <TeamDot constructor={entry.constructor} size="sm" />
                          {entry.constructor.name}
                        </Link>
                      </td>
                      <td>
                        <FormChips rows={formByDriver.get(entry.driver.id) ?? []} />
                      </td>
                      <td className="metric text-right text-white/65">{entry.wins}</td>
                      <td className="metric text-right text-white/45">
                        {podiumByDriver.get(entry.driver.id) ?? 0}
                      </td>
                      <td>
                        <PointsCell
                          points={entry.points}
                          leaderPoints={leaderPoints}
                          color={teamColor(entry.constructor.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Points trajectory"
              title="前六名積分走勢"
              subtitle="每站正賽與衝刺賽積分累計。"
            />
            <div className="mt-5">
              <ProgressionChart
                points={driverProgression.points}
                series={driverProgression.series}
                height={320}
              />
            </div>
          </Panel>
        </>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {season.constructorStandings.slice(0, 3).map((entry) => (
              <ConstructorPodiumCard
                key={entry.constructor.id}
                entry={entry}
                leaderPoints={constructorLeaderPoints}
                drivers={season.driverStandings.filter(
                  (driver) => driver.constructor.id === entry.constructor.id,
                )}
                to={link(`/teams/${entry.constructor.id}`)}
              />
            ))}
          </section>

          <Panel className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Constructors championship"
              title="車隊積分榜"
              subtitle="車隊積分由兩位車手於每站正賽與衝刺賽的總和。"
              action={<span className="chip">{season.constructorStandings.length} TEAMS</span>}
            />
            <div className="mt-5 overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th className="w-12">Pos</th>
                    <th>Team</th>
                    <th>Drivers</th>
                    <th className="text-right">Wins</th>
                    <th className="text-right">Podiums</th>
                    <th className="w-[150px] text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {season.constructorStandings.map((entry) => {
                    const driverRows = season.driverStandings.filter(
                      (driver) => driver.constructor.id === entry.constructor.id,
                    )
                    const podiums = driverRows.reduce(
                      (sum, driver) => sum + (podiumByDriver.get(driver.driver.id) ?? 0),
                      0,
                    )
                    const color = teamColor(entry.constructor.id)
                    return (
                      <tr key={entry.constructor.id} className="group">
                        <td>
                          <PositionBadge position={entry.position} />
                        </td>
                        <td>
                          <Link
                            to={link(`/teams/${entry.constructor.id}`)}
                            className="inline-flex items-center gap-2 font-semibold text-white/85 transition group-hover:text-white"
                          >
                            <span
                              className="h-5 w-1 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            {entry.constructor.name}
                          </Link>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {driverRows.map((driver) => (
                              <Link
                                key={driver.driver.id}
                                to={link(`/drivers/${driver.driver.id}`)}
                                className="inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-white/50 transition hover:text-white"
                              >
                                <span
                                  className="h-1 w-1 rounded-full"
                                  style={{ backgroundColor: color }}
                                />
                                {driver.driver.code}
                              </Link>
                            ))}
                          </div>
                        </td>
                        <td className="metric text-right text-white/65">{entry.wins}</td>
                        <td className="metric text-right text-white/45">{podiums}</td>
                        <td>
                          <PointsCell
                            points={entry.points}
                            leaderPoints={constructorLeaderPoints}
                            color={color}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <SectionHeading
              eyebrow="Constructor trajectory"
              title="前五隊積分走勢"
              subtitle="依每站正賽與衝刺賽積分累計。"
            />
            <div className="mt-5">
              <ProgressionChart
                points={constructorProgression.points}
                series={constructorProgression.series}
                height={320}
              />
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

function FormChips({ rows }: { rows: ResultRow[] }) {
  if (rows.length === 0) return <span className="text-white/20">—</span>
  return (
    <div className="flex gap-1">
      {rows.map((row) => {
        const dnf = isDnf(row)
        const podium = !dnf && row.position !== null && row.position <= 3
        return (
          <span
            key={`${row.driver.id}-${row.positionText}-${row.laps}`}
            title={row.status}
            className={cx(
              'grid h-5 min-w-5 place-items-center rounded px-1 font-mono text-[8px] font-bold',
              dnf
                ? 'bg-apex-red/15 text-apex-red-soft'
                : podium
                  ? 'bg-apex-mint/15 text-apex-mint'
                  : row.position !== null && row.position <= 10
                    ? 'bg-white/8 text-white/55'
                    : 'bg-white/[0.035] text-white/25',
            )}
          >
            {dnf ? 'R' : row.positionText}
          </span>
        )
      })}
    </div>
  )
}

function PointsCell({
  points,
  leaderPoints,
  color,
}: {
  points: number
  leaderPoints: number
  color: string
}) {
  const width = leaderPoints > 0 ? Math.max(3, (points / leaderPoints) * 100) : 0
  return (
    <div className="text-right">
      <div className="metric text-sm font-bold text-white">{formatPoints(points)}</div>
      <div className="ml-auto mt-1.5 h-1 w-full max-w-[90px] overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="ml-auto h-full rounded-full"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function DriverPodiumCard({
  entry,
  leaderPoints,
  to,
}: {
  entry: DriverStanding
  leaderPoints: number
  to: string
}) {
  const gap = leaderPoints - entry.points
  return (
    <Panel
      accent={entry.position === 1}
      className="group relative overflow-hidden p-5"
    >
      <div className="pointer-events-none absolute -right-2 -top-7 font-mono text-[92px] font-black leading-none text-white/[0.025]">
        {entry.position}
      </div>
      <div className="flex items-start justify-between">
        <PositionBadge position={entry.position} />
        <span className="chip">{entry.wins} WINS</span>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <DriverBadge
          driver={entry.driver}
          constructorId={entry.constructor.id}
          size="lg"
          showNumber
        />
        <div className="min-w-0">
          <Link
            to={to}
            className="block truncate text-lg font-black tracking-tight text-white transition hover:text-apex-red-soft"
          >
            {entry.driver.fullName}
          </Link>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/40">
            <TeamDot constructor={entry.constructor} size="sm" />
            {entry.constructor.name}
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between border-t border-white/[0.06] pt-4">
        <div>
          <div className="metric text-2xl font-bold text-white">{formatPoints(entry.points)}</div>
          <div className="font-mono text-[8px] tracking-[0.14em] text-white/25">POINTS</div>
        </div>
        <div className="text-right">
          <div className={cx('metric text-sm font-bold', gap === 0 ? 'text-apex-mint' : 'text-white/45')}>
            {gap === 0 ? 'LEADER' : `-${formatPoints(gap)}`}
          </div>
          <div className="font-mono text-[8px] tracking-[0.14em] text-white/25">GAP</div>
        </div>
        <Link
          to={to}
          className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/35 transition group-hover:bg-white/10 group-hover:text-white"
          aria-label={`查看 ${entry.driver.fullName}`}
        >
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </Panel>
  )
}

function ConstructorPodiumCard({
  entry,
  leaderPoints,
  drivers,
  to,
}: {
  entry: ConstructorStanding
  leaderPoints: number
  drivers: DriverStanding[]
  to: string
}) {
  const color = teamColor(entry.constructor.id)
  const gap = leaderPoints - entry.points
  return (
    <Panel
      accent={entry.position === 1}
      className="group relative overflow-hidden p-5"
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: color, opacity: 0.9 }}
      />
      <div className="flex items-start justify-between">
        <PositionBadge position={entry.position} />
        <span className="chip">{entry.wins} WINS</span>
      </div>
      <div className="mt-5">
        <Link
          to={to}
          className="text-xl font-black tracking-tight text-white transition hover:text-apex-red-soft"
        >
          {entry.constructor.name}
        </Link>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">
          {entry.constructor.nationality}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {drivers.map((driver) => (
          <Link
            key={driver.driver.id}
            to={to}
            className="inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[9px] text-white/50 transition hover:text-white"
          >
            <span className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
            {driver.driver.code}
            <span className="metric text-white/30">{formatPoints(driver.points)}</span>
          </Link>
        ))}
      </div>
      <div className="mt-5 flex items-end justify-between border-t border-white/[0.06] pt-4">
        <div>
          <div className="metric text-2xl font-bold text-white">{formatPoints(entry.points)}</div>
          <div className="font-mono text-[8px] tracking-[0.14em] text-white/25">POINTS</div>
        </div>
        <div className="text-right">
          <div className={cx('metric text-sm font-bold', gap === 0 ? 'text-apex-mint' : 'text-white/45')}>
            {gap === 0 ? 'LEADER' : `-${formatPoints(gap)}`}
          </div>
          <div className="font-mono text-[8px] tracking-[0.14em] text-white/25">GAP</div>
        </div>
        <Link
          to={to}
          className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/35 transition group-hover:bg-white/10 group-hover:text-white"
          aria-label={`查看 ${entry.constructor.name}`}
        >
          <ChevronRight size={14} />
        </Link>
      </div>
    </Panel>
  )
}
