import { useEffect, useState } from 'react'
import { countdownParts } from '../lib/analytics'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export default function Countdown({
  target,
  compact = false,
}: {
  target: Date
  compact?: boolean
}) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const { days, hours, minutes, seconds, totalMs } = countdownParts(target, now)

  if (totalMs <= 0) {
    return (
      <div className="inline-flex items-center gap-2 rounded-lg border border-apex-mint/20 bg-apex-mint/10 px-3 py-2 text-xs font-semibold text-apex-mint">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-apex-mint" />
        賽事進行中 / 已開始
      </div>
    )
  }

  const cells = [
    { label: 'DAYS', value: days },
    { label: 'HRS', value: hours },
    { label: 'MIN', value: minutes },
    { label: 'SEC', value: seconds },
  ]

  return (
    <div
      className={compact ? 'flex gap-2' : 'grid grid-cols-4 gap-2'}
      role="timer"
      aria-label={`距離比賽開始 ${days} 天 ${hours} 小時 ${minutes} 分 ${seconds} 秒`}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          className={`rounded-lg border border-white/8 bg-black/25 text-center ${
            compact ? 'min-w-[46px] px-2 py-1.5' : 'px-2 py-2'
          }`}
        >
          <div
            className={`metric font-bold tabular-nums text-white ${
              compact ? 'text-base' : 'text-xl sm:text-2xl'
            }`}
          >
            {pad(cell.value)}
          </div>
          <div className="mt-0.5 font-mono text-[7px] tracking-[0.2em] text-white/35">
            {cell.label}
          </div>
        </div>
      ))}
    </div>
  )
}
