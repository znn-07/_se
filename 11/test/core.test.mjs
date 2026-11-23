import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePayload, normalizeReading, ValidationError } from '../src/validate.js';
import { latestReadings, summarize } from '../src/stats.js';
import { evaluateAlerts } from '../src/rules.js';
import { makeDemoReading } from '../src/demo.js';
import { csvCell, toCsv } from '../src/export.js';
import { hasValidToken, requiresToken } from '../src/auth.js';
import { cwaUrl, toReadings } from '../src/cwa.js';

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

test('makeDemoReading is deterministic with an injected random source', () => {
  const random = () => 0;
  const demo = makeDemoReading(NOW, random);

  assert.equal(demo.device, 'sensor-a1');
  assert.equal(demo.metric, 'temperature');
  assert.equal(demo.timestamp, NOW.toISOString());
  assert.ok(Number.isFinite(demo.value));
});

test('CSV cells are quoted and protected against spreadsheet formulas', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell(-68), '"-68"');
  assert.equal(toCsv([{ device: 'a', metric: 'signal', value: -68, unit: 'dBm', timestamp: 't', receivedAt: 'r' }]),
    'device,metric,value,unit,timestamp,receivedAt\r\n'
    + '"a","signal","-68","dBm","t","r"\r\n');
});

test('token protection applies only to write endpoints', () => {
  assert.equal(requiresToken('POST', '/api/telemetry'), true);
  assert.equal(requiresToken('POST', '/api/demo'), true);
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
});

test('toReadings converts CWA stations into telemetry readings', () => {
  const readings = toReadings({
    success: 'true',
    records: {
      Station: [
        {
          StationId: '466920',
          ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
          WeatherElement: { AirTemperature: '26.5', RelativeHumidity: '0.72' },
        },
        {
          StationId: '466990',
          ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
          WeatherElement: { AirTemperature: '-99', RelativeHumidity: '1' },
        },
      ],
    },
  }, { now: NOW });

  assert.deepEqual(readings, [
    {
      device: 'cwa-466920',
      metric: 'temperature',
      value: 26.5,
      unit: 'C',
      timestamp: '2026-11-22T20:00:00.000Z',
    },
    {
      device: 'cwa-466920',
      metric: 'humidity',
      value: 72,
      unit: '%',
      timestamp: '2026-11-22T20:00:00.000Z',
    },
    {
      device: 'cwa-466990',
      metric: 'humidity',
      value: 100,
      unit: '%',
      timestamp: '2026-11-22T20:00:00.000Z',
    },
  ]);
});

test('toReadings rejects failed CWA responses', () => {
  assert.throws(
    () => toReadings({ success: 'false', result: { message: '授權碼錯誤' } }),
    /授權碼錯誤/,
  );
});
