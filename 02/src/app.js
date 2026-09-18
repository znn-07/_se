'use strict';

/**
 * Presenter: 校務系統的「控制中樞」。
 *
 * 負責：
 *   - 解析請求（方法 / 路徑 / 標頭 / JSON 主體）
 *   - 路由分派（/api/* 走 API，其餘走靜態檔案）
 *   - 登入與會話管理（Bearer token）
 *   - 角色權限檢查（admin / teacher / student）
 *   - 業務規則：選課（人數、重複、衝堂）、成績登錄（教師限定、0~100）
 *
 * 本模組不直接輸出回應內容（交給 view），也不讀寫資料檔（交給 model），
 * 只負責「判斷與控制」。
 */

const crypto = require('node:crypto');
const model = require('./model.js');
const view = require('./view.js');

const SEMESTER = '115-1'; // 學期：115 學年第 1 學期
const MAX_BODY_BYTES = 1024 * 1024; // 請求主體上限 1 MB

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- 工具 ----------
function parseCookieHeader(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return cookies;
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AppError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new AppError(400, 'invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      throw new AppError(400, `missing field: ${f}`);
    }
  }
}

// ---------- 會話 ----------
// 以隨機 token 對應 { userId, role }；存在記憶體，伺服器重啟後需重新登入。
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role: user.role, userId: user.id });
  return token;
}

function sessionUser(token) {
  const s = sessions.get(token);
  if (!s) return null;
  return { role: s.role, userId: s.userId };
}

// ---------- API Handler 群 ----------
// 每個 handler 收 ctx = { req, res, params:[...], body, user }

function publicUserView(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    dept: user.dept || null,
    semester: SEMESTER,
  };
}

function handleLogin(ctx) {
  const { username, password } = ctx.body;
  if (!username) {
    throw new AppError(400, 'missing field: username');
  }
  const user = model.findUserByLogin(String(username));
  if (!user || !model.verifyPassword(user, String(password || ''))) {
    throw new AppError(401, '帳號或密碼錯誤');
  }
  const token = createSession(user);
  return view.sendJSON(ctx.res, 200, { token, user: publicUserView(user) });
}

function handleLogout(ctx) {
  const token = ctx.token;
  if (token) sessions.delete(token);
  return view.sendJSON(ctx.res, 200, { ok: true });
}

function handleMe(ctx) {
  return view.sendJSON(ctx.res, 200, { user: publicUserView(ctx.user) });
}

// ---- 系所管理（admin）----
function handleListDepartments(ctx) {
  return view.sendJSON(ctx.res, 200, model.list('departments'));
}

function handleCreateDepartment(ctx) {
  requireFields(ctx.body, ['code', 'name']);
  if (model.findBy('departments', 'code', ctx.body.code)) {
    throw new AppError(409, `系所代碼 ${ctx.body.code} 已存在`);
  }
  const item = model.insert('departments', {
    code: ctx.body.code,
    name: ctx.body.name,
  });
  return view.sendJSON(ctx.res, 201, item);
}

function handleUpdateDepartment(ctx) {
  const code = ctx.params[0];
  const item = model.get('departments', code);
  if (!item) throw new AppError(404, `系所 ${code} 不存在`);
  if (ctx.body.name !== undefined && ctx.body.name === '') {
    throw new AppError(400, 'missing field: name');
  }
  return view.sendJSON(ctx.res, 200, model.update('departments', code, { name: ctx.body.name }));
}

function handleDeleteDepartment(ctx) {
  const code = ctx.params[0];
  const dependents = ['students', 'teachers', 'courses'].filter((c) =>
    model.list(c).some((x) => x.dept === code)
  ).length;
  if (dependents > 0) {
    throw new AppError(409, `系所 ${code} 尚有資料參照，無法刪除`);
  }
  const item = model.remove('departments', code);
  if (!item) throw new AppError(404, `系所 ${code} 不存在`);
  return view.sendJSON(ctx.res, 200, { ok: true });
}

// ---- 學生管理（admin）----
function handleListStudents(ctx) {
  const rows = model.list('students').map((s) => ({
    ...s,
    deptName: model.deptName(s.dept),
    passwordHash: undefined,
  }));
  return view.sendJSON(ctx.res, 200, rows);
}

function handleCreateStudent(ctx) {
  requireFields(ctx.body, ['id', 'name', 'dept']);
  if (model.get('students', ctx.body.id)) {
    throw new AppError(409, `學號 ${ctx.body.id} 已存在`);
  }
  const item = model.insert('students', {
    id: ctx.body.id,
    name: ctx.body.name,
    dept: ctx.body.dept,
    entryYear: Number(ctx.body.entryYear || new Date().getFullYear()),
    passwordHash: model.hashPassword(ctx.body.password || '1111'),
  });
  return view.sendJSON(ctx.res, 201, { ...item, passwordHash: undefined });
}

function handleUpdateStudent(ctx) {
  const id = ctx.params[0];
  if (!model.get('students', id)) throw new AppError(404, `學生 ${id} 不存在`);
  const patch = {
    name: ctx.body.name,
    dept: ctx.body.dept,
    entryYear: ctx.body.entryYear === undefined ? undefined : Number(ctx.body.entryYear),
  };
  if (ctx.body.password) patch.passwordHash = model.hashPassword(ctx.body.password);
  const item = model.update('students', id, patch);
  return view.sendJSON(ctx.res, 200, { ...item, passwordHash: undefined });
}

function handleDeleteStudent(ctx) {
  const id = ctx.params[0];
  const item = model.remove('students', id);
  if (!item) throw new AppError(404, `學生 ${id} 不存在`);
  // 一併刪除該學生的選課紀錄
  model.removeEnrollments({ studentId: id });
  return view.sendJSON(ctx.res, 200, { ok: true });
}

// ---- 教師管理（admin）----
function handleListTeachers(ctx) {
  const rows = model.list('teachers').map((t) => ({
    ...t,
    deptName: model.deptName(t.dept),
    passwordHash: undefined,
  }));
  return view.sendJSON(ctx.res, 200, rows);
}

function handleCreateTeacher(ctx) {
  requireFields(ctx.body, ['id', 'name', 'dept']);
  if (model.get('teachers', ctx.body.id)) {
    throw new AppError(409, `教師編號 ${ctx.body.id} 已存在`);
  }
  const item = model.insert('teachers', {
    id: ctx.body.id,
    name: ctx.body.name,
    dept: ctx.body.dept,
    title: ctx.body.title || '講師',
    passwordHash: model.hashPassword(ctx.body.password || '1111'),
  });
  return view.sendJSON(ctx.res, 201, { ...item, passwordHash: undefined });
}

function handleUpdateTeacher(ctx) {
  const id = ctx.params[0];
  if (!model.get('teachers', id)) throw new AppError(404, `教師 ${id} 不存在`);
  const patch = {
    name: ctx.body.name,
    dept: ctx.body.dept,
    title: ctx.body.title,
  };
  if (ctx.body.password) patch.passwordHash = model.hashPassword(ctx.body.password);
  const item = model.update('teachers', id, patch);
  return view.sendJSON(ctx.res, 200, { ...item, passwordHash: undefined });
}

function handleDeleteTeacher(ctx) {
  const id = ctx.params[0];
  const hasCourses = model.list('courses').some((c) => c.teacherId === id);
  if (hasCourses) throw new AppError(409, `教師 ${id} 仍開設課程，無法刪除`);
  const item = model.remove('teachers', id);
  if (!item) throw new AppError(404, `教師 ${id} 不存在`);
  return view.sendJSON(ctx.res, 200, { ok: true });
}

// ---- 課程管理（admin / 全部角色可見）----
function handleListCourses(ctx) {
  const rows = model.list('courses').map((c) => {
    const extra =
      ctx.user?.role === 'student'
        ? { isEnrolled: model.isEnrolled(ctx.user.id, c.id) }
        : {};
    return model.enrichCourse(c, extra);
  });
  return view.sendJSON(ctx.res, 200, rows);
}

function handleCreateCourse(ctx) {
  requireFields(ctx.body, ['code', 'name', 'dept', 'credits', 'teacherId', 'times', 'capacity']);
  if (model.findBy('courses', 'code', ctx.body.code)) {
    throw new AppError(409, `課程代碼 ${ctx.body.code} 已存在`);
  }
  if (!model.get('teachers', ctx.body.teacherId)) {
    throw new AppError(400, `教師 ${ctx.body.teacherId} 不存在`);
  }
  const item = model.insert('courses', {
    id: model.nextId('courses', 'C'),
    code: ctx.body.code,
    name: ctx.body.name,
    dept: ctx.body.dept,
    credits: Number(ctx.body.credits),
    teacherId: ctx.body.teacherId,
    times: Array.isArray(ctx.body.times) ? ctx.body.times : [],
    capacity: Number(ctx.body.capacity),
  });
  return view.sendJSON(ctx.res, 201, model.enrichCourse(item));
}

function handleUpdateCourse(ctx) {
  const id = ctx.params[0];
  const c = model.get('courses', id);
  if (!c) throw new AppError(404, `課程 ${id} 不存在`);
  const patch = {
    code: ctx.body.code,
    name: ctx.body.name,
    dept: ctx.body.dept,
    credits: ctx.body.credits === undefined ? undefined : Number(ctx.body.credits),
    teacherId: ctx.body.teacherId,
    times: ctx.body.times,
    capacity: ctx.body.capacity === undefined ? undefined : Number(ctx.body.capacity),
  };
  if (patch.teacherId && !model.get('teachers', patch.teacherId)) {
    throw new AppError(400, `教師 ${patch.teacherId} 不存在`);
  }
  const item = model.update('courses', id, patch);
  return view.sendJSON(ctx.res, 200, model.enrichCourse(item));
}

function handleDeleteCourse(ctx) {
  const id = ctx.params[0];
  const item = model.remove('courses', id);
  if (!item) throw new AppError(404, `課程 ${id} 不存在`);
  // 一併刪除該課程的所有選課紀錄
  model.removeEnrollments({ courseId: id });
  return view.sendJSON(ctx.res, 200, { ok: true });
}

// ---- 教師端：我的課程、成績登錄 ----
function handleTeacherCourses(ctx) {
  return view.sendJSON(ctx.res, 200, model.coursesOfTeacher(ctx.user.id));
}

function handleTeacherRoster(ctx) {
  const courseId = ctx.params[0];
  const course = model.get('courses', courseId);
  if (!course) throw new AppError(404, `課程 ${courseId} 不存在`);
  if (course.teacherId !== ctx.user.id) {
    throw new AppError(403, '只能查詢自己開設的課程');
  }
  const roster = model
    .list('enrollments')
    .filter((e) => e.courseId === courseId)
    .map((e) => {
      const s = model.get('students', e.studentId);
      return {
        studentId: e.studentId,
        studentName: s ? s.name : e.studentId,
        deptName: s ? model.deptName(s.dept) : '',
        score: e.score,
      };
    });
  return view.sendJSON(ctx.res, 200, {
    course: model.enrichCourse(course),
    semester: SEMESTER,
    roster,
  });
}

function handleTeacherScores(ctx) {
  const courseId = ctx.params[0];
  const course = model.get('courses', courseId);
  if (!course) throw new AppError(404, `課程 ${courseId} 不存在`);
  if (course.teacherId !== ctx.user.id) {
    throw new AppError(403, '只能為自己開設的課程登錄成績');
  }
  const { studentId, score } = ctx.body;
  if (!studentId) throw new AppError(400, 'missing field: studentId');
  if (score === null || score === undefined || score === '') {
    throw new AppError(400, 'missing field: score');
  }
  const numeric = Number(score);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new AppError(400, '成績必須介於 0 ~ 100');
  }
  const e = model.list('enrollments').find(
    (x) => x.studentId === studentId && x.courseId === courseId
  );
  if (!e) throw new AppError(404, `學生 ${studentId} 未選修此課程`);
  e.score = Math.round(numeric);
  return view.sendJSON(ctx.res, 200, {
    studentId,
    courseId,
    score: e.score,
    grade: model.gradeLetter(e.score),
  });
}

// ---- 學生端：選課 / 退選 / 已選課程 / 成績 ----
function handleEnroll(ctx) {
  requireFields(ctx.body, ['courseId']);
  const courseId = ctx.body.courseId;
  const course = model.get('courses', courseId);
  const student = ctx.user;

  if (!course) throw new AppError(404, `課程 ${courseId} 不存在`);
  if (model.isEnrolled(student.id, courseId)) {
    throw new AppError(409, '你已選修此課程');
  }
  if (model.enrolledCount(courseId) >= course.capacity) {
    throw new AppError(409, '課程人數已額滿');
  }

  // 衝堂檢查：新課程與所有已選課程不得有重疊的排課時間
  const mine = model.enrolledCoursesOf(student.id);
  for (const c of mine) {
    if (model.timesOverlap(c.times, course.times)) {
      throw new AppError(
        409,
        `選課失敗：「${course.name}」與已選的「${c.name}」排課衝堂`
      );
    }
  }

  model.insert('enrollments', {
    studentId: student.id,
    courseId: course.id,
    score: null,
  });
  return view.sendJSON(ctx.res, 201, {
    ok: true,
    message: `已加選「${course.name}」`,
    course: model.enrichCourse(course),
  });
}

function handleDropCourse(ctx) {
  const courseId = ctx.params[0];
  const list = model.list('enrollments');
  const idx = list.findIndex(
    (e) => e.studentId === ctx.user.id && e.courseId === courseId
  );
  if (idx === -1) throw new AppError(404, '你尚未選修此課程');
  const [removed] = list.splice(idx, 1);
  const course = model.get('courses', courseId);
  return view.sendJSON(ctx.res, 200, {
    ok: true,
    message: `已退選「${course ? course.name : courseId}」`,
  });
}

function handleStudentEnrolled(ctx) {
  const enrolled = model.enrolledCoursesOf(ctx.user.id);
  return view.sendJSON(ctx.res, 200, { semester: SEMESTER, courses: enrolled });
}

function handleStudentGrades(ctx) {
  const enrolled = model.enrolledCoursesOf(ctx.user.id);
  const hasScore = enrolled.filter((c) => c.score !== null);
  const totalCredits = enrolled.reduce((s, c) => s + c.credits, 0);
  const gradedCredits = hasScore.reduce((s, c) => s + c.credits, 0);
  const weightedSum = hasScore.reduce((s, c) => s + c.score * c.credits, 0);
  const average = gradedCredits > 0 ? weightedSum / gradedCredits : null;
  const gpa =
    gradedCredits > 0
      ? hasScore.reduce((s, c) => s + model.gradePoint(c.score) * c.credits, 0) /
        gradedCredits
      : null;
  return view.sendJSON(ctx.res, 200, {
    semester: SEMESTER,
    courses: enrolled.map((c) => ({
      ...c,
      grade: model.gradeLetter(c.score),
    })),
    summary: {
      totalCredits,
      gradedCredits,
      average: average === null ? null : Number(average.toFixed(2)),
      gpa: gpa === null ? null : Number(gpa.toFixed(2)),
    },
  });
}

// ---------- 路由表 ----------
// [method, pathPattern(RegExp), role, handler]
// role: 'public' 不需登入；'any' 登入即可；否則限定該角色。
const ROUTES = [
  ['POST', /^\/api\/login$/, 'public', handleLogin],
  ['GET', /^\/api\/me$/, 'any', handleMe],
  ['POST', /^\/api\/logout$/, 'any', handleLogout],

  ['GET', /^\/api\/departments$/, 'any', handleListDepartments],
  ['POST', /^\/api\/departments$/, 'admin', handleCreateDepartment],
  ['PUT', /^\/api\/departments\/([^/]+)$/, 'admin', handleUpdateDepartment],
  ['DELETE', /^\/api\/departments\/([^/]+)$/, 'admin', handleDeleteDepartment],

  ['GET', /^\/api\/students$/, 'admin', handleListStudents],
  ['POST', /^\/api\/students$/, 'admin', handleCreateStudent],
  ['PUT', /^\/api\/students\/([^/]+)$/, 'admin', handleUpdateStudent],
  ['DELETE', /^\/api\/students\/([^/]+)$/, 'admin', handleDeleteStudent],

  ['GET', /^\/api\/teachers$/, 'admin', handleListTeachers],
  ['POST', /^\/api\/teachers$/, 'admin', handleCreateTeacher],
  ['PUT', /^\/api\/teachers\/([^/]+)$/, 'admin', handleUpdateTeacher],
  ['DELETE', /^\/api\/teachers\/([^/]+)$/, 'admin', handleDeleteTeacher],

  ['GET', /^\/api\/courses$/, 'any', handleListCourses],
  ['POST', /^\/api\/courses$/, 'admin', handleCreateCourse],
  ['PUT', /^\/api\/courses\/([^/]+)$/, 'admin', handleUpdateCourse],
  ['DELETE', /^\/api\/courses\/([^/]+)$/, 'admin', handleDeleteCourse],

  ['GET', /^\/api\/teacher\/courses$/, 'teacher', handleTeacherCourses],
  ['GET', /^\/api\/teacher\/courses\/([^/]+)\/roster$/, 'teacher', handleTeacherRoster],
  ['PUT', /^\/api\/teacher\/courses\/([^/]+)\/scores$/, 'teacher', handleTeacherScores],

  ['POST', /^\/api\/student\/enroll$/, 'student', handleEnroll],
  ['DELETE', /^\/api\/student\/enroll\/([^/]+)$/, 'student', handleDropCourse],
  ['GET', /^\/api\/student\/enrolled$/, 'student', handleStudentEnrolled],
  ['GET', /^\/api\/student\/grades$/, 'student', handleStudentGrades],
];

// ---------- API 主流程 ----------
async function handleAPI(req, res, pathname, method) {
  for (const [routeMethod, pattern, role, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const m = pattern.exec(pathname);
    if (!m) continue;

    const params = m.slice(1);
    const body = ['POST', 'PUT'].includes(method) ? await readJSONBody(req) : {};
    const ctx = { req, res, params, body, user: null, token: null };

    // 權限檢查
    if (role !== 'public') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
        parseCookieHeader(req).token;
      const session = token ? sessionUser(token) : null;
      const user = session ? model.get(session.role + 's', session.userId) : null;
      if (!session) throw new AppError(401, '請先登入');
      if (!user) throw new AppError(401, '登入已失效，請重新登入');
      if (role !== 'any' && session.role !== role) {
        throw new AppError(403, '沒有此操作權限');
      }
      ctx.user = {
        id: user.id,
        role: session.role,
        name: user.name,
        dept: user.dept,
      };
      ctx.token = token;
    }

    return await handler(ctx);
  }

  throw new AppError(404, `未知的 API：${method} ${pathname}`);
}

/**
 * 建立應用程式處理器。回傳 (req, res) => Promise<undefined>
 */
function createApp() {
  return function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    if (pathname.startsWith('/api/')) {
      return handleAPI(req, res, pathname, method).catch((err) => {
        if (err instanceof AppError) {
          view.sendError(res, err.status, err.message);
        } else {
          view.sendError(res, 500, `伺服器內部錯誤：${err.message}`);
        }
      });
    }

    return Promise.resolve(view.serveStatic(res, pathname));
  };
}

module.exports = { createApp, AppError };