export const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1'

const USER_AGENT = 'APEX-F1-Dashboard/1.0 (student project; contact: local)'
const MAX_PAGES = 20
const PAGE_SIZE = 100

export interface RawDriver {
  driverId: string
  permanentNumber?: string
  code?: string
  url?: string
  givenName: string
  familyName: string
  dateOfBirth?: string
  nationality: string
}

export interface RawConstructor {
  constructorId: string
  url?: string
  name: string
  nationality: string
}

export interface RawCircuit {
  circuitId: string
  url?: string
  circuitName: string
  Location: {
    lat: string
    long: string
    locality: string
    country: string
  }
}

export interface RawSession {
  date: string
  time?: string
}

export interface RawFastestLap {
  rank?: string
  lap?: string
  Time?: { time?: string }
}

export interface RawResult {
  number?: string
  position?: string
  positionText: string
  points?: string
  Driver: RawDriver
  Constructor: RawConstructor
  grid?: string
  laps?: string
  status?: string
  Time?: { millis?: string; time?: string }
  FastestLap?: RawFastestLap
}

export interface RawRace {
  season: string
  round: string
  url?: string
  raceName: string
  Circuit: RawCircuit
  date: string
  time?: string
  FirstPractice?: RawSession
  SecondPractice?: RawSession
  ThirdPractice?: RawSession
  Qualifying?: RawSession
  Sprint?: RawSession
  SprintQualifying?: RawSession
  Results?: RawResult[]
  SprintResults?: RawResult[]
  QualifyingResults?: RawQualifying[]
  PitStops?: RawPitStop[]
}

export interface RawQualifying {
  number?: string
  position: string
  Driver: RawDriver
  Constructor: RawConstructor
  Q1?: string
  Q2?: string
  Q3?: string
}

export interface RawPitStop {
  driverId: string
  lap: string
  stop: string
  time: string
  duration: string
}

export interface RawDriverStanding {
  position: string
  positionText?: string
  points: string
  wins: string
  Driver: RawDriver
  Constructors: RawConstructor[]
}

export interface RawConstructorStanding {
  position: string
  positionText?: string
  points: string
  wins: string
  Constructor: RawConstructor
}

export interface ErgastResponse {
  MRData: {
    total?: string
    limit?: string
    offset?: string
    StandingsTable?: {
      season?: string
      StandingsLists?: Array<{
        season?: string
        round?: string
        DriverStandings?: RawDriverStanding[]
        ConstructorStandings?: RawConstructorStanding[]
      }>
    }
    RaceTable?: {
      season?: string
      round?: string
      Races: RawRace[]
    }
    SeasonTable?: {
      Seasons: Array<{ season: string; url?: string }>
    }
  }
}

class CacheUnavailable extends Error {
  constructor() {
    super('Cache API unavailable')
  }
}

export function getEdgeCache(): Cache | null {
  if (typeof caches === 'undefined') return null
  return (caches as CacheStorage & { default?: Cache }).default ?? null
}

async function readCache(cacheKey: string): Promise<unknown | null> {
  try {
    const cache = getEdgeCache()
    if (!cache) return null
    const hit = await cache.match(cacheKeyToRequest(cacheKey))
    if (!hit) return null
    return await hit.json()
  } catch {
    return null
  }
}

async function writeCache(cacheKey: string, data: unknown, ttl: number): Promise<void> {
  try {
    const cache = getEdgeCache()
    if (!cache) throw new CacheUnavailable()
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    })
    await cache.put(cacheKeyToRequest(cacheKey), response)
  } catch {
    throw new CacheUnavailable()
  }
}

function cacheKeyToRequest(cacheKey: string): Request {
  return new Request(`https://apex-f1-cache.local/${encodeURIComponent(cacheKey)}`, {
    method: 'GET',
  })
}

export async function fetchJson<T>(
  path: string,
  cacheKey: string,
  ttl: number,
): Promise<T> {
  const cached = await readCache(cacheKey)
  if (cached) return cached as T

  const response = await fetch(`${JOLPICA_BASE}/${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })
  if (!response.ok) {
    throw new Error(`Jolpica responded with ${response.status} for ${path}`)
  }
  const data = (await response.json()) as T
  try {
    await writeCache(cacheKey, data, ttl)
  } catch {
    // Edge cache is an optimization only; serving the upstream payload still works.
  }
  return data
}

export interface PagedResult {
  races: RawRace[]
  total: number
}

export async function fetchAllRacePages(
  season: string,
  kind: 'results' | 'sprint',
  ttl = 300,
): Promise<PagedResult> {
  const first = await fetchJson<ErgastResponse>(
    `${season}/${kind}.json?limit=${PAGE_SIZE}&offset=0`,
    `jolpica:${season}:${kind}:0`,
    ttl,
  )
  const total = Number(first.MRData.total ?? 0)
  const pageCount = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE))
  const races = [...(first.MRData.RaceTable?.Races ?? [])]

  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) => {
        const offset = (index + 1) * PAGE_SIZE
        return fetchJson<ErgastResponse>(
          `${season}/${kind}.json?limit=${PAGE_SIZE}&offset=${offset}`,
          `jolpica:${season}:${kind}:${offset}`,
          ttl,
        )
      }),
    )
    for (const page of rest) {
      races.push(...(page.MRData.RaceTable?.Races ?? []))
    }
  }

  const deduped = new Map<string, RawRace>()
  for (const race of races) {
    const key = `${race.round}:${race.date}:${race.raceName}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, race)
      continue
    }
    deduped.set(key, {
      ...existing,
      Results: mergeResultRows(existing.Results, race.Results),
      SprintResults: mergeResultRows(existing.SprintResults, race.SprintResults),
    })
  }

  return {
    races: [...deduped.values()].sort((a, b) => Number(a.round) - Number(b.round)),
    total,
  }
}

function mergeResultRows(
  current: RawResult[] | undefined,
  incoming: RawResult[] | undefined,
): RawResult[] | undefined {
  if (!current?.length) return incoming
  if (!incoming?.length) return current
  const byDriver = new Map<string, RawResult>()
  for (const row of current) byDriver.set(row.Driver.driverId, row)
  for (const row of incoming) byDriver.set(row.Driver.driverId, row)
  return [...byDriver.values()].sort(
    (a, b) => Number(a.position ?? 99) - Number(b.position ?? 99),
  )
}

export function cacheKey(path: string): string {
  return `apex-f1:${path}`
}
