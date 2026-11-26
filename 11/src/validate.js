export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const ALLOWED_METRICS = new Set(['temperature', 'humidity', 'voltage', 'signal']);

const DEFAULT_UNITS = {
  temperature: 'C',
  humidity: '%',
  voltage: 'V',
  signal: 'dBm',
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeReading(input, now = new Date()) {
  if (!isObject(input)) {
    throw new ValidationError('reading must be a JSON object');
  }

  const device = typeof input.device === 'string' ? input.device.trim() : '';
  const metric = typeof input.metric === 'string' ? input.metric.trim().toLowerCase() : '';
  const region = typeof input.region === 'string' ? input.region.trim().slice(0, 64) : '';
  const station = typeof input.station === 'string' ? input.station.trim().slice(0, 64) : '';

  if (!device || device.length > 64) {
    throw new ValidationError('device must be a non-empty string (max 64 chars)');
  }
  if (!metric || metric.length > 32) {
    throw new ValidationError('metric must be a non-empty string (max 32 chars)');
  }
  if (!ALLOWED_METRICS.has(metric)) {
    throw new ValidationError(`unsupported metric: ${metric}`);
  }

  if (typeof input.value !== 'number'
    && (typeof input.value !== 'string' || input.value.trim() === '')) {
    throw new ValidationError('value must be a finite number');
  }
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    throw new ValidationError('value must be a finite number');
  }
  if (Math.abs(value) > 1000000) {
    throw new ValidationError('value is out of range');
  }

  const unit = typeof input.unit === 'string' && input.unit.trim()
    ? input.unit.trim().slice(0, 16)
    : DEFAULT_UNITS[metric];

  let timestamp;
  if (input.timestamp === undefined || input.timestamp === null || input.timestamp === '') {
    timestamp = now.toISOString();
  } else if (typeof input.timestamp !== 'string') {
    throw new ValidationError('timestamp must be an ISO 8601 string');
  } else {
    const parsed = new Date(input.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError('timestamp must be an ISO 8601 string');
    }
    timestamp = parsed.toISOString();
  }

  return {
    device,
    region,
    station,
    metric,
    value,
    unit,
    timestamp,
    receivedAt: now.toISOString(),
  };
}

export function normalizePayload(body, now = new Date()) {
  if (!isObject(body)) {
    throw new ValidationError('payload must be a JSON object');
  }

  if (body.readings !== undefined && !Array.isArray(body.readings)) {
    throw new ValidationError('readings must be an array');
  }

  const items = Array.isArray(body.readings) ? body.readings : [body];
  if (items.length === 0) {
    throw new ValidationError('no readings provided');
  }
  if (items.length > 100) {
    throw new ValidationError('too many readings (max 100 per request)');
  }

  return items.map((item) => normalizeReading(item, now));
}
