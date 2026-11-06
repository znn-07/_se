export interface Driver {
  id: string
  code: string
  firstName: string
  lastName: string
  fullName: string
  number: string | null
  nationality: string
}

export interface Constructor {
  id: string
  name: string
  nationality: string
}

export interface Circuit {
  id: string
  name: string
  locality: string
  country: string
  url?: string
}

export interface SessionSlot {
  date: string
  time?: string
}

export interface RaceWeekend {
  season: string
  round: number
  raceName: string
  url?: string
  date: string
  time?: string
  circuit: Circuit
  sessions: {
    firstPractice?: SessionSlot
    secondPractice?: SessionSlot
    thirdPractice?: SessionSlot
    qualifying?: SessionSlot
    sprint?: SessionSlot
    sprintQualifying?: SessionSlot
  }
}

export interface DriverStanding {
  position: number
  points: number
  wins: number
  driver: Driver
  constructor: Constructor
}

export interface ConstructorStanding {
  position: number
  points: number
  wins: number
  constructor: Constructor
}

export interface FastestLap {
  rank: number | null
  lap: number | null
  time: string
}

export interface ResultRow {
  position: number | null
  positionText: string
  points: number
  driver: Driver
  constructor: Constructor
  grid: number | null
  laps: number
  status: string
  time: string | null
  fastestLap: FastestLap | null
}

export interface RaceResultSet {
  round: number
  raceName: string
  date: string
  circuit: Circuit
  results: ResultRow[]
}

export interface QualifyingRow {
  position: number
  driver: Driver
  constructor: Constructor
  q1: string | null
  q2: string | null
  q3: string | null
}

export interface PitStopRow {
  driverId: string
  driver: Driver | null
  lap: number
  stop: number
  time: string
  duration: number
}

export interface SeasonPayload {
  season: string
  updatedAt: string
  schedule: RaceWeekend[]
  driverStandings: DriverStanding[]
  constructorStandings: ConstructorStanding[]
  raceResults: RaceResultSet[]
  sprintResults: RaceResultSet[]
}

export interface RaceDetailPayload {
  season: string
  updatedAt: string
  race: RaceWeekend
  results: ResultRow[]
  sprintResults: ResultRow[]
  qualifying: QualifyingRow[]
  pitStops: PitStopRow[]
}

export interface ApiError {
  error: string
  detail?: string
}
