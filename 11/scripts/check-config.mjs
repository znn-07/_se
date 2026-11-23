import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');

let config;
try {
  config = JSON.parse(source);
} catch {
  console.error('wrangler.jsonc 不是有效的 JSONC。');
  process.exit(1);
}

const databaseId = config.d1_databases?.[0]?.database_id ?? '';
const isPlaceholder = /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId);
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId);

if (!isUuid || isPlaceholder) {
  console.error('wrangler.jsonc 的 d1_databases[0].database_id 仍是佔位值，無法部署。');
  console.error('請先執行：npx wrangler d1 create telemetry-hub-db');
  console.error('再把輸出的 database_id 填入 wrangler.jsonc，並執行 npm run db:remote。');
  process.exit(1);
}

console.log(`設定檢查通過：${config.name} → D1 ${databaseId}`);
