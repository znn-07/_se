# Docker Microservice System

使用 Docker Compose 建置的簡易微服務系統。

## 系統架構

本系統包含三個容器，透過兩個網路分層隔離：

```
        瀏覽器
          │  :8080
     ┌────▼─────┐   frontend 網路   ┌──────────┐
     │  web     ├───────────────────┤ backend  │
     │ (Nginx)  │   /api → :3000    │ (Node.js)│
     └──────────┘                   └────┬─────┘
                                         │ backend 網路 (internal)
                                    ┌────▼─────┐
                                    │   db     │
                                    │(Postgres)│
                                    └──────────┘
```

1. **Nginx (`web`)**: 提供靜態網頁，並作為 Reverse Proxy 將 `/api` 請求轉發至後端。
2. **Node.js (`backend`)**: 使用 Express 建立 API 伺服器，透過 `pg` 連接資料庫。
3. **PostgreSQL (`db`)**: 關聯式資料庫，資料以 Named Volume 持久化；位於 internal 網路，不對外曝露。

## 啟動方式

```bash
# 1. 準備環境變數（可選，未設定時使用預設值）
cp .env.example .env

# 2. 建置並啟動
docker compose up -d --build
```

啟動完成後開啟瀏覽器：`http://localhost:8080`

## 常用指令

```bash
docker compose ps                 # 查看服務與健康狀態
docker compose logs -f backend    # 追蹤後端日誌
docker compose down               # 停止並移除容器（資料保留）
docker compose down -v            # 停止並清除資料庫 Volume
```

## API

| 方法 | 路徑           | 說明                                |
| ---- | -------------- | ----------------------------------- |
| GET  | `/api/health`  | 服務存活檢查（Liveness，不查 DB）   |
| GET  | `/api/status`  | 就緒檢查，實際查詢資料庫回傳時間    |

前端透過 `fetch('/api/status')` 呼叫，經 Nginx 反向代理後抵達後端。

## 設計重點

* **健康檢查與啟動順序**：`db` 使用 `pg_isready`、`backend` 使用 `/api/health`、`web` 使用 `/healthz`，並以 `depends_on: condition: service_healthy` 確保依賴就緒後才啟動。
* **網路隔離**：`backend` 網路設為 `internal`，資料庫無法被外部直接連線。
* **非 root 執行**：後端映像檔以內建 `node` 使用者執行，降低風險。
* **多階段建置**：Dockerfile 分離依賴安裝與執行階段，並使用 `npm ci` 確保可重現建置。
* **優雅關閉**：後端監聽 `SIGTERM`/`SIGINT`，正確關閉連線池。
* **日誌輪替**：所有服務設定 `max-size`/`max-file`，避免日誌佔滿磁碟。

## 學習紀錄

* 學會撰寫多階段 `Dockerfile` 打包 Node.js 執行環境並以非 root 身分執行。
* 了解如何透過 `docker-compose.yml` 進行容器編排，並用 healthcheck + `depends_on` 控制啟動順序。
* 學會設定 Nginx 的 `proxy_pass` 達成反向代理，正確傳遞 `X-Forwarded-*` 標頭並解決跨域問題。
* 成功讓 Node.js 容器透過內網 DNS (`db`) 連線至 PostgreSQL 容器，並以網路分層提升安全性。
