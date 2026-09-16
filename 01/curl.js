#!/usr/bin/env node
/**
 * curl.js - 一個模仿 curl 的 HTTP 命令列用戶端 (Node.js / MVP 架構)。
 *
 * 專案結構 (MVP):
 *   curl.js           入口：負責呼叫 Presenter
 *   src/presenter.js  Presenter：解析參數、控制流程、呼叫 Model / View
 *   src/model.js      Model：HTTP 傳輸邏輯（請求、重新導向、逾時）
 *   src/view.js       View：所有輸出呈現（標頭、主體、說明、錯誤）
 */
'use strict';

const { main } = require('./src/presenter.js');

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});