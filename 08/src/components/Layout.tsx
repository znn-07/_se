import {
  Activity,
  CalendarDays,
  Database,
  FlagTriangleRight,
  LayoutDashboard,
  Menu,
  Trophy,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { SeasonPicker, cx } from './primitives'

const NAV_ITEMS = [
  { to: '/', label: '儀表板', sub: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: '賽程', sub: 'Calendar', icon: CalendarDays },
  { to: '/standings', label: '積分榜', sub: 'Standings', icon: Trophy },
]

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-10 w-10 -skew-x-6 place-items-center overflow-hidden rounded-lg border border-white/12 bg-white/[0.045]">
        <span className="absolute inset-x-0 top-0 h-[3px] bg-apex-red" />
        <span className="absolute inset-y-0 left-0 w-[3px] bg-apex-red/40" />
        <FlagTriangleRight size={19} className="skew-x-6 text-white" strokeWidth={2.4} />
      </div>
      <div className={compact ? 'hidden sm:block' : ''}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-black leading-none tracking-[0.16em] text-white">
            APEX
          </span>
          <span className="font-mono text-[9px] font-medium tracking-[0.2em] text-apex-red">
            F1
          </span>
        </div>
        <div className="eyebrow mt-1 text-[8px] tracking-[0.26em]">Data Hub</div>
      </div>
    </div>
  )
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-white/[0.06] bg-carbon-950/72 px-4 py-6 backdrop-blur-xl lg:flex">
      <div className="px-2">
        <Brand />
      </div>

      <div className="mt-9 px-2">
        <div className="eyebrow mb-3 text-[9px]">Race Intelligence</div>
        <nav className="space-y-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx('nav-link group', isActive && 'nav-link-active')
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    size={17}
                    strokeWidth={isActive ? 2.4 : 1.9}
                    className={isActive ? 'text-apex-red' : 'text-white/40'}
                  />
                  <span className="flex-1">{item.label}</span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/22">
                    {item.sub}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="mt-8 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
        <div className="flex items-center gap-2">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-apex-mint" />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/55">
            Edge cached
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/38">
          賽事資料經 Cloudflare 邊緣節點快取，降低延遲與上游請求量。
        </p>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-white/35">
          <Database size={12} className="text-apex-mint/70" />
          Jolpica F1 API
        </div>
      </div>

      <div className="mt-auto px-2 pt-6">
        <div className="flex items-center gap-2 text-[10px] text-white/28">
          <Activity size={12} />
          <span className="font-mono tracking-[0.12em]">SEASON TRACKER v1.0</span>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-white/20">
          非官方專案，資料版權屬 Formula 1 及相關權利人所有。
        </p>
      </div>
    </aside>
  )
}

function MobileDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="關閉選單"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 left-0 w-[280px] border-r border-white/10 bg-carbon-950 px-4 py-5 shadow-2xl">
        <div className="flex items-center justify-between px-2">
          <Brand />
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/60"
          >
            <X size={16} />
          </button>
        </div>
        <nav className="mt-8 space-y-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                cx('nav-link', isActive && 'nav-link-active')
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    size={17}
                    className={isActive ? 'text-apex-red' : 'text-white/40'}
                  />
                  <span className="flex-1">{item.label}</span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/22">
                    {item.sub}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
          <div className="flex items-center gap-2">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-apex-mint" />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/55">
              Edge cached
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/38">
            由 Cloudflare Workers 提供 API 與靜態資源。
          </p>
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-carbon-950/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70"
                aria-label="開啟選單"
              >
                <Menu size={17} />
              </button>
              <Brand compact />
            </div>

            <div className="hidden items-center gap-3 lg:flex">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
                Formula 1 · Race Data Tracking
              </span>
              <span className="h-3 w-px bg-white/10" />
              <span className="flex items-center gap-1.5 text-[10px] text-white/40">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-apex-mint" />
                LIVE FEED
              </span>
            </div>

            <div className="flex items-center gap-2">
              <SeasonPicker />
              <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] text-white/45 sm:flex">
                <Database size={13} className="text-apex-mint" />
                <span className="font-mono tracking-[0.1em]">JOLPICA</span>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>

        <footer className="mx-auto flex max-w-[1500px] flex-col gap-2 border-t border-white/[0.05] px-4 py-6 text-[10px] text-white/25 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>APEX F1 · 非官方 Formula 1 賽事數據儀表板</span>
          <span className="font-mono tracking-[0.12em]">
            DATA BY JOLPICA · BUILT FOR CLOUDFLARE
          </span>
        </footer>
      </div>

      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}
