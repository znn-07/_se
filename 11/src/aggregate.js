const AGGREGATE_SQL = `WITH filtered AS (
  SELECT id, device, region, station, metric, value, unit, ts
  FROM readings
  {where}
), ranked AS (
  SELECT device, region, station, metric, value, unit, ts,
         ROW_NUMBER() OVER (PARTITION BY device, metric ORDER BY ts DESC, id DESC) AS rn
  FROM filtered
)
SELECT r.device AS device,
       r.metric AS metric,
       MAX(x.region) AS region,
       MAX(x.station) AS station,
       MAX(x.unit) AS unit,
       x.ts AS latestAt,
       x.value AS latest,
       COUNT(*) AS count,
       MIN(r.value) AS min,
       MAX(r.value) AS max,
       AVG(r.value) AS avg
FROM filtered r
JOIN ranked x ON x.device = r.device AND x.metric = r.metric AND x.rn = 1
GROUP BY r.device, r.metric, x.ts, x.value
ORDER BY r.device ASC, r.metric ASC`;

function keyOf(device, metric) {
  return `${device}::${metric}`;
}

export async function aggregateReadings(db, region = '') {
  const sql = AGGREGATE_SQL.replace('{where}', region ? 'WHERE region = ?' : '');
  const statement = db.prepare(sql);
  const { results } = await (region ? statement.bind(region) : statement).all();
  const stats = (results ?? []).map((row) => ({
    device: row.device,
    metric: row.metric,
    region: row.region ?? '',
    station: row.station ?? '',
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
    { value: item.latest, unit: item.unit, region: item.region, station: item.station, timestamp: item.latestAt },
  ]));

  return { stats, latest };
}
