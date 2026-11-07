# Field Notes

- 使用opencode製作

一個紙張質感的筆記網站，全端跑在 **Cloudflare Workers + D1** 上。

> **線上版本**：https://cloudnotes.fieldnotebook.workers.dev

> Worker：`cloudnotes` · D1：`cloudnotes-db`（APAC，`wrangler.jsonc` 內已是實際 database_id）

- **前端**：React 19 + Vite + TypeScript，自訂 CSS（無 UI 框架）
- **後端**：Cloudflare Worker，`/api/*` 提供筆記 CRUD
- **資料庫**：Cloudflare D1（SQLite），notes / tags / note_tags 三張表
- **字型**：Fraunces、Newsreader、JetBrains Mono（透過 Fontsource 自我託管）

## 功能

- 新增 / 編輯 / 刪除筆記，雙擊卡片即可編輯
- 6 種紙張顏色、釘選（pinned）、標籤（最多 8 個）
- 即時搜尋標題 / 內文 / 標籤、依標籤篩選
- 鍵盤快捷鍵：`N` 新筆記、`/` 搜尋、`Cmd/Ctrl + Enter` 儲存、`Esc` 關閉
- 行動裝置響應式版面、載入骨架、錯誤重試、Toast 提示

## 本機開發

```bash
npm install

# 建立本機 D1 資料庫並套用 migration（含範例筆記）
npm run db:migrate:local

npm run dev
```

開啟 http://localhost:5173 。`@cloudflare/vite-plugin` 會在本機 workerd 中執行
Worker 與 D1 綁定，所以 `/api` 是真的打到本機 SQLite。

其他指令：

```bash
npm run typecheck       # TypeScript 檢查
npm run build           # 型別檢查 + production build
npm run cf:dry          # build 後 wrangler deploy --dry-run（不實際部署）
```

## 部署到 Cloudflare

需要一個 Cloudflare 帳號，並先登入 Wrangler：

```bash
npx wrangler login
```

1. 建立 D1 資料庫（此專案已建立，ID 已寫入 `wrangler.jsonc`）：

   ```bash
   npx wrangler d1 create cloudnotes-db
   ```

   若在別的帳號重建，指令會印出新的 `database_id`，請更新
   `wrangler.jsonc` 的 `d1_databases[0].database_id`。

2. 套用遠端 migration：

   ```bash
   npm run db:migrate:remote
   ```

3. 建置並部署：

   ```bash
   npm run deploy
   ```

   完成後 Wrangler 會印出 `https://cloudnotes.<你的子網域>.workers.dev`。

### 更新 schema

在 `migrations/` 新增 `000N_xxx.sql`，再執行 `npm run db:migrate:remote`。

## API

| Method | Path | 說明 |
| ------ | ---- | ---- |
| GET | `/api/health` | 健康檢查 |
| GET | `/api/notes?q=&tag=&pinned=1` | 列出筆記（可搜尋 / 篩選） |
| POST | `/api/notes` | 新增筆記 |
| GET | `/api/notes/:id` | 讀取單一筆記 |
| PUT | `/api/notes/:id` | 更新筆記 |
| PATCH | `/api/notes/:id` | `{ "pinned": true }` 切換釘選 |
| DELETE | `/api/notes/:id` | 刪除筆記 |
| GET | `/api/tags` | 標籤與使用次數 |
| DELETE | `/api/tags/:name` | 刪除標籤 |

筆記物件：

```json
{
  "id": "uuid",
  "title": "Welcome to Field Notes",
  "body": "…",
  "color": "butter",
  "pinned": true,
  "tags": ["welcome", "cloudflare"],
  "createdAt": "2026-11-05T09:12:00.000Z",
  "updatedAt": "2026-11-05T09:12:00.000Z"
}
```

## 專案結構

```
09/
├── migrations/          D1 schema 與 seed 資料
├── shared/types.ts      前後端共用的型別
├── worker/
│   ├── index.ts         Worker 入口（/api → api.ts，其餘交給靜態資源）
│   ├── api.ts           路由、驗證、JSON 回應
│   └── db.ts            D1 存取（notes / tags）
├── src/
│   ├── App.tsx          版面、狀態、篩選與快捷鍵
│   ├── api.ts           前端 fetch 封裝
│   ├── components/      NoteCard、NoteEditor
│   ├── lib/utils.ts     相對時間、卡片傾角
│   └── styles.css       全部視覺樣式
└── wrangler.jsonc       Worker / D1 / assets 設定
```
