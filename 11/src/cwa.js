const OBSERVATION_DATASET_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001';
const FORECAST_DATASET_URL = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-089';
const TEMPERATURE_ELEMENTS = new Set(['溫度', 'T', '氣溫', 'temperature']);
const HUMIDITY_ELEMENTS = new Set(['相對濕度', 'RH', '濕度', 'humidity']);

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

function forecastTime(time, fallback) {
  return isoTime(time?.DataTime ?? time?.StartTime ?? time?.dataTime, fallback);
}

function threeHourSlot(value) {
  const match = String(value ?? '').match(/T(\d{2}):/);
  return !match || Number(match[1]) % 3 === 0;
}

function elementFields(name) {
  if (TEMPERATURE_ELEMENTS.has(name)) return { metric: 'temperature', keys: ['Temperature', 'T', 'temperature'] };
  if (HUMIDITY_ELEMENTS.has(name)) return { metric: 'humidity', keys: ['RelativeHumidity', 'RH', 'humidity'] };
  return null;
}

function elementValue(time, keys) {
  const values = Array.isArray(time?.ElementValue) ? time.ElementValue : [time?.ElementValue ?? {}];
  for (const key of keys) {
    const found = values.find((item) => item?.[key] !== undefined);
    if (found) return numeric(found[key]);
  }
  return null;
}

function placeOf(station, name) {
  const town = String(station?.GeoInfo?.TownName ?? station?.TownName ?? '').trim();
  return town && town !== name ? `${name}（${town}）` : name;
}

function stationReadings(station, fallbackTime) {
  const id = String(station?.StationId ?? station?.stationId ?? '').trim();
  if (!id) return [];

  const region = String(station?.StationName ?? station?.locationName ?? station?.stationName ?? '').trim();
  const place = placeOf(station, region);
  const weather = station.WeatherElement ?? {};
  const timestamp = isoTime(station.ObsTime?.DateTime ?? station.obsTime?.DateTime, fallbackTime);
  const temperature = numeric(weather.AirTemperature ?? weather.TEMP);
  const rawHumidity = numeric(weather.RelativeHumidity ?? weather.HUMD);
  const humidity = rawHumidity !== null && rawHumidity <= 1 ? rawHumidity * 100 : rawHumidity;
  const device = `cwa-${id}`;
  const readings = [];

  if (temperature !== null) {
    readings.push({ device, region, station: place, metric: 'temperature', value: temperature, unit: 'C', timestamp });
  }
  if (humidity !== null) {
    readings.push({
      device,
      region,
      station: place,
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

  const region = String(location?.locationName ?? location?.StationName ?? '').trim();
  const place = placeOf(location, region);
  const elements = Array.isArray(location.weatherElement) ? location.weatherElement : [];
  const elementValue = (name) => elements.find((item) => item.elementName === name)?.elementValue;
  const timestamp = isoTime(location.time ?? location.obsTime, fallbackTime);
  const temperature = numeric(elementValue('TEMP'));
  const humidity = numeric(elementValue('HUMD'));
  const device = `cwa-${id}`;
  const readings = [];

  if (temperature !== null) {
    readings.push({ device, region, station: place, metric: 'temperature', value: temperature, unit: 'C', timestamp });
  }
  if (humidity !== null) {
    readings.push({
      device,
      region,
      station: place,
      metric: 'humidity',
      value: humidity <= 1 ? Math.round(humidity * 1000) / 10 : humidity,
      unit: '%',
      timestamp,
    });
  }
  return readings;
}

export function cwaUrl(key, stationIds = '', county = '') {
  const url = new URL(OBSERVATION_DATASET_URL);
  url.searchParams.set('Authorization', key);
  url.searchParams.set('format', 'JSON');
  if (stationIds) url.searchParams.set('StationId', stationIds);
  if (county) url.searchParams.set('CountyName', county);
  return url.toString();
}

export function cwaForecastUrl(key, county = '') {
  const url = new URL(FORECAST_DATASET_URL);
  url.searchParams.set('Authorization', key);
  url.searchParams.set('format', 'JSON');
  if (county) url.searchParams.set('LocationName', county);
  return url.toString();
}

function countyOf(station) {
  return String(station?.GeoInfo?.CountyName ?? station?.CountyName ?? station?.CITY ?? '').trim();
}

export function toReadings(payload, { limit = 24, now = new Date(), region = '' } = {}) {
  if (payload?.success === false || payload?.success === 'false') {
    throw new Error(payload?.result?.message ?? 'CWA API 回傳失敗');
  }

  const stations = payload?.records?.Station ?? payload?.records?.location ?? [];
  if (!Array.isArray(stations)) return [];

  const fallback = now.toISOString();
  const readings = [];
  for (const station of stations) {
    if (readings.length >= limit) break;
    if (region && countyOf(station) !== region) continue;
    const converted = Array.isArray(station?.weatherElement)
      ? locationReadings(station, fallback)
      : stationReadings(station, fallback);
    readings.push(...(region ? converted.map((reading) => ({ ...reading, region })) : converted));
  }
  return readings.slice(0, limit);
}

function forecastLocationReadings(location, fallback, region) {
  const county = String(location?.LocationName ?? location?.countyName ?? '').trim();
  const town = String(location?.TownName ?? location?.townName ?? '').trim();
  if (region && county !== region && town !== region) return [];

  const geocode = String(location?.Geocode ?? location?.geocode ?? '').trim();
  if (!geocode) return [];

  const station = town && town !== county ? `${county}（${town}）` : (county || town);
  const device = `cwa-fx-${geocode}`;
  const buckets = new Map();
  const elements = Array.isArray(location?.WeatherElement) ? location.WeatherElement : [];

  for (const element of elements) {
    const fields = elementFields(String(element?.ElementName ?? '').trim());
    if (!fields) continue;
    const times = Array.isArray(element.Time) ? element.Time : [];
    for (const time of times) {
      const rawTime = time?.DataTime ?? time?.StartTime ?? time?.dataTime;
      if (!threeHourSlot(rawTime)) continue;
      const timestamp = forecastTime(time, fallback);
      const value = elementValue(time, fields.keys);
      if (value === null) continue;
      if (!buckets.has(timestamp)) {
        buckets.set(timestamp, { device, region: region || county, station: station || county });
      }
      buckets.get(timestamp)[fields.metric] = fields.metric === 'humidity'
        ? Math.round(value * 10) / 10
        : value;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([timestamp, bucket]) => {
      const readings = [];
      if (bucket.temperature !== undefined) {
        readings.push({
          device: bucket.device,
          region: bucket.region,
          station: bucket.station,
          metric: 'temperature',
          value: bucket.temperature,
          unit: 'C',
          timestamp,
        });
      }
      if (bucket.humidity !== undefined) {
        readings.push({
          device: bucket.device,
          region: bucket.region,
          station: bucket.station,
          metric: 'humidity',
          value: bucket.humidity,
          unit: '%',
          timestamp,
        });
      }
      return readings;
    });
}

export function toForecastReadings(payload, { limit = 4000, region = '', now = new Date() } = {}) {
  if (payload?.success === false || payload?.success === 'false') {
    throw new Error(payload?.result?.message ?? 'CWA API 回傳失敗');
  }

  const groups = payload?.records?.Locations ?? payload?.records?.location ?? [];
  if (!Array.isArray(groups)) return [];

  const fallback = now.toISOString();
  const readings = [];
  for (const group of groups) {
    const locations = Array.isArray(group?.Location) ? group.Location : [group];
    for (const location of locations) {
      if (readings.length >= limit) break;
      readings.push(...forecastLocationReadings(location, fallback, region));
    }
    if (readings.length >= limit) break;
  }
  return readings.slice(0, limit);
}
