const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json());

// 設定 PostgreSQL 連線池 (使用 docker-compose 傳入的環境變數)
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// 未被預期關閉的連線時，避免整個 process 崩潰
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Liveness：僅檢查服務本身是否存活 (供 healthcheck 使用，不依賴 DB)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 就緒狀態：實際查詢資料庫，確認連線正常
app.get('/api/status', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({
      message: 'Node.js 後端服務運作正常',
      db_time: result.rows[0].now,
    });
  } catch (err) {
    console.error('Database query failed:', err.message);
    res.status(503).json({ error: '資料庫連線失敗' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// 全域錯誤處理
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});

// Graceful shutdown：收到終止訊號時關閉連線池與伺服器
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    pool.end().then(() => {
      console.log('Shutdown complete');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
