import { RULES } from './rules.js';

const READ_SQL = 'SELECT rule_id, active FROM alert_state';
const WRITE_SQL = `INSERT INTO alert_state (rule_id, active, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(rule_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`;

export async function syncAlertState(db, alerts, env, now = new Date()) {
  if (!env.ALERT_WEBHOOK_URL) return { checked: 0, sent: 0 };

  const { results } = await db.prepare(READ_SQL).all();
  const previous = new Map((results ?? []).map((row) => [row.rule_id, Number(row.active) === 1]));
  const activeIds = new Set(alerts.map((alert) => alert.id));
  const timestamp = now.toISOString();
  const events = [];

  for (const rule of RULES) {
    const active = activeIds.has(rule.id);
    const wasActive = previous.get(rule.id) ?? false;
    if (active !== wasActive) {
      events.push({
        ...rule,
        status: active ? 'triggered' : 'resolved',
        value: alerts.find((alert) => alert.id === rule.id)?.value ?? null,
      });
    }
    await db.prepare(WRITE_SQL).bind(rule.id, active ? 1 : 0, timestamp).run();
  }

  let sent = 0;
  for (const event of events) {
    if (event.status === 'resolved' && env.ALERT_WEBHOOK_RESOLVE !== '1') continue;

    const headers = { 'content-type': 'application/json' };
    if (env.ALERT_WEBHOOK_TOKEN) headers.authorization = `Bearer ${env.ALERT_WEBHOOK_TOKEN}`;

    try {
      const response = await globalThis.fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: event.status,
          rule: event.id,
          device: event.device,
          metric: event.metric,
          value: event.value,
          threshold: event.threshold,
          message: event.message,
          timestamp,
        }),
      });
      if (!response.ok) console.error(`[telemetry-hub] webhook HTTP ${response.status}`);
      else sent += 1;
    } catch (error) {
      console.error('[telemetry-hub] webhook delivery failed', error);
    }
  }

  return { checked: RULES.length, sent };
}
