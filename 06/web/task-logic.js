(function (root) {
  "use strict";

  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

  function parseDateOnly(value) {
    if (typeof value !== "string") {
      return null;
    }

    const match = DATE_ONLY.exec(value.trim());
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  function startOfDay(value) {
    const date = value instanceof Date ? new Date(value) : new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function dayDifference(later, earlier) {
    const laterUtc = Date.UTC(
      later.getFullYear(),
      later.getMonth(),
      later.getDate(),
    );
    const earlierUtc = Date.UTC(
      earlier.getFullYear(),
      earlier.getMonth(),
      earlier.getDate(),
    );
    return Math.round((laterUtc - earlierUtc) / 86400000);
  }

  function formatDueDate(value, options = {}) {
    const due = parseDateOnly(value);
    if (!due) {
      return null;
    }

    const today = startOfDay(options.today);
    const locale = options.locale || "zh-TW";
    const daysUntil = dayDifference(due, today);
    const formatted = new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
    }).format(due);

    const result = {
      daysUntil,
      overdue: daysUntil < 0,
      dueToday: daysUntil === 0,
      dueSoon: daysUntil >= 0 && daysUntil <= 3,
    };

    if (daysUntil < 0) {
      return { ...result, label: `逾期 ${formatted}` };
    }
    if (daysUntil === 0) {
      return { ...result, label: "今天截止" };
    }
    if (daysUntil === 1) {
      return { ...result, label: "明天截止" };
    }
    if (daysUntil <= 3) {
      return { ...result, label: `${daysUntil} 天後截止` };
    }
    return { ...result, label: formatted };
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function filterTasks(tasks, filters = {}) {
    const query = normalize(filters.query);
    const label = normalize(filters.label);

    return (Array.isArray(tasks) ? tasks : []).filter((task) => {
      const labels = Array.isArray(task.labels) ? task.labels : [];
      if (label && !labels.some((item) => normalize(item) === label)) {
        return false;
      }
      if (!query) {
        return true;
      }

      const searchable = [task.title, task.description, ...labels]
        .map(normalize)
        .join(" ");
      return searchable.includes(query);
    });
  }

  function cloneColumns(columns) {
    return (Array.isArray(columns) ? columns : []).map((column) => ({
      ...column,
      tasks: (Array.isArray(column.tasks) ? column.tasks : []).map((task) => ({
        ...task,
        labels: Array.isArray(task.labels) ? [...task.labels] : [],
      })),
    }));
  }

  function applyTaskMove(columns, taskId, targetColumnId, position = null) {
    const next = cloneColumns(columns);
    const source = next.find((column) =>
      column.tasks.some((task) => task.id === taskId),
    );
    const target = next.find((column) => column.id === targetColumnId);

    if (!source || !target) {
      return next;
    }

    const sourceIndex = source.tasks.findIndex((task) => task.id === taskId);
    const [task] = source.tasks.splice(sourceIndex, 1);
    const requested = Number(position);
    const targetIndex =
      position === null || position === undefined || Number.isNaN(requested)
        ? target.tasks.length
        : Math.max(0, Math.min(requested, target.tasks.length));

    task.column_id = targetColumnId;
    target.tasks.splice(targetIndex, 0, task);

    next.forEach((column) => {
      column.tasks.forEach((item, index) => {
        item.position = index;
      });
    });

    return next;
  }

  const api = { formatDueDate, filterTasks, applyTaskMove };
  root.TaskLogic = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
