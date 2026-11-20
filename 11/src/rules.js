export const RULES = [
  {
    id: 'temp-high',
    device: 'sensor-a1',
    metric: 'temperature',
    operator: '>',
    threshold: 30,
    message: '溫度超過 30°C',
  },
  {
    id: 'humid-high',
    device: 'sensor-a1',
    metric: 'humidity',
    operator: '>',
    threshold: 70,
    message: '濕度超過 70%',
  },
  {
    id: 'volt-low',
    device: 'sensor-a2',
    metric: 'voltage',
    operator: '<',
    threshold: 11.5,
    message: '電壓低於 11.5V',
  },
  {
    id: 'signal-low',
    device: 'sensor-a2',
    metric: 'signal',
    operator: '<',
    threshold: -80,
    message: '訊號低於 -80dBm',
  },
];

export function compare(value, operator, threshold) {
  switch (operator) {
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    default: return false;
  }
}

export function evaluateAlerts(latest, rules = RULES) {
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
      unit: reading.unit || '',
      threshold: rule.threshold,
      operator: rule.operator,
      message: rule.message,
      timestamp: reading.timestamp,
    });
  }

  return alerts;
}
