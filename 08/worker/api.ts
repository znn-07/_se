import type {
  ApiError,
  Driver,
  QualifyingRow,
  RaceDetailPayload,
  RaceWeekend,
  SeasonPayload,
} from '../shared/types'
import {
  fetchAllRacePages,
  fetchJson,
  getEdgeCache,
  type ErgastResponse,
  type RawDriverStanding,
  type RawConstructorStanding,
} from './jolpica'
import {
  buildSeasonPayload,
  normalizeDriver,
  normalizePitStop,
  normalizeQualifying,
  normalizeRace,
  normalizeResult,
} from './normalize'

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface CachedResult<T> {
  data: T
  cache: 'HIT' | 'MISS'
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      ...extraHeaders,
    },
  })
}

async function readRouteCache<T>(key: string): Promise<T | null> {
  try {
    const cache = getEdgeCache()
    if (!cache) return null
    const hit = await cache.match(routeCacheRequest(key))
    if (!hit) return null
    return (await hit.json()) as T
  } catch {
    return null
  }
}

async function writeRouteCache<T>(key: string, data: T, ttl: number): Promise<void> {
  try {
    const cache = getEdgeCache()
    if (!cache) return
    await cache.put(
      routeCacheRequest(key),
      new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${ttl}`,
        },
      }),
    )
  } catch {
    // Cache is best-effort.
  }
}

function routeCacheRequest(key: string): Request {
  return new Request(`https://apex-f1-cache.local/route/${encodeURIComponent(key)}`, {
    method: 'GET',
  })
}

async function withRouteCache<T>(
  key: string,
  ttl: number,
  producer: () => Promise<T>,
): Promise<CachedResult<T>> {
  const cached = await readRouteCache<T>(key)
  if (cached) return { data: cached, cache: 'HIT' }
  const data = await producer()
  await writeRouteCache(key, data, ttl)
  return { data, cache: 'MISS' }
}

function resolveSeason(value: string | null): string {
  if (!value || value === 'current') return 'current'
  if (!/^\d{4}$/.test(value)) {
    throw new HttpError(400, 'Season must be a four digit year or "current".')
  }
  return value
}

function resolveRound(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new HttpError(400, 'Round must be a positive integer.')
  }
  const round = Number(value)
  if (round < 1 || round > 40) {
    throw new HttpError(400, 'Round is outside the supported range.')
  }
  return round
}

async function fetchSeason(seasonParam: string): Promise<SeasonPayload> {
  const season = resolveSeason(seasonParam)
  return withRouteCache(`season:${season}`, 300, async () => {
    const [scheduleRes, driversRes, constructorsRes, races, sprints] = await Promise.all([
      fetchJson<ErgastResponse>(
        `${season}/races.json?limit=100`,
        `jolpica:${season}:races`,
        600,
      ),
      fetchJson<ErgastResponse>(
        `${season}/driverStandings.json`,
        `jolpica:${season}:driverStandings`,
        180,
      ),
      fetchJson<ErgastResponse>(
        `${season}/constructorStandings.json`,
        `jolpica:${season}:constructorStandings`,
        180,
      ),
      fetchAllRacePages(season, 'results', 300),
      fetchAllRacePages(season, 'sprint', 600),
    ])

    const schedule = scheduleRes.MRData.RaceTable?.Races ?? []
    const seasonId =
      schedule[0]?.season ??
      driversRes.MRData.StandingsTable?.season ??
      (season === 'current' ? String(new Date().getUTCFullYear()) : season)

    const driverStandings: RawDriverStanding[] =
      driversRes.MRData.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
    const constructorStandings: RawConstructorStanding[] =
      constructorsRes.MRData.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []

    return buildSeasonPayload(
      seasonId,
      schedule,
      driverStandings,
      constructorStandings,
      races.races,
      sprints.races,
    )
  }).then((result) => result.data)
}

async function fetchRace(
  seasonParam: string,
  roundParam: string | null,
  request: Request,
): Promise<{ payload: RaceDetailPayload; cache: 'HIT' | 'MISS' }> {
  const season = resolveSeason(seasonParam)
  const round = resolveRound(roundParam)
  const url = new URL(request.url)
  const force = url.searchParams.get('refresh') === '1'
  const key = `race:${season}:${round}`

  if (!force) {
    const cached = await readRouteCache<RaceDetailPayload>(key)
    if (cached) return { payload: cached, cache: 'HIT' }
  }

  const [scheduleRes, resultsRes, qualifyingRes, pitStopsRes, sprintRes] =
    await Promise.all([
      fetchJson<ErgastResponse>(
        `${season}/races.json?limit=100`,
        `jolpica:${season}:races`,
        600,
      ),
      fetchJson<ErgastResponse>(
        `${season}/${round}/results.json?limit=100`,
        `jolpica:${season}:${round}:results`,
        180,
      ),
      fetchJson<ErgastResponse>(
        `${season}/${round}/qualifying.json?limit=100`,
        `jolpica:${season}:${round}:qualifying`,
        600,
      ),
      fetchJson<ErgastResponse>(
        `${season}/${round}/pitstops.json?limit=100`,
        `jolpica:${season}:${round}:pitstops`,
        600,
      ),
      fetchJson<ErgastResponse>(
        `${season}/${round}/sprint.json?limit=100`,
        `jolpica:${season}:${round}:sprint`,
        600,
      ),
    ])

  const schedule = scheduleRes.MRData.RaceTable?.Races ?? []
  const scheduleRace = schedule.find((race) => Number(race.round) === round)
  const resultRace = resultsRes.MRData.RaceTable?.Races?.[0]
  const rawRace = scheduleRace ?? resultRace
  if (!rawRace) {
    throw new HttpError(404, `Round ${round} was not found for the ${season} season.`)
  }

  const race: RaceWeekend = normalizeRace(rawRace)
  const results = (resultRace?.Results ?? []).map(normalizeResult)
  const sprintResults = (sprintRes.MRData.RaceTable?.Races?.[0]?.SprintResults ?? []).map(
    normalizeResult,
  )
  const qualifying: QualifyingRow[] = (
    qualifyingRes.MRData.RaceTable?.Races?.[0]?.QualifyingResults ?? []
  )
    .map(normalizeQualifying)
    .sort((a, b) => a.position - b.position)

  const driverMap = new Map<string, Driver>()
  for (const row of [...results, ...sprintResults]) {
    driverMap.set(row.driver.id, row.driver)
  }
  for (const row of qualifying) {
    driverMap.set(row.driver.id, row.driver)
  }
  for (const raw of scheduleRace?.Results ?? []) {
    const driver = normalizeDriver(raw.Driver)
    driverMap.set(driver.id, driver)
  }

  const pitStops = (
    pitStopsRes.MRData.RaceTable?.Races?.[0]?.PitStops ?? []
  ).map((raw) => normalizePitStop(raw, driverMap.get(raw.driverId) ?? null))

  const payload: RaceDetailPayload = {
    season: race.season,
    updatedAt: new Date().toISOString(),
    race,
    results,
    sprintResults,
    qualifying,
    pitStops,
  }

  await writeRouteCache(key, payload, 180)
  return { payload, cache: 'MISS' }
}

async function fetchSeasons(): Promise<Array<{ season: string }>> {
  const response = await withRouteCache('seasons', 86_400, async () => {
    const raw = await fetchJson<ErgastResponse>(
      'seasons.json?limit=100',
      'jolpica:seasons',
      86_400,
    )
    return (raw.MRData.SeasonTable?.Seasons ?? [])
      .map((entry) => ({ season: entry.season }))
      .sort((a, b) => Number(b.season) - Number(a.season))
  })
  return response.data
}

export async function handleApi(request: Request, _env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' } satisfies ApiError, 405)
  }

  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  try {
    if (path === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'apex-f1-api',
        time: new Date().toISOString(),
      })
    }

    if (path === '/api/seasons') {
      const seasons = await fetchSeasons()
      return jsonResponse({ seasons }, 200, { 'X-Cache': 'ROUTE' })
    }

    if (path === '/api/season' || path.startsWith('/api/season/')) {
      const param =
        url.searchParams.get('season') ??
        (path.startsWith('/api/season/') ? path.slice('/api/season/'.length) : 'current')
      const payload = await fetchSeason(param)
      return jsonResponse(payload, 200, {
        'X-Data-Source': 'Jolpica F1 API',
        'X-Season': payload.season,
      })
    }

    const raceMatch = path.match(/^\/api\/race\/([^/]+)\/([^/]+)$/)
    if (raceMatch) {
      const { payload, cache } = await fetchRace(raceMatch[1], raceMatch[2], request)
      return jsonResponse(payload, 200, {
        'X-Data-Source': 'Jolpica F1 API',
        'X-Cache': cache,
      })
    }

    if (path === '/api') {
      return jsonResponse({
        name: 'APEX F1 API',
        endpoints: [
          '/api/health',
          '/api/seasons',
          '/api/season/current',
          '/api/season/2025',
          '/api/race/current/19',
        ],
        source: 'https://api.jolpi.ca/ergast/f1',
      })
    }

    return jsonResponse({ error: 'API route not found' } satisfies ApiError, 404)
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message } satisfies ApiError, error.status)
    }
    const detail = error instanceof Error ? error.message : 'Unknown upstream error'
    return jsonResponse(
      {
        error: 'Unable to reach the F1 data source right now.',
        detail,
      } satisfies ApiError,
      502,
    )
  }
}

export { HttpError }
