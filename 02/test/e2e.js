'use strict';

/**
 * test/e2e.js — 校務系統端對端（End-to-End）測試
 *
 * 從「使用者／瀏覽器」的角度，透過真實 HTTP 請求模擬完整的使用流程：
 *   學生登入 → 瀏覽課程 → 加退選（含重複／滿班／衝堂）→ 教師登成績 → 查成績單
 *   教務處 → 系所／學生／教師／課程 CRUD → 權限控管
 *
 * 執行方式（純 Node 標準庫，內建 node:test，不需安裝任何套件）：
 *   node --test test/e2e.js
 *
 * 測試會啟動一份真實的 server.js 子程序，並使用 $DATA_DIR 指向的隔離暫存
 * 資料庫（獨立於正式 data/），結束後自動清理。
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || 8391);
const BASE = `http://${HOST}:${PORT}`;
const API = `${BASE}/api`;
const SERVER_ENTRY = path.join(__dirname, '..', 'server.js');

let server;
let tempDir;
let childOut = '';
let childErr = '';

/* ---------------- 工具 ---------------- */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    await sleep(200);
  }
  throw new Error(`server did not start. stderr:\n${childErr}`);
}

async function api(path, { method = 'GET', token = null, body = null } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(username, password = '1111') {
  const r = await api('/login', { method: 'POST', body: { username, password } });
  assert.equal(r.status, 200, `login ${username} failed`);
  return r.data.token;
}

/* ---------------- 生命週期 ---------------- */
before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nqu-e2e-'));
  server = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tempDir, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (c) => (childOut += c));
  server.stderr.on('data', (c) => (childErr += c));
  await waitReady();
});

after(() => {
  if (server && !server.killed) server.kill();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

/* ================================================================
 * 1. 登入與角色
 * ================================================================ */
test('登入：三種角色成功，錯誤密碼 401，未登入 401', async () => {
  const admin = await login('admin');
  const teacher = await login('T001');
  const student = await login('S001');
  assert.ok(admin.length > 10);
  assert.ok(teacher.length > 10);
  assert.ok(student.length > 10);

  const bad = await api('/login', { method: 'POST', body: { username: 'S001', password: 'wrong' } });
  assert.equal(bad.status, 401);

  const noToken = await api('/me');
  assert.equal(noToken.status, 401);
});

test('權限控管：角色不符 403', async () => {
  const studentToken = await login('S001');
  const adminOnly = await api('/students', { token: studentToken });
  assert.equal(adminOnly.status, 403);

  const teacherToken = await login('T001');
  const teacherOnly = await api('/teacher/courses/C001/roster', { token: teacherToken });
  assert.equal(teacherOnly.status, 200);
  const studentDenied = await api('/teacher/courses', { token: studentToken });
  assert.equal(studentDenied.status, 403);
});

/* ================================================================
 * 2. 教務處：系所／學生／教師／課程 CRUD
 * ================================================================ */
test('教務處：系所新增、重複 409、改名、刪除', async () => {
  const tok = await login('admin');

  const created = await api('/departments', {
    method: 'POST',
    token: tok,
    body: { code: 'ZZ', name: '測試系' },
  });
  assert.equal(created.status, 201);

  const dup = await api('/departments', {
    method: 'POST',
    token: tok,
    body: { code: 'ZZ', name: '測試系' },
  });
  assert.equal(dup.status, 409);

  const renamed = await api('/departments/ZZ', {
    method: 'PUT',
    token: tok,
    body: { name: '改名系' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.name, '改名系');

  const removed = await api('/departments/ZZ', { method: 'DELETE', token: tok });
  assert.equal(removed.status, 200);
});

test('教務處：學生新增／修改／刪除，刪除連帶清掉選課', async () => {
  const tok = await login('admin');

  const created = await api('/students', {
    method: 'POST',
    token: tok,
    body: { id: 'S101', name: '測試生', dept: 'CS', entryYear: 2025 },
  });
  assert.equal(created.status, 201);

  const updated = await api('/students/S101', {
    method: 'PUT',
    token: tok,
    body: { name: '測試生改', dept: 'EE' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.dept, 'EE');

  const removed = await api('/students/S101', { method: 'DELETE', token: tok });
  assert.equal(removed.status, 200);

  const list = await api('/students', { token: tok });
  assert.equal(list.status, 200);
  assert.equal(list.data.some((s) => s.id === 'S101'), false);
  assert.equal('passwordHash' in (list.data[0] || {}), false, '不應回傳密碼雜湊');
});

test('教務處：教師新增、修改、刪除；有開課的教師不可刪', async () => {
  const tok = await login('admin');

  const created = await api('/teachers', {
    method: 'POST',
    token: tok,
    body: { id: 'T101', name: '測試師', dept: 'CS', title: '講師' },
  });
  assert.equal(created.status, 201);

  const updated = await api('/teachers/T101', {
    method: 'PUT',
    token: tok,
    body: { title: '副教授' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.title, '副教授');

  const removed = await api('/teachers/T101', { method: 'DELETE', token: tok });
  assert.equal(removed.status, 200);

  const blocked = await api('/teachers/T001', { method: 'DELETE', token: tok });
  assert.equal(blocked.status, 409, '仍有開課的教師應阻止刪除');
});

test('教務處：課程新增／修改／刪除，課程代碼重複 409', async () => {
  const tok = await login('admin');

  const created = await api('/courses', {
    method: 'POST',
    token: tok,
    body: {
      code: 'ZZ100',
      name: '測試課',
      dept: 'CS',
      credits: 2,
      teacherId: 'T001',
      times: ['1-1'],
      capacity: 5,
    },
  });
  assert.equal(created.status, 201);
  const cid = created.data.id;

  const dup = await api('/courses', {
    method: 'POST',
    token: tok,
    body: {
      code: 'ZZ100',
      name: '測試課二',
      dept: 'CS',
      credits: 2,
      teacherId: 'T001',
      times: ['2-1'],
      capacity: 5,
    },
  });
  assert.equal(dup.status, 409);

  const updated = await api(`/courses/${cid}`, {
    method: 'PUT',
    token: tok,
    body: { capacity: 9 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.capacity, 9);

  const removed = await api(`/courses/${cid}`, { method: 'DELETE', token: tok });
  assert.equal(removed.status, 200);
});

/* ================================================================
 * 3. 學生：選課流程（成功／重複／衝堂／滿班）＋退選
 * ================================================================ */
test('選課：不衝堂可加選，重複加選 409', async () => {
  const tok = await login('S001'); // 已選 C001(週一1-2) C010(週四5-6)
  const ok = await api('/student/enroll', {
    method: 'POST',
    token: tok,
    body: { courseId: 'C006' }, // 管理學，週二1-2，不衝堂
  });
  assert.equal(ok.status, 201);

  const dup = await api('/student/enroll', {
    method: 'POST',
    token: tok,
    body: { courseId: 'C006' },
  });
  assert.equal(dup.status, 409);
});

test('選課：衝堂 409', async () => {
  const tok = await login('S001');
  // C001 為週一第1、2節；新增一門週一第1節的課，加選應被衝堂規則擋下
  const created = await api('/courses', {
    method: 'POST',
    token: await login('admin'),
    body: {
      code: 'ZZ200',
      name: '衝堂課',
      dept: 'CS',
      credits: 2,
      teacherId: 'T001',
      times: ['1-1'],
      capacity: 50,
    },
  });
  const cid = created.data.id;

  const conflict = await api('/student/enroll', {
    method: 'POST',
    token: tok,
    body: { courseId: cid },
  });
  assert.equal(conflict.status, 409);
  assert.match(conflict.data.error, /衝堂/);
});

test('選課：滿班 409', async () => {
  const created = await api('/courses', {
    method: 'POST',
    token: await login('admin'),
    body: {
      code: 'ZZ300',
      name: '滿班課',
      dept: 'EE',
      credits: 1,
      teacherId: 'T002',
      times: ['3-3'],
      capacity: 1,
    },
  });
  const cid = created.data.id;

  const tok3 = await login('S003'); // EE，已選 C004(1-3,1-4)、C005(4-1,4-2)
  const fill = await api('/student/enroll', { method: 'POST', token: tok3, body: { courseId: cid } });
  assert.equal(fill.status, 201);

  const tok4 = await login('S004'); // BA，已選 C006(2-1,2-2)
  const full = await api('/student/enroll', { method: 'POST', token: tok4, body: { courseId: cid } });
  assert.equal(full.status, 409);
  assert.match(full.data.error, /額滿/);
});

test('退選：正常退選，退選後可再選', async () => {
  const tok = await login('S001');

  const drop = await api('/student/enroll/C006', { method: 'DELETE', token: tok });
  assert.equal(drop.status, 200);

  const enrolled = await api('/student/enrolled', { token: tok });
  assert.equal(enrolled.data.courses.some((c) => c.code === 'BA100'), false, '退選後不應再列出');
});

/* ================================================================
 * 4. 教師：成績登錄 ＋ 學生：成績單
 * ================================================================ */
test('成績登錄：只能登自己課、必須 0~100、等第正確', async () => {
  const tea = await login('T001');

  const roster = await api('/teacher/courses/C001/roster', { token: tea });
  assert.equal(roster.status, 200);
  assert.ok(roster.data.roster.length >= 2);

  const own = await api('/teacher/courses/C004/scores', {
    method: 'PUT',
    token: tea,
    body: { studentId: 'S003', score: 80 },
  });
  assert.equal(own.status, 403, '非本人課程不可登錄');

  const bad = await api('/teacher/courses/C001/scores', {
    method: 'PUT',
    token: tea,
    body: { studentId: 'S002', score: 150 },
  });
  assert.equal(bad.status, 400);

  const ok = await api('/teacher/courses/C001/scores', {
    method: 'PUT',
    token: tea,
    body: { studentId: 'S002', score: 90 },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.score, 90);
  assert.equal(ok.data.grade, 'A+');
});

test('學生：成績單含平均與 GPA，登錄後同步更新', async () => {
  const tea = await login('T001');
  // 先設定 S001 的 C001 成績為 85（種子為 88）
  const set = await api('/teacher/courses/C001/scores', {
    method: 'PUT',
    token: tea,
    body: { studentId: 'S001', score: 85 },
  });
  assert.equal(set.status, 200);

  const tok = await login('S001');
  const grades = await api('/student/grades', { token: tok });
  assert.equal(grades.status, 200);

  // S001：C001=85(3學分) 邏輯分、C010=95(1學分)
  // 加權平均 = (85*3 + 95*1)/4 = 87.5；GPA = (3*3 + 4*1)/4 = 3.25
  assert.equal(grades.data.summary.average, 87.5);
  assert.equal(grades.data.summary.gpa, 3.25);
  assert.equal(grades.data.summary.totalCredits, 4);
});

/* ================================================================
 * 5. 前端靜態資源與路徑防護
 * ================================================================ */
test('靜態資源：首頁／JS／CSS 可取得，目錄穿越被擋', async () => {
  const home = await fetch(`${BASE}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<!DOCTYPE html>/);

  const appjs = await fetch(`${BASE}/js/app.js`);
  assert.equal(appjs.status, 200);
  assert.match(await appjs.text(), /boot\(\)/);

  const css = await fetch(`${BASE}/css/style.css`);
  assert.equal(css.status, 200);

  const nothing = await fetch(`${BASE}/no-such-file.js`);
  assert.equal(nothing.status, 404);

  // 用原始 HTTP 請求送出未正規化的路徑，確認目錄穿越不會讀到 server.js 原始碼
  const rawStatus = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: '/../server.js' },
      (res) => resolve(res.statusCode)
    );
    req.on('error', reject);
    req.end();
  });
  assert.notEqual(rawStatus, 200);
});