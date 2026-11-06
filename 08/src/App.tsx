import { useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { PageHeader, Panel } from './components/primitives'
import CalendarPage from './pages/CalendarPage'
import DashboardPage from './pages/DashboardPage'
import DriverPage from './pages/DriverPage'
import RacePage from './pages/RacePage'
import StandingsPage from './pages/StandingsPage'
import TeamPage from './pages/TeamPage'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function NotFoundPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="404"
        title="找不到頁面"
        description="這個賽道不存在，或頁面已經被移出賽程。"
      />
      <Panel className="p-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-xl bg-apex-red px-4 py-2.5 text-xs font-bold text-white transition hover:bg-apex-red-soft"
        >
          返回儀表板
        </Link>
      </Panel>
    </div>
  )
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="standings" element={<StandingsPage />} />
          <Route path="drivers/:driverId" element={<DriverPage />} />
          <Route path="teams/:constructorId" element={<TeamPage />} />
          <Route path="races/:round" element={<RacePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  )
}
