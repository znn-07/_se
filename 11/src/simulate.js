import { normalizeReading } from './validate.js';

const MINUTE = 60_000;
const DEVICE = 'sensor-a2';
const STATION = '模擬感測器';

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function temperatureAt(timestamp, random) {
  const minute = timestamp.getTime() / MINUTE;
  const drift = 26 + 2.2 * Math.sin(minute / 120) + 0.6 * Math.sin(minute / 13);
  return round(clamp(drift + (random() - 0.5) * 0.8, 18, 32), 1);
}

function humidityAt(timestamp, random) {
  const minute = timestamp.getTime() / MINUTE;
  const drift = 62 + 7 * Math.sin(minute / 100) + 2 * Math.sin(minute / 9);
  return round(clamp(drift + (random() - 0.5) * 3, 30, 85), 1);
}

function voltageAt(timestamp, random) {
  const minute = timestamp.getTime() / MINUTE;
  const drift = 12.15 + 0.32 * Math.sin(minute / 95) + 0.08 * Math.sin(minute / 11);
  const dip = random() < 0.04 ? 0.8 : 0;
  return round(clamp(drift + (random() - 0.5) * 0.1 - dip, 10.9, 13.2), 2);
}

function signalAt(timestamp, random) {
  const minute = timestamp.getTime() / MINUTE;
  const drift = -68 + 6 * Math.sin(minute / 43) + 2 * Math.sin(minute / 6);
  const fade = random() < 0.05 ? 12 : 0;
  return round(clamp(drift + (random() - 0.5) * 4 - fade, -95, -45), 0);
}

export function makeSimulatedReadings({
  now = new Date(),
  region = '',
  count = 6,
  random = Math.random,
} = {}) {
  const anchor = Math.floor(now.getTime() / MINUTE) * MINUTE;
  const readings = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const timestamp = new Date(anchor - index * MINUTE);

    for (const [metric, value, unit] of [
      ['temperature', temperatureAt(timestamp, random), 'C'],
      ['humidity', humidityAt(timestamp, random), '%'],
      ['voltage', voltageAt(timestamp, random), 'V'],
      ['signal', signalAt(timestamp, random), 'dBm'],
    ]) {
      readings.push(normalizeReading({
        device: DEVICE,
        region,
        station: STATION,
        metric,
        value,
        unit,
        timestamp: timestamp.toISOString(),
      }, now));
    }
  }

  return readings;
}
