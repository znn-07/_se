# FOLD · 任務看板管理工具

FOLD 是一套以 **Rust + Axum + SQLite** 打造的任務看板（Kanban）網站。前端使用原生 HTML / CSS / JavaScript，支援多個看板、欄位管理、任務 CRUD、標籤、拖曳排序、搜尋、標籤篩選、到期日提示與 WebSocket 即時更新，資料會持久化在 SQLite 中。

本專案包含三層測試（Server / Client 單元測試、Web API 系統測試、E2E）：

| 測試層級 | 技術 | 內容 | 數量 |
| --- | --- | --- | --- |
| 單元測試（Server） | Rust `cargo test --lib` | 輸入驗證、標籤、資料庫排序、拖曳移動、刪除與 cascade 行為 | 14 |
| 單元測試（Client） | Node.js `node:test` | 狀態切換、拖曳排序、到期日提醒計算、搜尋與標籤篩選 | 6 |
| 系統測試（Web API） | Rust integration test + `tower::ServiceExt` | 直接呼叫 Router，驗證 HTTP 狀態碼、JSON、CRUD、WebSocket 事件與錯誤處理 | 8 |
| E2E 測試 | Playwright（Chromium headless） | 真實伺服器 + 真實瀏覽器，驗證建立、編輯、拖曳、即時更新、刪除與重新整理後持久化 | 4 |

---

## 功能

- 多個任務看板，可建立、重新命名、刪除
- 每個看板可建立多個欄位，欄位可重新命名、刪除
- 任務可新增、編輯、刪除
- HTML5 拖曳：任務可在欄位間移動，也可在同一欄位內排序
- 任務欄位包含：標題、描述、優先級（低 / 中 / 高）、到期日、標籤
- 搜尋任務標題、描述與標籤
- 依標籤篩選任務（例如只看 `Bug`）
- 到期日狀態與逾期提示
- WebSocket 即時推播：其他使用者新增、更新、移動或刪除任務時，看板自動更新
- 所有變更即時寫入 SQLite，重新整理不會遺失
- 首次啟動自動建立示範看板與資料
- 響應式版面與無障礙標籤（鍵盤操作、ARIA、focus 狀態）

---

## 技術棧

- **Server**：Rust 2021、Axum 0.8、Tokio
- **Database**：SQLite（`rusqlite` bundled，免安裝 SQLite）
- **Frontend**：HTML、CSS、Vanilla JavaScript
- **Realtime**：WebSocket（Axum + Tokio broadcast channel）
- **E2E**：Playwright / Chromium
- **測試輔助**：`tower`、`http-body-util`、`tempfile`、`tokio-tungstenite`、Node.js `node:test`

---

## 專案結構

```text
06/
├── e2e/
│   └── board.spec.js          # Playwright E2E 測試
├── server/
│   ├── src/
│   │   ├── api.rs             # Axum Router 與 HTTP handlers
│   │   ├── db.rs              # SQLite schema、CRUD、排序、種子資料
│   │   ├── error.rs           # 統一 API 錯誤格式
│   │   ├── lib.rs             # AppState 與 Router 組裝
│   │   ├── main.rs            # 伺服器進入點
│   │   ├── models.rs          # Board / Column / Task 模型
│   │   └── validation.rs      # 輸入驗證
│   ├── tests/
│   │   └── api_test.rs        # Web API 系統測試
│   └── Cargo.toml
├── tests/
│   └── task-logic.test.js     # Node.js 前端邏輯單元測試
├── web/
│   ├── index.html
│   ├── styles.css
│   ├── task-logic.js          # 瀏覽器與 Node 共用的任務邏輯
│   └── app.js
├── package.json
├── playwright.config.js
└── README.md
```

---

## 環境需求

- Rust（建議 1.80 以上）
- Node.js 20 以上
- npm

確認版本：

```bash
rustc --version
cargo --version
node --version
npm --version
```

---

## 快速開始

```bash
# 1. 安裝 Playwright 測試套件
npm install

# 2. 安裝 Chromium（第一次執行 E2E 前）
npx playwright install chromium

# 3. 啟動網站
npm start
```

開啟 <http://127.0.0.1:3000>。

首次啟動會自動建立 `server/data/taskboard.db` 並寫入示範資料。若已有資料庫，示範資料不會重複寫入。

停止伺服器：在終端機按 `Ctrl+C`。

---

## 測試指令

```bash
# 全部測試（Client + Server 單元、系統、E2E）
npm test

# 只跑前端邏輯單元測試
npm run test:client

# 只跑 Rust 單元測試
npm run test:unit

# 只跑 Web API 系統測試
npm run test:api

# 所有 Rust 測試（含單元與整合測試）
npm run test:server

# Playwright E2E（headless Chromium）
npm run test:e2e

# 開啟 Playwright UI 模式
npm run test:e2e:ui

# 查看上一次 E2E HTML 報告
npm run test:e2e:report
```

### 測試範圍說明

**1. Server 單元測試**

位於 `server/src/validation.rs` 與 `server/src/db.rs` 的 `#[cfg(test)]` 模組，使用 in-memory SQLite，不啟動網路伺服器。涵蓋：

- 必填文字 trim、空白與長度限制
- 優先級、日期格式與標籤驗證（去重、長度、數量上限）
- 任務標籤的新增、讀取與更新
- 任務新增、修改、刪除後的位置壓縮
- 同欄位排序與跨欄位移動
- 刪除欄位 / 看板時的 cascade 行為
- 防止跨看板移動任務

**2. Client 單元測試**

`tests/task-logic.test.js` 使用 Node.js 內建 `node:test`，直接測試 `web/task-logic.js` 這份瀏覽器與 Node 共用的邏輯，不需要啟動瀏覽器。涵蓋：

- 任務從「進行中」切換到「已完成」的狀態與欄位變化
- 同欄位排序、位置夾取，以及不修改原始資料
- 到期日格式化、今天 / 明天 / 逾期 / 即將到期計算
- 無效日期處理
- 依 `Bug` 標籤篩選，以及標籤與關鍵字搜尋組合

**3. 系統測試 / Web API 測試**

`server/tests/api_test.rs` 會建立測試用 Router，透過 `tower::ServiceExt::oneshot` 發送 HTTP request；WebSocket 測試則啟動真實的臨時 TCP port。涵蓋：

- `GET /api/health`
- 看板、欄位、任務的完整建立流程
- 建立任務後寫入資料庫，並回傳正確 JSON（含標籤）
- 任務更新與拖曳 API
- 錯誤輸入回傳 4xx 與 JSON 錯誤訊息
- 跨看板移動被拒絕
- `GET /api/ws` 會收到 `task.created` 即時事件
- 首頁靜態檔案可被伺服

**4. E2E 測試**

`e2e/board.spec.js` 由 Playwright 啟動真正的 Rust 伺服器與 headless Chromium，使用獨立測試資料庫 `.e2e/taskboard.db`，每次啟動前重設。涵蓋：

- 建立看板 → 建立欄位 → 重新命名欄位 → 建立含標籤的任務
- 重新整理頁面後資料仍存在，且標籤可作為篩選條件
- 將任務從「進行中」拖曳到「已完成」，並透過 API 確認已持久化
- 重新整理後任務仍在「已完成」
- 另一位使用者透過 API 新增任務時，頁面經 WebSocket 即時出現新卡片
- 編輯任務、刪除任務、刪除看板

---

## API 文件

所有 API 路徑皆以 `/api` 為前綴，回應格式為 JSON。

### 健康檢查

```http
GET /api/health
```

```json
{
  "status": "ok",
  "service": "taskboard-server",
  "version": "0.1.0"
}
```

### 看板

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/boards` | 列出所有看板 |
| `POST` | `/api/boards` | 建立看板，body：`{ "name": "..." }` |
| `GET` | `/api/boards/{id}` | 取得看板詳情（含欄位與任務） |
| `PATCH` | `/api/boards/{id}` | 重新命名看板 |
| `DELETE` | `/api/boards/{id}` | 刪除看板（cascade 刪除欄位與任務） |

### 欄位

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/api/boards/{id}/columns` | 建立欄位，body：`{ "title": "..." }` |
| `PATCH` | `/api/columns/{id}` | 重新命名欄位 |
| `DELETE` | `/api/columns/{id}` | 刪除欄位（cascade 刪除任務） |

### 任務

| Method | Path | 說明 |
| --- | --- | --- |
| `POST` | `/api/columns/{id}/tasks` | 建立任務 |
| `PATCH` | `/api/tasks/{id}` | 更新任務 |
| `DELETE` | `/api/tasks/{id}` | 刪除任務 |
| `POST` | `/api/tasks/{id}/move` | 移動 / 排序任務 |

建立任務範例：

```json
{
  "title": "整理 onboarding 流程",
  "description": "盤點註冊到首次開啟的節點",
  "priority": "high",
  "due_date": "2026-11-05",
  "labels": ["Research", "UX"]
}
```

移動任務範例：

```json
{
  "column_id": "column-uuid",
  "position": 0
}
```

錯誤回應範例（HTTP 400）：

```json
{
  "error": "任務標題不能是空白"
}
```

### WebSocket 即時更新

```text
GET /api/ws
```

連線成功後會先收到：

```json
{ "type": "connected" }
```

任務建立、更新、移動或刪除時會廣播事件，例如：

```json
{
  "type": "task.created",
  "board_id": "board-uuid",
  "column_id": "column-uuid",
  "task": {
    "id": "task-uuid",
    "title": "修正登入 API",
    "labels": ["Bug", "Backend"]
  }
}
```

前端收到事件後會重新載入目前看板；連線中斷時會自動重試。

---

## 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | 伺服器 port |
| `TASKBOARD_HOST` | `127.0.0.1` | 綁定位址 |
| `TASKBOARD_DB_PATH` | `server/data/taskboard.db` | SQLite 路徑 |
| `TASKBOARD_STATIC_DIR` | `server/../web` | 前端靜態檔案目錄 |
| `TASKBOARD_SEED` | `1` | 設為 `0` 可停用示範資料 |
| `TASKBOARD_RESET_DB` | 未設定 | 設為 `1` 可在啟動前刪除資料庫 |

自訂啟動範例：

```bash
# Windows PowerShell
$env:PORT="4000"; $env:TASKBOARD_DB_PATH="C:\temp\fold.db"; npm start

# macOS / Linux
PORT=4000 TASKBOARD_DB_PATH=/tmp/fold.db npm start
```

E2E 測試會自動使用 `PORT=3100`、`.e2e/taskboard.db`、`TASKBOARD_SEED=0` 與 `TASKBOARD_RESET_DB=1`。

---

## 設計與實作重點

- **單一資料庫連線 + Mutex**：SQLite 寫入量小，使用同步 `rusqlite` 搭配 `Arc<Mutex<Connection>>`，避免 async 生態額外複雜度；所有操作集中於 `db.rs`，API 層保持薄。
- **Position 正規化**：任務移動或刪除後會重排 `position`，避免出現空洞，拖曳結果穩定。
- **Cascade 約束**：schema 啟用 `PRAGMA foreign_keys = ON`，刪除看板或欄位時自動清除子資料。
- **統一錯誤格式**：`AppError` 實作 `IntoResponse`，所有 API 錯誤皆回傳統一 JSON。
- **輸出入驗證**：標題長度、空白、優先級、日期格式與標籤皆在寫入資料庫前檢查。
- **標籤儲存**：任務標籤以 JSON 陣列存於 SQLite `labels` 欄位，舊資料庫啟動時會自動補上欄位。
- **WebSocket 推播**：API 完成寫入後透過 Tokio broadcast channel 發布事件，`/api/ws` 將事件送給所有連線；前端收到後重新同步目前看板。
- **共用任務邏輯**：`web/task-logic.js` 同時供瀏覽器與 Node 單元測試使用，避免測試複製一份與正式程式不同的邏輯。
- **前端無框架**：以事件委派與 `fetch` 管理狀態，降低建置成本，也讓 E2E 直接測試真實 DOM 行為。
- **測試資料隔離**：單元 / API 測試使用 in-memory SQLite；E2E 使用獨立檔案資料庫並在啟動前重設，不污染開發資料。

---

## 疑難排解

### E2E 顯示找不到 Chromium

```bash
npx playwright install chromium
```

若公司網路阻擋下載，可改用既有 Chromium，並在 `playwright.config.js` 的 `use` 中加入 `launchOptions.executablePath`。本專案固定使用 `@playwright/test@1.63.0`，以搭配此環境既有的 Chromium；若要升級 Playwright，請一併確認對應的瀏覽器版本已安裝。

### Port 3100 或 3000 被占用

```bash
# 改用其他 port
PORT=4000 npm start
```

E2E 的 port 定義於 `playwright.config.js`，可依環境調整。

### 想重置開發資料

```bash
# Windows PowerShell
$env:TASKBOARD_RESET_DB="1"; npm start
```

或直接刪除 `server/data/taskboard.db`。
