'use strict';

/**
 * Model: 負責資料與 HTTP 傳輸。
 * 接收 Presenter 給的請求規格 (spec)，送出 HTTP 請求並回傳正規化的回應物件。
 * 完全不進行任何 console / fs 輸出，也不解析命令列參數。
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const MAX_REDIRECTS = 50;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

class HttpError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HttpError';
    this.cause = cause;
  }
}

function transportFor(protocol) {
  return protocol === 'https:' ? https : http;
}

function buildOptions(spec) {
  const url = new URL(spec.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(`unsupported protocol '${url.protocol}'`);
  }
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    path: url.pathname + url.search || '/',
    method: spec.method,
    headers: spec.headers,
  };
}

function rewriteForRedirect(nextUrl, options) {
  return {
    ...options,
    hostname: nextUrl.hostname,
    port: nextUrl.port || undefined,
    path: nextUrl.pathname + nextUrl.search,
  };
}

function perform(uri, options, body, spec, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri);
    const req = transportFor(url.protocol).request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const status = res.statusCode;
        const responseBody = Buffer.concat(chunks);

        if (
          spec.followRedirects &&
          redirectsLeft > 0 &&
          REDIRECT_STATUSES.includes(status)
        ) {
          const location = res.headers.location;
          if (location) {
            if (spec.onRedirect) spec.onRedirect(location);
            const next = new URL(location, url);
            return resolve(
              perform(
                next.href,
                rewriteForRedirect(next, options),
                body,
                spec,
                redirectsLeft - 1
              )
            );
          }
        }

        resolve({ status, headers: res.headers, body: responseBody });
      });
    });

    req.on('error', (err) =>
      reject(new HttpError(`could not connect to '${options.hostname}': ${err.message}`, err))
    );
    req.setTimeout(spec.timeoutMs, () =>
      req.destroy(new HttpError(`connection timed out after ${spec.timeoutMs / 1000}s`))
    );

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * 送出 HTTP 請求。
 * @param {object} spec 請求規格:
 *   - url: string            目標 URL
 *   - method: string         HTTP 方法 (GET/POST/...)
 *   - headers: object        請求標頭
 *   - body: Buffer|null      請求主體
 *   - followRedirects: bool  是否自動跟隨 3xx 重新導向
 *   - timeoutMs: number      連線/整筆傳輸逾時(毫秒)
 *   - onRedirect: fn(string) 每次跟隨重新導向時的通知回呼
 * @returns {Promise<{status:number, headers:object, body:Buffer}>}
 */
function fetch(spec) {
  const options = buildOptions(spec);
  return perform(spec.url, options, spec.body || null, spec, MAX_REDIRECTS);
}

module.exports = { fetch, HttpError };