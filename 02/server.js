#!/usr/bin/env node
/**
 * server.js - 大學校務系統（入口）。
 *
 * 啟動方式：node server.js          （預設 http://127.0.0.1:8300）
 *          PORT=9000 node server.js （自訂連接埠）
 *
 * 架構（MVP）：
 *   server.js        入口：建立 HTTP 伺服器
 *   src/app.js       Presenter：路由分派、登入 / 權限、業務規則
 *   src/model.js     Model：JSON 檔案資料庫
 *   src/view.js      View：JSON 回應與靜態檔案伺服
 *   public/          前端（HTML / CSS / JS）
 */
'use strict';

const http = require('node:http');
const { createApp } = require('./src/app.js');
const model = require('./src/model.js');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8300);

const wasSeeded = model.init();

const handle = createApp();
const server = http.createServer((req, res) => {
  handle(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`大學校務系統已啟動：http://${HOST}:${PORT}`);
  if (wasSeeded) {
    console.log('（首次啟動，已建立示範資料，所有帳號密碼預設為 1111）');
  }
  console.log('示範帳號：');
  console.log('  教務處  admin   / 1111');
  console.log('  教師    T001    / 1111');
  console.log('  學生    S001    / 1111');
});