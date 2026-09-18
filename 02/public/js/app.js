'use strict';

/* ============================================================
 * 大學校務系統 - 前端邏輯
 * 以 hash 路由切換各角色的頁面，透過 fetch 呼叫 REST API。
 * ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  token: localStorage.getItem('nqu_token') || null,
  user: null,
};

const DAYS = ['一', '二', '三', '四', '五', '六', '日'];

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 資料的主鍵：有 id 用 id（學生/教師/課程），否則用 code（系所）
function itemKey(it) {
  return it.id !== undefined && it.id !== null ? it.id : it.code;
}

function timeText(times) {
  if (!Array.isArray(times) || !times.length) return '未排課';
  return times
    .map((t) => {
      const [d, p] = String(t).split('-').map(Number);
      return `週${DAYS[d - 1] || d}第${p}節`;
    })
    .join('、');
}

/* ---------------- API 封裝 ---------------- */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = 'Bearer ' + state.token;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !path.endsWith('/login')) {
    handleSessionExpired();
    throw new ApiError(401, data.error || '請先登入');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  return data;
}

function handleSessionExpired() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('nqu_token');
  showLogin();
  showToast('登入已失效，請重新登入', 'err');
}

/* ---------------- Toast / Modal ---------------- */
let toastTimer = null;
function showToast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function openModal(title, formHTML) {
  $('#modal-title').textContent = title;
  $('#modal-form').innerHTML = formHTML;
  $('#modal-mask').hidden = false;
}

function closeModal() {
  $('#modal-mask').hidden = true;
}

document.addEventListener('click', (e) => {
  if (e.target.dataset.close === 'modal') closeModal();
});
$('#modal-mask').addEventListener('click', (e) => {
  if (e.target.id === 'modal-mask') closeModal();
});

/* ---------------- 登入 / 登出 ---------------- */
async function handleLogin(e) {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const errEl = $('#login-error');
  errEl.hidden = true;
  try {
    const data = await api('/api/login', { method: 'POST', body: { username, password } });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('nqu_token', data.token);
    enterApp(data.user);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

function handleLogout() {
  api('/api/logout', { method: 'POST' }).catch(() => {});
  state.token = null;
  state.user = null;
  localStorage.removeItem('nqu_token');
  showLogin();
  showToast('已登出', 'ok');
}

function showLogin() {
  $('#app-screen').hidden = true;
  $('#login-screen').hidden = false;
  window.location.hash = '';
}

function enterApp(user) {
  state.user = user;
  $('#login-screen').hidden = true;
  $('#app-screen').hidden = false;
  $('#user-name').textContent = `${user.name}（${user.id}）`;
  $('#role-badge').textContent =
    user.role === 'admin' ? '教務處' : user.role === 'teacher' ? '教師' : '學生';
  $('#role-badge').className = 'role-badge ' + user.role;
  $('#semester-label').textContent = `開課學期 ${user.semester || ''}`;
  buildSidebar();
  navigate();
}

function buildSidebar() {
  const linksByRole = {
    admin: [
      ['#/admin/students', '學生管理'],
      ['#/admin/teachers', '教師管理'],
      ['#/admin/departments', '系所管理'],
      ['#/admin/courses', '課程管理'],
    ],
    teacher: [
      ['#/teacher/courses', '我的課程'],
      ['#/teacher/scores', '成績登錄'],
    ],
    student: [
      ['#/student/enroll', '線上選課'],
      ['#/student/enrolled', '已選課程'],
      ['#/student/grades', '我的成績'],
    ],
  };
  const links = linksByRole[state.user.role] || [];
  $('#sidebar').innerHTML = links
    .map(([href, label]) => `<a href="${href}" data-href="${href}">${label}</a>`)
    .join('');
}

function navigate() {
  const hash = window.location.hash.replace(/^#\//, '');
  const parts = hash.split('/');
  // hash 可含角色前綴（#/student/enroll）或不含（#/enroll），
  // 一律以「角色 + 頁面名」的分派鍵來比對。
  const view = parts[0] === state.user.role ? parts[1] : parts[0];
  const route = `${state.user.role}/${view || ''}`;
  const dispatch = {
    'admin/students': () => renderCrud(crudConfig.students),
    'admin/teachers': () => renderCrud(crudConfig.teachers),
    'admin/departments': () => renderCrud(crudConfig.departments),
    'admin/courses': () => renderCrud(crudConfig.courses),
    'teacher/courses': () => renderTeacherCourses(),
    'teacher/scores': () => renderTeacherScores(),
    'student/enroll': () => renderEnroll(),
    'student/enrolled': () => renderEnrolled(),
    'student/grades': () => renderGrades(),
  };
  const handler = dispatch[route];
  if (!handler) {
    const defaults = { admin: '#/admin/students', teacher: '#/teacher/courses', student: '#/student/enroll' };
    window.location.hash = defaults[state.user.role];
    return;
  }
  $$('#sidebar a').forEach((a) =>
    a.classList.toggle('active', a.dataset.href === window.location.hash)
  );
  handler().catch((err) => showToast(err.message, 'err'));
}

window.addEventListener('hashchange', () => {
  if (state.user) navigate();
});

/* ---------------- 表單欄位與 Modal 表單 ---------------- */
async function loadSelectOptions(field) {
  if (field.options) {
    if (typeof field.options === 'function') return (await Promise.resolve(field.options())) || [];
    return field.options;
  }
  return [];
}

function fieldHTML(f, options, value, editing) {
  const val = value === undefined || value === null ? '' : value;
  if (f.type === 'select') {
    const opts = options
      .map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(label)}</option>`)
      .join('');
    return `<label class="field"><span>${f.label}</span><select name="${f.name}">${opts}</select></label>`;
  }
  if (f.type === 'textarea') {
    return `<label class="field"><span>${f.label}</span><textarea name="${f.name}" rows="2">${esc(val)}</textarea></label>`;
  }
  const disabled = editing && f.createOnly ? ' disabled' : '';
  const placeholder = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const required = f.required !== false ? ' required' : '';
  return `<label class="field"><span>${f.label}</span><input type="${f.type}" name="${f.name}" value="${esc(val)}"${disabled}${placeholder}${required} /></label>`;
}

async function openCrudForm(cfg, item) {
  const editing = !!item;
  const fields = [];
  const optionsPromises = cfg.fields.map(async (f) => {
    fields.push({ field: f, options: await loadSelectOptions(f), value: item ? item[f.name] : f.defaultValue });
  });
  await Promise.all(optionsPromises);

  openModal(
    editing ? `編輯${cfg.singular}` : `新增${cfg.singular}`,
    `<div class="form-grid ${fields.length > 2 ? 'two' : ''}">` +
      fields
        .map(({ field, options, value }) =>
          fieldHTML(field, options, value, editing)
        )
        .join('') +
      `</div>`
  );

  const form = $('#modal-form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = {};
    for (const { field } of fields) {
      const el = form.elements[field.name];
      if (!el) continue;
      if (field.type === 'number') data[field.name] = Number(el.value);
      else if (field.type === 'select') data[field.name] = el.value;
      else if (field.name === 'times') {
        const tokens = el.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        data[field.name] = tokens;
      } else data[field.name] = el.value;
    }
    return submitCrudForm(cfg, item, data, form);
  };
}

async function submitCrudForm(cfg, item, data, form) {
  try {
    if (item) {
      await api(cfg.updateUrl(item), { method: 'PUT', body: cfg.beforeSave ? cfg.beforeSave(data, item) : data });
      showToast(`${cfg.singular}「${data[cfg.nameField || 'name'] || item.id}」已更新`, 'ok');
    } else {
      await api(cfg.createUrl, { method: 'POST', body: cfg.beforeSave ? cfg.beforeSave(data) : data });
      showToast(`${cfg.singular}「${data[cfg.nameField || 'name'] || data.id}」已新增`, 'ok');
    }
    closeModal();
    await loadCrudTable(cfg);
  } catch (err) {
    showToast(err.message, 'err');
  }
}

/* ---------------- 通用 CRUD 頁面 ---------------- */
async function renderCrud(cfg) {
  const content = $('#content');
  content.innerHTML = `
    <h2 class="page-title">${cfg.title}</h2>
    <p class="page-desc">${cfg.desc}</p>
    <div class="card">
      <div class="toolbar">
        <span class="tbar-title">${cfg.title}列表</span>
        <button class="btn btn-primary btn-sm" id="btn-add">＋ 新增${cfg.singular}</button>
      </div>
      <div id="table-wrap"><p class="empty">載入中…</p></div>
    </div>`;
  $('#btn-add').onclick = () => openCrudForm(cfg, null);
  await loadCrudTable(cfg);
}

async function loadCrudTable(cfg) {
  const wrap = $('#table-wrap');
  let items;
  try {
    items = await cfg.fetchAll();
  } catch (err) {
    wrap.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }

  const head = cfg.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('');
  const body = items
    .map((it, i) => {
      const tds = cfg.columns
        .map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(it) : esc(it[c.key])}</td>`)
        .join('');
      const actions = `
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(itemKey(it))}" data-key="${itemKey(it)}">編輯</button>
        <button class="btn btn-danger btn-sm" data-action="del" data-id="${esc(itemKey(it))}" data-key="${itemKey(it)}">刪除</button>`;
      return `<tr><td class="num">${i + 1}</td>${tds}<td style="white-space:nowrap">${actions}</td></tr>`;
    })
    .join('');

  wrap.innerHTML = items.length
    ? `<table class="tbl"><thead><tr><th>#</th>${head}<th>操作</th></tr></thead><tbody>${body}</tbody></table>`
    : `<p class="empty">目前沒有資料</p>`;

  wrap.onclick = async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.key;
    if (action === 'edit') {
      const item = items.find((x) => itemKey(x) === id);
      if (item) openCrudForm(cfg, item);
    } else if (action === 'del') {
      const label = items.find((x) => itemKey(x) === id)?.name || id;
      if (window.confirm(`確定刪除「${label}」？`)) {
        try {
          await api(cfg.deleteUrl(id), { method: 'DELETE' });
          showToast('已刪除', 'ok');
          await loadCrudTable(cfg);
        } catch (err) {
          showToast(err.message, 'err');
        }
      }
    }
  };
}

/* ---------------- CRUD 設定 ---------------- */
async function deptOptions() {
  const depts = await api('/api/departments');
  return depts.map((d) => [d.code, `${d.code}　${d.name}`]);
}

const crudConfig = {
  departments: {
    title: '系所管理',
    singular: '系所',
    desc: '管理全校各系所與通識中心基本資料。',
    fetchAll: () => api('/api/departments'),
    createUrl: '/api/departments',
    updateUrl: (it) => `/api/departments/${it.code}`,
    deleteUrl: (key) => `/api/departments/${key}`,
    nameField: 'name',
    columns: [
      { key: 'code', label: '系所代碼' },
      { key: 'name', label: '系所名稱' },
    ],
    fields: [
      { name: 'code', label: '系所代碼', type: 'text', createOnly: true, placeholder: '例如 CS' },
      { name: 'name', label: '系所名稱', type: 'text' },
    ],
  },

  students: {
    title: '學生管理',
    singular: '學生',
    desc: '管理學生基本資料；刪除學生時會一併刪除其選課紀錄。',
    fetchAll: () => api('/api/students'),
    createUrl: '/api/students',
    updateUrl: (it) => `/api/students/${it.id}`,
    deleteUrl: (key) => `/api/students/${key}`,
    columns: [
      { key: 'id', label: '學號' },
      { key: 'name', label: '姓名' },
      { key: 'deptName', label: '系所' },
      { key: 'entryYear', label: '入學年', num: true },
    ],
    fields: [
      { name: 'id', label: '學號', type: 'text', createOnly: true, placeholder: '例如 S007' },
      { name: 'name', label: '姓名', type: 'text' },
      { name: 'dept', label: '系所', type: 'select', options: deptOptions },
      { name: 'entryYear', label: '入學年', type: 'number', defaultValue: new Date().getFullYear() },
      { name: 'password', label: '密碼（留空則預設 1111）', type: 'password', required: false, placeholder: '1111' },
    ],
  },

  teachers: {
    title: '教師管理',
    singular: '教師',
    desc: '管理教師基本資料；仍有開課的教師不能刪除。',
    fetchAll: () => api('/api/teachers'),
    createUrl: '/api/teachers',
    updateUrl: (it) => `/api/teachers/${it.id}`,
    deleteUrl: (key) => `/api/teachers/${key}`,
    columns: [
      { key: 'id', label: '編號' },
      { key: 'name', label: '姓名' },
      { key: 'deptName', label: '系所' },
      { key: 'title', label: '職稱' },
    ],
    fields: [
      { name: 'id', label: '教師編號', type: 'text', createOnly: true, placeholder: '例如 T005' },
      { name: 'name', label: '姓名', type: 'text' },
      { name: 'dept', label: '系所', type: 'select', options: deptOptions },
      { name: 'title', label: '職稱', type: 'select', options: [['教授', '教授'], ['副教授', '副教授'], ['助理教授', '助理教授'], ['講師', '講師']] },
      { name: 'password', label: '密碼（留空則預設 1111）', type: 'password', required: false, placeholder: '1111' },
    ],
  },

  courses: {
    title: '課程管理',
    singular: '課程',
    desc: '管理課程資料與排課時間。時間格式：星期-節次，例如 1-1、3-5，多節以逗號分隔。',
    fetchAll: () => api('/api/courses'),
    createUrl: '/api/courses',
    updateUrl: (it) => `/api/courses/${it.id}`,
    deleteUrl: (key) => `/api/courses/${key}`,
    columns: [
      { key: 'code', label: '課程代碼' },
      { key: 'name', label: '課程名稱' },
      { key: 'deptName', label: '系所' },
      { key: 'credits', label: '學分', num: true },
      { key: 'teacherName', label: '授課教師' },
      { render: (c) => esc(timeText(c.times)), label: '上課時間' },
      { render: (c) => `${c.enrolledCount} / ${c.capacity}`, label: '已選/容量', num: true },
    ],
    fields: [
      { name: 'code', label: '課程代碼', type: 'text', createOnly: true, placeholder: '例如 CS300' },
      { name: 'name', label: '課程名稱', type: 'text' },
      { name: 'dept', label: '開課系所', type: 'select', options: deptOptions },
      { name: 'credits', label: '學分', type: 'number' },
      { name: 'teacherId', label: '授課教師', type: 'select', options: async () => (await api('/api/teachers')).map((t) => [t.id, `${t.id}　${t.name}`]) },
      { name: 'times', label: '上課時間（如 1-1,3-2）', type: 'text' },
      { name: 'capacity', label: '人數上限', type: 'number', defaultValue: 60 },
    ],
    beforeSave: (data) => ({ ...data, times: data.times || [] }),
  },
};

/* ---------------- 教師端 ---------------- */
async function renderTeacherCourses() {
  const content = $('#content');
  content.innerHTML = `
    <h2 class="page-title">我的課程</h2>
    <p class="page-desc">本學期（115-1）由你開設的課程。</p>
    <div class="card"><div id="table-wrap"><p class="empty">載入中…</p></div></div>`;
  let courses;
  try {
    courses = await api('/api/teacher/courses');
  } catch (err) {
    $('#table-wrap').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  $('#table-wrap').innerHTML = courses.length
    ? `<table class="tbl">
        <thead><tr><th>課程代碼</th><th>課程名稱</th><th>學分</th><th>上課時間</th><th>已選/容量</th><th>操作</th></tr></thead>
        <tbody>${courses.map((c, i) => `
          <tr>
            <td>${esc(c.code)}</td><td>${esc(c.name)}</td>
            <td>${c.credits}</td><td>${esc(timeText(c.times))}</td>
            <td>${c.enrolledCount} / ${c.capacity}</td>
            <td><button class="link-btn" data-score-course="${c.id}">成績登錄</button></td>
          </tr>`).join('')}</tbody>
      </table>`
    : `<p class="empty">你目前沒有開課</p>`;

  $('#table-wrap').onclick = (e) => {
    const id = e.target.dataset.scoreCourse;
    if (id) renderTeacherScores(id);
  };
}

async function renderTeacherScores(selectId) {
  const content = $('#content');
  content.innerHTML = `
    <h2 class="page-title">成績登錄</h2>
    <p class="page-desc">選擇課程後即可為修課學生登錄成績（0~100 分）。</p>
    <div class="card">
      <div class="toolbar">
        <span class="tbar-title">選擇課程</span>
        <select id="course-select" class="field" style="width:280px"></select>
      </div>
      <div id="roster-wrap"><p class="empty">請選擇課程</p></div>
    </div>`;

  const courses = await api('/api/teacher/courses');
  const select = $('#course-select');
  select.innerHTML = courses.length
    ? courses.map((c) => `<option value="${c.id}" ${String(c.id) === String(selectId) ? 'selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`).join('')
    : `<option value="">您沒有開課</option>`;
  const loadRoster = async () => {
    if (!select.value) return;
    const data = await api(`/api/teacher/courses/${select.value}/roster`);
    const { course, roster } = data;
    const rows = roster
      .map((r) => `
        <tr>
          <td>${esc(r.studentId)}</td>
          <td>${esc(r.studentName)}</td>
          <td>${esc(r.deptName)}</td>
          <td>${r.score === null ? '<span class="badge gray">未登錄</span>' : `<span class="grade-chip">${r.score}（${r.grade}）</span>`}</td>
          <td><input type="number" min="0" max="100" class="score-input" data-student="${r.studentId}" value="${r.score === null ? '' : r.score}" /></td>
          <td><button class="btn btn-ok btn-sm" data-save="${r.studentId}">儲存</button></td>
        </tr>`)
      .join('');
    $('#roster-wrap').innerHTML = roster.length
      ? `<p class="small-note">課程：${esc(course.name)}（${esc(course.code)}）｜學生 ${roster.length} 人</p>
         <table class="tbl"><thead><tr><th>學號</th><th>姓名</th><th>系所</th><th>目前成績</th><th>新的成績</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="empty">這門課目前沒有學生選修</p>`;

    $('#roster-wrap').querySelectorAll('button[data-save]').forEach((btn) => {
      btn.onclick = async () => {
        const studentId = btn.dataset.save;
        const input = $('#roster-wrap').querySelector(`input[data-student="${studentId}"]`);
        try {
          await api(`/api/teacher/courses/${select.value}/scores`, {
            method: 'PUT',
            body: { studentId, score: input.value },
          });
          showToast(`已登錄 ${studentId} 的成績`, 'ok');
          loadRoster();
        } catch (err) {
          showToast(err.message, 'err');
        }
      };
    });
  };
  select.onchange = loadRoster;
  if (select.value) await loadRoster();
}

/* ---------------- 學生端 ---------------- */
async function renderEnroll() {
  const content = $('#content');
  content.innerHTML = `
    <h2 class="page-title">線上選課</h2>
    <p class="page-desc">加退選 115 學年第 1 學期的課程；系統會自動檢查名額與排課是否衝堂。</p>
    <div class="card"><div id="table-wrap"><p class="empty">載入中…</p></div></div>`;

  const [courses, enrolled] = await Promise.all([
    api('/api/courses'),
    api('/api/student/enrolled'),
  ]);
  const mine = enrolled.courses;
  const myTimes = mine.flatMap((c) => c.times);

  const rows = courses
    .map((c) => {
      const seats = c.capacity - c.enrolledCount;
      let badge = '';
      let action = '';
      if (c.isEnrolled) {
        badge = '<span class="badge blue">已選</span>';
      } else if (seats <= 0) {
        badge = '<span class="badge gray">滿班</span>';
      } else {
        const conflict = c.times.some((t) => myTimes.includes(t));
        if (conflict) {
          badge = '<span class="badge red">衝堂</span>';
        } else {
          badge = '<span class="badge green">可選</span>';
          action = `<button class="btn btn-primary btn-sm" data-enroll="${c.id}">加選</button>`;
        }
      }
      return `<tr>
        <td>${esc(c.code)}</td>
        <td>${esc(c.name)}</td>
        <td>${esc(c.deptName)}</td>
        <td>${c.credits}</td>
        <td>${esc(c.teacherName)}</td>
        <td>${esc(timeText(c.times))}</td>
        <td>${c.enrolledCount} / ${c.capacity}</td>
        <td>${badge}</td>
        <td>${action}</td>
      </tr>`;
    })
    .join('');

  $('#table-wrap').innerHTML =
    `<table class="tbl">
      <thead><tr><th>代碼</th><th>課程</th><th>系所</th><th>學分</th><th>教師</th><th>上課時間</th><th>已選/容量</th><th>狀態</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;

  $('#table-wrap').onclick = async (e) => {
    const id = e.target.dataset.enroll;
    if (!id) return;
    try {
      const data = await api('/api/student/enroll', { method: 'POST', body: { courseId: id } });
      showToast(data.message, 'ok');
      renderEnroll();
    } catch (err) {
      showToast(err.message, 'err');
    }
  };
}

async function renderEnrolled() {
  const content = $('#content');
  content.innerHTML = `
    <h2 class="page-title">已選課程</h2>
    <p class="page-desc">本學期已選修的課程，未登錄成績前都可以退選。</p>
    <div class="card"><div id="table-wrap"><p class="empty">載入中…</p></div></div>`;

  const data = await api('/api/student/enrolled');
  const { courses } = data;
  const totalCredits = courses.reduce((s, c) => s + c.credits, 0);

  $('#table-wrap').innerHTML = courses.length
    ? `<table class="tbl">
        <thead><tr><th>代碼</th><th>課程</th><th>學分</th><th>教師</th><th>上課時間</th><th>成績</th><th>操作</th></tr></thead>
        <tbody>${courses.map((c) => `
          <tr>
            <td>${esc(c.code)}</td>
            <td>${esc(c.name)}</td>
            <td>${c.credits}</td>
            <td>${esc(c.teacherName)}</td>
            <td>${esc(timeText(c.times))}</td>
            <td>${c.score === null ? '<span class="badge gray">未登錄</span>' : `<span class="grade-chip">${c.score}分</span>`}</td>
            <td><button class="btn btn-danger btn-sm" data-drop="${c.id}">退選</button></td>
          </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4"></td><td>已修學分：${totalCredits}</td><td></td><td></td></tr></tfoot>
      </table>`
    : `<p class="empty">還沒有選課，<a href="#/student/enroll">去選課</a></p>`;

  $('#table-wrap').onclick = async (e) => {
    const id = e.target.dataset.drop;
    if (!id) return;
    if (!window.confirm('確定要退選這門課嗎？')) return;
    try {
      const data = await api(`/api/student/enroll/${id}`, { method: 'DELETE' });
      showToast(data.message, 'ok');
      renderEnrolled();
    } catch (err) {
      showToast(err.message, 'err');
    }
  };
}

async function renderGrades() {
  const content = $('#content');
  content.innerHTML = `
    <h2 class="page-title">我的成績</h2>
    <p class="page-desc">本學期（115-1）成績單，含學分、平均與 GPA 統計。</p>
    <div class="summary-row" id="summary"></div>
    <div class="card"><div id="table-wrap"><p class="empty">載入中…</p></div></div>`;

  const data = await api('/api/student/grades');
  const { courses, summary } = data;

  $('#summary').innerHTML = `
    <div class="summary-item"><div class="k">本學期修課學分</div><div class="v">${summary.totalCredits}</div></div>
    <div class="summary-item"><div class="k">已登錄成績學分</div><div class="v">${summary.gradedCredits}</div></div>
    <div class="summary-item"><div class="k">加權平均</div><div class="v">${summary.average === null ? '－' : summary.average}</div></div>
    <div class="summary-item"><div class="k">GPA（4.0 制）</div><div class="v">${summary.gpa === null ? '－' : summary.gpa}</div></div>`;

  const letterBadge = (letter) => {
    const cls =
      letter === 'F' ? 'red' :
      letter === 'C+' ? 'orange' :
      /^A/.test(letter) ? 'green' : 'blue';
    return `<span class="badge ${cls}">${letter}</span>`;
  };

  $('#table-wrap').innerHTML = courses.length
    ? `<table class="tbl">
        <thead><tr><th>代碼</th><th>課程</th><th>學分</th><th>成績</th><th>等第</th></tr></thead>
        <tbody>${courses.map((c) => `
          <tr>
            <td>${esc(c.code)}</td>
            <td>${esc(c.name)}</td>
            <td>${c.credits}</td>
            <td>${c.score === null ? '－' : `<span class="grade-chip">${c.score}</span>`}</td>
            <td>${c.score === null ? '－' : letterBadge(c.grade)}</td>
          </tr>`).join('')}</tbody>
      </table>`
    : `<p class="empty">還沒有選課紀錄</p>`;
}

/* ---------------- 啟動 ---------------- */
async function boot() {
  $('#login-form').addEventListener('submit', handleLogin);
  $('#logout-btn').addEventListener('click', handleLogout);

  if (state.token) {
    try {
      const data = await api('/api/me');
      enterApp(data.user);
      return;
    } catch {
      /* 失敗由 api() 處理登出 */
    }
  }
  showLogin();
}

boot();