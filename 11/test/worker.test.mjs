import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker/index.js';

function createMockD1() {
  const rows = [];
  let nextId = 1;

  function select(sql, binds) {
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

async function call(path, options, db = createMockD1()) {
  const request = new Request(`http://localhost${path}`, options);
  return { response: await worker.fetch(request, makeEnv(db)), db };
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
