'use strict';

/**
 * Model: 負責「資料層」—— 校務系統的 JSON 檔案資料庫。
 *
 * 所有資料存放在 data/ 目錄下的多個 JSON 檔案中：
 *   admins / students / teachers / departments / courses / enrollments
 *
 * 啟動時把資料載入記憶體，任何異動（新增 / 修改 / 刪除）後立即寫回磁碟。
 * 本模組完全不參與 HTTP 請求處理、不輸出任何訊息 —— 純資料邏輯。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 資料目錄可用環境變數 DATA_DIR 覆寫（供 e2e 測試使用隔離資料庫）。
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const COLLECTIONS = [
  'admins',
  'students',
  'teachers',
  'departments',
  'courses',
  'enrollments',
];

// ---------- 記憶體中的資料庫 ----------
const db = {};

// ---------- 密碼雜湊 ----------
// 課程示範用：以 salt + 密碼 做 SHA-256 雜湊，避免明文儲存密碼。
const SALT = 'nqu-ce-115';

function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(SALT + password, 'utf-8')
    .digest('hex');
}

// ---------- 種子資料 ----------
// 初次啟動（資料檔不存在）時建立示範資料，所有帳號密碼預設為 1111。
function seedData() {
  const pw = hashPassword('1111');

  const departments = [
    { code: 'CS', name: '資訊工程系' },
    { code: 'EE', name: '電機工程系' },
    { code: 'ME', name: '機械工程系' },
    { code: 'BA', name: '企業管理系' },
    { code: 'GE', name: '通識教育中心' },
  ];

  const admins = [{ id: 'admin', name: '教務處', passwordHash: pw }];

  const teachers = [
    { id: 'T001', name: '陳鍾誠', dept: 'CS', title: '教授', passwordHash: pw },
    { id: 'T002', name: '王思明', dept: 'EE', title: '副教授', passwordHash: pw },
    { id: 'T003', name: '李雅君', dept: 'BA', title: '助理教授', passwordHash: pw },
    { id: 'T004', name: '陳志遠', dept: 'ME', title: '教授', passwordHash: pw },
  ];

  const students = [
    { id: 'S001', name: '張小明', dept: 'CS', entryYear: 2023, passwordHash: pw },
    { id: 'S002', name: '李美玲', dept: 'CS', entryYear: 2023, passwordHash: pw },
    { id: 'S003', name: '王大華', dept: 'EE', entryYear: 2022, passwordHash: pw },
    { id: 'S004', name: '林雅婷', dept: 'BA', entryYear: 2023, passwordHash: pw },
    { id: 'S005', name: '陳志強', dept: 'ME', entryYear: 2024, passwordHash: pw },
    { id: 'S006', name: '黃心怡', dept: 'CS', entryYear: 2024, passwordHash: pw },
  ];

  // times 欄位格式：["星期-節次", ...]，例如 "1-2" 代表 星期一第2節。
  const courses = [
    { id: 'C001', code: 'CS100', name: '程式設計', dept: 'CS', credits: 3, teacherId: 'T001', times: ['1-1', '1-2'], capacity: 60 },
    { id: 'C002', code: 'CS200', name: '資料結構', dept: 'CS', credits: 3, teacherId: 'T001', times: ['2-3', '2-4'], capacity: 60 },
    { id: 'C003', code: 'CS210', name: '作業系統', dept: 'CS', credits: 3, teacherId: 'T001', times: ['3-5', '3-6'], capacity: 45 },
    { id: 'C004', code: 'EE100', name: '電路學', dept: 'EE', credits: 3, teacherId: 'T002', times: ['1-3', '1-4'], capacity: 50 },
    { id: 'C005', code: 'EE210', name: '數位邏輯設計', dept: 'EE', credits: 3, teacherId: 'T002', times: ['4-1', '4-2'], capacity: 40 },
    { id: 'C006', code: 'BA100', name: '管理學', dept: 'BA', credits: 3, teacherId: 'T003', times: ['2-1', '2-2'], capacity: 80 },
    { id: 'C007', code: 'BA210', name: '行銷管理', dept: 'BA', credits: 3, teacherId: 'T003', times: ['5-3', '5-4'], capacity: 60 },
    { id: 'C008', code: 'ME120', name: '工程力學', dept: 'ME', credits: 3, teacherId: 'T004', times: ['3-1', '3-2'], capacity: 55 },
    { id: 'C009', code: 'GE101', name: '大學國文', dept: 'GE', credits: 2, teacherId: 'T003', times: ['1-5', '1-6'], capacity: 80 },
    { id: 'C010', code: 'GE201', name: '體育', dept: 'GE', credits: 1, teacherId: 'T002', times: ['4-5', '4-6'], capacity: 100 },
  ];

  const enrollments = [
    { studentId: 'S001', courseId: 'C001', score: 88 },
    { studentId: 'S001', courseId: 'C010', score: 95 },
    { studentId: 'S002', courseId: 'C001', score: 75 },
    { studentId: 'S002', courseId: 'C003', score: 82 },
    { studentId: 'S002', courseId: 'C008', score: null },
    { studentId: 'S003', courseId: 'C004', score: 69 },
    { studentId: 'S003', courseId: 'C005', score: null },
    { studentId: 'S004', courseId: 'C006', score: null },
    { studentId: 'S005', courseId: 'C008', score: null },
  ];

  return { departments, admins, teachers, students, courses, enrollments };
}

// ---------- 檔案讀寫 ----------
function filePath(collection) {
  return path.join(DATA_DIR, collection + '.json');
}

function readCollection(collection) {
  const raw = fs.readFileSync(filePath(collection), 'utf-8');
  db[collection] = JSON.parse(raw);
}

function saveCollection(collection) {
  fs.writeFileSync(filePath(collection), JSON.stringify(db[collection], null, 2) + '\n');
}

function saveAll() {
  for (const name of COLLECTIONS) saveCollection(name);
}

/**
 * 初始化資料庫：建立資料目錄，缺檔則以種子資料建立，否則從磁碟載入。
 */
function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let wasSeeded = false;
  for (const name of COLLECTIONS) {
    if (!fs.existsSync(filePath(name))) {
      const seed = seedData();
      db[name] = seed[name];
      saveCollection(name);
      wasSeeded = true;
    } else {
      readCollection(name);
    }
  }
  return wasSeeded;
}

// ---------- 通用查詢 / 異動介面 ----------
// 各集合的主鍵：一般用 item.id，系所（departments）用 item.code。
function itemKey(item) {
  return item.id !== undefined ? item.id : item.code;
}

function list(collection) {
  return db[collection];
}

function get(collection, key) {
  const idx = findIndexById(collection, key);
  return idx === -1 ? null : db[collection][idx];
}

function findBy(collection, field, value) {
  const items = db[collection];
  for (let i = 0; i < items.length; i++) {
    if (items[i][field] === value) return items[i];
  }
  return null;
}

function findIndexById(collection, key) {
  const items = db[collection];
  for (let i = 0; i < items.length; i++) {
    if (itemKey(items[i]) === key) return i;
  }
  return -1;
}

/**
 * 產生下一個可用 id。prefix 例如 'S' → S007、'C' → C011。
 */
function nextId(collection, prefix) {
  const items = db[collection];
  let max = 0;
  for (const item of items) {
    const m = /^(\d+)$/.exec(String(item.id).slice(prefix.length));
    if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  return prefix + String(max + 1).padStart(3, '0');
}

function insert(collection, item) {
  db[collection].push(item);
  saveCollection(collection);
  return item;
}

function update(collection, id, patch) {
  const idx = findIndexById(collection, id);
  if (idx === -1) return null;
  const item = db[collection][idx];
  for (const key of Object.keys(patch)) {
    if (patch[key] !== undefined) item[key] = patch[key];
  }
  saveCollection(collection);
  return item;
}

function remove(collection, id) {
  const idx = findIndexById(collection, id);
  if (idx === -1) return null;
  const [item] = db[collection].splice(idx, 1);
  saveCollection(collection);
  return item;
}

/**
 * 依條件移除選課紀錄並寫回磁碟。
 * removeEnrollments({ studentId: 'S001' }) 或 removeEnrollments({ courseId: 'C001' })。
 * @returns {number} 移除筆數
 */
function removeEnrollments(criteria) {
  const before = db.enrollments.length;
  db.enrollments = db.enrollments.filter((e) => {
    for (const key of Object.keys(criteria)) {
      if (e[key] !== criteria[key]) return true;
    }
    return false;
  });
  const removed = before - db.enrollments.length;
  if (removed > 0) saveCollection('enrollments');
  return removed;
}

// ---------- 登入 ----------
/**
 * 依登入帳號（= 各角色資料的 id）找出使用者。
 * @returns {{role:string, id:string, name:string, dept?:string, profile:object}|null}
 */
function findUserByLogin(loginId) {
  for (const role of ['admin', 'student', 'teacher']) {
    const profile = get(role + 's', loginId);
    if (profile) {
      return { role, id: profile.id, name: profile.name, dept: profile.dept, profile };
    }
  }
  return null;
}

function verifyPassword(user, password) {
  return hashPassword(password) === user.profile.passwordHash;
}

// ---------- 業務資料查詢 ----------
function enrolledCount(courseId) {
  return db.enrollments.filter((e) => e.courseId === courseId).length;
}

function deptName(code) {
  const d = findBy('departments', 'code', code);
  return d ? d.name : code;
}

function teacherName(id) {
  const t = get('teachers', id);
  return t ? t.name : id;
}

function studentName(id) {
  const s = get('students', id);
  return s ? s.name : id;
}

/**
 * 包裝課程資料：附加教師姓名、系所名稱、已選人數、課程時間文字。
 */
function enrichCourse(course, extra) {
  return {
    ...course,
    teacherName: teacherName(course.teacherId),
    deptName: deptName(course.dept),
    enrolledCount: enrolledCount(course.id),
    timeText: formatTimes(course.times),
    ...(extra || {}),
  };
}

const DAYS = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * 把 ["1-2", "3-4"] 轉成「週一二第2節、週三第4節」的易讀文字。
 */
function formatTimes(times) {
  if (!Array.isArray(times) || times.length === 0) return '未排課';
  return times
    .map((t) => {
      const [day, period] = String(t).split('-').map(Number);
      const dayName = DAYS[day - 1] || day;
      return `週${dayName}第${period}節`;
    })
    .join('、');
}

/**
 * 檢查兩門課的排課時間是否衝堂。
 */
function timesOverlap(timesA, timesB) {
  const setA = new Set(timesA || []);
  for (const t of timesB || []) {
    if (setA.has(t)) return true;
  }
  return false;
}

function isEnrolled(studentId, courseId) {
  return db.enrollments.some(
    (e) => e.studentId === studentId && e.courseId === courseId
  );
}

/**
 * 學生已選的「課程」清單（含成績），依課程 id 排序。
 */
function enrolledCoursesOf(studentId) {
  return db.enrollments
    .filter((e) => e.studentId === studentId)
    .map((e) => {
      const course = get('courses', e.courseId);
      return course ? { ...enrichCourse(course), score: e.score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 教師開設的課程清單。
 */
function coursesOfTeacher(teacherId) {
  return db.courses
    .filter((c) => c.teacherId === teacherId)
    .map((c) => enrichCourse(c));
}

// 學生成績的「等第」換算
function gradeLetter(score) {
  if (score === null || score === undefined) return '－';
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  return 'F';
}

// 以 4.0 制的簡易 GPA 換算
function gradePoint(score) {
  if (score === null || score === undefined) return 0;
  if (score >= 90) return 4.0;
  if (score >= 80) return 3.0;
  if (score >= 70) return 2.0;
  if (score >= 60) return 1.0;
  return 0;
}

module.exports = {
  init,
  list,
  get,
  findBy,
  insert,
  update,
  remove,
  nextId,
  hashPassword,
  findUserByLogin,
  verifyPassword,
  enrolledCount,
  deptName,
  teacherName,
  studentName,
  enrichCourse,
  formatTimes,
  timesOverlap,
  isEnrolled,
  enrolledCoursesOf,
  coursesOfTeacher,
  removeEnrollments,
  gradeLetter,
  gradePoint,
};