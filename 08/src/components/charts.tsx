import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ProgressionPoint, ProgressionSeries } from '../lib/analytics'
import { teamColor } from '../../shared/teams'

interface TooltipEntry {
  dataKey?: string | number
  value?: number | string
  color?: string
  payload?: Record<string, unknown>
}

interface ProgressionTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string
  series: ProgressionSeries[]
}

function ProgressionTooltip({ active, payload, label, series }: ProgressionTooltipProps) {
  if (!active || !payload?.length) return null
  const rows = [...payload].sort((a, b) => Number(b.value) - Number(a.value))
  const data = rows[0]?.payload as { raceName?: string } | undefined
  return (
    <div className="min-w-[190px] rounded-xl border border-white/12 bg-carbon-950/95 p-3 shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.14em] text-white/45">{label}</span>
        <span className="text-[10px] text-white/35">{data?.raceName ?? ''}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((entry) => {
          const item = series.find((candidate) => candidate.id === entry.dataKey)
          if (!item) return null
          return (
            <div key={item.id} className="flex items-center gap-2 text-[11px]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="min-w-0 flex-1 truncate text-white/60">{item.name}</span>
              <span className="metric font-bold text-white">{entry.value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ProgressionChart({
  points,
  series,
  height = 300,
}: {
  points: ProgressionPoint[]
  series: ProgressionSeries[]
  height?: number
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const data = useMemo(
    () =>
      points.map((point) => ({
        label: point.label,
        raceName: point.raceName,
        ...point.values,
      })),
    [points],
  )

  const toggle = (id: string) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="h-[300px] w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.055)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,0.34)', fontSize: 9, fontFamily: 'JetBrains Mono' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.34)', fontSize: 9, fontFamily: 'JetBrains Mono' }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              content={<ProgressionTooltip series={series} />}
              cursor={{ stroke: 'rgba(255,255,255,0.16)', strokeDasharray: '3 3' }}
            />
            {series.map((item) => (
              <Line
                key={item.id}
                type="monotone"
                dataKey={item.id}
                stroke={item.color}
                strokeWidth={hidden.has(item.id) ? 0 : 2.2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: item.color }}
                hide={hidden.has(item.id)}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {series.map((item) => {
          const isHidden = hidden.has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.06em] transition ${
                isHidden
                  ? 'border-white/5 bg-transparent text-white/25'
                  : 'border-white/10 bg-white/[0.045] text-white/65'
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: isHidden ? '#555b66' : item.color }}
              />
              {item.code}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface LapRow {
  code: string
  name: string
  time: string
  seconds: number
  color: string
}

export function FastestLapChart({ rows }: { rows: LapRow[] }) {
  if (rows.length === 0) {
    return <ChartEmpty label="此站尚無最快單圈資料。" />
  }
  return (
    <div className="h-[310px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 62, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis type="number" hide domain={['dataMin - 0.4', 'dataMax + 0.4']} />
          <YAxis
            dataKey="code"
            type="category"
            width={38}
            tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as LapRow
              return (
                <div className="rounded-xl border border-white/12 bg-carbon-950/95 p-3 text-xs shadow-2xl">
                  <div className="font-semibold text-white">{row.name}</div>
                  <div className="metric mt-1 text-apex-mint">{row.time}</div>
                </div>
              )
            }}
          />
          <Bar dataKey="seconds" radius={[0, 6, 6, 0]} barSize={14} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.code} fill={row.color} fillOpacity={0.9} />
            ))}
            <LabelList
              dataKey="time"
              position="right"
              fill="rgba(255,255,255,0.62)"
              style={{ fontSize: 9, fontFamily: 'JetBrains Mono' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function PitStopChart({
  rows,
}: {
  rows: Array<{ driverId: string; constructorId: string; code: string; name: string; seconds: number }>
}) {
  if (rows.length === 0) {
    return <ChartEmpty label="此站尚無進站資料。" />
  }
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 56, left: 0, bottom: 4 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
          <XAxis type="number" hide domain={['dataMin - 1', 'dataMax + 1']} />
          <YAxis
            dataKey="code"
            type="category"
            width={38}
            tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as {
                name: string
                seconds: number
                color: string
              }
              return (
                <div className="rounded-xl border border-white/12 bg-carbon-950/95 p-3 text-xs shadow-2xl">
                  <div className="font-semibold text-white">{row.name}</div>
                  <div className="metric mt-1 text-apex-mint">
                    {row.seconds.toFixed(3)}s
                  </div>
                </div>
              )
            }}
          />
          <Bar dataKey="seconds" radius={[0, 6, 6, 0]} barSize={13} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.driverId} fill={teamColor(row.constructorId)} fillOpacity={0.9} />
            ))}
            <LabelList
              dataKey="seconds"
              position="right"
              formatter={(value) => `${Number(value).toFixed(1)}s`}
              fill="rgba(255,255,255,0.55)"
              style={{ fontSize: 9, fontFamily: 'JetBrains Mono' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function PointsByRoundChart({
  rows,
}: {
  rows: Array<{ label: string; points: number; raceName: string }>
}) {
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(255,255,255,0.32)', fontSize: 8, fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.32)', fontSize: 9, fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            axisLine={false}
            width={38}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as {
                label: string
                points: number
                raceName: string
              }
              return (
                <div className="rounded-xl border border-white/12 bg-carbon-950/95 p-3 text-xs shadow-2xl">
                  <div className="font-mono text-[10px] text-white/40">{row.label}</div>
                  <div className="mt-0.5 font-semibold text-white">{row.raceName}</div>
                  <div className="mt-1 text-apex-mint">+{row.points} pts</div>
                </div>
              )
            }}
          />
          <Bar dataKey="points" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.label}
                fill={row.points > 0 ? '#e10600' : 'rgba(255,255,255,0.1)'}
                fillOpacity={row.points > 0 ? 0.82 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-white/10 text-xs text-white/30">
      {label}
    </div>
  )
}

