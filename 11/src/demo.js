import { normalizeReading } from './validate.js';

const DEVICES = [
  {
    device: 'sensor-a1',
    metrics: [
      { metric: 'temperature', unit: 'C', base: 26, spread: 4, spike: 34 },
      { metric: 'humidity', unit: '%', base: 58, spread: 10, spike: 76 },
    ],
  },
  {
    device: 'sensor-a2',
    metrics: [
      { metric: 'voltage', unit: 'V', base: 12.1, spread: 0.6, spike: 11.1 },
      { metric: 'signal', unit: 'dBm', base: -68, spread: 9, spike: -86 },
    ],
  },
  {
    device: 'gateway-01',
    metrics: [
      { metric: 'temperature', unit: 'C', base: 31, spread: 3, spike: 39 },
      { metric: 'signal', unit: 'dBm', base: -72, spread: 8, spike: -88 },
    ],
  },
];

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function makeDemoReading(now = new Date(), random = Math.random) {
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
    timestamp: now.toISOString(),
  }, now);
}
