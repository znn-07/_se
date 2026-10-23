const STORAGE_KEY = "fold.activeBoard";
const PRIORITY_LABELS = {
  high: "高優先",
  medium: "中優先",
  low: "低優先",
};
const PRIORITY_OPTIONS = [
  { value: "high", label: "高優先" },
  { value: "medium", label: "中優先" },
  { value: "low", label: "低優先" },
];
const COLUMN_ACCENTS = ["var(--coral)", "var(--gold)", "var(--blue)", "var(--sage)"];
const { applyTaskMove, filterTasks, formatDueDate } = window.TaskLogic;

const state = {
  boards: [],
  board: null,
  activeBoardId: localStorage.getItem(STORAGE_KEY),
  search: "",
  labelFilter: "",
  draggingId: null,
  currentDropZone: null,
};

const view = document.getElementById("view");
const boardList = document.getElementById("board-list");
const searchInput = document.getElementById("search-input");
const labelFilterSelect = document.getElementById("label-filter");
const liveStatus = document.getElementById("live-status");
const todayLabel = document.getElementById("today-label");
const appShell = document.getElementById("app");
const modal = document.getElementById("modal");
const toast = document.getElementById("toast");

let toastTimer = null;
let searchTimer = null;
let realtimeTimer = null;
let realtimeReconnectTimer = null;
let realtimeSocket = null;

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const icon = (name, className = "icon") =>
  `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

function showToast(message, tone = "success") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", tone === "error");
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function setTodayLabel() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  todayLabel.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(
    now.getDate(),
  )} / ${weekdays[now.getDay()]}`;
}

async function api(path, options = {}) {
  const request = {
    method: options.method || "GET",
    headers: {},
  };

  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, request);

  if (!response.ok) {
    let message = `請求失敗（${response.status}）`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Keep the status-based message when the body is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "剛剛更新";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "剛剛更新";
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分鐘前更新`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} 小時前更新`;
  }

  return `${new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
  }).format(date)} 更新`;
}

function renderSidebar() {
  if (state.boards.length === 0) {
    boardList.innerHTML = `<p class="sidebar-empty">還沒有看板。<br />點右上角的 + 開始第一個工作流。</p>`;
  } else {
    boardList.innerHTML = state.boards
      .map(
        (board, index) => `
          <button
            class="board-link ${board.id === state.activeBoardId ? "is-active" : ""}"
            type="button"
            data-board-id="${escapeHtml(board.id)}"
            data-testid="board-item"
          >
            <span class="board-link-mark">${String(index + 1).padStart(2, "0")}</span>
            <span class="board-link-copy">
              <strong>${escapeHtml(board.name)}</strong>
              <small>${board.column_count} 欄 · ${board.task_count} 任務</small>
            </span>
          </button>
        `,
      )
      .join("");
  }

  searchInput.disabled = !state.board;
  labelFilterSelect.disabled = !state.board;
}

function syncLabelOptions() {
  const labels = new Set();
  for (const column of state.board?.columns || []) {
    for (const task of column.tasks) {
      for (const label of task.labels || []) {
        labels.add(label);
      }
    }
  }

  const sorted = [...labels].sort((left, right) =>
    left.localeCompare(right, "zh-Hant"),
  );
  if (state.labelFilter && !sorted.includes(state.labelFilter)) {
    state.labelFilter = "";
  }

  labelFilterSelect.innerHTML = [
    '<option value="">所有標籤</option>',
    ...sorted.map(
      (label) =>
        `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`,
    ),
  ].join("");
  labelFilterSelect.value = state.labelFilter;
  labelFilterSelect.disabled = !state.board || sorted.length === 0;
}

function renderLoading() {
  view.innerHTML = `
    <section class="loading-view" aria-label="載入中">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-meta"></div>
      <div class="skeleton-columns">
        <div class="skeleton skeleton-column"></div>
        <div class="skeleton skeleton-column"></div>
        <div class="skeleton skeleton-column"></div>
      </div>
    </section>
  `;
}

function renderEmptyWorkspace() {
  state.board = null;
  searchInput.disabled = true;
  syncLabelOptions();
  view.innerHTML = `
    <section class="empty-workspace">
      <div class="empty-copy">
        <p class="empty-kicker">YOUR FIRST BOARD</p>
        <h1>把腦中的<br /><em>混亂</em>，釘到牆上。</h1>
        <p>
          用欄位整理節奏，用卡片承載任務。拖曳之間，讓每一件事都有清楚的下一步。
        </p>
        <div class="empty-actions">
          <button
            class="button button-primary"
            type="button"
            data-action="new-board"
            data-testid="new-board"
          >
            ${icon("plus")}
            建立第一個看板
          </button>
          <span class="empty-hint">NO ACCOUNT / LOCAL SQLITE</span>
        </div>
      </div>

      <div class="empty-visual" aria-hidden="true">
        <div class="empty-card">
          <span class="empty-card-label"><span>TO DO</span><span>01</span></span>
          <strong>定義這一週<br />真正重要的事</strong>
          <p>先放進待辦，再一一拆小。</p>
          <span class="empty-card-line"></span>
        </div>
        <div class="empty-card">
          <span class="empty-card-label"><span>IN PROGRESS</span><span>02</span></span>
          <strong>讓工作<br />保持流動</strong>
          <p>一次專注在一張卡片上。</p>
          <span class="empty-card-line"></span>
        </div>
        <div class="empty-card">
          <span class="empty-card-label"><span>DONE</span><span>03</span></span>
          <strong>把完成<br />好好收好</strong>
          <p>看見前進的痕跡，才走得遠。</p>
          <span class="empty-card-line"></span>
        </div>
        <span class="stamp">FOLD<br />YOUR<br />WORK</span>
      </div>
    </section>
  `;
}

function renderErrorWorkspace(message) {
  view.innerHTML = `
    <section class="empty-workspace">
      <div class="empty-copy">
        <p class="empty-kicker">CONNECTION LOST</p>
        <h1>暫時找不到<br /><em>工作區</em>。</h1>
        <p>${escapeHtml(message)}</p>
        <div class="empty-actions">
          <button class="button button-primary" type="button" data-action="retry">
            ${icon("spark")}
            重新載入
          </button>
        </div>
      </div>
      <div class="empty-visual" aria-hidden="true">
        <div class="empty-card">
          <span class="empty-card-label"><span>SERVER</span><span>500</span></span>
          <strong>連線中斷</strong>
          <p>確認 Rust 伺服器仍在執行，然後再試一次。</p>
          <span class="empty-card-line"></span>
        </div>
        <span class="stamp">TRY<br />AGAIN</span>
      </div>
    </section>
  `;
}

function renderTaskCard(task, index) {
  const due = formatDueDate(task.due_date);
  const description = task.description
    ? `<p class="card-description">${escapeHtml(task.description)}</p>`
    : "";
  const labels = (task.labels || [])
    .map(
      (label) =>
        `<span class="label-chip" data-testid="task-label">${escapeHtml(label)}</span>`,
    )
    .join("");
  const labelRow = labels ? `<div class="card-labels">${labels}</div>` : "";

  return `
    <article
      class="task-card priority-${escapeHtml(task.priority)}"
      style="--i: ${index}"
      draggable="true"
      data-task-id="${escapeHtml(task.id)}"
      data-testid="task-card"
      tabindex="0"
      aria-label="任務：${escapeHtml(task.title)}"
    >
      <div class="card-top">
        <span class="priority-tag">${PRIORITY_LABELS[task.priority] || "中優先"}</span>
        <button
          class="icon-button card-menu"
          type="button"
          data-action="edit-task"
          aria-label="編輯任務：${escapeHtml(task.title)}"
        >
          ${icon("more")}
        </button>
      </div>
      <h3>${escapeHtml(task.title)}</h3>
      ${description}
      ${labelRow}
      <footer class="card-footer">
        ${
          due
            ? `<span class="due-date ${due.overdue ? "is-overdue" : ""}">${icon(
                "calendar",
              )}${escapeHtml(due.label)}</span>`
            : '<span class="due-date">尚未設定日期</span>'
        }
        <span class="card-id">#${escapeHtml(task.id.slice(0, 4))}</span>
      </footer>
      <span class="drag-grip" aria-hidden="true">${icon("grip")}</span>
    </article>
  `;
}

function renderColumn(column, index, filters) {
  const tasks = filterTasks(column.tasks, filters);
  const filtering = Boolean(filters.query || filters.label);

  const cards =
    tasks.length > 0
      ? tasks.map((task, taskIndex) => renderTaskCard(task, taskIndex)).join("")
      : filtering
        ? '<p class="no-results">這個欄位沒有符合的任務</p>'
        : "";

  return `
    <section
      class="column"
      style="--accent: ${COLUMN_ACCENTS[index % COLUMN_ACCENTS.length]}"
      data-column-id="${escapeHtml(column.id)}"
      data-testid="column"
    >
      <header class="column-head">
        <div class="column-heading">
          <span class="column-index">${String(index + 1).padStart(2, "0")}</span>
          <h2 class="column-title">${escapeHtml(column.title)}</h2>
          <span class="column-count">${column.tasks.length}</span>
        </div>
        <button
          class="icon-button column-menu"
          type="button"
          data-action="edit-column"
          aria-label="編輯欄位：${escapeHtml(column.title)}"
        >
          ${icon("more")}
        </button>
      </header>

      <div class="task-list" data-dropzone data-testid="task-list">
        ${cards}
      </div>

      <button
        class="add-task-inline"
        type="button"
        data-action="add-task"
        data-column-id="${escapeHtml(column.id)}"
        data-testid="add-task"
      >
        ${icon("plus")}
        新增任務
      </button>
    </section>
  `;
}

function renderBoard() {
  const board = state.board;
  if (!board) {
    renderEmptyWorkspace();
    return;
  }

  syncLabelOptions();

  const boardIndex = Math.max(
    0,
    state.boards.findIndex((item) => item.id === board.id),
  );
  const taskTotal = board.columns.reduce((total, column) => total + column.tasks.length, 0);
  const lastColumn = board.columns[board.columns.length - 1];
  const doneTotal = lastColumn ? lastColumn.tasks.length : 0;
  const progress = taskTotal === 0 ? 0 : Math.round((doneTotal / taskTotal) * 100);
  const filters = { query: state.search, label: state.labelFilter };

  const columns =
    board.columns.length > 0
      ? board.columns
          .map((column, index) => renderColumn(column, index, filters))
          .join("")
      : "";

  view.innerHTML = `
    <section class="board-view">
      <div class="board-intro">
        <div class="board-heading">
          <p class="board-kicker">
            <span>BOARD / ${String(boardIndex + 1).padStart(2, "0")}</span>
            <span class="dot"></span>
            <span>ACTIVE WORKFLOW</span>
          </p>
          <h1 class="board-title" data-testid="board-title">${escapeHtml(board.name)}</h1>
          <div class="board-meta">
            <span>${board.columns.length} 個欄位</span>
            <span>${taskTotal} 張任務</span>
            <span>${doneTotal} 張完成</span>
            <span>${escapeHtml(formatRelativeTime(board.updated_at))}</span>
          </div>
        </div>

        <div class="board-actions">
          <button class="button button-ghost" type="button" data-action="edit-board">
            ${icon("more")}
            看板設定
          </button>
        </div>

        <div class="progress-card" aria-label="看板完成率 ${progress}%">
          <div class="progress-ring" style="--progress: ${progress}%"><span>${progress}%</span></div>
          <div class="progress-copy">
            <strong>${doneTotal} / ${taskTotal}</strong>
            <small>任務完成率</small>
          </div>
        </div>
      </div>

      <div class="columns-wrap">
        ${columns}
        <button
          class="add-column-tile"
          type="button"
          data-action="new-column"
          data-testid="add-column-tile"
        >
          ${icon("plus")}
          新增欄位
        </button>
      </div>

      <footer class="board-footer">
        <span>拖曳卡片可調整欄位與順序</span>
        <span>資料即時保存於 SQLite</span>
        <span>FOLD / ${String(boardIndex + 1).padStart(2, "0")}</span>
      </footer>
    </section>
  `;

  state.currentDropZone = null;
}

async function loadBoard(boardId, { showLoading = false } = {}) {
  if (showLoading) {
    renderLoading();
    searchInput.disabled = true;
  }

  try {
    const board = await api(`/api/boards/${encodeURIComponent(boardId)}`);
    state.board = board;
    state.activeBoardId = board.id;
    localStorage.setItem(STORAGE_KEY, board.id);
    renderSidebar();
    renderBoard();
  } catch (error) {
    showToast(error.message, "error");
    await reload({ fallbackFrom: boardId });
  }
}

async function selectBoard(boardId) {
  if (boardId === state.activeBoardId && state.board) {
    appShell.classList.remove("sidebar-open");
    return;
  }

  state.activeBoardId = boardId;
  localStorage.setItem(STORAGE_KEY, boardId);
  renderSidebar();
  appShell.classList.remove("sidebar-open");
  await loadBoard(boardId, { showLoading: true });
}

async function reload({ preferredId, toastMessage, fallbackFrom } = {}) {
  try {
    const boards = await api("/api/boards");
    state.boards = boards;

    if (preferredId) {
      state.activeBoardId = preferredId;
    }

    if (fallbackFrom && state.activeBoardId === fallbackFrom) {
      state.activeBoardId = null;
    }

    if (!state.activeBoardId || !boards.some((board) => board.id === state.activeBoardId)) {
      state.activeBoardId = boards[0]?.id ?? null;
    }

    if (state.activeBoardId) {
      state.board = await api(`/api/boards/${encodeURIComponent(state.activeBoardId)}`);
      localStorage.setItem(STORAGE_KEY, state.activeBoardId);
    } else {
      state.board = null;
      localStorage.removeItem(STORAGE_KEY);
    }

    renderSidebar();
    if (state.board) {
      renderBoard();
    } else {
      renderEmptyWorkspace();
    }

    if (toastMessage) {
      showToast(toastMessage);
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadInitial() {
  renderLoading();
  try {
    const boards = await api("/api/boards");
    state.boards = boards;

    const active =
      boards.find((board) => board.id === state.activeBoardId) || boards[0] || null;
    state.activeBoardId = active?.id ?? null;
    renderSidebar();

    if (!active) {
      renderEmptyWorkspace();
      return;
    }

    state.board = await api(`/api/boards/${encodeURIComponent(active.id)}`);
    localStorage.setItem(STORAGE_KEY, active.id);
    renderBoard();
  } catch (error) {
    renderErrorWorkspace(error.message);
  }
}

/* ------------------------------- Realtime ---------------------------------- */

function setRealtimeStatus(status) {
  liveStatus.dataset.state = status;
  liveStatus.title =
    status === "online"
      ? "即時連線正常"
      : status === "connecting"
        ? "正在連線即時更新"
        : "即時連線中斷，正在重試";
}

function scheduleRealtimeRefresh() {
  window.clearTimeout(realtimeTimer);
  realtimeTimer = window.setTimeout(() => {
    reload({ preferredId: state.board?.id });
  }, 120);
}

function connectRealtime() {
  if (
    realtimeSocket &&
    (realtimeSocket.readyState === WebSocket.OPEN ||
      realtimeSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
  realtimeSocket = socket;
  setRealtimeStatus("connecting");

  socket.addEventListener("open", () => {
    if (realtimeSocket === socket) {
      setRealtimeStatus("online");
    }
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type && payload.type !== "connected") {
        scheduleRealtimeRefresh();
      }
    } catch {
      // Ignore malformed events and keep the connection alive.
    }
  });

  socket.addEventListener("close", () => {
    if (realtimeSocket !== socket) {
      return;
    }
    realtimeSocket = null;
    setRealtimeStatus("offline");
    window.clearTimeout(realtimeReconnectTimer);
    realtimeReconnectTimer = window.setTimeout(connectRealtime, 2000);
  });

  socket.addEventListener("error", () => {
    socket.close();
  });
}

/* ---------------------------------- Modal ---------------------------------- */

function renderField(field) {
  const id = `field-${field.name}`;
  const required = field.required ? "required" : "";
  const maxlength = field.maxLength ? `maxlength="${field.maxLength}"` : "";
  const placeholder = field.placeholder
    ? `placeholder="${escapeHtml(field.placeholder)}"`
    : "";
  const value = escapeHtml(field.value ?? "");
  let control = "";

  if (field.type === "textarea") {
    control = `<textarea id="${id}" name="${field.name}" ${required} ${maxlength} ${placeholder}>${value}</textarea>`;
  } else if (field.type === "select") {
    const options = (field.options || [])
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}" ${
            String(option.value) === String(field.value) ? "selected" : ""
          }>${escapeHtml(option.label)}</option>`,
      )
      .join("");
    control = `<select id="${id}" name="${field.name}" ${required}>${options}</select>`;
  } else {
    control = `<input id="${id}" name="${field.name}" type="${escapeHtml(
      field.type || "text",
    )}" value="${value}" ${required} ${maxlength} ${placeholder} autocomplete="off" />`;
  }

  return `
    <label class="field" for="${id}">
      <span class="field-label">${escapeHtml(field.label)}</span>
      ${control}
      ${field.hint ? `<span class="field-hint">${escapeHtml(field.hint)}</span>` : ""}
    </label>
  `;
}

function openFormDialog({
  kicker = "NEW RECORD",
  title,
  subtitle = "",
  fields = [],
  submitLabel = "儲存",
  message = "",
  onSubmit,
  onDelete = null,
}) {
  if (modal.open) {
    modal.close();
  }

  modal.innerHTML = `
    <form class="modal-card">
      <button class="icon-button modal-close" type="button" data-modal-close aria-label="關閉">
        ${icon("close")}
      </button>
      <header class="modal-header">
        <p class="modal-kicker">${escapeHtml(kicker)}</p>
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </header>
      ${message ? `<div class="modal-message">${message}</div>` : ""}
      <div class="modal-form">
        ${fields.map(renderField).join("")}
        <p class="form-error" hidden></p>
        <footer class="modal-footer">
          ${
            onDelete
              ? `<button class="button modal-delete" type="button" data-modal-delete>${icon(
                  "trash",
                )}${escapeHtml(onDelete.label)}</button>`
              : "<span></span>"
          }
          <button class="button button-ghost" type="button" data-modal-close>取消</button>
          <button class="button button-primary" type="submit">${escapeHtml(submitLabel)}</button>
        </footer>
      </div>
    </form>
  `;

  const form = modal.querySelector("form");
  const errorLabel = modal.querySelector(".form-error");
  const submitButton = form.querySelector('button[type="submit"]');

  modal.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => modal.close());
  });

  const deleteButton = modal.querySelector("[data-modal-delete]");
  if (deleteButton && onDelete) {
    deleteButton.addEventListener("click", () => {
      modal.close();
      window.setTimeout(onDelete.action, 80);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      return;
    }

    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "處理中…";
    errorLabel.hidden = true;

    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await onSubmit(values);
      modal.close();
    } catch (error) {
      errorLabel.textContent = error.message || "操作失敗，請再試一次";
      errorLabel.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  });

  modal.showModal();
  window.setTimeout(() => {
    modal.querySelector("input, textarea, select")?.focus();
  }, 60);
}

function openBoardDialog(board = null) {
  const editing = Boolean(board);

  openFormDialog({
    kicker: editing ? "EDIT / BOARD" : "NEW / BOARD",
    title: editing ? "看板設定" : "建立新看板",
    subtitle: editing ? "調整看板名稱，或移除整個工作流。" : "替下一個工作流取一個清楚的名字。",
    fields: [
      {
        name: "name",
        label: "看板名稱",
        value: board?.name ?? "",
        placeholder: "例如：秋季產品衝刺",
        required: true,
        maxLength: 60,
      },
    ],
    submitLabel: editing ? "儲存變更" : "建立看板",
    onSubmit: async (values) => {
      const name = values.name.trim();
      if (!name) {
        throw new Error("請輸入看板名稱");
      }

      if (editing) {
        await api(`/api/boards/${encodeURIComponent(board.id)}`, {
          method: "PATCH",
          body: { name },
        });
        await reload({ preferredId: board.id, toastMessage: "看板名稱已更新" });
      } else {
        const created = await api("/api/boards", {
          method: "POST",
          body: { name },
        });
        await reload({ preferredId: created.id, toastMessage: "看板已建立" });
      }
    },
    onDelete: editing
      ? {
          label: "刪除看板",
          action: () => openDeleteBoardDialog(board),
        }
      : null,
  });
}

function openDeleteBoardDialog(board) {
  openFormDialog({
    kicker: "REMOVE / BOARD",
    title: "刪除這個看板？",
    subtitle: "這個動作無法復原。",
    message: `看板 <strong>${escapeHtml(
      board.name,
    )}</strong> 底下的所有欄位與任務都會一起被移除。`,
    submitLabel: "確認刪除",
    onSubmit: async () => {
      await api(`/api/boards/${encodeURIComponent(board.id)}`, { method: "DELETE" });
      await reload({ toastMessage: "看板已刪除" });
    },
  });
}

function findColumn(columnId) {
  return state.board?.columns.find((column) => column.id === columnId) || null;
}

function findTask(taskId) {
  if (!state.board) {
    return { task: null, column: null };
  }
  for (const column of state.board.columns) {
    const task = column.tasks.find((item) => item.id === taskId);
    if (task) {
      return { task, column };
    }
  }
  return { task: null, column: null };
}

function openColumnDialog(column = null) {
  const board = state.board;
  if (!board) {
    showToast("請先建立或選擇一個看板", "error");
    return;
  }

  const editing = Boolean(column);

  openFormDialog({
    kicker: editing ? "EDIT / COLUMN" : "NEW / COLUMN",
    title: editing ? "欄位設定" : "新增欄位",
    subtitle: editing
      ? "重新命名欄位，或把它從看板中移除。"
      : "用一個動詞描述這個階段，例如「進行中」。",
    fields: [
      {
        name: "title",
        label: "欄位名稱",
        value: column?.title ?? "",
        placeholder: "例如：待審核",
        required: true,
        maxLength: 40,
      },
    ],
    submitLabel: editing ? "儲存變更" : "建立欄位",
    onSubmit: async (values) => {
      const title = values.title.trim();
      if (!title) {
        throw new Error("請輸入欄位名稱");
      }

      if (editing) {
        await api(`/api/columns/${encodeURIComponent(column.id)}`, {
          method: "PATCH",
          body: { title },
        });
        await reload({ preferredId: board.id, toastMessage: "欄位名稱已更新" });
      } else {
        await api(`/api/boards/${encodeURIComponent(board.id)}/columns`, {
          method: "POST",
          body: { title },
        });
        await reload({ preferredId: board.id, toastMessage: "欄位已建立" });
      }
    },
    onDelete: editing
      ? {
          label: "刪除欄位",
          action: () => openDeleteColumnDialog(column),
        }
      : null,
  });
}

function openDeleteColumnDialog(column) {
  const board = state.board;
  openFormDialog({
    kicker: "REMOVE / COLUMN",
    title: "刪除這個欄位？",
    subtitle: "欄位中的任務會一起被移除。",
    message: `<strong>${escapeHtml(column.title)}</strong> 目前有 ${
      column.tasks.length
    } 張任務，刪除後將無法復原。`,
    submitLabel: "確認刪除",
    onSubmit: async () => {
      await api(`/api/columns/${encodeURIComponent(column.id)}`, { method: "DELETE" });
      await reload({ preferredId: board.id, toastMessage: "欄位已刪除" });
    },
  });
}

function openTaskDialog(task = null, columnId = null) {
  const board = state.board;
  if (!board) {
    showToast("請先建立或選擇一個看板", "error");
    return;
  }
  if (board.columns.length === 0) {
    showToast("請先建立至少一個欄位", "error");
    return;
  }

  const editing = Boolean(task);
  const selectedColumn =
    columnId || task?.column_id || board.columns[0]?.id || "";

  openFormDialog({
    kicker: editing ? "EDIT / TASK" : "NEW / TASK",
    title: editing ? "編輯任務" : "新增任務",
    subtitle: editing
      ? "更新內容、優先順序，或把任務移到另一個欄位。"
      : "把任務拆得夠小，下一步就會很清楚。",
    fields: [
      {
        name: "column_id",
        label: "所在欄位",
        type: "select",
        value: selectedColumn,
        required: true,
        options: board.columns.map((column) => ({
          value: column.id,
          label: column.title,
        })),
      },
      {
        name: "title",
        label: "任務標題",
        value: task?.title ?? "",
        placeholder: "例如：完成登入流程",
        required: true,
        maxLength: 120,
      },
      {
        name: "description",
        label: "描述",
        type: "textarea",
        value: task?.description ?? "",
        placeholder: "補充背景、驗收條件或下一步…",
        maxLength: 2000,
      },
      {
        name: "labels",
        label: "標籤",
        value: (task?.labels ?? []).join(", "),
        placeholder: "例如：Bug, Backend",
        maxLength: 200,
        hint: "以逗號分隔，最多 8 個標籤。",
      },
      {
        name: "priority",
        label: "優先順序",
        type: "select",
        value: task?.priority ?? "medium",
        required: true,
        options: PRIORITY_OPTIONS,
      },
      {
        name: "due_date",
        label: "截止日期",
        type: "date",
        value: task?.due_date ?? "",
        hint: "可留空。格式為 YYYY-MM-DD。",
      },
    ],
    submitLabel: editing ? "儲存任務" : "建立任務",
    onSubmit: async (values) => {
      const title = values.title.trim();
      if (!title) {
        throw new Error("請輸入任務標題");
      }

      const labels = (values.labels || "")
        .split(/[,，]/)
        .map((label) => label.trim())
        .filter(Boolean);

      const body = {
        title,
        description: values.description || "",
        priority: values.priority || "medium",
        due_date: values.due_date || "",
        labels,
      };

      if (editing) {
        await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          body,
        });
        if (values.column_id !== task.column_id) {
          await api(`/api/tasks/${encodeURIComponent(task.id)}/move`, {
            method: "POST",
            body: { column_id: values.column_id, position: null },
          });
        }
        await reload({ preferredId: board.id, toastMessage: "任務已更新" });
      } else {
        await api(
          `/api/columns/${encodeURIComponent(values.column_id)}/tasks`,
          { method: "POST", body },
        );
        await reload({ preferredId: board.id, toastMessage: "任務已建立" });
      }
    },
    onDelete: editing
      ? {
          label: "刪除任務",
          action: () => openDeleteTaskDialog(task),
        }
      : null,
  });
}

function openDeleteTaskDialog(task) {
  const board = state.board;
  openFormDialog({
    kicker: "REMOVE / TASK",
    title: "刪除這張卡片？",
    subtitle: "這個動作無法復原。",
    message: `<strong>${escapeHtml(task.title)}</strong> 會從看板中永久移除。`,
    submitLabel: "確認刪除",
    onSubmit: async () => {
      await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      await reload({ preferredId: board.id, toastMessage: "任務已刪除" });
    },
  });
}

/* ---------------------------------- Drag ----------------------------------- */

function clearDropHighlights() {
  document
    .querySelectorAll(".is-drag-over, .is-drop-target")
    .forEach((element) => element.classList.remove("is-drag-over", "is-drop-target"));
  state.currentDropZone = null;
}

function getDropPosition(zone, clientY, draggedId) {
  const cards = Array.from(zone.querySelectorAll(".task-card")).filter(
    (card) => card.dataset.taskId !== draggedId,
  );

  const index = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });

  return index === -1 ? cards.length : index;
}

view.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".task-card");
  if (!card) {
    return;
  }

  state.draggingId = card.dataset.taskId;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", card.dataset.taskId);
});

view.addEventListener("dragend", () => {
  document
    .querySelectorAll(".task-card.is-dragging")
    .forEach((card) => card.classList.remove("is-dragging"));
  state.draggingId = null;
  clearDropHighlights();
});

view.addEventListener("dragover", (event) => {
  const zone = event.target.closest("[data-dropzone]");
  if (!zone) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  if (state.currentDropZone !== zone) {
    clearDropHighlights();
    state.currentDropZone = zone;
    zone.classList.add("is-drag-over");
    zone.closest(".column")?.classList.add("is-drop-target");
  }
});

view.addEventListener("drop", async (event) => {
  const zone = event.target.closest("[data-dropzone]");
  if (!zone) {
    return;
  }

  event.preventDefault();
  const column = zone.closest("[data-column-id]");
  const taskId = state.draggingId || event.dataTransfer.getData("text/plain");
  if (!column || !taskId) {
    return;
  }

  const position = getDropPosition(zone, event.clientY, taskId);
  const columnId = column.dataset.columnId;
  const boardId = state.board?.id;
  clearDropHighlights();
  state.draggingId = null;

  if (state.board) {
    state.board.columns = applyTaskMove(
      state.board.columns,
      taskId,
      columnId,
      position,
    );
    renderBoard();
  }

  try {
    await api(`/api/tasks/${encodeURIComponent(taskId)}/move`, {
      method: "POST",
      body: { column_id: columnId, position },
    });
    await reload({ preferredId: boardId, toastMessage: "任務已移動" });
  } catch (error) {
    showToast(error.message, "error");
    await reload({ preferredId: boardId });
  }
});

/* --------------------------------- Events ---------------------------------- */

boardList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-board-id]");
  if (button) {
    selectBoard(button.dataset.boardId);
  }
});

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;

  if (action === "new-board") {
    openBoardDialog();
  } else if (action === "new-column") {
    openColumnDialog();
  } else if (action === "new-task") {
    openTaskDialog();
  } else if (action === "add-task") {
    openTaskDialog(null, actionTarget.dataset.columnId);
  } else if (action === "edit-board") {
    openBoardDialog(state.board);
  } else if (action === "edit-column") {
    const column = actionTarget.closest("[data-column-id]");
    if (column) {
      openColumnDialog(findColumn(column.dataset.columnId));
    }
  } else if (action === "edit-task") {
    const card = actionTarget.closest("[data-task-id]");
    if (card) {
      openTaskDialog(findTask(card.dataset.taskId).task);
    }
  } else if (action === "toggle-sidebar") {
    appShell.classList.toggle("sidebar-open");
  } else if (action === "retry") {
    loadInitial();
  }
});

view.addEventListener("click", (event) => {
  if (event.target.closest("button")) {
    return;
  }

  const card = event.target.closest("[data-task-id]");
  if (card) {
    openTaskDialog(findTask(card.dataset.taskId).task);
  }
});

view.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const card = event.target.closest("[data-task-id]");
  if (card && event.target === card) {
    event.preventDefault();
    openTaskDialog(findTask(card.dataset.taskId).task);
  }
});

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    state.search = searchInput.value.trim();
    if (state.board) {
      renderBoard();
    }
  }, 110);
});

labelFilterSelect.addEventListener("change", () => {
  state.labelFilter = labelFilterSelect.value;
  if (state.board) {
    renderBoard();
  }
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  if (event.key === "/" && !isTyping) {
    event.preventDefault();
    searchInput.focus();
  }

  if (event.key === "n" && !isTyping && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    openTaskDialog();
  }

  if (event.key === "Escape" && target === searchInput && searchInput.value) {
    searchInput.value = "";
    state.search = "";
    renderBoard();
  }
});

modal.addEventListener("click", (event) => {
  if (event.target.closest("[data-modal-close]")) {
    modal.close();
    return;
  }

  if (event.target === modal) {
    modal.close();
  }
});

modal.addEventListener("close", () => {
  modal.innerHTML = "";
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 960) {
    appShell.classList.remove("sidebar-open");
  }
});

setTodayLabel();
connectRealtime();
loadInitial();
