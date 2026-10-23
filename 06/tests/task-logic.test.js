const test = require("node:test");
const assert = require("node:assert/strict");
const { applyTaskMove, filterTasks, formatDueDate } = require("../web/task-logic.js");

function boardFixture() {
  return [
    {
      id: "todo",
      title: "待辦",
      tasks: [
        { id: "t1", column_id: "todo", title: "整理需求", position: 0, labels: ["Research"] },
        { id: "t2", column_id: "todo", title: "修正登入錯誤", position: 1, labels: ["Bug"] },
      ],
    },
    {
      id: "doing",
      title: "進行中",
      tasks: [
        { id: "t3", column_id: "doing", title: "實作拖曳", position: 0, labels: ["Feature"] },
      ],
    },
    {
      id: "done",
      title: "已完成",
      tasks: [],
    },
  ];
}

test("applyTaskMove moves a task from 進行中 to 已完成 without mutating the source", () => {
  const columns = boardFixture();
  const moved = applyTaskMove(columns, "t3", "done", 0);

  assert.equal(columns[1].tasks.length, 1);
  assert.equal(columns[2].tasks.length, 0);
  assert.equal(moved[1].tasks.length, 0);
  assert.equal(moved[2].tasks[0].id, "t3");
  assert.equal(moved[2].tasks[0].column_id, "done");
  assert.equal(moved[2].tasks[0].position, 0);
  assert.deepEqual(moved[2].tasks[0].labels, ["Feature"]);
});

test("applyTaskMove reorders and clamps positions within the same column", () => {
  const moved = applyTaskMove(boardFixture(), "t2", "todo", 0);
  assert.deepEqual(
    moved[0].tasks.map((task) => task.id),
    ["t2", "t1"],
  );
  assert.deepEqual(
    moved[0].tasks.map((task) => task.position),
    [0, 1],
  );

  const appended = applyTaskMove(boardFixture(), "t1", "todo", 99);
  assert.deepEqual(
    appended[0].tasks.map((task) => task.id),
    ["t2", "t1"],
  );
});

test("applyTaskMove returns a clone when the task or target is missing", () => {
  const columns = boardFixture();
  const moved = applyTaskMove(columns, "missing", "done");
  assert.notEqual(moved, columns);
  assert.deepEqual(moved.map((column) => column.tasks.length), [2, 1, 0]);
});

test("formatDueDate calculates today, tomorrow, overdue and upcoming reminders", () => {
  const today = new Date(2026, 9, 23);

  assert.equal(formatDueDate("2026-10-23", { today }).label, "今天截止");
  assert.equal(formatDueDate("2026-10-23", { today }).dueToday, true);

  const tomorrow = formatDueDate("2026-10-24", { today });
  assert.equal(tomorrow.label, "明天截止");
  assert.equal(tomorrow.daysUntil, 1);

  const overdue = formatDueDate("2026-10-21", { today });
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.daysUntil, -2);
  assert.match(overdue.label, /^逾期 /);

  const soon = formatDueDate("2026-10-26", { today });
  assert.equal(soon.label, "3 天後截止");
  assert.equal(soon.dueSoon, true);
});

test("formatDueDate rejects invalid or empty dates", () => {
  assert.equal(formatDueDate(""), null);
  assert.equal(formatDueDate(null), null);
  assert.equal(formatDueDate("2026-02-30"), null);
  assert.equal(formatDueDate("23/10/2026"), null);
});

test("filterTasks filters by Bug label and combines label with search", () => {
  const tasks = [
    { title: "修正登入錯誤", description: "登入 API 500", labels: ["Bug", "Backend"] },
    { title: "新增看板", description: "建立看板流程", labels: ["Feature"] },
    { title: "修正錯字", description: "文案調整", labels: ["bug"] },
  ];

  assert.deepEqual(
    filterTasks(tasks, { label: "Bug" }).map((task) => task.title),
    ["修正登入錯誤", "修正錯字"],
  );
  assert.deepEqual(
    filterTasks(tasks, { label: "bug", query: "api" }).map((task) => task.title),
    ["修正登入錯誤"],
  );
  assert.deepEqual(
    filterTasks(tasks, { query: "看板" }).map((task) => task.title),
    ["新增看板"],
  );
  assert.equal(filterTasks(tasks, { label: "Design" }).length, 0);
  assert.equal(filterTasks(tasks).length, 3);
});
