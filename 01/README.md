# curl.js — 一個模仿 curl 的 HTTP 命令列用戶端

以 **Node.js（原生化模組）** 實作的簡易 `curl` 模擬程式，並以 **MVP（Model - View - Presenter）** 架構切割，純標準函式庫，**不需要 `npm install`** 即可執行。

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

## MVP 架構

MVP 把程式切成三層，讓「資料」「呈現」「控制」彼此解耦、各自可獨立測試：

```
01/
├── curl.js              # 入口（Entry Point）：呼叫 Presenter
├── src/
│   ├── presenter.js     # Presenter（中介層，可測試性核心）
│   ├── model.js         # Model（資料與 HTTP 傳輸邏輯）
│   └── view.js          # View（所有輸出呈現）
└── README.md            # 本文件
```

| 層級 | 檔案 | 職責 | 不該做的事 |
|------|------|------|-----------|
| **Model** | `src/model.js` | 建立連線、送出請求、收集回應、處理重新導向與逾時，回傳 `{ status, headers, body }`。純資料層。 | 不做任何 console / 檔案輸出，不解析命令列 |
| **View** | `src/view.js` | 呈現回應主體與標頭、輸出 verbose 資訊、說明文件與錯誤訊息；寫入輸出檔案。 | 不碰 HTTP 邏輯，不決定「何時」輸出 |
| **Presenter** | `src/presenter.js` | 解析命令列、組出請求規格（RequestSpec）、呼叫 `model.fetch()`、再依選項決定呼叫哪個 View 方法，並歸納 exit code。 | 不直接操作 HTTP，不直接 print |

單向依賴，沒有循環引用：

```
curl.js ──▶ Presenter ──▶ Model
                │
                └──────▶ View
```

### 資料流範例（`node curl.js -u a:b https://example.com`）

1. `Presenter.parseArgs()` 解析參數 → `Presenter.buildRequest()` 產生請求規格（含 Base64 認證標頭）。
2. `Presenter` 呼叫 `model.fetch(spec)`。
3. `Model` 選用 `http`/`https` 模組送出請求，收集回應，回傳 `{ status, headers, body }`。
4. `Presenter` 依選項呼叫 `view.writeBody()` / `view.renderResponseIncludingHeaders()` 等呈現結果。
5. `Presenter` 回傳 exit code 給入口程式。

## 執行與驗證

先測試 HTTP 範例（也可用本地測試伺服器）：

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

## 專案資訊

| 欄位 | 內容 |
|------|------|
| 課程 | 現代軟體工程（115 學年上學期） |
| 教師 | 陳鍾誠（金門大學資訊工程系） |
| 學生 | 劉甄娜 |
| 學號 | 111410510 |