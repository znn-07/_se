# ---- 建置階段：安裝依賴 ----
FROM node:20-alpine AS deps
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- 執行階段：僅帶入必要檔案 ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app

# 使用非 root 使用者執行，降低風險（node 映像檔內建 node 使用者）
COPY --from=deps --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node server.js ./

USER node
EXPOSE 3000

# 容器自我健康檢查（供 docker compose / orchestrator 使用）
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
