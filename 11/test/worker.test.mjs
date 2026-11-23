import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker/index.js';
import { summarize } from '../src/stats.js';

function createMockD1() {
  const rows = [];
  const alertState = [];
  let nextId = 1;

  function select(sql, binds) {
    if (sql.includes('alert_state')) {
      return alertState.map((row) => ({ ...row }));
    }
    if (sql.includes('ROW_NUMBER() OVER')) {
      return summarize(rows.map(({ id, ...row }) => row)).map((item) => ({
        device: item.device,
        metric: item.metric,
        unit: item.unit,
        latestAt: item.latestAt,
        latest: item.latest,
        count: item.count,
        min: item.min,
        max: item.max,
        avg: item.avg,
      }));
    }

    let index = 0;
    const device = sql.includes('device = ?') ? binds[index++] : null;
    const metric = sql.includes('metric = ?') ? binds[index++] : null;
    const limit = binds[index] ?? 100;

    return rows
      .filter((row) => !device || row.device === device)
      .filter((row) => !metric || row.metric === metric)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id - a.id)
      .slice(0, limit)
      .map(({ id, ...row }) => row);
  }

  function prepare(sql) {
    let binds = [];
    return {
      bind(...values) {
        binds = values;
        return this;
      },
      async all() {
        return { results: select(sql, binds), success: true, meta: {} };
      },
      async first() {
        if (sql.includes('COUNT(*)')) return { total: rows.length };
        return null;
      },
      async run() {
        if (sql.startsWith('INSERT INTO readings')) {
          rows.push({
            id: nextId++,
            device: binds[0],
            metric: binds[1],
            value: binds[2],
            unit: binds[3],
            timestamp: binds[4],
            receivedAt: binds[5],
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith('DELETE FROM readings')) {
          const changes = rows.length;
          rows.length = 0;
          return { success: true, meta: { changes } };
        }
        if (sql.startsWith('INSERT INTO alert_state')) {
          const ruleId = binds[0];
          const existing = alertState.find((row) => row.rule_id === ruleId);
          if (existing) existing.active = binds[1];
          else alertState.push({ rule_id: ruleId, active: binds[1] });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith('DELETE FROM alert_state')) {
          const changes = alertState.length;
          alertState.length = 0;
          return { success: true, meta: { changes } };
        }
        return { success: true, meta: { changes: 0 } };
      },
    };
  }

  return { prepare };
}

function makeEnv(db) {
  return {
    DB: db,
    ASSETS: {
      fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`),
    },
  };
}

async function call(path, options, db = createMockD1(), env = {}) {
  const request = new Request(`http://localhost${path}`, options);
  return { response: await worker.fetch(request, { ...makeEnv(db), ...env }), db };
}

function post(path, body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('health endpoint reports service status', async () => {
  const { response } = await call('/api/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, 'telemetry-hub');
});

test('telemetry endpoint stores a reading and readings endpoint returns it', async () => {
  const { response, db } = await call('/api/telemetry', post('/api/telemetry', {
    device: 'sensor-a1',
    metric: 'temperature',
    value: 27.4,
  }));

  assert.equal(response.status, 201);
  assert.equal((await response.json()).accepted, 1);

  const list = await call('/api/readings?limit=10', undefined, db);
  const body = await list.response.json();
  assert.equal(body.count, 1);
  assert.equal(body.readings[0].value, 27.4);
});

test('telemetry endpoint rejects invalid payloads', async () => {
  const invalid = await call('/api/telemetry', post('/api/telemetry', {
    device: 'sensor-a1',
    metric: 'pressure',
    value: 1,
  }));
  assert.equal(invalid.response.status, 400);
  assert.equal((await invalid.response.json()).error, 'INVALID_PAYLOAD');

  const broken = await call('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  });
  assert.equal(broken.response.status, 400);
});

test('summary combines stats, alerts, recent readings and total', async () => {
  const seeded = await call('/api/telemetry', post('/api/telemetry', {
    device: 'sensor-a1',
    metric: 'temperature',
    value: 33.2,
  }));

  const { response } = await call('/api/summary', undefined, seeded.db);
  const body = await response.json();

  assert.equal(body.total, 1);
  assert.equal(body.devices, 1);
  assert.equal(body.stats.length, 1);
  assert.equal(body.recent.length, 1);
  assert.equal(body.alerts.length, 1);
  assert.equal(body.alerts[0].id, 'temp-high');
});

test('demo endpoint inserts a generated reading', async () => {
  const { response } = await call('/api/demo', { method: 'POST' });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.accepted, 1);
  assert.ok(body.reading.device);
});

test('delete clears readings', async () => {
  const seeded = await call('/api/telemetry', post('/api/telemetry', {
    device: 'sensor-a2',
    metric: 'voltage',
    value: 12,
  }));
  const { response } = await call('/api/readings', { method: 'DELETE' }, seeded.db);
  assert.equal((await response.json()).total, 0);
});

test('unknown API routes return 404 and non-API routes serve assets', async () => {
  const missing = await call('/api/nope');
  assert.equal(missing.response.status, 404);

  const asset = await call('/index.html');
  assert.equal(await asset.response.text(), 'asset:/index.html');
});

test('write endpoints require a bearer token when API_TOKEN is configured', async () => {
  const db = createMockD1();
  const env = { API_TOKEN: 's3cret' };
  const payload = post('/api/telemetry', {
    device: 'sensor-a1',
    metric: 'temperature',
    value: 28,
  });

  const denied = await call('/api/telemetry', payload, db, env);
  assert.equal(denied.response.status, 401);
  assert.equal((await denied.response.json()).error, 'UNAUTHORIZED');

  const authorized = await call('/api/telemetry', {
    ...payload,
    headers: { 'content-type': 'application/json', authorization: 'Bearer s3cret' },
  }, db, env);
  assert.equal(authorized.response.status, 201);

  const read = await call('/api/summary', undefined, db, env);
  assert.equal(read.response.status, 200);
});

test('stats aggregate every stored reading instead of a sampled window', async () => {
  const readings = Array.from({ length: 6 }, (_, index) => ({
    device: 'sensor-a1',
    metric: 'temperature',
    value: 20 + index,
    timestamp: `2026-11-20T0${index}:00:00Z`,
  }));
  const seeded = await call('/api/telemetry', post('/api/telemetry', { readings }));
  const { response } = await call('/api/stats', undefined, seeded.db);
  const body = await response.json();

  assert.equal(body.stats[0].count, 6);
  assert.equal(body.stats[0].latest, 25);
  assert.equal(body.stats[0].avg, 22.5);
});

test('webhook receives only alert transitions', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('{}', { status: 200 });
  };

  try {
    const env = {
      ALERT_WEBHOOK_URL: 'https://example.com/hook',
      ALERT_WEBHOOK_TOKEN: 'hook-secret',
    };
    const high = await call('/api/telemetry', post('/api/telemetry', {
      device: 'sensor-a1',
      metric: 'temperature',
      value: 33,
    }), createMockD1(), env);
    assert.equal(high.response.status, 201);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].options.body).type, 'triggered');
    assert.equal(calls[0].options.headers.authorization, 'Bearer hook-secret');

    const low = await call('/api/telemetry', post('/api/telemetry', {
      device: 'sensor-a1',
      metric: 'temperature',
      value: 26,
    }), high.db, { ...env, ALERT_WEBHOOK_RESOLVE: '1' });
    assert.equal(low.response.status, 201);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1].options.body).type, 'resolved');

    const repeated = await call('/api/telemetry', post('/api/telemetry', {
      device: 'sensor-a1',
      metric: 'temperature',
      value: 26,
    }), low.db, { ...env, ALERT_WEBHOOK_RESOLVE: '1' });
    assert.equal(repeated.response.status, 201);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CWA import endpoint requires configuration and stores real observations', async () => {
  const missing = await call('/api/import/cwa', { method: 'POST' });
  assert.equal(missing.response.status, 503);
  assert.equal((await missing.response.json()).error, 'CWA_NOT_CONFIGURED');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: 'true',
    records: {
      Station: [{
        StationId: '466920',
        ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
        WeatherElement: { AirTemperature: '25.8', RelativeHumidity: '68.4' },
      }],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const imported = await call('/api/import/cwa', { method: 'POST' }, createMockD1(), {
      CWA_API_KEY: 'CWA-test',
    });
    assert.equal(imported.response.status, 201);
    assert.deepEqual(await imported.response.json(), { ok: true, accepted: 2, total: 2 });

    const list = await call('/api/readings?limit=10', undefined, imported.db);
    const body = await list.response.json();
    assert.ok(body.readings.every((item) => item.device === 'cwa-466920'));
    assert.deepEqual(body.readings.map((item) => item.metric).sort(), ['humidity', 'temperature']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('export endpoint returns filtered and escaped CSV', async () => {
  const seeded = await call('/api/telemetry', post('/api/telemetry', {
    readings: [
      {
        device: '=cmd',
        metric: 'temperature',
        value: 31,
        unit: 'C',
        timestamp: '2026-11-20T01:00:00Z',
      },
      { device: 'sensor-a2', metric: 'voltage', value: 12, unit: 'V' },
    ],
  }));
  const { response } = await call('/api/export?device=%3Dcmd', undefined, seeded.db);

  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment/);

  const text = await response.text();
  assert.ok(text.startsWith('device,metric,value,unit,timestamp,receivedAt'));
  assert.match(text, /"'=cmd","temperature"/);
  assert.doesNotMatch(text, /sensor-a2/);
});
