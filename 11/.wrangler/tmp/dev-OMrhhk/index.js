var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/validate.js
var ValidationError = class extends Error {
  static {
    __name(this, "ValidationError");
  }
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
};
var ALLOWED_METRICS = /* @__PURE__ */ new Set(["temperature", "humidity", "voltage", "signal"]);
var DEFAULT_UNITS = {
  temperature: "C",
  humidity: "%",
  voltage: "V",
  signal: "dBm"
};
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
__name(isObject, "isObject");
function normalizeReading(input, now = /* @__PURE__ */ new Date()) {
  if (!isObject(input)) {
    throw new ValidationError("reading must be a JSON object");
  }
  const device = typeof input.device === "string" ? input.device.trim() : "";
  const metric = typeof input.metric === "string" ? input.metric.trim().toLowerCase() : "";
  if (!device || device.length > 64) {
    throw new ValidationError("device must be a non-empty string (max 64 chars)");
  }
  if (!metric || metric.length > 32) {
    throw new ValidationError("metric must be a non-empty string (max 32 chars)");
  }
  if (!ALLOWED_METRICS.has(metric)) {
    throw new ValidationError(`unsupported metric: ${metric}`);
  }
  const value = typeof input.value === "number" ? input.value : Number(input.value);
  if (!Number.isFinite(value)) {
    throw new ValidationError("value must be a finite number");
  }
  if (Math.abs(value) > 1e6) {
    throw new ValidationError("value is out of range");
  }
  const unit = typeof input.unit === "string" && input.unit.trim() ? input.unit.trim().slice(0, 16) : DEFAULT_UNITS[metric];
  let timestamp;
  if (input.timestamp === void 0 || input.timestamp === null || input.timestamp === "") {
    timestamp = now.toISOString();
  } else {
    const parsed = new Date(input.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError("timestamp must be an ISO 8601 string");
    }
    timestamp = parsed.toISOString();
  }
  return {
    device,
    metric,
    value,
    unit,
    timestamp,
    receivedAt: now.toISOString()
  };
}
__name(normalizeReading, "normalizeReading");
function normalizePayload(body, now = /* @__PURE__ */ new Date()) {
  if (!isObject(body)) {
    throw new ValidationError("payload must be a JSON object");
  }
  const items = Array.isArray(body.readings) ? body.readings : [body];
  if (items.length === 0) {
    throw new ValidationError("no readings provided");
  }
  if (items.length > 100) {
    throw new ValidationError("too many readings (max 100 per request)");
  }
  return items.map((item) => normalizeReading(item, now));
}
__name(normalizePayload, "normalizePayload");

// src/stats.js
function keyOf(device, metric) {
  return `${device}::${metric}`;
}
__name(keyOf, "keyOf");
function summarize(readings) {
  const groups = /* @__PURE__ */ new Map();
  for (const reading of readings) {
    const key = keyOf(reading.device, reading.metric);
    let group = groups.get(key);
    if (!group) {
      group = {
        device: reading.device,
        metric: reading.metric,
        unit: reading.unit || "",
        count: 0,
        min: reading.value,
        max: reading.value,
        sum: 0,
        latest: reading.value,
        latestAt: reading.timestamp
      };
      groups.set(key, group);
    }
    group.count += 1;
    group.sum += reading.value;
    if (reading.value < group.min) group.min = reading.value;
    if (reading.value > group.max) group.max = reading.value;
    if (reading.timestamp >= group.latestAt) {
      group.latest = reading.value;
      group.latestAt = reading.timestamp;
      group.unit = reading.unit || group.unit;
    }
  }
  return [...groups.values()].map(({ sum, ...group }) => ({
    ...group,
    avg: sum / group.count
  })).sort((a, b) => a.device.localeCompare(b.device) || a.metric.localeCompare(b.metric));
}
__name(summarize, "summarize");
function latestReadings(readings) {
  const latest = /* @__PURE__ */ new Map();
  for (const reading of readings) {
    const key = keyOf(reading.device, reading.metric);
    const current = latest.get(key);
    if (!current || reading.timestamp >= current.timestamp) {
      latest.set(key, reading);
    }
  }
  return latest;
}
__name(latestReadings, "latestReadings");

// src/rules.js
var RULES = [
  {
    id: "temp-high",
    device: "sensor-a1",
    metric: "temperature",
    operator: ">",
    threshold: 30,
    message: "\u6EAB\u5EA6\u8D85\u904E 30\xB0C"
  },
  {
    id: "humid-high",
    device: "sensor-a1",
    metric: "humidity",
    operator: ">",
    threshold: 70,
    message: "\u6FD5\u5EA6\u8D85\u904E 70%"
  },
  {
    id: "volt-low",
    device: "sensor-a2",
    metric: "voltage",
    operator: "<",
    threshold: 11.5,
    message: "\u96FB\u58D3\u4F4E\u65BC 11.5V"
  },
  {
    id: "signal-low",
    device: "sensor-a2",
    metric: "signal",
    operator: "<",
    threshold: -80,
    message: "\u8A0A\u865F\u4F4E\u65BC -80dBm"
  }
];
function compare(value, operator, threshold) {
  switch (operator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    default:
      return false;
  }
}
__name(compare, "compare");
function evaluateAlerts(latest, rules = RULES) {
  const alerts = [];
  for (const rule of rules) {
    const key = `${rule.device}::${rule.metric}`;
    const reading = latest instanceof Map ? latest.get(key) : latest[key];
    if (!reading) continue;
    if (!compare(reading.value, rule.operator, rule.threshold)) continue;
    alerts.push({
      id: rule.id,
      device: rule.device,
      metric: rule.metric,
      value: reading.value,
      unit: reading.unit || "",
      threshold: rule.threshold,
      operator: rule.operator,
      message: rule.message,
      timestamp: reading.timestamp
    });
  }
  return alerts;
}
__name(evaluateAlerts, "evaluateAlerts");

// src/demo.js
var DEVICES = [
  {
    device: "sensor-a1",
    metrics: [
      { metric: "temperature", unit: "C", base: 26, spread: 4, spike: 34 },
      { metric: "humidity", unit: "%", base: 58, spread: 10, spike: 76 }
    ]
  },
  {
    device: "sensor-a2",
    metrics: [
      { metric: "voltage", unit: "V", base: 12.1, spread: 0.6, spike: 11.1 },
      { metric: "signal", unit: "dBm", base: -68, spread: 9, spike: -86 }
    ]
  },
  {
    device: "gateway-01",
    metrics: [
      { metric: "temperature", unit: "C", base: 31, spread: 3, spike: 39 },
      { metric: "signal", unit: "dBm", base: -72, spread: 8, spike: -88 }
    ]
  }
];
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
__name(round, "round");
function makeDemoReading(now = /* @__PURE__ */ new Date(), random = Math.random) {
  const group = DEVICES[Math.floor(random() * DEVICES.length)];
  const spec = group.metrics[Math.floor(random() * group.metrics.length)];
  const spike = random() < 0.18;
  const center = spike ? spec.spike : spec.base;
  const value = round(center + (random() - 0.5) * spec.spread * 2);
  return normalizeReading({
    device: group.device,
    metric: spec.metric,
    value,
    unit: spec.unit,
    timestamp: now.toISOString()
  }, now);
}
__name(makeDemoReading, "makeDemoReading");

// worker/index.js
var HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}
__name(json, "json");
function fail(status, error, message) {
  return json({ ok: false, error, message }, status);
}
__name(fail, "fail");
async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("invalid JSON body");
  }
}
__name(readBody, "readBody");
function limitOf(value, fallback, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}
__name(limitOf, "limitOf");
async function insertReadings(db, readings) {
  const statement = db.prepare(
    "INSERT INTO readings (device, metric, value, unit, ts, received_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const reading of readings) {
    await statement.bind(
      reading.device,
      reading.metric,
      reading.value,
      reading.unit,
      reading.timestamp,
      reading.receivedAt
    ).run();
  }
}
__name(insertReadings, "insertReadings");
async function selectReadings(db, { device, metric, limit }) {
  const clauses = [];
  const binds = [];
  if (device) {
    clauses.push("device = ?");
    binds.push(device);
  }
  if (metric) {
    clauses.push("metric = ?");
    binds.push(metric);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT device, metric, value, unit, ts AS timestamp, received_at AS receivedAt
               FROM readings ${where}
               ORDER BY ts DESC, id DESC
               LIMIT ?`;
  binds.push(limit);
  const { results } = await db.prepare(sql).bind(...binds).all();
  return (results ?? []).map((row) => ({
    ...row,
    value: Number(row.value)
  }));
}
__name(selectReadings, "selectReadings");
async function countReadings(db) {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM readings").first();
  return Number(row?.total ?? 0);
}
__name(countReadings, "countReadings");
async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type"
      }
    });
  }
  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "telemetry-hub", time: (/* @__PURE__ */ new Date()).toISOString() });
  }
  if (path === "/api/telemetry" && method === "POST") {
    const readings = normalizePayload(await readBody(request));
    await insertReadings(db, readings);
    return json({ ok: true, accepted: readings.length, total: await countReadings(db) }, 201);
  }
  if (path === "/api/demo" && method === "POST") {
    const reading = normalizeReading(makeDemoReading());
    await insertReadings(db, [reading]);
    return json({ ok: true, accepted: 1, reading, total: await countReadings(db) }, 201);
  }
  if (path === "/api/readings" && method === "GET") {
    const readings = await selectReadings(db, {
      device: url.searchParams.get("device"),
      metric: url.searchParams.get("metric"),
      limit: limitOf(url.searchParams.get("limit"), 100, 500)
    });
    return json({ ok: true, readings, count: readings.length });
  }
  if (path === "/api/stats" && method === "GET") {
    const readings = await selectReadings(db, { limit: 500 });
    return json({ ok: true, stats: summarize(readings) });
  }
  if (path === "/api/alerts" && method === "GET") {
    const readings = await selectReadings(db, { limit: 500 });
    return json({ ok: true, alerts: evaluateAlerts(latestReadings(readings)) });
  }
  if (path === "/api/summary" && method === "GET") {
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
      lastSeen: readings[0]?.timestamp ?? null
    });
  }
  if (path === "/api/readings" && method === "DELETE") {
    await db.prepare("DELETE FROM readings").run();
    return json({ ok: true, deleted: true, total: 0 });
  }
  return fail(404, "NOT_FOUND", `unknown endpoint: ${method} ${path}`);
}
__name(handleApi, "handleApi");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        if (error instanceof ValidationError) {
          return fail(400, "INVALID_PAYLOAD", error.message);
        }
        console.error("[telemetry-hub]", error);
        return fail(500, "INTERNAL_ERROR", "unexpected server error");
      }
    }
    return env.ASSETS.fetch(request);
  }
};

// ../09/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../09/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-SztKnA/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../09/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-SztKnA/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
