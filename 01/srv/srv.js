'use strict';

/**
 * srv.js - 本機測試伺服器，用來驗證 curl.js 的各項功能。
 * 啟動：node srv.js
 * 預設監聽 http://127.0.0.1:8123
 */

const http = require('node:http');

const PORT = 8123;

const server = http.createServer((req, res) => {
  const { url, method } = req;

  if (url === '/auth') {
    const ok = req.headers.authorization === 'Basic dXNlcjpwYXNz'; // user:pass
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'text/plain' });
    res.end(ok ? 'ok' : 'denied');
    return;
  }

  if (url === '/redirect') {
    res.writeHead(302, { Location: '/auth' });
    res.end('moved');
    return;
  }

  if (url === '/echo') {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ method, url, headers: req.headers, body: body.toString() }, null, 2)
      );
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`hello! (${method} ${url})\n`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`test server ready at http://127.0.0.1:${PORT}`);
});