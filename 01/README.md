# curl.js — 一個模仿 curl 的 HTTP 命令列用戶端

以 **Node.js（原生化模組）** 實作的簡易 `curl` 模擬程式，以 **MVP（Model - View - Presenter）** 架構切割，**純標準函式庫，不需要 `npm install`** 即可執行。

本專案同時具備「命令列使用者介面（前端）」與「HTTP 網路傳輸（後端）」兩大面向，下文將分別詳細說明兩者的架構與互動流程。

---

## 目錄

1. [快速開始](#快速開始)
2. [支援功能](#支援功能)
3. [系統架構總覽](#系統架構總覽)
4. [前端架構：命令列 UI 層](#前端架構命令列-ui-層)
    - [入口 curl.js](#入口-curljs)
    - [View 層（輸出呈現）](#view-層輸出呈現)
    - [Presenter 層（流程控制）](#presenter-層流程控制)
5. [後端架構：網路傳輸層](#後端架構網路傳輸層)
    - [Model 層（HTTP 傳輸）](#model-層http-傳輸)
    - [重新導向處理](#重新導向處理)
6. [完整請求生命週期](#完整請求生命週期)
7. [錯誤處理與 Exit Code](#錯誤處理與-exit-code)
8. [本地測試伺服器](#本地測試伺服器)
9. [執行與驗證](#執行與驗證)
10. [專案資訊](#專案資訊)

---

## 快速開始

```bash
node curl.js https://example.com                 # GET 請求
node curl.js -o page.html -L https://example.com # 存檔 + 跟隨重新導向
node curl.js -d "name=test" -H "Accept: application/json" https://httpbin.org/post
node curl.js -i -u user:pass https://example.com # 顯示標頭 + Basic 認證
node curl.js -X DELETE -f https://example.com/item/1
```

## 支援功能

| 選項 | 說明 |
|------|------|
| `-X, --request COMMAND` | 指定 HTTP 方法（GET / POST / PUT / DELETE ...） |
| `-H, --header LINE` | 自訂標頭 `"Name: value"`，可重複 |
| `-d, --data DATA` | 傳送表單資料（可重複，以 `&` 串接） |
| `-o, --output FILE` | 將回應主體寫入檔案 |
| `-f, --fail` | HTTP 4xx / 5xx 時回傳錯誤碼 1，且不輸出主體 |
| `-i, --include` | 輸出中一併顯示回應標頭 |
| `-I, --head` | 只取回應標頭（HEAD 請求） |
| `-L, --location` | 自動跟隨 3xx 重新導向（最多 50 次） |
| `-s, --silent` | 靜音模式：隱藏錯誤訊息 |
| `-v, --verbose` | 詳細模式：請求資訊輸出到 stderr（不干擾主體） |
| `-u, --user USER:PASSWORD` | HTTP Basic 認證 |
| `--connect-timeout SECONDS` | 連線逾時 |
| `--max-time SECONDS` | 整筆傳輸逾時 |
| `-h, --help` / `--version` | 說明 / 版本 |

支援 HTTP 與 HTTPS。預設行為與 curl 一致：只有 3xx 才回傳 0、4xx/5xx 需搭配 `-f` 才回傳非零。

---

## 系統架構總覽

MVP 把程式切成三層，讓「資料」「呈現」「控制」彼此解耦、各自可獨立測試。站在「前端 / 後端」的觀點，可以這樣分類：

```
┌───────────────────────────────────────────────────────────┐
│                      curl.js（前端）                        │
│             命令列使用者介面（CLI / UI 層）                  │
│                                                           │
│   curl.js（入口）                                          │
│      │                                              ┌─────┴──────┐
│      ▼                                              │   View     │
│   Presenter（控制中樞：解析參數、決定流程、      ──▶│  呈現輸出   │
│   組出請求規格、歸納 exit code）                    │  寫入檔案   │
│      │                                              └────────────┘
│      ▼
│   Model（請求規格 Spec ──▶ { status, headers, body }）
│      │
└──────┼──────────────────────────────────────────────────────────┘
       ▼
┌───────────────────────────────────────────────────────────┐
│                    curl.js（後端）                         │
│                  HTTP 網路傳輸層                           │
│                                                           │
│   Node.js 內建 http / https 模組                           │
│   （連線、請求、接收回應、重新導向、逾時）                    │
└───────────────────────────────────────────────────────────┘
```

把「命令列介面」視為本程式的**前端**（UI 層），把「HTTP 網路通訊」視為**後端**（資料／傳輸層）：

| 面向 | 層級 | 檔案 | 職責 |
|------|------|------|------|
| **前端** | 入口 | `curl.js` | 呼叫 Presenter 並把 exit code 寫入 `process.exitCode` |
| **前端** | Presenter | `src/presenter.js` | 解析命令列、控制流程、呼叫 Model / View、歸納 exit code |
| **前端** | View | `src/view.js` | 所有輸出呈現（主體、標頭、verbose、說明、錯誤）與檔案寫入 |
| **後端** | Model | `src/model.js` | HTTP 傳輸（連線、請求、回應、重新導向、逾時、錯誤封裝） |
| **後端** | 傳輸介面 | Node.js `node:http` / `node:https` | 實際的網路 I/O |

完整的目錄結構：

```
01/
├── curl.js              # 前端 ─ 入口（Entry Point）：呼叫 Presenter
├── srv/
│   └── srv.js           # 後端 ─ 本地測試伺服器（驗證用）
├── src/                 # 前端 + 後端核心
│   ├── presenter.js     # 前端 ─ Presenter（中介層，可測試性核心）
│   ├── view.js          # 前端 ─ View（所有輸出呈現）
│   └── model.js         # 後端 ─ Model（資料與 HTTP 傳輸邏輯）
└── README.md            # 本文件
```

單向依賴，沒有循環引用：

```
curl.js ──▶ Presenter ──▶ Model ──▶ node:http / node:https
                │
                └──────▶ View ──▶ process.stdout / stderr / fs
```

| 層級 | 職責 | 不該做的事 |
|------|------|-----------|
| **Model** | 建立連線、送出請求、收集回應、處理重新導向與逾時，回傳 `{ status, headers, body }`。純資料層。 | 不做任何 console / 檔案輸出，不解析命令列 |
| **View** | 呈現回應主體與標頭、輸出 verbose 資訊、說明文件與錯誤訊息；寫入輸出檔案。 | 不碰 HTTP 邏輯，不決定「何時」輸出 |
| **Presenter** | 解析命令列、組出請求規格（RequestSpec）、呼叫 `model.fetch()`、再依選項決定呼叫哪個 View 方法，並歸納 exit code。 | 不直接操作 HTTP，不直接 print |

---

## 前端架構：命令列 UI 層

前端由三個元件組成：**入口 `curl.js`**、**Presenter（控制中樞）**、**View（呈現）**。

### 入口 curl.js

```js
const { main } = require('./src/presenter.js');
main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
```

- 只做一件事：把 `process.argv`（去掉前兩個固定參數）**原封不動**交給 `Presenter.main()`。
- 取得回傳的 exit code 後寫入 `process.exitCode`，由 Node.js 在程式結束時套用。
- 入口本身**不包含任何業務邏輯**，因此哪一天要改成支援 pipe 輸入、批次檔或測試框架，都只需要改這一層的接線方式。

### View 層（輸出呈現）

`src/view.js` 負責「把東西顯示出來」。它**不知道**回應是怎麼來的、**不知道**何時該輸出 —— 全部由 Presenter 決定呼叫順序。

| 方法 | 輸出目標 | 職責 |
|------|---------|------|
| `writeBody(body)` | stdout | 把回應主體寫到標準輸出 |
| `writeToFile(filename, body)` | 檔案 | 用 `fs.writeFileSync` 把主體寫入檔案 |
| `renderVerbose({method,url,headers})` | stderr | 印出請求方法、URL 與標頭 |
| `renderVerboseNotice(message)` | stderr | 印出單行訊息（例如跟隨重新導向的通知） |
| `renderResponseIncludingHeaders(response)` | stdout | 先印格式化的回應標頭，換行後再印主體 |
| `formatHeaders(response)` | （回傳字串） | 把回應封裝成 `HTTP/1.1 <status> <reason>` 開頭、逐行標頭的純文字 |
| `renderHelp(version)` | stdout | 印出完整的選項說明（等價於 `-h`） |
| `renderVersion(version)` | stdout | 印出版本號 |
| `renderError(message)` | stderr | 以 `curl: error: <msg>` 格式印出錯誤 |

**設計巧思**：主體走 `process.stdout.write`，verbose / 錯誤走 `process.stderr`（`console.error`）。兩者分流，讓使用者可以用 `2>/dev/null` 過濾掉診斷訊息，主體仍保存在 stdout —— 這正是真實 `curl -v` 的行為。

### Presenter 層（流程控制）

`src/presenter.js` 是整個前端的「大腦」，主要含三個函式：

**`parseArgs(argv)` —— 解析命令列**

- `flags` 表格把每個旗標對應到一個 handler；handler 回傳「額外消耗了幾個 token」（0 或 1，代表是否還握有下一個值）。
- 支援「短旗標 + 長旗標」雙寫法（例如 `-X` 與 `--request`）。
- `-d` / `--data` 可重複，使用 `addData` 依序收集再以 `&` 串接。
- 未知選項（開頭為 `-` 卻不在表格內）拋出 `CliError`；超過一個非旗標參數也拋錯。
- 解析結果放在 `args` 物件上（url、method、headers、data、各布林旗標……）。

**`buildRequest(args)` —— 組出請求規格（RequestSpec）**

1. 把 `-H` 的 `"Name: value"` 拆成 `{ Name: value }` 標頭物件；語法錯誤（沒有 `:`）拋出 `CliError`。
2. 若指定 `-u user:pass`，以 UTF-8 做 Base64 編碼後塞進 `Authorization: Basic <base64>`。
3. **方法推斷**：優先取 `-X` 指定的方法；否則有 `-d` 資料就預設 `POST`；再否則 `-I` 就 `HEAD`；最後才是 `GET`。
4. 有 `-d` 資料時，把所有值以 `&` 串接成 Buffer，並在沒有自訂 `Content-Type` 時補上 `application/x-www-form-urlencoded`。
5. **逾時**：`(connectTimeout || maxTime || 30) * 1000` 毫秒。
6. `-v` 時掛上 `onRedirect` 回呼，讓 Model 每次跟隨重新導向都能通知 View 印出訊息。

**`main(argv)` —— 主流程**

```
main(argv)
 ├─ 偵測是否 -s / --silent（優先記下，因為 parse 失敗也可能需要靜音）
 ├─ parseArgs → 失敗：非靜音時印錯誤，return 1
 ├─ --version → renderVersion，return 0
 ├─ --help → renderHelp，return 0
 ├─ URL 為空 → renderHelp，return 2
 ├─ buildRequest → 失敗：印錯誤，return 1
 ├─ -v → renderVerbose（stderr）
 ├─ await model.fetch(spec)
 │    ├─ HttpError → 非靜音時 renderError，return 1
 │    ├─ -f 且 status >= 400 → return 1（不輸出主體）
 │    ├─ -i → renderResponseIncludingHeaders
 │    ├─ -o → writeToFile（-v 時另印完成訊息）
 │    └─ 否則 → writeBody
 └─ return 0
```

Presenter 是**可測試性的核心**：它不直接開 socket、不直接 print，所有副作用都委派給 Model（網路）或 View（輸出），因此任何一層都可以單獨被替換或 mock。

---

## 後端架構：網路傳輸層

### Model 層（HTTP 傳輸）

`src/model.js` 負責整個「後端」的網路行為：連線、送請求、收回應、跟重新導向、管逾時。它唯一對外的視窗是 `fetch(spec)`，回傳一個 `Promise`：

```js
await model.fetch(spec)
// → { status: 200, headers: {...}, body: <Buffer> }
```

**`transportFor(protocol)`** —— 依 `https:` / `http:` 挑選對應的傳輸模組，讓同一套程式碼同時支援兩種協定。

**`buildOptions(spec)`**
- 用 `new URL(spec.url)` 解析目標。
- 不支援的協定拋出 `HttpError('unsupported protocol ...')`。
- 組出 `http.request()` 需要的 `{ protocol, hostname, port, path, method, headers }`。

**`perform(uri, options, body, spec, redirectsLeft)`**
- 以 Promise 包住 `transport.request(options, cb)`。
- 用 `Buffer.concat(chunks)` 在 `end` 事件把回應主體收齊。
- 完全沒有 stor 輸出、完全不知道命令列 —— 純資料傳輸。

**`fetch(spec)`** —— 後端公開 API：
1. `buildOptions(spec)` 組出連線選項。
2. `perform(spec.url, options, body, spec, MAX_REDIRECTS)` 送出請求。

**`HttpError extends Error`**
- 統一封裝連線失敗、協定不支援、逾時等「後端錯誤」。
- 帶 `cause` 欄位保留原始 `Error`，方便除錯。
- Presenter 只需 `err instanceof model.HttpError` 就能判斷是否為可預期的失敗。

### 重新導向處理

```
perform(url, options, ...)
 │
 │ 收到回應
 ▼
status ∈ {301,302,303,307,308} 且 -L 且 redirectsLeft > 0？
 │
 ├─ 是：Location 存在？
 │       ├─ 是 → onRedirect 通知 → new URL(location, base) → 遞迴 perform
 │       │      （rewriteForRedirect 只更新 hostname / port / path，保留 method、headers、body）
 │       └─ 否 → 直接回傳目前回應
 │
 └─ 否 → 回傳 { status, headers, body }
```

重點：
- **最多 50 次**（`MAX_REDIRECTS`），避免無限迴圈。
- 用 `new URL(location, url)` 以「相對網址」解析下一站（符合 HTTP `Location` 規範）。
- 遞迴而非迴圈，因此每個重新導向跳轉都自然沿用同一套 Promise 流程。
- `-v` 時每一次跳轉都會透過 `onRedirect` 在 stderr 印出 `* following redirect to <url>`。

---

## 完整請求生命週期

以 `node curl.js -u a:b https://example.com` 為例，前端與後端如何協作：

```
節點                    動作
───────────────────────────────────────────────────────────────
curl.js                 呼叫 Presenter.main(args)
  │
Presenter.parseArgs()   解析出 args = { url, user:'a:b', maybe -v/-s ... }
  │
Presenter.buildRequest() 組出 spec：
  │  { url, method:'GET', headers:{'Authorization':'Basic <base64>'},
  │    body:null, followRedirects, timeoutMs, onRedirect }
  │
Presenter               -v 時 → view.renderVerbose(spec)           （→ stderr）
  │
Presenter               spec ──▶ model.fetch(spec)                （後端入口）
  │
Model.buildOptions()    new URL → { hostname, path, method, headers }
  │
Model.perform()         transport.request(...)
  │                       │ 收齊 response body (Buffer)
  │                       │ 檢查重新導向 / 逾時 / 錯誤
  ▼                       ▼
                  回傳 { status, headers, body }
  │
Presenter               ├─ -f 且 4xx/5xx → return 1
  │                     ├─ -i → view.renderResponseIncludingHeaders()
  │                     ├─ -o → view.writeToFile()                （→ 檔案）
  │                     └─ 否則 → view.writeBody()                 （→ stdout）
  ▼
curl.js                 process.exitCode = code（0 / 1 / 2）
───────────────────────────────────────────────────────────────
```

## 錯誤處理與 Exit Code

| Exit Code | 情境 |
|-----------|------|
| `0` | 成功（含 3xx 重新導向且未指定 `-f`） |
| `1` | 命令列語法錯誤、未知選項、`-H` 格式錯誤、連線失敗、逾時、協定不支援；或 `-f` 下收到 4xx/5xx |
| `2` | 沒有提供 URL（同時印出 help） |

搭配 `-s` / `--silent` 時，錯誤訊息一律不輸出，但 exit code 依然成立 —— 適合在腳本中安靜地檢查成敗。

---

## 本地測試伺服器

`01/srv/srv.js` 是一個內建的 **Node.js http 測試伺服器**（後端應用範例），用來離線驗證 curl.js 的各種功能，不需要連外網：

```bash
node srv/srv.js          # 預設監聽 http://127.0.0.1:8123
```

| 路徑 | 行為 |
|------|------|
| `GET /auth` | 檢查 `Authorization: Basic dXNlcjpwYXNz`（即 `user:pass`）→ 通過回 `200 ok`、失敗回 `401 denied` |
| `GET /redirect` | 回 `302` 並導向 `/auth`，用來測試 `-L` |
| `POST /echo` | 收集 request body，回傳 `{ method, url, headers, body }` 的 JSON，用來測試 `-d` / `-H` / `-X` |
| 其他 | 一律回 `200 hello! (METHOD path)` |

搭配範例：

```bash
node curl.js http://127.0.0.1:8123/                          # → hello! (GET /)
node curl.js -L http://127.0.0.1:8123/redirect                # 302 → /auth → 401（無認證）
node curl.js -L -u user:pass http://127.0.0.1:8123/redirect   # 302 → /auth → ok
node curl.js -X POST -d 'name=娜' -H 'X-Custom: 1' http://127.0.0.1:8123/echo
```

## 執行與驗證

先測試 HTTP 範例（也可用上面本地測試伺服器）：

```bash
# 用 httpbin.org 線上驗證
node curl.js -s -d "name=test" https://httpbin.org/post
node curl.js -s http://httpbin.org/get
node curl.js -s -L http://httpbin.org/redirect/3
node curl.js -s -u admin:secret http://httpbin.org/basic-auth/admin/secret
```

本機測試伺服器範例（可另存 `srv.js` 執行）：

```js
const http = require('node:http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('hello from local server\n');
}).listen(8123, '127.0.0.1', () => console.log('ready'));
```

再以 `node curl.js http://127.0.0.1:8123` 測試。

---

## 專案資訊

| 欄位 | 內容 |
|------|------|
| 課程 | 現代軟體工程（115 學年上學期） |
| 教師 | 陳鍾誠（金門大學資訊工程系） |
| 學生 | 劉甄娜 |
| 學號 | 111410510 |