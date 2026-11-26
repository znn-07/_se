import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePayload, normalizeReading, ValidationError } from '../src/validate.js';
import { latestReadings, summarize } from '../src/stats.js';
import { evaluateAlerts } from '../src/rules.js';
import { csvCell, toCsv } from '../src/export.js';
import { hasValidToken, requiresToken } from '../src/auth.js';
import { cwaUrl, toReadings } from '../src/cwa.js';
import { aggregateReadings } from '../src/aggregate.js';
import { makeSimulatedReadings } from '../src/simulate.js';

const NOW = new Date('2026-11-20T09:30:00.000Z');

function reading(overrides = {}) {
  return normalizeReading({
    device: 'sensor-a1',
    metric: 'temperature',
    value: 26.7,
    ...overrides,
  }, NOW);
}

test('normalizeReading fills defaults and normalizes input', () => {
  assert.deepEqual(reading(), {
    device: 'sensor-a1',
    region: '',
    station: '',
    metric: 'temperature',
    value: 26.7,
    unit: 'C',
    timestamp: NOW.toISOString(),
    receivedAt: NOW.toISOString(),
  });

  const custom = reading({ metric: 'HUMIDITY', unit: ' % ', value: '61.2', timestamp: '2026-11-20T08:00:00Z' });
  assert.equal(custom.metric, 'humidity');
  assert.equal(custom.unit, '%');
  assert.equal(custom.value, 61.2);
  assert.equal(custom.timestamp, '2026-11-20T08:00:00.000Z');
  assert.equal(reading({ region: '  臺北  ' }).region, '臺北');
  assert.equal(reading({ station: '  金門  ' }).station, '金門');
});

test('normalizeReading rejects invalid values', () => {
  assert.throws(() => normalizeReading({ device: '', metric: 'temperature', value: 1 }), ValidationError);
  assert.throws(() => normalizeReading({ device: 'a', metric: 'pressure', value: 1 }), ValidationError);
  assert.throws(() => reading({ value: Number.NaN }), ValidationError);
  assert.throws(() => reading({ value: Number.POSITIVE_INFINITY }), ValidationError);
  assert.throws(() => reading({ value: null }), ValidationError);
  assert.throws(() => reading({ value: true }), ValidationError);
  assert.throws(() => reading({ value: [26] }), ValidationError);
  assert.throws(() => reading({ value: '   ' }), ValidationError);
  assert.throws(() => reading({ timestamp: 'not-a-date' }), ValidationError);
  assert.throws(() => reading({ timestamp: 1763620200000 }), ValidationError);
});

test('normalizePayload accepts a single reading or a batch', () => {
  assert.equal(normalizePayload({ device: 'a', metric: 'signal', value: -70 }, NOW).length, 1);
  const batch = normalizePayload({ readings: [reading(), reading({ value: 28 })] }, NOW);
  assert.equal(batch.length, 2);
  assert.throws(() => normalizePayload({ readings: [] }), ValidationError);
  assert.throws(() => normalizePayload({ readings: {} }), ValidationError);
});

test('summarize groups by device and metric', () => {
  const stats = summarize([
    reading({ value: 20, timestamp: '2026-11-20T08:00:00Z' }),
    reading({ value: 30, timestamp: '2026-11-20T09:00:00Z' }),
    reading({ device: 'sensor-a2', metric: 'voltage', value: 12, unit: 'V' }),
  ]);

  assert.equal(stats.length, 2);
  assert.deepEqual(stats[0], {
    device: 'sensor-a1',
    region: '',
    station: '',
    metric: 'temperature',
    unit: 'C',
    count: 2,
    min: 20,
    max: 30,
    latest: 30,
    latestAt: '2026-11-20T09:00:00.000Z',
    avg: 25,
  });
});

test('aggregateReadings SQL runs against a real SQLite database', async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    t.skip('node:sqlite is not available');
    return;
  }

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE readings (
    id INTEGER PRIMARY KEY, device TEXT NOT NULL, region TEXT NOT NULL DEFAULT '',
    station TEXT NOT NULL DEFAULT '', metric TEXT NOT NULL, value REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT '', ts TEXT NOT NULL, received_at TEXT NOT NULL
  )`);
  sqlite.prepare(`INSERT INTO readings (device, region, station, metric, value, unit, ts, received_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('cwa-C0W140', '金門縣', '金門', 'temperature', 16.8, 'C', NOW.toISOString(), NOW.toISOString());
  sqlite.prepare(`INSERT INTO readings (device, region, station, metric, value, unit, ts, received_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('cwa-467110', '臺北市', '臺北', 'temperature', 25.8, 'C', NOW.toISOString(), NOW.toISOString());

  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...values) {
          return { all: () => ({ results: statement.all(...values) }) };
        },
        all: () => ({ results: statement.all() }),
      };
    },
  };

  const { stats } = await aggregateReadings(db, '金門縣');
  assert.equal(stats.length, 1);
  assert.equal(stats[0].station, '金門');
  assert.equal((await aggregateReadings(db)).stats.length, 2);
});

test('evaluateAlerts checks the latest value against rules', () => {
  const latest = latestReadings([
    reading({ value: 31, timestamp: '2026-11-20T09:00:00Z' }),
    reading({ metric: 'humidity', value: 62 }),
  ]);
  const alerts = evaluateAlerts(latest);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, 'temp-high');
  assert.equal(alerts[0].value, 31);
});

test('CSV cells are quoted and protected against spreadsheet formulas', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell(-68), '"-68"');
  assert.equal(toCsv([{ device: 'a', region: '臺北', station: '中正區', metric: 'signal', value: -68, unit: 'dBm', timestamp: 't', receivedAt: 'r' }]),
    'device,region,station,metric,value,unit,timestamp,receivedAt\r\n'
    + '"a","臺北","中正區","signal","-68","dBm","t","r"\r\n');
});

test('token protection applies only to write endpoints', () => {
  assert.equal(requiresToken('POST', '/api/telemetry'), true);
  assert.equal(requiresToken('DELETE', '/api/readings'), true);
  assert.equal(requiresToken('GET', '/api/summary'), false);

  const request = new Request('http://localhost/api/telemetry', {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(hasValidToken(request, { API_TOKEN: 'secret' }), true);
  assert.equal(hasValidToken(request, { API_TOKEN: 'other' }), false);
  assert.equal(hasValidToken(new Request('http://localhost/api/telemetry'), {}), true);
  assert.equal(requiresToken('POST', '/api/import/cwa'), true);
});

test('cwaUrl builds an authorized dataset request', () => {
  const url = new URL(cwaUrl('CWA-abc 123', '466920'));
  assert.equal(url.pathname, '/api/v1/rest/datastore/O-A0001-001');
  assert.equal(url.searchParams.get('Authorization'), 'CWA-abc 123');
  assert.equal(url.searchParams.get('format'), 'JSON');
  assert.equal(url.searchParams.get('StationId'), '466920');

  const countyUrl = new URL(cwaUrl('key', '', '臺北市'));
  assert.equal(countyUrl.searchParams.get('CountyName'), '臺北市');
  assert.equal(countyUrl.searchParams.has('StationId'), false);
});

test('toReadings converts CWA stations into telemetry readings', () => {
  const readings = toReadings({
    success: 'true',
    records: {
      Station: [
        {
          StationId: '466920',
          StationName: '臺北',
          ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
          WeatherElement: { AirTemperature: '26.5', RelativeHumidity: '0.72' },
        },
        {
          StationId: '466990',
          StationName: '花蓮',
          ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
          WeatherElement: { AirTemperature: '-99', RelativeHumidity: '1' },
        },
      ],
    },
  }, { now: NOW });

  assert.deepEqual(readings, [
    {
      device: 'cwa-466920',
      region: '臺北',
      station: '臺北',
      metric: 'temperature',
      value: 26.5,
      unit: 'C',
      timestamp: '2026-11-22T20:00:00.000Z',
    },
    {
      device: 'cwa-466920',
      region: '臺北',
      station: '臺北',
      metric: 'humidity',
      value: 72,
      unit: '%',
      timestamp: '2026-11-22T20:00:00.000Z',
    },
    {
      device: 'cwa-466990',
      region: '花蓮',
      station: '花蓮',
      metric: 'humidity',
      value: 100,
      unit: '%',
      timestamp: '2026-11-22T20:00:00.000Z',
    },
  ]);
});

test('toReadings filters stations by the selected county', () => {
  const station = (id, county) => ({
    StationId: id,
    StationName: `${county}測站`,
    GeoInfo: { CountyName: county },
    ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
    WeatherElement: { AirTemperature: '25.8', RelativeHumidity: '68.4' },
  });
  const payload = {
    success: 'true',
    records: { Station: [station('466920', '臺北市'), station('467490', '臺中市')] },
  };

  const readings = toReadings(payload, { region: '臺中市', now: NOW });
  assert.equal(readings.length, 2);
  assert.ok(readings.every((item) => item.region === '臺中市' && item.station === '臺中市測站' && item.device === 'cwa-467490'));
  assert.equal(toReadings(payload, { region: '連江縣', now: NOW }).length, 0);
});

test('toReadings records the station and township as the measurement place', () => {
  const readings = toReadings({
    success: 'true',
    records: {
      Station: [{
        StationId: 'C0W140', StationName: '金門',
        GeoInfo: { CountyName: '金門縣', TownName: '金城鎮' },
        ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
        WeatherElement: { AirTemperature: '16.8', RelativeHumidity: '60' },
      }],
    },
  }, { region: '金門縣', now: NOW });

  assert.equal(readings[0].region, '金門縣');
  assert.equal(readings[0].station, '金門（金城鎮）');
});

test('toReadings rejects failed CWA responses', () => {
  assert.throws(
    () => toReadings({ success: 'false', result: { message: '授權碼錯誤' } }),
    /授權碼錯誤/,
  );
});

test('makeSimulatedReadings bundles all four metrics per timestamp on one device', () => {
  const readings = makeSimulatedReadings({
    now: NOW,
    region: '金門縣',
    random: () => 0.5,
  });

  assert.equal(readings.length, 24);
  assert.ok(readings.every((item) => item.device === 'sensor-a2' && item.region === '金門縣'));
  assert.deepEqual([...new Set(readings.map((item) => item.metric))].sort(),
    ['humidity', 'signal', 'temperature', 'voltage']);

  const units = { temperature: 'C', humidity: '%', voltage: 'V', signal: 'dBm' };
  for (const [metric, unit] of Object.entries(units)) {
    const samples = readings.filter((item) => item.metric === metric);
    assert.equal(samples.length, 6, metric);
    assert.ok(samples.every((item) => item.unit === unit), metric);
    assert.deepEqual(samples.map((item) => item.timestamp),
      readings.filter((item) => item.metric === 'voltage').map((item) => item.timestamp), metric);
  }

  assert.ok(readings.filter((item) => item.metric === 'temperature')
    .every((item) => item.value >= 18 && item.value <= 32));
  assert.ok(readings.filter((item) => item.metric === 'humidity')
    .every((item) => item.value >= 30 && item.value <= 85));
  assert.ok(readings.filter((item) => item.metric === 'voltage')
    .every((item) => item.value >= 10.9 && item.value <= 13.2));
  assert.ok(readings.filter((item) => item.metric === 'signal')
    .every((item) => item.value >= -95 && item.value <= -45));

  const stamps = readings.filter((item) => item.metric === 'voltage').map((item) => Date.parse(item.timestamp));
  for (let index = 1; index < stamps.length; index += 1) {
    assert.equal(stamps[index] - stamps[index - 1], 60_000);
  }
  assert.equal(Math.max(...stamps), Math.floor(NOW.getTime() / 60_000) * 60_000);
  assert.ok(readings.every((item) => item.receivedAt === NOW.toISOString()));
});
