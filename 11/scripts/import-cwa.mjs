import { existsSync, readFileSync } from 'node:fs';
import { cwaUrl, toReadings } from '../src/cwa.js';

function dotVars() {
  const path = new URL('../.dev.vars', import.meta.url);
  if (!existsSync(path)) return {};

  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const vars = { ...dotVars(), ...process.env };
const key = vars.CWA_API_KEY;
const base = (vars.TELEMETRY_URL ?? 'https://telemetry-hub.fieldnotebook.workers.dev').replace(/\/$/, '');
const token = vars.TELEMETRY_TOKEN ?? vars.API_TOKEN ?? '';
const limit = Number(vars.CWA_LIMIT ?? 24);
const stationIds = vars.CWA_STATIONS ?? '';

if (!key) {
  console.error('請先設定 CWA_API_KEY（環境變數或 11/.dev.vars）。');
  process.exit(1);
}

const writeHeaders = { 'content-type': 'application/json' };
if (token) writeHeaders.authorization = `Bearer ${token}`;

async function main() {
  const response = await fetch(cwaUrl(key, stationIds));
  if (!response.ok) throw new Error(`CWA API HTTP ${response.status}`);
  const payload = await response.json();

  const readings = toReadings(payload, { limit });
  if (readings.length === 0) throw new Error('CWA API 沒有回傳可用的溫度或濕度數值');

  if (process.argv.includes('--clear')) {
    const cleared = await fetch(`${base}/api/readings`, { method: 'DELETE', headers: writeHeaders });
    if (!cleared.ok) throw new Error(`清空資料失敗：HTTP ${cleared.status}`);
    console.log('已清空舊資料');
  }

  for (let index = 0; index < readings.length; index += 100) {
    const chunk = readings.slice(index, index + 100);
    const result = await fetch(`${base}/api/telemetry`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ readings: chunk }),
    });
    const body = await result.json();
    if (!result.ok || !body.ok) throw new Error(body.message ?? `寫入失敗：HTTP ${result.status}`);
    console.log(`已寫入 ${body.accepted} 筆，目前累計 ${body.total} 筆`);
  }

  console.log('匯入完成，重新整理儀表板即可看到中央氣象署的觀測資料。');
}

main().catch((error) => {
  console.error(`匯入失敗：${error.message}`);
  process.exitCode = 1;
});
