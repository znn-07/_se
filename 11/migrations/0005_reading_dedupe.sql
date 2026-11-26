DELETE FROM readings
WHERE id NOT IN (
  SELECT MIN(id) FROM readings GROUP BY device, metric, ts
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_observation
  ON readings(device, metric, ts);
