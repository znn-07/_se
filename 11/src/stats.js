function keyOf(device, metric) {
  return `${device}::${metric}`;
}

export function summarize(readings) {
  const groups = new Map();

  for (const reading of readings) {
    const key = keyOf(reading.device, reading.metric);
    let group = groups.get(key);

    if (!group) {
      group = {
        device: reading.device,
        region: reading.region || '',
        station: reading.station || '',
        metric: reading.metric,
        unit: reading.unit || '',
        count: 0,
        min: reading.value,
        max: reading.value,
        sum: 0,
        latest: reading.value,
        latestAt: reading.timestamp,
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
      group.region = reading.region || group.region;
      group.station = reading.station || group.station;
    }
  }

  return [...groups.values()]
    .map(({ sum, ...group }) => ({
      ...group,
      avg: sum / group.count,
    }))
    .sort((a, b) => a.device.localeCompare(b.device) || a.metric.localeCompare(b.metric));
}

export function latestReadings(readings) {
  const latest = new Map();

  for (const reading of readings) {
    const key = keyOf(reading.device, reading.metric);
    const current = latest.get(key);
    if (!current || reading.timestamp >= current.timestamp) {
      latest.set(key, reading);
    }
  }

  return latest;
}
