# TELEMETRY HUB · 遙測資料監控系統-期末專案

TELEMETRY HUB 是一套 Deploy 在 **Cloudflare Workers** 上的輕量級遙測平台：接收裝置（溫度、濕度、電壓、訊號強度等）回傳的量測資料，寫入 **Cloudflare D1**，即時統計、判斷警戒條件，並在瀏覽器儀表板中視覺化。

整套系統沒有獨立的後端伺服器：Worker 同時處理 API 與靜態頁面，前端為純 HTML / CSS / JavaScript，不用 React、不用打包工具。


## 核心能力

- **資料接收**：`POST /api/telemetry` 接收單筆或批次量測，驗證欄位型別與範圍。
- **持久化**：資料寫入 D1（SQLite）的 `readings` 資料表，不受 Worker 重啟影響。
- **即時統計**：依 `device + metric` 計算最新值、最小值、最大值、平均值與樣本數。
- **告警規則**：以 Threshold 規則判斷異常，在告警控制台顯示裝置、數值與時間。
- **視覺化儀表板**：Canvas 繪製時序波形、裝置狀態表、KPI 卡片與即時事件流。
- **示範資料**：`POST /api/demo` 或儀表板上的「注入一筆」按鈕可立刻產生假資料。
- **寫入保護**：設定 `API_TOKEN` 後，寫入端點需帶 `Authorization: Bearer <token>`；讀取端點維持公開。
- **告警通知**：狀態變化時可 POST 到 `ALERT_WEBHOOK_URL`，通知狀態存在 D1，避免重複發送。
- **SQL 聚合**：統計與告警由 D1 直接分組計算，不再受限於最近 500 筆。
- **資料匯出**：`GET /api/export` 可下載 CSV，儀表板也提供「匯出 CSV」按鈕。
- **主題切換**：深色 / 淺色主題可切換，選擇會保存在瀏覽器。
- **可測試**：驗證、統計、告警等核心邏輯為純函式，可用 `node --test` 在本機測試。

---

## 系統架構

```
 裝置 / curl / 示範按鈕          瀏覽器
        │ POST /api/telemetry       │ GET /api/summary（每 3 秒）
        ▼                           ▼
┌──────────────────────────────────────────────┐
│            Cloudflare Worker                 │
│  worker/index.js                             │
│    ├─ /api/* → API 路由                       │
│    └─ 其他   → env.ASSETS.fetch() 靜態頁面     │
│                                              │
│  src/validate.js  驗證與正規化                 │
│  src/stats.js     分組統計                     │
│  src/aggregate.js D1 SQL 聚合                  │
│  src/rules.js     告警規則判斷                 │
│  src/notify.js    Webhook 通知狀態機           │
│  src/auth.js      寫入端點 Token 檢查          │
│  src/export.js    CSV 序列化                   │
│  src/demo.js      示範資料產生器               │
└──────────────────┬───────────────────────────┘
                    ▼
      Cloudflare D1（readings / alert_state）
                    │
                    ├─ migrations/0001_init.sql
                    └─ migrations/0002_alert_state.sql
```

資料流：

1. 裝置送出量測到 `POST /api/telemetry`。
2. Worker 驗證欄位，補上 `received_at`，寫入 D1。
3. Dashboard 呼叫 `GET /api/summary`，一次取得統計、告警、最近紀錄與總數。
4. `src/rules.js` 比對最新值與 Threshold，異常項目顯示在告警控制台。
5. 告警狀態由 `src/notify.js` 寫回 `alert_state`；狀態改變時才發出 Webhook。

---

## 資料格式

單筆上傳：

```json
{
  "device": "sensor-a1",
  "metric": "temperature",
  "value": 26.7,
  "unit": "C",
  "timestamp": "2026-11-20T09:30:00Z"
}
```

批次上傳：

```json
{
  "readings": [
    { "device": "sensor-a1", "metric": "temperature", "value": 26.7, "unit": "C" },
    { "device": "sensor-a1", "metric": "humidity", "value": 61.2, "unit": "%" }
  ]
}
```

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `device` | string | 是 | 裝置 ID，例如 `sensor-a1` |
| `metric` | string | 是 | 指標名稱：`temperature`、`humidity`、`voltage`、`signal` |
| `value` | number | 是 | 有限數值或數字字串，不接受 `NaN` / `Infinity` / `null` |
| `unit` | string | 否 | 單位：`C`、`%`、`V`、`dBm` |
| `timestamp` | ISO 8601 string | 否 | 量測時間；省略時由 Worker 補上 |

---

## API 規格

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康檢查，回傳 `{"ok":true,"service":"telemetry-hub"}` |
| `POST` | `/api/telemetry` | 上傳單筆或批次量測 |
| `POST` | `/api/demo` | 產生一筆隨機示範量測 |
| `GET` | `/api/readings?device=&metric=&limit=100` | 查詢最近量測（最多 500 筆） |
| `GET` | `/api/stats` | 各裝置 / 指標的統計摘要 |
| `GET` | `/api/alerts` | 目前的告警列表 |
| `GET` | `/api/summary` | 儀表板用：統計 + 告警 + 最近 60 筆 + 總數 |
| `GET` | `/api/export?device=&metric=&limit=5000` | 匯出 CSV（最多 10000 筆） |
| `DELETE` | `/api/readings` | 清空所有量測（展示用重置） |

設定 `API_TOKEN` 後，`POST /api/telemetry`、`POST /api/demo`、`DELETE /api/readings` 需附帶 `Authorization: Bearer <token>`；所有 `GET` 端點仍可公開讀取。

成功回應：

```json
{ "ok": true, "accepted": 1, "total": 128 }
```

失敗回應：

```json
{ "ok": false, "error": "INVALID_PAYLOAD", "message": "value must be a finite number" }
```

```json
{ "ok": false, "error": "UNAUTHORIZED", "message": "missing or invalid API token" }
```

---

## 告警規則

定義在 `src/rules.js`，可依需求增減：

| Rule ID | Device | Metric | 條件 |
| --- | --- | --- | --- |
| `temp-high` | `sensor-a1` | `temperature` | `value > 30` |
| `humid-high` | `sensor-a1` | `humidity` | `value > 70` |
| `volt-low` | `sensor-a2` | `voltage` | `value < 11.5` |
| `signal-low` | `sensor-a2` | `signal` | `value < -80` |

## 告警 Webhook

在 Worker 設定以下 Secret 即可啟用；未設定時完全不發出通知。

| Secret | 說明 |
| --- | --- |
| `ALERT_WEBHOOK_URL` | 接收通知的 URL，會收到 `POST` JSON |
| `ALERT_WEBHOOK_TOKEN` | 選填，通知請求的 Bearer Token |
| `ALERT_WEBHOOK_RESOLVE` | 設為 `1` 時，告警解除也發出通知 |

通知內容包含 `type`（`triggered` / `resolved`）、`rule`、`device`、`metric`、`value`、`threshold` 與 `timestamp`。狀態存放在 `alert_state` 資料表，因此同一條規則只會在狀態改變時通知一次。

---

## 檔案結構

```text
11/
├── wrangler.jsonc              Worker 名稱、assets、D1 binding
├── package.json                dev / deploy / db / test 指令
├── migrations/
│   ├── 0001_init.sql           建立 readings 資料表與索引
│   └── 0002_alert_state.sql    建立告警通知狀態表
├── worker/
│   └── index.js                Worker 入口：路由 + 靜態資源
├── src/
│   ├── validate.js             欄位驗證與正規化
│   ├── stats.js                統計摘要（純函式）
│   ├── aggregate.js            D1 SQL 聚合與最新值
│   ├── rules.js                告警規則與判斷
│   ├── notify.js               Webhook 狀態機
│   ├── auth.js                 寫入端點 Token 檢查
│   ├── export.js               CSV 序列化
│   └── demo.js                 示範資料產生器
├── public/
│   ├── index.html              儀表板頁面
│   ├── styles.css              版面、色彩、波形與動畫
│   └── app.js                  資料抓取、Canvas 圖表、互動
├── scripts/
│   ├── seed.mjs                批次寫入示範紀錄（本機 / 遠端皆可）
│   └── check-config.mjs        部署前檢查 D1 database_id
├── test/
│   ├── core.test.mjs           核心邏輯單元測試
│   └── worker.test.mjs         Worker 路由測試（mock D1）
└── README.md                   本文件
```

---

## 本機開發

需要 Node.js 20 以上。可共用先前專案已安裝的 wrangler，或在此目錄重新安裝：

```powershell
cd C:\Users\user\Desktop\_se\_se\11
npm install
npm run db:local
npm run dev
```

開啟 http://localhost:8787 。

`@cloudflare/vite-plugin` 不是必須；`wrangler dev` 會在本機 workerd 中執行 Worker，並用本機 SQLite 模擬 D1，因此 `/api` 是真的打到資料庫。

若要在本機測試 Token 或 Webhook，在專案根目錄建立 `.dev.vars`（已被 `.gitignore` 忽略）：

```text
API_TOKEN=local-secret
ALERT_WEBHOOK_URL=https://example.com/hook
```

其他指令：

```powershell
npm test             # 核心邏輯 + Worker 路由測試
npm run config:check # 檢查 D1 database_id 是否已完成設定
npm run check        # 測試 + 設定檢查
npm run deploy       # 檢查設定後部署到 Cloudflare
```

---

## 部署到 Cloudflare

1. 登入 Wrangler：

```powershell
npx wrangler login
```

2. 建立 D1 資料庫：

```powershell
npx wrangler d1 create telemetry-hub-db
```

3. 把指令印出的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`（目前是佔位用的 `00000000-...`，只適合本機開發）。

4. 依需求設定 Secret（未設定就不啟用該功能）：

```powershell
npx wrangler secret put API_TOKEN
npx wrangler secret put ALERT_WEBHOOK_URL
npx wrangler secret put ALERT_WEBHOOK_TOKEN
npx wrangler secret put ALERT_WEBHOOK_RESOLVE
```

5. 套用遠端 migration 後部署（`npm run deploy` 會先自動執行 `config:check`）：

```powershell
npm run db:remote
npm run deploy
```

部署完成後 Wrangler 會印出 `*.workers.dev` 網址。目前本專案的部署網址為 https://telemetry-hub.fieldnotebook.workers.dev 。

---

## 操作示範

```bash
curl https://<your-worker>.workers.dev/api/health

curl -X POST https://<your-worker>.workers.dev/api/telemetry `
  -H "Content-Type: application/json" `
  -d '{"device":"sensor-a1","metric":"temperature","value":32.5,"unit":"C"}'

curl -X POST https://<your-worker>.workers.dev/api/demo
curl "https://<your-worker>.workers.dev/api/readings?device=sensor-a1&limit=10"
curl https://<your-worker>.workers.dev/api/summary
curl -o telemetry.csv "https://<your-worker>.workers.dev/api/export?format=csv"
```

若有設定 `API_TOKEN`，寫入時改用：

```bash
curl -X POST https://<your-worker>.workers.dev/api/telemetry `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <token>" `
  -d '{"device":"sensor-a1","metric":"temperature","value":32.5,"unit":"C"}'
```

批次塞入 40 筆示範資料（本機）：

```powershell
node scripts\seed.mjs http://localhost:8787 40
```

---

## 驗收檢查表

- [ ] `GET /api/health` 回傳 `ok: true`
- [ ] 上傳單筆與批次資料皆回傳 `accepted`
- [ ] 重新整理頁面後統計數值保留（D1 持久化）
- [ ] 注入高溫資料時，告警控制台出現 `temp-high`
- [ ] 1440 / 768 / 390 三種寬度沒有水平捲動
- [ ] 淺色 / 深色主題切換後，重新整理仍保留選擇
- [ ] 有設定 `API_TOKEN` 時，沒有 Token 的寫入要求回傳 401
- [ ] 同一條告警只觸發一次 Webhook，解除後再觸發可再次通知
- [ ] `GET /api/export` 下載的 CSV 內容與篩選條件相符
- [ ] `npm test` 全部通過
- [ ] `npm run config:check` 在填入真實 `database_id` 後通過

---

## 限制與未來改進

- 讀取端點公開；若資料敏感，需再加上唯讀 Token 或前端登入。
- Webhook 目前為 fire-and-forget 的單次 POST，沒有重試佇列。
- `GET /api/export` 單次最多 10000 筆，更大的資料集應改成分頁或 Cursor。
- 即時更新採用 3 秒輪詢，高頻場景可改用 WebSocket / SSE。
