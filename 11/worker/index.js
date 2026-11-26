import { normalizePayload, normalizeReading, ValidationError } from '../src/validate.js';
import { RULES, evaluateAlerts } from '../src/rules.js';
import { requiresToken, hasValidToken } from '../src/auth.js';
import { aggregateReadings } from '../src/aggregate.js';
import { syncAlertState } from '../src/notify.js';
import { toCsv } from '../src/export.js';
import { cwaForecastUrl, cwaUrl, toForecastReadings, toReadings } from '../src/cwa.js';
import { makeSimulatedReadings } from '../src/simulate.js';

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

async function readOptionalBody(request) {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
}

function regionOf(body) {
  return typeof body?.region === 'string' ? body.region.trim().slice(0, 64) : '';
}

function cwaModeOf(body) {
  return body?.mode === 'observation' ? 'observation' : 'forecast';
}

function regionParam(url) {
  return url.searchParams.get('region')?.trim().slice(0, 64) ?? '';
}

function limitOf(value, fallback, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function insertReadings(db, readings) {
  const sql = 'INSERT OR IGNORE INTO readings (device, region, station, metric, value, unit, ts, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  const statements = readings.map((reading) => db.prepare(sql).bind(
    reading.device,
    reading.region ?? '',
    reading.station ?? '',
    reading.metric,
    reading.value,
    reading.unit,
    reading.timestamp,
    reading.receivedAt,
  ));

  for (let offset = 0; offset < statements.length; offset += 500) {
    const chunk = statements.slice(offset, offset + 500);
    if (typeof db.batch === 'function') {
      await db.batch(chunk);
    } else {
      for (const statement of chunk) await statement.run();
    }
  }
}

async function fetchCwaPayload(env, region, mode = 'forecast') {
  const url = mode === 'forecast'
    ? cwaForecastUrl(env.CWA_API_KEY, region)
    : cwaUrl(env.CWA_API_KEY, region ? '' : (env.CWA_STATIONS ?? ''), region);
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.success === false || payload?.success === 'false') {
        throw new Error(payload?.result?.message ?? 'CWA API 回傳失敗');
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError;
}

async function importCwa(db, env, region = '', { notify = true, mode = 'forecast' } = {}) {
  const payload = await fetchCwaPayload(env, region, mode);
  const readings = (mode === 'forecast'
    ? toForecastReadings(payload, { limit: 6000, region })
    : toReadings(payload, { limit: 2000, region }))
    .map((reading) => normalizeReading(reading));
  if (readings.length === 0) {
    throw new Error(region ? `${region} 沒有可用的溫度或濕度測站` : '沒有可用的溫度或濕度數值');
  }

  await insertReadings(db, readings);
  if (notify) await notifyAlerts(db, env);
  return readings;
}

async function selectReadings(db, { device, metric, region, limit }) {
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
  if (region) {
    clauses.push('region = ?');
    binds.push(region);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT device, region, station, metric, value, unit, ts AS timestamp, received_at AS receivedAt
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

async function countReadings(db, region = '') {
  const sql = region
    ? 'SELECT COUNT(*) AS total FROM readings WHERE region = ?'
    : 'SELECT COUNT(*) AS total FROM readings';
  const statement = db.prepare(sql);
  const row = await (region ? statement.bind(region) : statement).first();
  return Number(row?.total ?? 0);
}

async function notifyAlerts(db, env) {
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    const { latest } = await aggregateReadings(db);
    await syncAlertState(db, evaluateAlerts(latest), env);
  } catch (error) {
    console.error('[telemetry-hub] alert notification failed', error);
  }
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
        'access-control-allow-headers': 'content-type, authorization',
      },
    });
  }

  if (requiresToken(method, path) && !hasValidToken(request, env)) {
    return fail(401, 'UNAUTHORIZED', 'missing or invalid API token');
  }

  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true, service: 'telemetry-hub', time: new Date().toISOString() });
  }

  if (path === '/api/telemetry' && method === 'POST') {
    const readings = normalizePayload(await readBody(request));
    await insertReadings(db, readings);
    await notifyAlerts(db, env);
    return json({ ok: true, accepted: readings.length, total: await countReadings(db) }, 201);
  }

  if (path === '/api/simulate' && method === 'POST') {
    const region = regionOf(await readOptionalBody(request));
    const readings = makeSimulatedReadings({ region });
    await insertReadings(db, readings);
    await notifyAlerts(db, env);
    return json({ ok: true, accepted: readings.length, total: await countReadings(db) }, 201);
  }

  if (path === '/api/import/cwa' && method === 'POST') {
    if (!env.CWA_API_KEY) {
      return fail(503, 'CWA_NOT_CONFIGURED', '尚未設定 CWA_API_KEY');
    }

    const body = await readOptionalBody(request);
    const region = regionOf(body);
    const mode = cwaModeOf(body);

    try {
      const readings = await importCwa(db, env, region, { mode });
      return json({ ok: true, accepted: readings.length, total: await countReadings(db) }, 201);
    } catch (error) {
      return fail(502, 'CWA_FETCH_FAILED', `無法取得中央氣象署資料：${error.message}`);
    }
  }

  if (path === '/api/readings' && method === 'GET') {
    const readings = await selectReadings(db, {
      device: url.searchParams.get('device'),
      metric: url.searchParams.get('metric'),
      region: regionParam(url),
      limit: limitOf(url.searchParams.get('limit'), 100, 500),
    });
    return json({ ok: true, readings, count: readings.length });
  }

  if (path === '/api/stats' && method === 'GET') {
    const { stats } = await aggregateReadings(db, regionParam(url));
    return json({ ok: true, stats });
  }

  if (path === '/api/alerts' && method === 'GET') {
    const { latest } = await aggregateReadings(db, regionParam(url));
    return json({ ok: true, alerts: evaluateAlerts(latest) });
  }

  if (path === '/api/summary' && method === 'GET') {
    const region = regionParam(url);
    const { stats, latest } = await aggregateReadings(db, region);
    const recent = await selectReadings(db, { region, limit: 60 });
    const alerts = evaluateAlerts(latest);
    const devices = new Set(stats.map((item) => item.device));

    return json({
      ok: true,
      stats,
      alerts,
      rules: RULES,
      recent,
      total: await countReadings(db, region),
      devices: devices.size,
      lastSeen: recent[0]?.timestamp ?? null,
    });
  }

  if (path === '/api/export' && method === 'GET') {
    const readings = await selectReadings(db, {
      device: url.searchParams.get('device'),
      metric: url.searchParams.get('metric'),
      region: regionParam(url),
      limit: limitOf(url.searchParams.get('limit'), 5000, 10000),
    });
    const date = new Date().toISOString().slice(0, 10);

    return new Response(toCsv(readings), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="telemetry-${date}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  if (path === '/api/readings' && method === 'DELETE') {
    await db.prepare('DELETE FROM readings').run();
    try {
      await db.prepare('DELETE FROM alert_state').run();
    } catch (error) {
      console.error('[telemetry-hub] could not reset alert state', error);
    }
    return json({ ok: true, deleted: true, total: 0 });
  }

  return fail(404, 'NOT_FOUND', `unknown endpoint: ${method} ${path}`);
}

export default {
  async scheduled(_controller, env) {
    const regions = String(env.CWA_REGIONS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const targets = regions.length ? regions : [''];

    for (const region of targets) {
      try {
        await insertReadings(env.DB, makeSimulatedReadings({ region }));
      } catch (error) {
        console.error(`[telemetry-hub] simulated sensor import failed (${region || 'all'})`, error);
      }

      if (!env.CWA_API_KEY) continue;
      try {
        await importCwa(env.DB, env, region, { notify: false, mode: 'observation' });
      } catch (error) {
        console.error(`[telemetry-hub] CWA scheduled import failed (${region || 'all'})`, error);
      }
    }

    try {
      await notifyAlerts(env.DB, env);
    } catch (error) {
      console.error('[telemetry-hub] scheduled alert notification failed', error);
    }
  },

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
