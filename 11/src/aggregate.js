const AGGREGATE_SQL = `WITH ranked AS (
  SELECT device, metric, value, unit, ts,
         ROW_NUMBER() OVER (PARTITION BY device, metric ORDER BY ts DESC, id DESC) AS rn
  FROM readings
)
SELECT r.device AS device,
       r.metric AS metric,
       MAX(x.unit) AS unit,
       x.ts AS latestAt,
       x.value AS latest,
       COUNT(*) AS count,
       MIN(r.value) AS min,
       MAX(r.value) AS max,
       AVG(r.value) AS avg
FROM readings r
JOIN ranked x ON x.device = r.device AND x.metric = r.metric AND x.rn = 1
GROUP BY r.device, r.metric, x.ts, x.value
ORDER BY r.device ASC, r.metric ASC`;

function keyOf(device, metric) {
  return `${device}::${metric}`;
}

export async function aggregateReadings(db) {
  const { results } = await db.prepare(AGGREGATE_SQL).all();
  const stats = (results ?? []).map((row) => ({
    device: row.device,
    metric: row.metric,
    unit: row.unit ?? '',
    count: Number(row.count),
    min: Number(row.min),
    max: Number(row.max),
    avg: Number(row.avg),
    latest: Number(row.latest),
    latestAt: row.latestAt,
  }));

  const latest = new Map(stats.map((item) => [
    keyOf(item.device, item.metric),
    { value: item.latest, unit: item.unit, timestamp: item.latestAt },
  ]));

  return { stats, latest };
}
