const DATASET_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001';

function numeric(value) {
  if (value === null || value === undefined || value === '' || value === '-99') return null;
  if (typeof value === 'string' && /^x$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoTime(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function stationReadings(station, fallbackTime) {
  const id = String(station?.StationId ?? station?.stationId ?? '').trim();
  if (!id) return [];

  const weather = station.WeatherElement ?? {};
  const timestamp = isoTime(station.ObsTime?.DateTime ?? station.obsTime?.DateTime, fallbackTime);
  const temperature = numeric(weather.AirTemperature ?? weather.TEMP);
  const rawHumidity = numeric(weather.RelativeHumidity ?? weather.HUMD);
  const humidity = rawHumidity !== null && rawHumidity <= 1 ? rawHumidity * 100 : rawHumidity;
  const device = `cwa-${id}`;
  const readings = [];

  if (temperature !== null) {
    readings.push({ device, metric: 'temperature', value: temperature, unit: 'C', timestamp });
  }
  if (humidity !== null) {
    readings.push({
      device,
      metric: 'humidity',
      value: Math.round(humidity * 10) / 10,
      unit: '%',
      timestamp,
    });
  }
  return readings;
}

function locationReadings(location, fallbackTime) {
  const id = String(location?.stationId ?? location?.StationId ?? '').trim();
  if (!id) return [];

  const elements = Array.isArray(location.weatherElement) ? location.weatherElement : [];
  const elementValue = (name) => elements.find((item) => item.elementName === name)?.elementValue;
  const timestamp = isoTime(location.time ?? location.obsTime, fallbackTime);
  const temperature = numeric(elementValue('TEMP'));
  const humidity = numeric(elementValue('HUMD'));
  const device = `cwa-${id}`;
  const readings = [];

  if (temperature !== null) {
    readings.push({ device, metric: 'temperature', value: temperature, unit: 'C', timestamp });
  }
  if (humidity !== null) {
    readings.push({
      device,
      metric: 'humidity',
      value: humidity <= 1 ? Math.round(humidity * 1000) / 10 : humidity,
      unit: '%',
      timestamp,
    });
  }
  return readings;
}

export function cwaUrl(key, stationIds = '') {
  const url = new URL(DATASET_URL);
  url.searchParams.set('Authorization', key);
  url.searchParams.set('format', 'JSON');
  if (stationIds) url.searchParams.set('StationId', stationIds);
  return url.toString();
}

export function toReadings(payload, { limit = 24, now = new Date() } = {}) {
  if (payload?.success === false || payload?.success === 'false') {
    throw new Error(payload?.result?.message ?? 'CWA API 回傳失敗');
  }

  const stations = payload?.records?.Station ?? payload?.records?.location ?? [];
  if (!Array.isArray(stations)) return [];

  const fallback = now.toISOString();
  const readings = [];
  for (const station of stations) {
    if (readings.length >= limit) break;
    const converted = Array.isArray(station?.weatherElement)
      ? locationReadings(station, fallback)
      : stationReadings(station, fallback);
    readings.push(...converted);
  }
  return readings.slice(0, limit);
}
