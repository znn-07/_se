# TELEMETRY HUB · 遙測資料監控系統-期末專案

TELEMETRY HUB 是一套 Deploy 在 **Cloudflare Workers** 上的輕量級遙測平台：接收裝置（溫度、濕度、電壓、訊號強度等）回傳的量測資料，寫入 **Cloudflare D1**，即時統計、判斷警戒條件，並在瀏覽器儀表板中視覺化。

整套系統沒有獨立的後端伺服器：Worker 同時處理 API 與靜態頁面，前端為純 HTML / CSS / JavaScript，不用 React、不用打包工具。

| 欄位 | 內容 |
| --- | --- |
| 課程 | 現代軟體工程 · 115 學年上學期 |
| 教師 | 陳鍾誠 · 金門大學資訊工程系 |
| 學生 | 劉甄娜 |
| 學號 | 111410510 |
| 入口 | `public/index.html` |
| 平台 | Cloudflare Workers + D1 + Workers Static Assets |

---

## 核心能力

- **資料接收**：`POST /api/telemetry` 接收單筆或批次量測，驗證欄位型別與範圍。
- **持久化**：資料寫入 D1（SQLite）的 `readings` 資料表，不受 Worker 重啟影響。
- **即時統計**：依 `device + metric` 計算最新值、最小值、最大值、平均值與樣本數。
- **告警規則**：以 Threshold 規則判斷異常，在告警控制台顯示裝置、數值與時間。
- **視覺化儀表板**：Canvas 繪製時序波形、裝置狀態表、KPI 卡片與即時事件流。
- **示範資料**：`POST /api/demo` 或儀表板上的「注入一筆」按鈕可立刻產生假資料。
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
│  src/rules.js     告警規則判斷                 │
│  src/demo.js      示範資料產生器               │
└──────────────────┬───────────────────────────┘
                   ▼
        Cloudflare D1（readings 資料表）
                   │
                   └─ migrations/0001_init.sql
```

資料流：

1. 裝置送出量測到 `POST /api/telemetry`。
2. Worker 驗證欄位，補上 `received_at`，寫入 D1。
3. Dashboard 呼叫 `GET /api/summary`，一次取得統計、告警、最近紀錄與總數。
4. `src/rules.js` 比對最新值與 Threshold，異常項目顯示在告警控制台。

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
| `value` | number | 是 | 有限數值，不接受 `NaN` / `Infinity` |
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
| `DELETE` | `/api/readings` | 清空所有量測（展示用重置） |

成功回應：

```json
{ "ok": true, "accepted": 1, "total": 128 }
```

失敗回應：

```json
{ "ok": false, "error": "INVALID_PAYLOAD", "message": "value must be a finite number" }
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

---

## 檔案結構

```text
11/
├── wrangler.jsonc              Worker 名稱、assets、D1 binding
├── package.json                dev / deploy / db / test 指令
├── migrations/
│   └── 0001_init.sql           建立 readings 資料表與索引
├── worker/
│   └── index.js                Worker 入口：路由 + 靜態資源
├── src/
│   ├── validate.js             欄位驗證與正規化
│   ├── stats.js                統計摘要
│   ├── rules.js                告警規則與判斷
│   └── demo.js                 示範資料產生器
├── public/
│   ├── index.html              儀表板頁面
│   ├── styles.css              版面、色彩、波形與動畫
│   └── app.js                  資料抓取、Canvas 圖表、互動
├── scripts/
│   └── seed.mjs                批次寫入示範紀錄（本機 / 遠端皆可）
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

其他指令：

```powershell
npm test        # 核心邏輯 + Worker 路由測試
npm run deploy  # 建置後部署到 Cloudflare
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

4. 套用遠端 migration 後部署：

```powershell
npm run db:remote
npm run deploy
```

部署完成後 Wrangler 會印出 `*.workers.dev` 網址。

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
- [ ] `npm test` 全部通過

---

## 限制與未來改進

- 示範 API 沒有驗證機制，正式上線前應加入 API Token。
- 告警為讀取時計算，尚未搭配 Email / Webhook 通知。
- `GET /api/summary` 目前讀取最近 500 筆，資料量大時應改為 SQL 聚合。
- 深色模式為主要視覺；後續可再加入淺色主題與資料匯出。
