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
      const region = sql.includes('WHERE region = ?') ? binds[0] : '';
      return summarize(rows
        .filter((row) => !region || row.region === region)
        .map(({ id, ...row }) => row)).map((item) => ({
        device: item.device,
        region: item.region,
        station: item.station,
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
    const region = sql.includes('region = ?') ? binds[index++] : null;
    const limit = binds[index] ?? 100;

    return rows
      .filter((row) => !device || row.device === device)
      .filter((row) => !metric || row.metric === metric)
      .filter((row) => !region || row.region === region)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id - a.id)
      .slice(0, limit)
      .map(({ id, ...row }) => row);
  }

  async function batch(statements) {
    for (const statement of statements) await statement.run();
    return [];
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
        if (sql.includes('COUNT(*)')) {
          const region = sql.includes('WHERE region = ?') ? binds[0] : '';
          return { total: rows.filter((row) => !region || row.region === region).length };
        }
        return null;
      },
      async run() {
        if (sql.startsWith('INSERT OR IGNORE INTO readings')) {
          const duplicate = rows.some((row) => row.device === binds[0]
            && row.metric === binds[3] && row.timestamp === binds[6]);
          if (duplicate) return { success: true, meta: { changes: 0 } };
          rows.push({
            id: nextId++,
            device: binds[0],
            region: binds[1],
            station: binds[2],
            metric: binds[3],
            value: binds[4],
            unit: binds[5],
            timestamp: binds[6],
            receivedAt: binds[7],
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

  return { prepare, batch };
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

function forecastPayload(regions = ['金門縣']) {
  return {
    success: 'true',
    records: {
      Locations: [{
        Location: regions.map((region, index) => ({
          LocationName: region,
          Geocode: `0902000${index}`,
          WeatherElement: [
            {
              ElementName: '溫度',
              Time: [
                { DataTime: '2026-11-27T00:00:00+08:00', ElementValue: [{ Temperature: '17' }] },
                { DataTime: '2026-11-27T01:00:00+08:00', ElementValue: [{ Temperature: '18' }] },
                { DataTime: '2026-11-27T03:00:00+08:00', ElementValue: [{ Temperature: '19' }] },
              ],
            },
            {
              ElementName: '相對濕度',
              Time: [
                { DataTime: '2026-11-27T00:00:00+08:00', ElementValue: [{ RelativeHumidity: '91' }] },
                { DataTime: '2026-11-27T03:00:00+08:00', ElementValue: [{ RelativeHumidity: '89' }] },
              ],
            },
          ],
        })),
      }],
    },
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
  assert.equal(body.rules.length, 4);
});

test('summary, readings and export only include the selected region', async () => {
  const seeded = await call('/api/telemetry', post('/api/telemetry', {
    readings: [
      { device: 'cwa-C0XXX', region: '金門縣', metric: 'temperature', value: 28 },
      { device: 'cwa-466920', region: '臺北市', metric: 'temperature', value: 33.2 },
    ],
  }));
  const region = encodeURIComponent('金門縣');

  const summary = await call(`/api/summary?region=${region}`, undefined, seeded.db);
  const body = await summary.response.json();
  assert.equal(body.total, 1);
  assert.equal(body.devices, 1);
  assert.equal(body.stats.length, 1);
  assert.equal(body.recent.length, 1);
  assert.ok(body.stats.every((item) => item.region === '金門縣'));
  assert.ok(body.recent.every((item) => item.region === '金門縣'));
  assert.equal(body.alerts.length, 0);

  const stats = await call(`/api/stats?region=${region}`, undefined, seeded.db);
  assert.equal((await stats.response.json()).stats.length, 1);

  const readings = await call(`/api/readings?region=${region}`, undefined, seeded.db);
  const list = await readings.response.json();
  assert.equal(list.count, 1);
  assert.equal(list.readings[0].region, '金門縣');

  const exported = await call(`/api/export?region=${region}`, undefined, seeded.db);
  const csv = await exported.response.text();
  assert.match(csv, /金門縣/);
  assert.doesNotMatch(csv, /臺北市/);
});

test('demo endpoint is no longer available', async () => {
  const { response } = await call('/api/demo', post('/api/demo', {}));
  assert.equal(response.status, 404);
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

test('CWA import endpoint requires configuration and stores a forecast time series by default', async () => {
  const missing = await call('/api/import/cwa', { method: 'POST' });
  assert.equal(missing.response.status, 503);
  assert.equal((await missing.response.json()).error, 'CWA_NOT_CONFIGURED');

  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(forecastPayload()), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const imported = await call('/api/import/cwa', { method: 'POST' }, createMockD1(), {
      CWA_API_KEY: 'CWA-test',
    });
    assert.equal(imported.response.status, 201);
    assert.deepEqual(await imported.response.json(), { ok: true, accepted: 4, total: 4 });
    assert.equal(new URL(requestedUrl).pathname, '/api/v1/rest/datastore/F-D0047-089');

    const list = await call('/api/readings?limit=10', undefined, imported.db);
    const body = await list.response.json();
    assert.ok(body.readings.every((item) => item.device === 'cwa-fx-09020000'));
    assert.deepEqual(body.readings.map((item) => item.metric).sort(), ['humidity', 'humidity', 'temperature', 'temperature']);
    assert.equal(new Set(body.readings.map((item) => item.timestamp)).size, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('repeated CWA forecast imports do not duplicate station timestamps', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(forecastPayload()), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

  try {
    const first = await call('/api/import/cwa', { method: 'POST' }, createMockD1(), { CWA_API_KEY: 'CWA-test' });
    await call('/api/import/cwa', { method: 'POST' }, first.db, { CWA_API_KEY: 'CWA-test' });
    const result = await first.response.json();
    const list = await call('/api/readings?limit=100', undefined, first.db);
    assert.equal(result.total, 4);
    assert.equal((await list.response.json()).count, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CWA import retries a transient upstream failure', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response('internal error', { status: 500 });
    return new Response(JSON.stringify(forecastPayload()), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const imported = await call('/api/import/cwa', post('/api/import/cwa', { region: '金門縣' }), createMockD1(), {
      CWA_API_KEY: 'CWA-test',
    });
    assert.equal(imported.response.status, 201);
    assert.equal((await imported.response.json()).accepted, 4);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CWA import endpoint loads forecast locations from the selected region', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(forecastPayload(['臺北市', '高雄市'])), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const imported = await call(
      '/api/import/cwa',
      post('/api/import/cwa', { region: '高雄市' }),
      createMockD1(),
      { CWA_API_KEY: 'CWA-test' },
    );
    assert.equal(imported.response.status, 201);
    assert.equal((await imported.response.json()).accepted, 4);
    assert.equal(new URL(requestedUrl).searchParams.get('LocationName'), '高雄市');

    const list = await call('/api/readings?limit=10', undefined, imported.db);
    const body = await list.response.json();
    assert.ok(body.readings.every((item) => item.device === 'cwa-fx-09020001'
      && item.region === '高雄市' && item.station === '高雄市'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled handler imports real CWA observations and simulates all four metrics', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      success: 'true',
      records: {
        Station: [{
          StationId: 'C0W140', StationName: '金門', GeoInfo: { CountyName: '金門縣', TownName: '金城鎮' },
          ObsTime: { DateTime: '2026-11-23T04:00:00+08:00' },
          WeatherElement: { AirTemperature: '16.8', RelativeHumidity: '60' },
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const db = createMockD1();
    await worker.scheduled({}, { ...makeEnv(db), CWA_API_KEY: 'CWA-test', CWA_REGIONS: '金門縣' });
    assert.equal(new URL(requestedUrl).searchParams.get('CountyName'), '金門縣');

    const list = await call('/api/readings?limit=100', undefined, db);
    const body = await list.response.json();
    assert.equal(body.readings.length, 26);
    assert.ok(body.readings.every((item) => item.region === '金門縣'));

    const cwa = body.readings.filter((item) => item.device === 'cwa-C0W140');
    assert.equal(cwa.length, 2);
    assert.ok(cwa.every((item) => item.station === '金門（金城鎮）'));
    assert.deepEqual(cwa.map((item) => item.metric).sort(), ['humidity', 'temperature']);

    const simulated = body.readings.filter((item) => item.device === 'sensor-a2');
    assert.equal(simulated.length, 24);
    assert.ok(simulated.every((item) => item.station === '模擬感測器'));
    assert.deepEqual([...new Set(simulated.map((item) => item.metric))].sort(),
      ['humidity', 'signal', 'temperature', 'voltage']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled handler still simulates readings without a CWA key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('CWA must not be called'); };

  try {
    const db = createMockD1();
    await worker.scheduled({}, makeEnv(db));

    const list = await call('/api/readings?limit=100', undefined, db);
    const body = await list.response.json();
    assert.equal(body.readings.length, 24);
    assert.ok(body.readings.every((item) => item.device === 'sensor-a2' && item.region === ''));
    assert.deepEqual([...new Set(body.readings.map((item) => item.metric))].sort(),
      ['humidity', 'signal', 'temperature', 'voltage']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('simulate endpoint writes all four metrics through the API', async () => {
  const { response, db } = await call(
    '/api/simulate',
    post('/api/simulate', { region: '金門縣' }),
    createMockD1(),
    { API_TOKEN: 'write-secret' },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, accepted: 24, total: 24 });

  const list = await call('/api/readings?limit=100', undefined, db);
  const body = await list.response.json();
  assert.equal(body.readings.length, 24);
  assert.ok(body.readings.every((item) => item.device === 'sensor-a2' && item.region === '金門縣'));
  assert.deepEqual([...new Set(body.readings.map((item) => item.metric))].sort(),
    ['humidity', 'signal', 'temperature', 'voltage']);
});

test('export endpoint returns filtered and escaped CSV', async () => {
  const seeded = await call('/api/telemetry', post('/api/telemetry', {
    readings: [
      {
        device: '=cmd',
        region: '臺北',
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
  assert.ok(text.startsWith('device,region,station,metric,value,unit,timestamp,receivedAt'));
  assert.match(text, /"'=cmd","臺北","","temperature"/);
  assert.doesNotMatch(text, /sensor-a2/);
});
