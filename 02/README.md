# 02 大學校務系統 — 校務行政資訊入口

以 **Node.js（原生化模組）** 實作的 **大學校務系統**，在 MVP（Model - View - Presenter）架構下切割，**純標準函式庫，不需要 `npm install`** 即可執行。

本系統涵蓋「教務處（admin）／教師（teacher）／學生（student）」三種角色，提供**登入與權限控管、學生／教師／系所／課程管理、線上選課（含名額與衝堂檢查）、成績管理**等大學校務核心功能。

---

## 目錄

1. [快速開始](#快速開始)
2. [支援功能總覽](#支援功能總覽)
3. [系統架構](#系統架構)
    - [兩段式設計：後端 API + 前端 SPA](#兩段式設計後端-api--前端-spa)
    - [MVC / MVP 三層分工](#mvc--mvp-三層分工)
4. [資料模型（Model）](#資料模型model)
    - [JSON 檔案資料庫](#json-檔案資料庫)
    - [種子資料與示範帳號](#種子資料與示範帳號)
5. [業務規則](#業務規則)
    - [選課：名額、重複、衝堂](#選課名額重複衝堂)
    - [成績登錄](#成績登錄)
    - [權限控管](#權限控管)
6. [REST API 參考](#rest-api-參考)
7. [前端設計](#前端設計)
8. [請求生命週期](#請求生命週期)
9. [端對端測試](#端對端測試)
10. [執行與驗證](#執行與驗證)
11. [專案資訊](#專案資訊)

---

## 快速開始

```bash
node server.js        # 預設 http://127.0.0.1:8300
# PORT=9000 node server.js  自訂連接埠
```

用瀏覽器開啟 `http://127.0.0.1:8300`，首次啟動會自動建立示範資料（`data/` 目錄），以任一示範帳號登入即可。

| 角色 | 帳號 | 密碼 |
|------|------|------|
| 教務處 | `admin` | `1111` |
| 教師（陳鍾誠） | `T001` | `1111` |
| 學生（張小明） | `S001` | `1111` |

---

## 支援功能總覽

| 功能 | 教務處 | 教師 | 學生 |
|------|:---:|:---:|:---:|
| 瀏覽課程清單（名稱／系所／學分／教師／時間／人數） | ✔ | ✔ | ✔ |
| 系所新增／修改／刪除 | ✔ | | |
| 學生資料新增／修改／刪除 | ✔ | | |
| 教師資料新增／修改／刪除 | ✔ | | |
| 課程資料新增／修改／刪除（含排課） | ✔ | | |
| 查詢自己的開課與修課名單 | | ✔ | |
| 登錄修課學生成績（0~100） | | ✔ | |
| 線上加選／退選課程 | | | ✔ |
| 衝堂與名額自動檢查 | | | ✔ |
| 查詢已選課程與成績單（平均 / GPA） | | | ✔ |

三種角色的帳號密碼一律雜湊存放（SHA-256 + salt），不做明文儲存。

---

## 系統架構

### 兩段式設計：後端 API + 前端 SPA

與 01 專案「命令列 UI × HTTP 傳輸層」的分工哲學相同，02 把「前端」與「後端」切開：

```
┌────────────────────────────────────────────────────────────────┐
│                          瀏覽器（前端）                          │
│          public/  單頁應用程式（登入、選課、成績、管理介面）        │
│                                                              │
│               HTML + CSS + Vanilla JS ── fetch ──▶ ／api/＊      │
└────────────────────────────────────────────────────────────────┘
                              │  JSON
┌─────────────────────────────▼──────────────────────────────────┐
│                        Node.js 伺服器（後端）                    │
│                                                              │
│   server.js（入口）                                              │
│       │                                                       │
│   src/app.js（Presenter）  路由／登入／權限／業務規則               │
│       │                                                       │
│   src/model.js（Model）    JSON 檔案資料庫                        │
│   src/view.js（View）      JSON 回應／靜態檔案伺服                 │
└────────────────────────────────────────────────────────────────┘
```

| 面向 | 層級 | 檔案 | 職責 |
|------|------|------|------|
| **前端** | SPA | `public/index.html` | 頁面骨架、登入畫面、主介面、彈窗 |
| **前端** | SPA | `public/css/style.css` | 全部樣式（純 CSS，無框架） |
| **前端** | SPA | `public/js/app.js` | hash 路由、fetch 呼叫、CRUD 介面、選課／成績畫面 |
| **後端** | 入口 | `server.js` | 建立 HTTP 伺服器、初始化資料庫 |
| **後端** | Presenter | `src/app.js` | 路由分派、登入與 token 會話、角色權限、選課／成績規則 |
| **後端** | Model | `src/model.js` | JSON 檔案資料庫、各種查詢與異動函式 |
| **後端** | View | `src/view.js` | 回應輸出（JSON、錯誤、靜態檔案） |

完整的目錄結構：

```
02/
├── server.js              # 入口：建立 HTTP 伺服器
├── src/                   # 後端核心
│   ├── app.js             # Presenter：路由、會話、權限、業務規則
│   ├── model.js           # Model：資料與 JSON 儲存
│   └── view.js            # View：回應與靜態檔案
├── public/                # 前端
│   ├── index.html         # 單頁應用入口
│   ├── css/style.css
│   └── js/app.js
├── test/
│   ├── e2e.js               # API 端對端測試（node --test，不需安裝套件）
│   └── ui_e2e.py            # 瀏覽器 UI 端對端測試（Python + Playwright）
├── data/                  # 資料庫（首次啟動自動建立，已 gitignore）
└── README.md              # 本文件
```

單向依賴，沒有循環引用：

```
server.js ──▶ src/app.js ──▶ src/model.js ──▶ data/*.json
                 │
                 └────────▶ src/view.js ──▶ public/
```

### MVC / MVP 三層分工

| 層級 | 職責 | 不該做的事 |
|------|------|-----------|
| **Model** | 讀寫 `data/*.json`、提供 `list / get / insert / update / remove` 等查詢介面、整理業務資料（成績換算、衝堂判斷、系所／教師名稱查詢） | 不做任何輸出，不判斷 HTTP 請求 |
| **View** | 輸出 JSON 回應、錯誤訊息；伺服 `public/` 靜態檔案（含目錄穿越防護） | 不做業務判斷，不決定「何時」回應 |
| **Presenter** | 解析請求、路由分派、登入會話、權限檢查，以及「選課／成績」等業務規則的編排 | 不直接碰檔案系統，不直接輸出 |

---

## 資料模型（Model）

### JSON 檔案資料庫

所有資料以 JSON 檔案儲存在 `data/`，每次異動後立即寫回磁碟：

| 檔案 | 欄位 | 說明 |
|------|------|------|
| `departments.json` | `code`, `name` | 系所（主鍵為 `code`） |
| `admins.json` | `id`, `name`, `passwordHash` | 教務處帳號 |
| `teachers.json` | `id`, `name`, `dept`, `title`, `passwordHash` | 教師 |
| `students.json` | `id`, `name`, `dept`, `entryYear`, `passwordHash` | 學生 |
| `courses.json` | `id`, `code`, `name`, `dept`, `credits`, `teacherId`, `times`, `capacity` | 課程與排課 |
| `enrollments.json` | `studentId`, `courseId`, `score` | 選課紀錄（`score` 未登錄為 `null`） |

**排課時間（`times`）** 格式為 `["星期-節次", …]`，例如 `["1-1","1-2"]` 代表「星期一第 1、2 節」。這是衝堂檢查的比對基礎。

### 種子資料與示範帳號

第一次啟動若 `data/` 不存在，會自動建立 5 個系所、1 位教務處、4 位教師、6 位學生、10 門課程與若干選課／成績紀錄。所有帳號密碼預設 `1111`（雜湊後存放）。

想重來一輪乾淨資料，把 `data/` 資料夾刪掉再啟動即可。

---

## 業務規則

### 選課：名額、重複、衝堂

當學生加選某課程時，系統依序檢查（任一失敗即拒絕並回傳明確訊息）：

1. **課程存在**：查無課程 → 404。
2. **重複加選**：已選修該課 → 409。
3. **名額**：`已選人數 >= capacity` → 409「課程人數已額滿」。
4. **衝堂**：新課程的任一時段與已選課程重疊（`timesOverlap`）→ 409 並指出與哪門課衝堂。

### 成績登錄

- 教師**只能**為自己開設的課程登錄成績（403）。
- 成績必須是 **0 ~ 100 的數字**（400），儲存後回傳等第（`A+ / A / … / F`）。
- 未登錄成績前，學生可以自由退選。

### 權限控管

- 登入成功後發出**隨機 token**（`crypto.randomBytes`，存記憶體）；前端以 `Authorization: Bearer <token>` 攜帶。
- 路由表上每個 API 標註 `public / any / admin / teacher / student` 其中一種權限，未登入 401、角色不符 403。

---

## REST API 參考

| 方法 | 路徑 | 權限 | 說明 |
|------|------|------|------|
| POST | `/api/login` | public | 登入，回傳 `{token, user}` |
| GET | `/api/me` | any | 目前登入者資訊 |
| POST | `/api/logout` | any | 登出（失效 token） |
| GET | `/api/departments` | any | 系所清單 |
| POST | `/api/departments` | admin | 新增系所 |
| PUT | `/api/departments/:code` | admin | 修改系所名稱 |
| DELETE | `/api/departments/:code` | admin | 刪除系所（尚有參照時拒絕） |
| GET | `/api/students` | admin | 學生清單 |
| POST | `/api/students` | admin | 新增學生 |
| PUT | `/api/students/:id` | admin | 修改學生 |
| DELETE | `/api/students/:id` | admin | 刪除學生（連同選課紀錄） |
| GET | `/api/teachers` | admin | 教師清單 |
| POST | `/api/teachers` | admin | 新增教師 |
| PUT | `/api/teachers/:id` | admin | 修改教師 |
| DELETE | `/api/teachers/:id` | admin | 刪除教師（仍有開課時拒絕） |
| GET | `/api/courses` | any | 課程清單（含名稱查詢、人數、是否已選） |
| POST | `/api/courses` | admin | 新增課程 |
| PUT | `/api/courses/:id` | admin | 修改課程 |
| DELETE | `/api/courses/:id` | admin | 刪除課程（連同選課紀錄） |
| GET | `/api/teacher/courses` | teacher | 我的開課清單 |
| GET | `/api/teacher/courses/:id/roster` | teacher | 指定課程的修課名單（限自己的課） |
| PUT | `/api/teacher/courses/:id/scores` | teacher | 登錄指定學生成績 `{studentId, score}` |
| POST | `/api/student/enroll` | student | 加選 `{courseId}` |
| DELETE | `/api/student/enroll/:courseId` | student | 退選 |
| GET | `/api/student/enrolled` | student | 已選課程 |
| GET | `/api/student/grades` | student | 成績單與統計（平均 / GPA） |

錯誤回應統一為 `{ "error": "訊息" }`，狀態碼語意：`400` 參數錯誤、`401` 未登入／登入失敗、`403` 權限不足、`404` 查無資料、`409` 業務衝突（重複選課、滿班、衝堂等）。

---

## 前端設計

- **單頁應用（SPA）**：登入後依角色切換側邊選單，以 `hash` 路由（`#/admin/students`、`#/teacher/scores`、`#/student/grades` …）導覽。
- **通用 CRUD 元件**：教務處的學生／教師／系所／課程管理共用同一套「表格 + 表單彈窗」邏輯，只需描述欄位與 API 路徑。
- **選課即時提示**：課程表直接標示「已選／可選／滿班／衝堂」，衝堂以學生已選課程的時段比對。
- **成績單**：顯示等第徽章、已修學分、加權平均與 4.0 制 GPA。
- 所有渲染資料都以 `esc()` 跳脫，避免 XSS；樣式為純 CSS（無任何框架）。

---

## 請求生命週期

以「學生加選一門課」為例：

```
瀏覽器                        Node.js 伺服器
   │  POST /api/student/enroll {courseId}
   │  Authorization: Bearer <token>
   ▼
   │  app.js：解析路由 → 權限檢查（student）→ role 相符
   │  model：課程存在？重複？名額？與已選課程不衝堂？
   │        └─ 全部通過 → insert('enrollments')
   ▼
   │  view.sendJSON(201, { ok, message, course })
瀏覽器                        ← 重新載入課程表，顯示「已選」
```

---

## 端對端測試

專案附帶一套 **端對端（End-to-End）測試** `test/e2e.js`，使用 Node.js 內建的測試框架 `node:test`，**不需要安裝任何套件**：

```bash
node --test test/e2e.js
```

測試流程：

1. **自動啟動**一份真實的 `server.js` 子程序（測試完畢自動關閉）。
2. 使用**隔離的暫存資料庫**（透過 `DATA_DIR` 環境變數指向 `os.tmpdir()` 下的資料夾，`src/model.js` 支援覆寫），**不會污染**正式 `data/`。
3. 從瀏覽器的角度以 `fetch` 發送真實 HTTP 請求，走完整使用者旅程。

目前共 **13 個測試案例**：

| 分類 | 案例 |
|------|------|
| 登入 | 三種角色登入成功、錯誤密碼 401、未登入 401 |
| 權限 | 角色不符 403（學生不得存取管理 API、學生不能進教師端） |
| 系所 CRUD | 新增、代碼重複 409、改名、刪除 |
| 學生 CRUD | 新增／修改／刪除、刪除連帶清選課、不洩漏密碼雜湊 |
| 教師 CRUD | 新增／修改／刪除、仍有開課者不可刪 |
| 課程 CRUD | 新增／修改／刪除、課程代碼重複 409 |
| 選課 | 不衝堂可加選、重複加選 409、衝堂 409、滿班 409、退選 |
| 成績 | 只能登自己的課 403、越界 400、等第正確、成績單平均／GPA 同步更新 |
| 靜態資源 | 首頁／JS／CSS 取得、404、目錄穿越被擋 |

例如「選課衝堂」案例會新增一門與已選課程同時段的課，再驗證加選被 409 拒絕；「成績單」案例會預期平均 87.5、GPA 3.25，並驗證教師登錄成績後學生的成績單同步更新。

---

### 瀏覽器 UI 端對端測試（test/ui_e2e.py）

`test/e2e.js` 只打到 HTTP API；若要像使用者一樣「真的打開瀏覽器操作網頁」，可執行 `test/ui_e2e.py`（Python + Playwright）：

```bash
pip install playwright
python -m playwright install chromium
python test/ui_e2e.py            # 無頭模式（CI 適用）
python test/ui_e2e.py --headed   # 開啟瀏覽器視窗，可直接觀看操作過程
```

測試流程與 `e2e.js` 相同：自動啟動一份真實 `server.js`（使用隔離的暫存 `DATA_DIR`，不污染正式 `data/`），然後開啟 Chromium 依序操作：

1. 登入畫面載入（標題正確、無網頁錯誤）
2. 學生登入 → 線上選課 → 加選「資料結構」→ 已選課程確認 → 出現成功提示
3. 學生查成績 → 成績單平均顯示
4. 教師登錄成績 → 儲存成功提示
5. 教務處學生 CRUD → 新增 S888 → 表格出現 → 刪除 → 表格移除
6. 登出 → 回到登入畫面

每一步都會截圖到 `test/screenshots/`（已加進 .gitignore），方便事後檢視；任何步驟失敗都會輸出 toast、彈窗狀態、內容區文字等診斷資訊。

執行結果範例：`UI e2e result: 7 passed, 0 failed`。

> 開發期間這套「真實瀏覽器」測試實際抓出過 4 個純前端的 Bug（彈窗遮罩蓋住整頁、hash 路由配不到、管理表單第一欄被行號覆寫、刪除按鈕把 id 傳成 undefined），驗證了「打開網頁來測」的必要性。

---

## 執行與驗證

服務啟動後，可用任何 REST 工具驗證（以下為 PowerShell / curl 示範）：

```powershell
# 登入取得 token
$login = Invoke-RestMethod -Uri http://127.0.0.1:8300/api/login -Method POST `
  -ContentType 'application/json' -Body '{"username":"S001","password":"1111"}'
$token = $login.token

# 學生查詢課程清單
Invoke-RestMethod -Uri http://127.0.0.1:8300/api/courses `
  -Headers @{ Authorization = "Bearer $token" }

# 加選一門不衝堂的課（C006 管理學）
Invoke-RestMethod -Uri http://127.0.0.1:8300/api/student/enroll -Method POST `
  -ContentType 'application/json' -Body '{"courseId":"C006"}' `
  -Headers @{ Authorization = "Bearer $token" }

# 學生查詢成績單
Invoke-RestMethod -Uri http://127.0.0.1:8300/api/student/grades `
  -Headers @{ Authorization = "Bearer $token" }
```

教師登入 `T001 / 1111` 後可用 `GET /api/teacher/courses/C001/roster` 查修課名單，再以 `PUT /api/teacher/courses/C001/scores` 登錄成績。

---

## 專案資訊

| 欄位 | 內容 |
|------|------|
| 課程 | 現代軟體工程（115 學年上學期） |
| 教師 | 陳鍾誠（金門大學資訊工程系） |
| 學生 | 劉甄娜 |
| 學號 | 111410510 |