'use strict';

/**
 * View: 負責所有「回應輸出」。
 * 包括 JSON API 回應、錯誤回應，以及前端靜態檔案（HTML / CSS / JS）的伺服。
 * 不做任何業務判斷 —— 一律由 Presenter 決定回應什麼、何時回應。
 */

const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

function sendText(res, status, text) {
  const body = String(text);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 伺服 public/ 下的靜態檔案。
 * '/' 對應 index.html；路徑會先正規化，防止目錄穿越（..）。
 */
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname;

  // 正規化後必須仍落在 PUBLIC_DIR 內，防止目錄穿越（../）跳出去。
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      return sendText(res, 404, 'Not Found');
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

module.exports = { sendJSON, sendError, sendText, serveStatic };