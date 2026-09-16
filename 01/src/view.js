'use strict';

/**
 * View: 負責所有「呈現」與「輸出」。
 * 輸出回應主體、回應標頭、詳細資訊、說明與錯誤訊息等等。
 * 不接觸 HTTP 邏輯，也不知道「何時」該呼叫檔案系統 —— 由 Presenter 決定。
 */

const http = require('node:http');
const fs = require('node:fs');

function writeBody(body) {
  process.stdout.write(body);
}

function writeToFile(filename, body) {
  fs.writeFileSync(filename, body);
}

function renderVerbose({ method, url, headers }) {
  console.error(`${method} ${url}`);
  for (const [key, value] of Object.entries(headers)) {
    console.error(`${key}: ${value}`);
  }
  console.error('');
}

function renderVerboseNotice(message) {
  console.error(message);
}

function renderResponseIncludingHeaders(response) {
  process.stdout.write(formatHeaders(response));
  process.stdout.write('\n');
  process.stdout.write(response.body);
}

function formatHeaders(response) {
  let text = `HTTP/1.1 ${response.status} ${http.STATUS_CODES[response.status] || ''}\n`;
  for (const [key, value] of Object.entries(response.headers)) {
    text += `${key}: ${value}\n`;
  }
  return text;
}

function renderHelp(version) {
  const lines = [
    `curl.js ${version} - a minimal curl-like HTTP client in Node.js`,
    '',
    'Usage: node curl.js [options] URL',
    '',
    'Options:',
    '  -X, --request COMMAND        HTTP method (GET, POST, DELETE, ...)',
    '  -H, --header LINE            custom header "Name: value" (repeatable)',
    '  -d, --data DATA              HTTP POST data (repeatable, &-joined)',
    '  -o, --output FILE            write body to FILE instead of stdout',
    '  -f, --fail                   fail (exit non-zero) on HTTP 4xx/5xx',
    '  -i, --include                include response headers in output',
    '  -I, --head                   fetch headers only (HEAD request)',
    '  -L, --location               follow redirects',
    '  -s, --silent                 silent mode: no progress or error messages',
    '  -v, --verbose                show request details on stderr',
    '  -u, --user USER:PASSWORD     HTTP basic authentication',
    '  --connect-timeout SECONDS    connection timeout',
    '  --max-time SECONDS           maximum time for the whole transfer',
    '  -h, --help                   show this help',
    '  --version                    show version',
  ];
  console.log(lines.join('\n'));
}

function renderVersion(version) {
  console.log(`curl.js ${version}`);
}

function renderError(message) {
  console.error(`curl: error: ${message}`);
}

module.exports = {
  writeBody,
  writeToFile,
  renderVerbose,
  renderVerboseNotice,
  renderResponseIncludingHeaders,
  renderHelp,
  renderVersion,
  renderError,
};