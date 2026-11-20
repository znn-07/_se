import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePayload, normalizeReading, ValidationError } from '../src/validate.js';
import { latestReadings, summarize } from '../src/stats.js';
import { evaluateAlerts } from '../src/rules.js';
import { makeDemoReading } from '../src/demo.js';

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
  assert.throws(() => reading({ timestamp: 'not-a-date' }), ValidationError);
});

test('normalizePayload accepts a single reading or a batch', () => {
  assert.equal(normalizePayload({ device: 'a', metric: 'signal', value: -70 }, NOW).length, 1);
  const batch = normalizePayload({ readings: [reading(), reading({ value: 28 })] }, NOW);
  assert.equal(batch.length, 2);
  assert.throws(() => normalizePayload({ readings: [] }), ValidationError);
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
