import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Crown,
  Flag,
  Gauge,
  MapPin,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { teamColor } from '../../shared/teams'
import { ProgressionChart } from '../components/charts'
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
import { useSeason } from '../lib/api'
import {
  buildDriverProgression,
  formatDateLong,
  formatLocalDateTime,
  formatPoints,
  getFastestLapRanking,
  getLastCompletedRace,
  getNextRace,
  getPodium,
  getUpcomingRaces,
  raceStart,
  resultGap,
  seasonSummary,
  shortRaceName,
} from '../lib/analytics'
import { useSeasonLink, useSeasonParam } from '../lib/season'

function SeasonRing({ progress }: { progress: number }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, progress)) / 100) * circumference
  return (
    <div className="relative grid h-[76px] w-[76px] place-items-center">
      <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90">
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="5"
        />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke="#e10600"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="text-center">
        <div className="metric text-sm font-bold text-white">{Math.round(progress)}%</div>
        <div className="font-mono text-[7px] tracking-[0.14em] text-white/35">SEASON</div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const seasonParam = useSeasonParam()
  const link = useSeasonLink()
  const { data: season, loading, error, refetch } = useSeason(seasonParam)
  const now = new Date()

  if (loading && !season) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Season overview"
          title="賽季戰況總覽"
          description="正在同步 Formula 1 賽季資料、積分與比賽結果。"
        />
        <div className="grid gap-4 xl:grid-cols-12">
          <LoadingPanel className="xl:col-span-8" rows={5} />
          <LoadingPanel className="xl:col-span-4" rows={5} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <LoadingPanel key={index} rows={1} />
          ))}
        </div>
      </div>
    )
  }

  if (error || !season) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Season overview"
          title="賽季戰況總覽"
          description="Formula 1 賽季資料、積分走勢與比賽結果。"
        />
        <ErrorPanel message={error ?? '無法取得賽季資料'} onRetry={refetch} />
      </div>
    )
  }

  const summary = seasonSummary(season, now)
  const nextRace = getNextRace(season.schedule, now)
  const lastRace = getLastCompletedRace(season.schedule, now)
  const lastResultSet = lastRace
    ? season.raceResults.find((race) => race.round === lastRace.round)
    : season.raceResults[season.raceResults.length - 1]
  const latestResults = lastResultSet?.results ?? []
  const podium = getPodium(latestResults)
  const leader = season.driverStandings[0]
  const second = season.driverStandings[1]
  const constructorLeader = season.constructorStandings[0]
  const progression = buildDriverProgression(season, 6)
  const upcoming = getUpcomingRaces(season.schedule, now, 3)
  const fastestLap = getFastestLapRanking(latestResults, 1)[0]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${season.season} SEASON · ROUND ${summary.completedRaces}/${summary.totalRaces}`}
        title="賽季戰況總覽"
        description="即時追蹤車手與車隊積分、下一站倒數、最新比賽結果，以及整季積分走勢。"
        actions={
          <>
            <Link
              to={link('/calendar')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs font-semibold text-white/65 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <CalendarDays size={14} />
              完整賽程
            </Link>
            <Link
              to={link('/standings')}
              className="inline-flex items-center gap-2 rounded-xl bg-apex-red px-3.5 py-2 text-xs font-semibold text-white shadow-[0_12px_40px_-18px_rgba(225,6,0,0.9)] transition hover:bg-apex-red-soft"
            >
              <Trophy size={14} />
              積分榜
            </Link>
          </>
        }
      />

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel accent className="relative overflow-hidden xl:col-span-8">
          {nextRace ? (
            <>
              <div className="pointer-events-none absolute -right-4 -top-12 select-none font-mono text-[150px] font-black leading-none text-white/[0.026] sm:text-[210px]">
                {String(nextRace.round).padStart(2, '0')}
              </div>
              <div className="relative p-5 sm:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip border-apex-red/30 bg-apex-red/10 text-apex-red-soft">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-apex-red-soft" />
                    Next Race
                  </span>
                  <span className="chip">Round {nextRace.round}</span>
                  <span className="chip">
                    <MapPin size={11} />
                    {nextRace.circuit.country}
                  </span>
                  {nextRace.sessions.sprint ? (
                    <span className="chip border-apex-amber/25 text-apex-amber">
                      <Zap size={11} />
                      Sprint
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-5 max-w-2xl text-3xl font-black leading-[0.96] tracking-[-0.04em] text-white sm:text-5xl">
                  {nextRace.raceName}
                </h2>
                <div className="mt-2 text-sm text-white/45">
                  {nextRace.circuit.name}
                  <span className="mx-2 text-white/15">/</span>
                  {nextRace.circuit.locality}
                </div>

                <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-5">
                  <div>
                    <div className="eyebrow mb-1">Race start · 當地時間</div>
                    <div className="metric text-xl font-bold text-white">
                      {formatLocalDateTime(nextRace.date, nextRace.time)}
                    </div>
                    <div className="mt-1 text-[10px] text-white/35">
                      {formatDateLong(nextRace.date)}
                    </div>
                  </div>
                  <Countdown target={raceStart(nextRace)} />
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    to={link(`/races/${nextRace.round}`)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-carbon-950 transition hover:bg-white/85"
                  >
                    <Flag size={14} />
                    比賽資訊
                    <ChevronRight size={14} />
                  </Link>
                  <span className="text-[10px] text-white/30">
                    排位賽 {nextRace.sessions.qualifying ? formatLocalDateTime(
                      nextRace.sessions.qualifying.date,
                      nextRace.sessions.qualifying.time,
                    ) : '待公布'}
                  </span>
                </div>
              </div>

              <div className="relative flex items-center gap-4 border-t border-white/[0.06] bg-black/15 px-5 py-4 sm:px-7">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px]">
                    <span className="font-mono uppercase tracking-[0.14em] text-white/35">
                      賽季進度
                    </span>
                    <span className="metric text-white/65">
                      {summary.completedRaces} / {summary.totalRaces} 站
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-apex-red to-apex-red-soft transition-all duration-700"
                      style={{ width: `${summary.progress}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-[10px] text-white/28">
                    剩餘 {summary.remainingRaces} 站 · 資料更新於{' '}
                    {new Intl.DateTimeFormat('zh-Hant-TW', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(season.updatedAt))}
                  </div>
                </div>
                <SeasonRing progress={summary.progress} />
              </div>
            </>
          ) : (
            <div className="p-8">
              <div className="chip">Season complete</div>
              <h2 className="mt-4 text-4xl font-black text-white">賽季已結束</h2>
              <p className="mt-2 max-w-lg text-sm text-white/45">
                {season.season} 年賽季所有分站已完成。回顧最終積分榜與各站比賽結果。
              </p>
              <div className="mt-5 flex gap-3">
                <Link
                  to={link('/standings')}
                  className="rounded-xl bg-apex-red px-4 py-2.5 text-xs font-bold text-white"
                >
                  查看最終積分
                </Link>
                <Link
                  to={link('/calendar')}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-white/65"
                >
                  賽季賽程
                </Link>
              </div>
            </div>
          )}
        </Panel>

        {leader ? (
          <Panel className="relative overflow-hidden p-5 xl:col-span-4 sm:p-6">
            <div className="pointer-events-none absolute -right-3 -top-8 font-mono text-[120px] font-black leading-none text-white/[0.028]">
              {leader.position}
            </div>
            <SectionHeading
              eyebrow="Championship leader"
              title="車手積分領先"
              action={
                <Link
                  to={link(`/drivers/${leader.driver.id}`)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/45 transition hover:bg-white/10 hover:text-white"
                  aria-label="查看領先車手"
                >
                  <ArrowUpRight size={15} />
                </Link>
              }
            />
            <div className="mt-6 flex items-center gap-3.5">
              <DriverBadge
                driver={leader.driver}
                constructorId={leader.constructor.id}
                size="lg"
                showNumber
              />
              <div className="min-w-0">
                <div className="truncate text-xl font-black tracking-tight text-white">
                  {leader.driver.fullName}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/45">
                  <TeamDot constructor={leader.constructor} />
                  {leader.constructor.name}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/25">
                  {leader.driver.nationality} · #{leader.driver.number ?? '—'}
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl border border-white/[0.07] bg-black/20 py-3">
              <div className="px-3 text-center">
                <div className="metric text-xl font-bold text-white">
                  {formatPoints(leader.points)}
                </div>
                <div className="font-mono text-[8px] tracking-[0.14em] text-white/30">
                  POINTS
                </div>
              </div>
              <div className="px-3 text-center">
                <div className="metric text-xl font-bold text-white">{leader.wins}</div>
                <div className="font-mono text-[8px] tracking-[0.14em] text-white/30">
                  WINS
                </div>
              </div>
              <div className="px-3 text-center">
                <div className="metric text-xl font-bold text-apex-mint">
                  +{formatPoints(leader.points - (second?.points ?? leader.points))}
                </div>
                <div className="font-mono text-[8px] tracking-[0.14em] text-white/30">
                  GAP
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-[11px] text-white/38">
              <Crown size={13} className="text-apex-amber" />
              領先 {second ? second.driver.fullName : '全場'} ·{' '}
              {formatPoints(leader.points - (second?.points ?? 0))} 分
            </div>
          </Panel>
        ) : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="已完成分站"
          value={`${summary.completedRaces}/${summary.totalRaces}`}
          hint={`賽季進度 ${summary.progress.toFixed(0)}%`}
          icon={<CalendarDays size={17} />}
        />
        <StatCard
          label="領先者勝場"
          value={leader?.wins ?? 0}
          unit="wins"
          hint={leader?.driver.fullName ?? '—'}
          icon={<Trophy size={17} />}
          accent
        />
        <StatCard
          label="車隊積分領先"
          value={constructorLeader ? formatPoints(constructorLeader.points) : '—'}
          unit="pts"
          hint={constructorLeader?.constructor.name ?? '—'}
          icon={<Gauge size={17} />}
        />
        <StatCard
          label="上一站冠軍"
          value={podium[0]?.driver.code ?? '—'}
          hint={lastRace ? shortRaceName(lastRace.raceName) : '—'}
          icon={<Flag size={17} />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="p-5 xl:col-span-8 sm:p-6">
          <SectionHeading
            eyebrow="Championship trajectory"
            title="車手積分走勢"
            subtitle="依每站正賽與衝刺賽積分累計，點擊圖例可切換車手顯示。"
            action={
              <Link
                to={link('/standings')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/40 transition hover:text-white"
              >
                完整積分榜
                <ChevronRight size={13} />
              </Link>
            }
          />
          <div className="mt-5">
            <ProgressionChart points={progression.points} series={progression.series} height={310} />
          </div>
        </Panel>

        <Panel className="p-5 xl:col-span-4 sm:p-6">
          <SectionHeading
            eyebrow="Constructors"
            title="車隊積分"
            action={
              <Link
                to={link('/standings?tab=teams')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/40 transition hover:text-white"
              >
                全部
                <ChevronRight size={13} />
              </Link>
            }
          />
          <div className="mt-5 space-y-3">
            {season.constructorStandings.slice(0, 6).map((entry) => {
              const color = teamColor(entry.constructor.id)
              const colorLeader = teamColor(season.constructorStandings[0].constructor.id)
              return (
                <Link
                  key={entry.constructor.id}
                  to={link(`/teams/${entry.constructor.id}`)}
                  className="group flex items-center gap-3 rounded-xl border border-transparent p-1.5 transition hover:border-white/8 hover:bg-white/[0.035]"
                >
                  <span className="w-5 font-mono text-[10px] text-white/30">
                    {String(entry.position).padStart(2, '0')}
                  </span>
                  <span
                    className="h-7 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-white/80 transition group-hover:text-white">
                      {entry.constructor.name}
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(4, (entry.points / season.constructorStandings[0].points) * 100)}%`,
                          background: `linear-gradient(90deg, ${color}, ${colorLeader}40)`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="metric shrink-0 text-right text-sm font-bold text-white">
                    {formatPoints(entry.points)}
                    <div className="font-mono text-[8px] font-normal tracking-[0.12em] text-white/25">
                      PTS
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Panel className="p-5 xl:col-span-7 sm:p-6">
          <SectionHeading
            eyebrow="Latest classification"
            title={lastRace ? shortRaceName(lastRace.raceName) : '最新比賽'}
            subtitle={
              lastRace
                ? `${formatDateLong(lastRace.date)} · ${lastRace.circuit.name}`
                : '目前沒有比賽結果'
            }
            action={
              lastRace ? (
                <Link
                  to={link(`/races/${lastRace.round}`)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/40 transition hover:text-white"
                >
                  完整結果
                  <ChevronRight size={13} />
                </Link>
              ) : null
            }
          />
          {latestResults.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="data-table min-w-[520px]">
                <thead>
                  <tr>
                    <th className="w-10">Pos</th>
                    <th>Driver</th>
                    <th>Team</th>
                    <th className="text-right">Grid</th>
                    <th className="text-right">Gap</th>
                    <th className="text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {latestResults.slice(0, 8).map((row) => (
                    <tr key={row.driver.id}>
                      <td>
                        <PositionBadge position={row.position} />
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
                      <td className="metric max-w-[130px] truncate text-right text-[11px] text-white/45">
                        {resultGap(row)}
                      </td>
                      <td className="metric text-right font-bold text-white">
                        {formatPoints(row.points)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-white/10 p-10 text-center text-xs text-white/30">
              此站尚無比賽結果
            </div>
          )}
          {fastestLap ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4 text-[11px] text-white/38">
              <Timer size={13} className="text-apex-mint" />
              最快單圈
              <span className="font-semibold text-white/70">{fastestLap.driver.fullName}</span>
              <span className="metric text-apex-mint">{fastestLap.time}</span>
            </div>
          ) : null}
        </Panel>

        <Panel className="p-5 xl:col-span-5 sm:p-6">
          <SectionHeading
            eyebrow="Up next"
            title="接下來"
            action={
              <Link
                to={link('/calendar')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/40 transition hover:text-white"
              >
                賽程
                <ChevronRight size={13} />
              </Link>
            }
          />
          <div className="mt-5 space-y-2.5">
            {upcoming.length > 0 ? (
              upcoming.map((race, index) => (
                <Link
                  key={race.round}
                  to={link(`/races/${race.round}`)}
                  className={cx(
                    'group flex items-center gap-3 rounded-xl border p-3 transition',
                    index === 0
                      ? 'border-apex-red/25 bg-apex-red/[0.07] hover:border-apex-red/40'
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04]',
                  )}
                >
                  <div className="w-9 shrink-0 text-center">
                    <div className="font-mono text-[10px] font-bold text-white/45">
                      R{String(race.round).padStart(2, '0')}
                    </div>
                    <div className="mt-0.5 text-[9px] text-white/25">
                      {formatDateLong(race.date).split(' ')[0]}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-white/85 transition group-hover:text-white">
                      {shortRaceName(race.raceName)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/35">
                      <MapPin size={10} />
                      {race.circuit.locality}
                      <span className="text-white/15">/</span>
                      {formatLocalDateTime(race.date, race.time)}
                    </div>
                  </div>
                  {index === 0 ? (
                    <span className="chip border-apex-red/25 text-apex-red-soft">Next</span>
                  ) : (
                    <ChevronRight
                      size={14}
                      className="text-white/20 transition group-hover:text-white/50"
                    />
                  )}
                </Link>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-white/30">
                本季賽程已全部結束
              </div>
            )}
          </div>
        </Panel>
      </section>
    </div>
  )
}
