import { normalizePayload, normalizeReading, ValidationError } from '../src/validate.js';
import { summarize, latestReadings } from '../src/stats.js';
import { evaluateAlerts } from '../src/rules.js';
import { makeDemoReading } from '../src/demo.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function fail(status, error, message) {
  return json({ ok: false, error, message }, status);
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
}

function limitOf(value, fallback, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function insertReadings(db, readings) {
  const statement = db.prepare(
    'INSERT INTO readings (device, metric, value, unit, ts, received_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  for (const reading of readings) {
    await statement
      .bind(
        reading.device,
        reading.metric,
        reading.value,
        reading.unit,
        reading.timestamp,
        reading.receivedAt,
      )
      .run();
  }
}

async function selectReadings(db, { device, metric, limit }) {
  const clauses = [];
  const binds = [];

  if (device) {
    clauses.push('device = ?');
    binds.push(device);
  }
  if (metric) {
    clauses.push('metric = ?');
    binds.push(metric);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT device, metric, value, unit, ts AS timestamp, received_at AS receivedAt
               FROM readings ${where}
               ORDER BY ts DESC, id DESC
               LIMIT ?`;
  binds.push(limit);

  const { results } = await db.prepare(sql).bind(...binds).all();
  return (results ?? []).map((row) => ({
    ...row,
    value: Number(row.value),
  }));
}

async function countReadings(db) {
  const row = await db.prepare('SELECT COUNT(*) AS total FROM readings').first();
  return Number(row?.total ?? 0);
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true, service: 'telemetry-hub', time: new Date().toISOString() });
  }

  if (path === '/api/telemetry' && method === 'POST') {
    const readings = normalizePayload(await readBody(request));
    await insertReadings(db, readings);
    return json({ ok: true, accepted: readings.length, total: await countReadings(db) }, 201);
  }

  if (path === '/api/demo' && method === 'POST') {
    const reading = normalizeReading(makeDemoReading());
    await insertReadings(db, [reading]);
    return json({ ok: true, accepted: 1, reading, total: await countReadings(db) }, 201);
  }

  if (path === '/api/readings' && method === 'GET') {
    const readings = await selectReadings(db, {
      device: url.searchParams.get('device'),
      metric: url.searchParams.get('metric'),
      limit: limitOf(url.searchParams.get('limit'), 100, 500),
    });
    return json({ ok: true, readings, count: readings.length });
  }

  if (path === '/api/stats' && method === 'GET') {
    const readings = await selectReadings(db, { limit: 500 });
    return json({ ok: true, stats: summarize(readings) });
  }

  if (path === '/api/alerts' && method === 'GET') {
    const readings = await selectReadings(db, { limit: 500 });
    return json({ ok: true, alerts: evaluateAlerts(latestReadings(readings)) });
  }

  if (path === '/api/summary' && method === 'GET') {
    const readings = await selectReadings(db, { limit: 500 });
    const stats = summarize(readings);
    const alerts = evaluateAlerts(latestReadings(readings));
    const devices = new Set(stats.map((item) => item.device));

    return json({
      ok: true,
      stats,
      alerts,
      recent: readings.slice(0, 60),
      total: await countReadings(db),
      devices: devices.size,
      lastSeen: readings[0]?.timestamp ?? null,
    });
  }

  if (path === '/api/readings' && method === 'DELETE') {
    await db.prepare('DELETE FROM readings').run();
    return json({ ok: true, deleted: true, total: 0 });
  }

  return fail(404, 'NOT_FOUND', `unknown endpoint: ${method} ${path}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        if (error instanceof ValidationError) {
          return fail(400, 'INVALID_PAYLOAD', error.message);
        }
        console.error('[telemetry-hub]', error);
        return fail(500, 'INTERNAL_ERROR', 'unexpected server error');
      }
    }

    return env.ASSETS.fetch(request);
  },
};
