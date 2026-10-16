# Docker Microservice System

使用 Docker Compose 建置的三層式微服務系統，整合 **Nginx**（網頁伺服器 / 反向代理）、**Node.js + Express**（應用服務）與 **PostgreSQL**（資料庫），示範容器化、網路隔離、健康檢查與資料持久化等實務做法。

---

## 目錄

- [功能特色](#功能特色)
- [系統架構](#系統架構)
- [專案結構](#專案結構)
- [前置需求](#前置需求)
- [快速開始](#快速開始)
- [環境變數](#環境變數)
- [API 文件](#api-文件)
- [常用指令](#常用指令)
- [設計重點](#設計重點)
- [疑難排解](#疑難排解)
- [安全性建議](#安全性建議)
- [學習紀錄](#學習紀錄)

---

## 功能特色

- 三容器架構：Web Server / Reverse Proxy、應用服務、資料庫各自獨立。
- 以 Docker Compose 一鍵建置與啟動，零額外設定即可跑起來。
- 兩層網路隔離（`frontend` / `backend`），資料庫不對外曝露。
- 健康檢查（healthcheck）+ `depends_on: condition` 保證啟動順序正確。
- 資料庫以 Named Volume 持久化，容器重建資料不遺失。
- 後端多階段建置、`npm ci` 可重現建置、非 root 身分執行。
- 支援優雅關閉（graceful shutdown）。
- 前後端分離：前端靜態頁面 + 透過 Nginx 反向代理存取 API，無跨域問題。

---

## 系統架構

本系統包含三個容器，透過兩個網路分層隔離。請求流程如下：

```
                    瀏覽器 / 客戶端
                          │  http://localhost:8080
                          ▼
                 ┌──────────────────┐
   frontend 網路 │   web (Nginx)    │  靜態網頁 + 反向代理
   ───────────── │   :80            │
                 └────────┬─────────┘
                          │  /api/*  →  proxy_pass  http://backend:3000
                          ▼
                 ┌──────────────────┐
   frontend     │ backend (Node.js)│  Express API
   + backend    │   :3000          │
                 └────────┬─────────┘
                          │  pg 連線 (host: db, port: 5432)
                          ▼
                 ┌──────────────────┐
   backend 網路 │   db (PostgreSQL)│  Named Volume: pgdata
   (internal)   │   :5432          │
                 └──────────────────┘
```

| 服務        | 容器名稱  | 映像檔 / 建置      | 對外連接埠      | 說明                                   |
| ----------- | --------- | ------------------ | --------------- | -------------------------------------- |
| **web**     | `web`     | `nginx:1.27-alpine`| `8080 → 80`     | 提供靜態網頁並反向代理 `/api` 至後端    |
| **backend** | `backend` | `./backend` (build)| 無（僅內網）    | Express API 伺服器，透過 `pg` 連線 DB   |
| **db**      | `db`      | `postgres:16-alpine`| 無（僅內網）   | 關聯式資料庫，資料持久化於 `pgdata`     |

> 只有 `web` 對外曝露連接埠；`backend` 與 `db` 僅能在 Docker 內網互通，提升安全性。

---

## 專案結構

```
.
├── docker-compose.yml       # 服務編排：容器、網路、健康檢查、Volume
├── .env.example             # 環境變數範本（複製為 .env 使用）
├── .gitignore
├── .dockerignore
├── README.md
├── backend/                 # Node.js 應用服務
│   ├── Dockerfile           # 多階段建置、非 root 執行
│   ├── .dockerignore
│   ├── package.json
│   ├── package-lock.json
│   └── server.js            # Express API 入口
└── nginx/                   # Nginx 網頁伺服器
    ├── nginx.conf           # 站台設定：靜態檔案 + 反向代理
    └── html/
        └── index.html       # 前端展示頁面（含呼叫 API 的 JS）
```

---

## 前置需求

- [Docker](https://docs.docker.com/get-docker/) 20.10 以上
- [Docker Compose](https://docs.docker.com/compose/) v2（`docker compose` 指令）

確認版本：

```bash
docker --version
docker compose version
```

---

## 快速開始

```bash
# 1. 準備環境變數（可選；未設定時會使用 .env.example 的預設值）
cp .env.example .env

# 2. 建置並啟動全部服務
docker compose up -d --build

# 3. 確認三個容器都 healthy
docker compose ps
```

啟動完成後，開啟瀏覽器：

- 展示頁面：<http://localhost:8080>
- 後端狀態 API：<http://localhost:8080/api/status>

預期 `docker compose ps` 輸出：

```
NAME      IMAGE                 STATUS
backend   05-backend            Up (healthy)
db        postgres:16-alpine    Up (healthy)
web       nginx:1.27-alpine     Up (healthy)
```

停止服務：

```bash
docker compose down          # 停止並移除容器（資料庫資料保留）
docker compose down -v       # 停止並移除容器，同時清除資料庫 Volume
```

---

## 環境變數

所有變數皆為選填，未提供時採用預設值。於專案根目錄建立 `.env`（可從 `.env.example` 複製）：

| 變數                | 預設值             | 說明                                   |
| ------------------- | ------------------ | -------------------------------------- |
| `WEB_PORT`          | `8080`             | Nginx 對外連接埠（主機端）             |
| `POSTGRES_USER`     | `postgres`         | PostgreSQL 使用者名稱                  |
| `POSTGRES_PASSWORD` | `mysecretpassword` | PostgreSQL 密碼                        |
| `POSTGRES_DB`       | `mydb`             | 初始建立的資料庫名稱                   |

> `.env` 已列入 `.gitignore`，不會被提交；請勿將真實密碼寫入版本控制。

---

## API 文件

所有 API 皆經由 Nginx 反向代理（保留 `/api` 前綴）。

### `GET /api/health`

服務存活檢查（Liveness）。僅確認後端行程是否存活，**不查詢資料庫**，供 Docker healthcheck 使用。

**回應 `200 OK`**

```json
{ "status": "ok" }
```

### `GET /api/status`

就緒檢查（Readiness）。實際對 PostgreSQL 執行查詢，確認資料庫連線正常。

**回應 `200 OK`**

```json
{
  "message": "Node.js 後端服務運作正常",
  "db_time": "2026-10-16T03:22:15.801Z"
}
```

**回應 `503 Service Unavailable`（資料庫無法連線）**

```json
{ "error": "資料庫連線失敗" }
```

### `GET /healthz`（Nginx）

Nginx 自身的健康檢查端點，回應純文字 `ok`，不經過後端。

**驗證範例**

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/api/status
curl http://localhost:8080/healthz
```

---

## 常用指令

```bash
# 檢視服務狀態與健康情形
docker compose ps

# 追蹤日誌
docker compose logs -f            # 全部服務
docker compose logs -f backend    # 僅後端

# 重新建置後啟動（程式碼有變更時）
docker compose up -d --build

# 只重啟後端
docker compose restart backend

# 進入容器除錯
docker compose exec backend sh
docker compose exec db psql -U postgres -d mydb

# 停止 / 清除
docker compose down               # 停止並移除容器（Volume 保留）
docker compose down -v            # 連同資料庫 Volume 一併清除
```

---

## 設計重點

- **健康檢查與啟動順序**：`db` 使用 `pg_isready`、`backend` 使用 `/api/health`、`web` 使用 `/healthz`；並以 `depends_on: condition: service_healthy` 確保依賴服務就緒後才啟動，避免連線競態。
- **網路隔離**：`frontend` 網路供 `web` 與 `backend` 通訊；`backend` 網路設為 `internal: true`，`db` 僅掛載於此，無法被外部直接連線。
- **資料持久化**：以 Named Volume `pgdata` 掛載至 `/var/lib/postgresql/data`，容器重建後資料仍在。
- **多階段建置**：Dockerfile 分離「安裝依賴」與「執行階段」，只把 `node_modules` 與程式碼帶入最終映像檔，縮小體積。
- **可重現建置**：使用 `npm ci` 搭配 `package-lock.json`，確保每次建置結果一致。
- **非 root 執行**：最終映像檔以內建 `node` 使用者執行，降低容器逃逸風險。
- **優雅關閉**：後端監聽 `SIGTERM` / `SIGINT`，先停止接收新請求、關閉資料庫連線池後再結束行程。
- **反向代理標頭**：Nginx 傳遞 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`，讓後端能取得真實來源資訊。
- **日誌輪替**：所有服務設定 `max-size: 10m`、`max-file: 3`，避免日誌無限成長佔滿磁碟。
- **Gzip 壓縮**：Nginx 對文字類回應啟用 Gzip，降低傳輸量。
- **連線池**：後端使用 `pg.Pool` 並設定連線與閒置逾時，避免連線耗盡；同時監聽閒置連線錯誤以防行程崩潰。

---

## 疑難排解

### 連接埠 8080 被占用

修改 `.env` 中的 `WEB_PORT`，或直接以環境變數覆寫：

```bash
WEB_PORT=9090 docker compose up -d
```

### 資料庫健康檢查一直失敗 / 版本不相容

若看到類似訊息：

```
FATAL: database files are incompatible with server
DETAIL: The data directory was initialized by PostgreSQL version 15,
        which is not compatible with this version 16.
```

表示舊的 `pgdata` Volume 是由其他 PostgreSQL 版本建立。**開發環境**可直接清除重建（會刪除資料）：

```bash
docker compose down -v
docker compose up -d --build
```

若需保留資料，請改用符合版本的映像檔，或使用 `pg_dump` / `pg_upgrade` 遷移。

### 後端啟動時資料庫尚未就緒

本專案已用 healthcheck + `depends_on` 條件避免此問題。若仍遇到，請確認 `docker compose ps` 中 `db` 狀態為 `healthy`，或用 `docker compose logs db` 檢查。

### 檢視容器健康檢查詳細結果

```bash
docker inspect db --format '{{json .State.Health}}'
docker inspect backend --format '{{json .State.Health}}'
```

---

## 安全性建議

本專案為教學 / 示範用途，正式環境建議再加強：

- 將資料庫密碼等機密改以 Docker Secrets 或外部密鑰管理服務提供，避免明文放在 `.env`。
- 只對外曝露 Nginx，其餘服務維持內部網路（本專案已落實）。
- 為 Nginx 加上 TLS/HTTPS（例如搭配 Let's Encrypt 或反向代理層憑證）。
- 定期更新基礎映像檔版本，修補已知漏洞。
- 視需求加入資源限制（`deploy.resources.limits`）與限流（Nginx `limit_req`）。
- 將 PostgreSQL 設定檔調校與定期備份（`pg_dump`）納入維運流程。
- 使用 `docker scout` 或 Trivy 掃描映像檔弱點。

---

## 學習紀錄

- 學會撰寫多階段 `Dockerfile` 打包 Node.js 執行環境，並以非 root 身分執行。
- 了解如何透過 `docker-compose.yml` 進行容器編排，並用 healthcheck + `depends_on` 控制啟動順序。
- 學會設定 Nginx 的 `proxy_pass` 達成反向代理，正確傳遞 `X-Forwarded-*` 標頭並解決跨域問題。
- 成功讓 Node.js 容器透過內網 DNS (`db`) 連線至 PostgreSQL 容器，並以網路分層提升安全性。
- 學會以 Named Volume 達成資料持久化，並理解資料庫版本升級對既有 Volume 的相容性影響。
- 學會正確實作服務的健康檢查端點（Liveness / Readiness）與優雅關閉機制。
