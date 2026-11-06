import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Gauge,
  MapPin,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ResultRow } from '../../shared/types'
import { teamColor } from '../../shared/teams'
import { FastestLapChart, PitStopChart } from '../components/charts'
import Countdown from '../components/Countdown'
import {
  DriverBadge,
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
import { useRace, useSeason } from '../lib/api'
import {
  formatDateLong,
  formatLocalDateTime,
  formatPoints,
  getFastestLapRanking,
  getPodium,
  isDnf,
  parseLapTime,
  raceEnd,
  raceStart,
  resultGap,
} from '../lib/analytics'
import { useSeasonLink, useSeasonParam } from '../lib/season'

type RaceTab = 'race' | 'qualifying' | 'sprint' | 'pitstops'

function sessionSlot(
  date: string,
  time?: string,
): { date: string; time?: string } {
  return { date, time }
}

function gapToPole(time: string | null, poleSeconds: number | null): string {
  if (!time || poleSeconds === null) return '—'
  const seconds = parseLapTime(time)
  if (seconds === null) return '—'
  const delta = seconds - poleSeconds
  if (delta <= 0.0001) return 'POLE'
  return `+${delta.toFixed(3)}`
}

export default function RacePage() {
  const { round } = useParams()
  const seasonParam = useSeasonParam()
  const link = useSeasonLink()
  const { data, loading, error, refetch } = useRace(seasonParam, round)
  const { data: season } = useSeason(seasonParam)
  const [tab, setTab] = useState<RaceTab>('race')
  const now = new Date()

  const driverMeta = useMemo(() => {
    const map = new Map<string, { constructorId: string; constructorName: string }>()
    if (!data) return map
    for (const row of [...data.results, ...data.sprintResults, ...data.qualifying]) {
      map.set(row.driver.id, {
        constructorId: row.constructor.id,
        constructorName: row.constructor.name,
      })
    }
    return map
  }, [data])

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Race detail" title="比賽資訊" />
        <LoadingPanel rows={5} />
        <LoadingPanel rows={10} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Race detail" title="比賽資訊" />
        <ErrorPanel message={error ?? '無法載入比賽資訊'} onRetry={refetch} />
        <Link
          to={link('/calendar')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-white/45 transition hover:text-white"
        >
          <ArrowLeft size={14} />
          返回賽程
        </Link>
      </div>
    )
  }

  const { race, results, qualifying, pitStops, sprintResults } = data
  const start = raceStart(race)
  const completed = results.length > 0
  const isLive =
    !completed && start.getTime() <= now.getTime() && raceEnd(race).getTime() >= now.getTime()
  const podium = getPodium(results)
  const winner = podium[0] ?? null
  const fastestRanking = getFastestLapRanking(results, 8)
  const fastest = fastestRanking[0] ?? null
  const pole = qualifying[0] ?? null
  const fastestPit = [...pitStops].sort((a, b) => a.duration - b.duration)[0] ?? null
  const heroColor = winner ? teamColor(winner.constructor.id) : '#e10600'

  const raceIndex = season?.schedule.findIndex((item) => item.round === race.round) ?? -1
  const previousRace = raceIndex > 0 ? season?.schedule[raceIndex - 1] : null
  const nextRace =
    raceIndex >= 0 && season && raceIndex < season.schedule.length - 1
      ? season.schedule[raceIndex + 1]
      : null

  const pitStopRows = [...pitStops]
    .sort((a, b) => a.duration - b.duration)
    .slice(0, 10)
    .map((stop) => ({
      driverId: stop.driverId,
      constructorId: driverMeta.get(stop.driverId)?.constructorId ?? 'unknown',
      code: stop.driver?.code ?? stop.driverId.slice(0, 3).toUpperCase(),
      name: stop.driver?.fullName ?? stop.driverId,
      seconds: stop.duration,
    }))

  const sessionItems = [
    { label: 'First Practice', short: 'FP1', slot: race.sessions.firstPractice },
    { label: 'Second Practice', short: 'FP2', slot: race.sessions.secondPractice },
    { label: 'Third Practice', short: 'FP3', slot: race.sessions.thirdPractice },
    {
      label: 'Sprint Qualifying',
      short: 'SQ',
      slot: race.sessions.sprintQualifying,
    },
    { label: 'Sprint', short: 'SPRINT', slot: race.sessions.sprint },
    { label: 'Qualifying', short: 'QUALI', slot: race.sessions.qualifying },
    { label: 'Grand Prix', short: 'RACE', slot: sessionSlot(race.date, race.time) },
  ].filter((item) => item.slot) as Array<{
    label: string
    short: string
    slot: { date: string; time?: string }
  }>

  const tabs: Array<{ id: RaceTab; label: string; count?: number; show: boolean }> = [
    { id: 'race', label: '比賽結果', count: results.length, show: completed },
    {
      id: 'qualifying',
      label: '排位賽',
      count: qualifying.length,
      show: qualifying.length > 0,
    },
    {
      id: 'sprint',
      label: '衝刺賽',
      count: sprintResults.length,
      show: sprintResults.length > 0,
    },
    {
      id: 'pitstops',
      label: '進站紀錄',
      count: pitStops.length,
      show: pitStops.length > 0,
    },
  ]
  const availableTabs = tabs.filter((item) => item.show)
  const activeTab = availableTabs.some((item) => item.id === tab) ? tab : 'race'

  const poleSeconds = pole
    ? (parseLapTime(pole.q3) ?? parseLapTime(pole.q2) ?? parseLapTime(pole.q1))
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${data.season} · Round ${race.round}`}
        title={race.raceName}
        description={`${race.circuit.name} · ${race.circuit.locality}, ${race.circuit.country}`}
        actions={
          <>
            <Link
              to={link('/calendar')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:text-white"
            >
              <ArrowLeft size={14} />
              賽程
            </Link>
            <div className="flex items-center gap-1">
              {previousRace ? (
                <Link
                  to={link(`/races/${previousRace.round}`)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/40 transition hover:text-white"
                  aria-label="上一站"
                >
                  <ChevronLeft size={15} />
                </Link>
              ) : null}
              {nextRace ? (
                <Link
                  to={link(`/races/${nextRace.round}`)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/40 transition hover:text-white"
                  aria-label="下一站"
                >
                  <ChevronRight size={15} />
                </Link>
              ) : null}
            </div>
          </>
        }
      />

      <Panel className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: `radial-gradient(circle at 10% 10%, ${heroColor}22, transparent 36%), linear-gradient(120deg, ${heroColor}0f, transparent 48%)`,
          }}
        />
        <div className="pointer-events-none absolute -right-3 -top-12 font-mono text-[170px] font-black leading-none text-white/[0.028] sm:text-[220px]">
          {String(race.round).padStart(2, '0')}
        </div>
        <div className="relative p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                'chip',
                completed
                  ? 'border-apex-mint/25 text-apex-mint'
                  : isLive
                    ? 'border-apex-red/35 text-apex-red-soft'
                    : 'border-white/15 text-white/55',
              )}
            >
              {completed ? (
                <Flag size={11} />
              ) : isLive ? (
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-apex-red-soft" />
              ) : (
                <Clock size={11} />
              )}
              {completed ? 'Completed' : isLive ? 'In progress' : 'Upcoming'}
            </span>
            <span className="chip">
              <CalendarDays size={11} />
              {formatDateLong(race.date)}
            </span>
            <span className="chip">
              <MapPin size={11} />
              {race.circuit.country}
            </span>
            {race.sessions.sprint ? (
              <span className="chip border-apex-amber/25 text-apex-amber">
                <Zap size={11} />
                Sprint weekend
              </span>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="max-w-4xl text-3xl font-black leading-[0.96] tracking-[-0.04em] text-white sm:text-5xl">
                {race.raceName}
              </h1>
              <div className="mt-3 text-sm text-white/45">
                {race.circuit.name}
                <span className="mx-2 text-white/15">/</span>
                {formatLocalDateTime(race.date, race.time)} 當地時間
              </div>
              {completed && winner ? (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <DriverBadge
                      driver={winner.driver}
                      constructorId={winner.constructor.id}
                      size="md"
                      showNumber
                    />
                    <div>
                      <div className="text-sm font-bold text-white">
                        {winner.driver.fullName}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
                        <TeamDot constructor={winner.constructor} size="sm" />
                        {winner.constructor.name}
                      </div>
                    </div>
                    <span className="ml-2 rounded-lg bg-apex-mint/10 px-2 py-1 font-mono text-[9px] font-bold text-apex-mint">
                      WINNER
                    </span>
                  </div>
                  {fastest ? (
                    <div className="flex items-center gap-2 text-[11px] text-white/38">
                      <Timer size={13} className="text-apex-mint" />
                      最快單圈
                      <span className="font-semibold text-white/70">
                        {fastest.driver.code}
                      </span>
                      <span className="metric text-apex-mint">{fastest.time}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="shrink-0">
              {!completed ? <Countdown target={start} /> : null}
              {isLive ? (
                <div className="mt-2 text-center text-[10px] text-apex-red-soft">
                  賽事進行中，結果將於賽後更新
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      {completed ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="分站冠軍"
              value={winner?.driver.code ?? '—'}
              hint={winner?.constructor.name ?? '—'}
              icon={<Trophy size={16} />}
              accent
            />
            <StatCard
              label="最快單圈"
              value={fastest?.time ?? '—'}
              hint={fastest?.driver.fullName ?? '—'}
              icon={<Timer size={16} />}
            />
            <StatCard
              label="桿位"
              value={pole?.driver.code ?? '—'}
              hint={pole?.constructor.name ?? '—'}
              icon={<Gauge size={16} />}
            />
            <StatCard
              label="最快進站"
              value={fastestPit ? `${fastestPit.duration.toFixed(1)}s` : '—'}
              hint={fastestPit?.driver?.fullName ?? '—'}
              icon={<Clock size={16} />}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {podium.map((row) => (
              <PodiumCard key={row.driver.id} row={row} to={link(`/drivers/${row.driver.id}`)} />
            ))}
          </section>

          <div className="flex flex-wrap gap-1.5">
            {availableTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cx(
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition',
                  activeTab === item.id
                    ? 'border-apex-red/35 bg-apex-red/12 text-white'
                    : 'border-white/8 bg-white/[0.025] text-white/45 hover:border-white/15 hover:text-white/75',
                )}
              >
                {item.label}
                <span className="font-mono text-[9px] text-white/30">{item.count}</span>
              </button>
            ))}
          </div>

          {activeTab === 'race' ? (
            <Panel className="p-5 sm:p-6">
              <SectionHeading
                eyebrow="Race classification"
                title="比賽結果"
                subtitle={`${results.length} 位車手 · ${formatDateLong(race.date)}`}
              />
              <ResultsTable rows={results} link={link} showLaps />
            </Panel>
          ) : null}

          {activeTab === 'qualifying' ? (
            <Panel className="p-5 sm:p-6">
              <SectionHeading
                eyebrow="Qualifying"
                title="排位賽結果"
                subtitle="Q1 / Q2 / Q3 最佳單圈與桿位差距"
              />
              <div className="mt-5 overflow-x-auto">
                <table className="data-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-12">Pos</th>
                      <th>Driver</th>
                      <th>Team</th>
                      <th className="text-right">Q1</th>
                      <th className="text-right">Q2</th>
                      <th className="text-right">Q3</th>
                      <th className="text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualifying.map((row) => {
                      const best =
                        parseLapTime(row.q3) ??
                        parseLapTime(row.q2) ??
                        parseLapTime(row.q1)
                      return (
                        <tr key={row.driver.id}>
                          <td>
                            <PositionBadge position={row.position} />
                          </td>
                          <td>
                            <Link
                              to={link(`/drivers/${row.driver.id}`)}
                              className="flex items-center gap-2 font-semibold text-white/82 transition hover:text-white"
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: teamColor(row.constructor.id) }}
                              />
                              {row.driver.fullName}
                              <span className="font-mono text-[9px] text-white/25">
                                {row.driver.code}
                              </span>
                            </Link>
                          </td>
                          <td className="text-white/40">{row.constructor.name}</td>
                          <td className="metric text-right text-white/45">{row.q1 ?? '—'}</td>
                          <td className="metric text-right text-white/45">{row.q2 ?? '—'}</td>
                          <td className="metric text-right font-bold text-white">
                            {row.q3 ?? '—'}
                          </td>
                          <td
                            className={cx(
                              'metric text-right text-[11px]',
                              best !== null && poleSeconds !== null && best <= poleSeconds + 0.0001
                                ? 'font-bold text-apex-mint'
                                : 'text-white/35',
                            )}
                          >
                            {gapToPole(
                              row.q3 ?? row.q2 ?? row.q1,
                              poleSeconds,
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          {activeTab === 'sprint' ? (
            <Panel className="p-5 sm:p-6">
              <SectionHeading
                eyebrow="Sprint classification"
                title="衝刺賽結果"
                subtitle="衝刺賽前八名依序 8-7-6-5-4-3-2-1 計分"
              />
              <ResultsTable rows={sprintResults} link={link} />
            </Panel>
          ) : null}

          {activeTab === 'pitstops' ? (
            <Panel className="p-5 sm:p-6">
              <SectionHeading
                eyebrow="Pit stop data"
                title="進站紀錄"
                subtitle="依進站時間排序，包含所有車手的進站紀錄"
              />
              <div className="mt-5 overflow-x-auto">
                <table className="data-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th className="w-12">#</th>
                      <th>Driver</th>
                      <th>Team</th>
                      <th className="text-right">Lap</th>
                      <th className="text-right">Stop</th>
                      <th className="text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pitStops]
                      .sort((a, b) => a.duration - b.duration)
                      .map((stop, index) => {
                        const meta = driverMeta.get(stop.driverId)
                        const constructorId = meta?.constructorId ?? 'unknown'
                        return (
                          <tr key={`${stop.driverId}-${stop.lap}-${stop.stop}`}>
                            <td>
                              <span
                                className={cx(
                                  'rank-badge',
                                  index < 3 && 'rank-podium',
                                )}
                              >
                                {index + 1}
                              </span>
                            </td>
                            <td>
                              {stop.driver ? (
                                <Link
                                  to={link(`/drivers/${stop.driver.id}`)}
                                  className="font-semibold text-white/82 transition hover:text-white"
                                >
                                  {stop.driver.fullName}
                                </Link>
                              ) : (
                                <span className="text-white/60">{stop.driverId}</span>
                              )}
                            </td>
                            <td className="text-white/40">
                              {stop.driver ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <TeamDot constructor={constructorId} size="sm" />
                                  {meta?.constructorName ?? '—'}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="metric text-right text-white/45">{stop.lap}</td>
                            <td className="metric text-right text-white/45">{stop.stop}</td>
                            <td className="metric text-right font-bold text-white">
                              {stop.duration.toFixed(3)}s
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-2">
            <Panel className="p-5 sm:p-6">
              <SectionHeading
                eyebrow="Fastest laps"
                title="最快單圈排行"
                subtitle="前八名車手最佳單圈"
              />
              <div className="mt-4">
                <FastestLapChart
                  rows={fastestRanking.map((row) => ({
                    code: row.driver.code,
                    name: row.driver.fullName,
                    time: row.time,
                    seconds: row.seconds,
                    color: teamColor(row.constructor.id),
                  }))}
                />
              </div>
            </Panel>

            <Panel className="p-5 sm:p-6">
              <SectionHeading
                eyebrow="Pit stops"
                title="最快進站"
                subtitle="本站前十名最快進站紀錄"
              />
              <div className="mt-4">
                <PitStopChart rows={pitStopRows} />
              </div>
            </Panel>
          </section>
        </>
      ) : (
        <section className="grid gap-4 lg:grid-cols-12">
          <Panel className="p-5 lg:col-span-7 sm:p-6">
            <SectionHeading
              eyebrow="Session schedule"
              title="賽事週末時間表"
              subtitle="所有練習賽、排位賽與正賽時間，顯示為當地時間"
            />
            <div className="mt-5 space-y-2">
              {sessionItems.map((item) => {
                const time = new Date(`${item.slot.date}T${item.slot.time ?? '00:00:00Z'}`)
                const done = time.getTime() < now.getTime()
                const isRace = item.short === 'RACE'
                return (
                  <div
                    key={item.short}
                    className={cx(
                      'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                      isRace
                        ? 'border-apex-red/25 bg-apex-red/[0.06]'
                        : 'border-white/[0.06] bg-white/[0.02]',
                    )}
                  >
                    <span
                      className={cx(
                        'w-16 shrink-0 font-mono text-[9px] tracking-[0.1em]',
                        isRace ? 'text-apex-red-soft' : 'text-white/35',
                      )}
                    >
                      {item.short}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white/70">
                      {item.label}
                    </span>
                    <span className="metric text-[11px] text-white/45">
                      {formatLocalDateTime(item.slot.date, item.slot.time)}
                    </span>
                    <span
                      className={cx(
                        'rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em]',
                        done
                          ? 'bg-white/[0.06] text-white/30'
                          : isRace
                            ? 'bg-apex-red/15 text-apex-red-soft'
                            : 'bg-white/[0.04] text-white/35',
                      )}
                    >
                      {done ? 'Done' : 'Soon'}
                    </span>
                  </div>
                )
              })}
            </div>
          </Panel>
          <Panel className="p-5 lg:col-span-5 sm:p-6">
            <SectionHeading eyebrow="Countdown" title="下一站" />
            <div className="mt-5">
              <Countdown target={start} />
            </div>
            <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/15 p-4 text-xs leading-relaxed text-white/38">
              比賽結果、排位賽與進站資料會在賽事結束後自動更新。資料來自 Cloudflare
              邊緣快取，通常數秒內即可取得。
            </div>
          </Panel>
        </section>
      )}

      {completed && sessionItems.length > 0 ? (
        <Panel className="p-5 sm:p-6">
          <SectionHeading
            eyebrow="Session schedule"
            title="賽事週末時間表"
            subtitle="練習賽、排位賽與正賽時間"
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {sessionItems.map((item) => (
              <div
                key={item.short}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <div className="font-mono text-[9px] tracking-[0.12em] text-white/30">
                  {item.short}
                </div>
                <div className="mt-1 text-xs font-semibold text-white/65">{item.label}</div>
                <div className="metric mt-1 text-[10px] text-white/40">
                  {formatLocalDateTime(item.slot.date, item.slot.time)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

function PodiumCard({ row, to }: { row: ResultRow; to: string }) {
  const color = teamColor(row.constructor.id)
  return (
    <Panel
      accent={row.position === 1}
      className="group relative overflow-hidden p-5"
    >
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start justify-between">
        <PositionBadge position={row.position} />
        <span className="chip">{row.position === 1 ? 'WINNER' : `P${row.position}`}</span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <DriverBadge
          driver={row.driver}
          constructorId={row.constructor.id}
          size="lg"
          showNumber
        />
        <div className="min-w-0">
          <Link
            to={to}
            className="block truncate text-base font-black tracking-tight text-white transition hover:text-apex-red-soft"
          >
            {row.driver.fullName}
          </Link>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/40">
            <TeamDot constructor={row.constructor} size="sm" />
            {row.constructor.name}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="metric truncate text-[11px] text-white/40">
          {resultGap(row)}
        </span>
        <span className="metric text-sm font-bold text-white">
          +{formatPoints(row.points)} pts
        </span>
      </div>
    </Panel>
  )
}

function ResultsTable({
  rows,
  link,
  showLaps = false,
}: {
  rows: ResultRow[]
  link: (path: string) => string
  showLaps?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-white/10 p-10 text-center text-xs text-white/30">
        尚無比賽結果
      </div>
    )
  }
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="data-table min-w-[820px]">
        <thead>
          <tr>
            <th className="w-12">Pos</th>
            <th>Driver</th>
            <th>Team</th>
            <th className="text-right">Grid</th>
            {showLaps ? <th className="text-right">Laps</th> : null}
            <th className="text-right">Time / Gap</th>
            <th className="text-right">Pts</th>
            <th>Fastest lap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.driver.id}>
              <td>
                <PositionBadge position={isDnf(row) ? null : row.position} />
              </td>
              <td>
                <Link
                  to={link(`/drivers/${row.driver.id}`)}
                  className="flex items-center gap-2.5 font-semibold text-white/85 transition hover:text-white"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: teamColor(row.constructor.id) }}
                  />
                  {row.driver.fullName}
                  <span className="font-mono text-[9px] text-white/25">
                    {row.driver.code}
                  </span>
                </Link>
              </td>
              <td className="text-white/42">{row.constructor.name}</td>
              <td className="metric text-right text-white/45">{row.grid ?? '—'}</td>
              {showLaps ? (
                <td className="metric text-right text-white/45">{row.laps}</td>
              ) : null}
              <td
                className={cx(
                  'metric max-w-[160px] truncate text-right text-[11px]',
                  isDnf(row) ? 'text-apex-red-soft' : 'text-white/50',
                )}
              >
                {resultGap(row)}
              </td>
              <td className="metric text-right font-bold text-white">
                {row.points > 0 ? formatPoints(row.points) : '—'}
              </td>
              <td className="metric text-right text-[10px] text-white/35">
                {row.fastestLap?.time ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
