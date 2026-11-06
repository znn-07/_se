import type {
  Circuit,
  Constructor,
  ConstructorStanding,
  Driver,
  DriverStanding,
  PitStopRow,
  QualifyingRow,
  RaceResultSet,
  RaceWeekend,
  ResultRow,
  SeasonPayload,
} from '../shared/types'
import type {
  RawCircuit,
  RawConstructor,
  RawDriver,
  RawDriverStanding,
  RawConstructorStanding,
  RawPitStop,
  RawQualifying,
  RawRace,
  RawResult,
} from './jolpica'

export function normalizeDriver(raw: RawDriver): Driver {
  const code =
    raw.code?.toUpperCase() ??
    (raw.familyName
      ? raw.familyName
          .replace(/[^a-zA-Z]/g, '')
          .slice(0, 3)
          .toUpperCase()
      : '???')
  return {
    id: raw.driverId,
    code,
    firstName: raw.givenName,
    lastName: raw.familyName,
    fullName: `${raw.givenName} ${raw.familyName}`.trim(),
    number: raw.permanentNumber ?? null,
    nationality: raw.nationality,
  }
}

export function normalizeConstructor(raw: RawConstructor | undefined): Constructor {
  if (!raw) {
    return { id: 'unknown', name: 'Unknown', nationality: 'Unknown' }
  }
  return {
    id: raw.constructorId,
    name: raw.name,
    nationality: raw.nationality,
  }
}

export function normalizeCircuit(raw: RawCircuit): Circuit {
  return {
    id: raw.circuitId,
    name: raw.circuitName,
    locality: raw.Location?.locality ?? '',
    country: raw.Location?.country ?? '',
    url: raw.url,
  }
}

export function normalizeRace(raw: RawRace): RaceWeekend {
  return {
    season: raw.season,
    round: Number(raw.round),
    raceName: raw.raceName,
    url: raw.url,
    date: raw.date,
    time: raw.time,
    circuit: normalizeCircuit(raw.Circuit),
    sessions: {
      firstPractice: raw.FirstPractice,
      secondPractice: raw.SecondPractice,
      thirdPractice: raw.ThirdPractice,
      qualifying: raw.Qualifying,
      sprint: raw.Sprint,
      sprintQualifying: raw.SprintQualifying,
    },
  }
}

export function normalizeResult(raw: RawResult): ResultRow {
  const position = raw.position !== undefined && raw.position !== '' ? Number(raw.position) : null
  const fastestTime = raw.FastestLap?.Time?.time
  return {
    position: Number.isFinite(position) ? position : null,
    positionText: raw.positionText,
    points: Number(raw.points ?? 0),
    driver: normalizeDriver(raw.Driver),
    constructor: normalizeConstructor(raw.Constructor),
    grid: raw.grid !== undefined && raw.grid !== '' ? Number(raw.grid) : null,
    laps: Number(raw.laps ?? 0),
    status: raw.status ?? 'Unknown',
    time: raw.Time?.time ?? null,
    fastestLap: fastestTime
      ? {
          rank: raw.FastestLap?.rank ? Number(raw.FastestLap.rank) : null,
          lap: raw.FastestLap?.lap ? Number(raw.FastestLap.lap) : null,
          time: fastestTime,
        }
      : null,
  }
}

export function normalizeQualifying(raw: RawQualifying): QualifyingRow {
  return {
    position: Number(raw.position),
    driver: normalizeDriver(raw.Driver),
    constructor: normalizeConstructor(raw.Constructor),
    q1: raw.Q1 ?? null,
    q2: raw.Q2 ?? null,
    q3: raw.Q3 ?? null,
  }
}

export function normalizePitStop(raw: RawPitStop, driver: Driver | null): PitStopRow {
  return {
    driverId: raw.driverId,
    driver,
    lap: Number(raw.lap),
    stop: Number(raw.stop),
    time: raw.time,
    duration: Number(raw.duration),
  }
}

export function normalizeDriverStanding(raw: RawDriverStanding): DriverStanding {
  return {
    position: Number(raw.position),
    points: Number(raw.points),
    wins: Number(raw.wins),
    driver: normalizeDriver(raw.Driver),
    constructor: normalizeConstructor(raw.Constructors?.[0]),
  }
}

export function normalizeConstructorStanding(
  raw: RawConstructorStanding,
): ConstructorStanding {
  return {
    position: Number(raw.position),
    points: Number(raw.points),
    wins: Number(raw.wins),
    constructor: normalizeConstructor(raw.Constructor),
  }
}

export function normalizeRaceResults(raw: RawRace): RaceResultSet {
  return {
    round: Number(raw.round),
    raceName: raw.raceName,
    date: raw.date,
    circuit: normalizeCircuit(raw.Circuit),
    results: (raw.Results ?? []).map(normalizeResult),
  }
}

export function normalizeSprintResults(raw: RawRace): RaceResultSet {
  return {
    round: Number(raw.round),
    raceName: raw.raceName,
    date: raw.date,
    circuit: normalizeCircuit(raw.Circuit),
    results: (raw.SprintResults ?? []).map(normalizeResult),
  }
}

export function buildSeasonPayload(
  season: string,
  schedule: RawRace[],
  driverStandings: RawDriverStanding[],
  constructorStandings: RawConstructorStanding[],
  raceResults: RawRace[],
  sprintResults: RawRace[],
): SeasonPayload {
  return {
    season,
    updatedAt: new Date().toISOString(),
    schedule: schedule.map(normalizeRace),
    driverStandings: driverStandings
      .map(normalizeDriverStanding)
      .sort((a, b) => a.position - b.position),
    constructorStandings: constructorStandings
      .map(normalizeConstructorStanding)
      .sort((a, b) => a.position - b.position),
    raceResults: raceResults
      .filter((race) => (race.Results?.length ?? 0) > 0)
      .map(normalizeRaceResults)
      .sort((a, b) => a.round - b.round),
    sprintResults: sprintResults
      .filter((race) => (race.SprintResults?.length ?? 0) > 0)
      .map(normalizeSprintResults)
      .sort((a, b) => a.round - b.round),
  }
}
