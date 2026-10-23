const { test, expect } = require("@playwright/test");

const uniqueName = (label) =>
  `${label} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

async function createBoardThroughApi(request, name) {
  const response = await request.post("/api/boards", { data: { name } });
  expect(response.status()).toBe(201);
  return response.json();
}

async function createColumnThroughApi(request, boardId, title) {
  const response = await request.post(`/api/boards/${boardId}/columns`, {
    data: { title },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function createTaskThroughApi(request, columnId, task) {
  const response = await request.post(`/api/columns/${columnId}/tasks`, {
    data: task,
  });
  expect(response.status()).toBe(201);
  return response.json();
}

function columnByHeading(page, name) {
  return page
    .getByTestId("column")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

test("建立看板、欄位與任務，重新整理後仍會保留", async ({ page, request }) => {
  const boardName = uniqueName("E2E 看板");
  let boardId = null;

  try {
    await page.goto("/");
    await page.getByTestId("new-board-sidebar").click();
    await page.getByLabel("看板名稱").fill(boardName);
    await page.getByRole("button", { name: "建立看板" }).click();

    await expect(page.getByTestId("board-title")).toHaveText(boardName);
    const boardItem = page.getByTestId("board-item").filter({ hasText: boardName });
    await expect(boardItem).toBeVisible();

    const boards = await (await request.get("/api/boards")).json();
    boardId = boards.find((board) => board.name === boardName).id;

    await page.getByTestId("add-column").click();
    await page.getByLabel("欄位名稱").fill("待辦");
    await page.getByRole("button", { name: "建立欄位" }).click();
    await expect(page.getByTestId("column")).toHaveCount(1);

    await page
      .getByTestId("column")
      .getByRole("button", { name: "編輯欄位：待辦" })
      .click();
    await page.getByLabel("欄位名稱").fill("本週待辦");
    await page.getByRole("button", { name: "儲存變更" }).click();
    await expect(
      page.getByRole("heading", { name: "本週待辦", exact: true }),
    ).toBeVisible();

    await page.getByTestId("column").getByTestId("add-task").click();
    await page.getByLabel("任務標題").fill("完成登入頁");
    await page.getByLabel("描述").fill("建立表單、驗證與錯誤狀態。");
    await page.locator("#field-labels").fill("Bug, Frontend");
    await page.getByLabel("優先順序").selectOption("high");
    await page.getByLabel("截止日期").fill("2026-12-18");
    await page.getByRole("button", { name: "建立任務" }).click();

    await expect(page.getByTestId("task-card")).toHaveCount(1);
    await expect(page.getByTestId("task-card")).toContainText("完成登入頁");
    await expect(page.getByTestId("task-label")).toHaveCount(2);
    await expect(
      page.getByTestId("task-label").filter({ hasText: "Frontend" }),
    ).toBeVisible();

    await page.reload();

    await expect(page.getByTestId("board-title")).toHaveText(boardName);
    await expect(
      page.getByRole("heading", { name: "本週待辦", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("task-card")).toContainText("完成登入頁");
    await expect(page.getByTestId("task-card")).toContainText("高優先");
    await expect(page.getByTestId("task-label")).toHaveCount(2);

    await page.getByLabel("依標籤篩選").selectOption("Bug");
    await expect(page.getByTestId("task-card")).toContainText("完成登入頁");
  } finally {
    if (boardId) {
      await request.delete(`/api/boards/${boardId}`);
    }
  }
});

test("可以把任務從進行中拖曳到已完成，重新整理後仍保留", async ({
  page,
  request,
}) => {
  const boardName = uniqueName("拖曳測試");
  const board = await createBoardThroughApi(request, boardName);
  const todo = await createColumnThroughApi(request, board.id, "待辦");
  const doing = await createColumnThroughApi(request, board.id, "進行中");
  const done = await createColumnThroughApi(request, board.id, "已完成");
  await createTaskThroughApi(request, doing.id, {
    title: "拖曳這張卡片",
    description: "從進行中移動到已完成。",
    priority: "high",
    labels: ["Bug"],
  });

  try {
    await page.goto("/");
    await page.getByTestId("board-item").filter({ hasText: boardName }).click();
    await expect(page.getByTestId("board-title")).toHaveText(boardName);

    const sourceColumn = columnByHeading(page, "進行中");
    const targetColumn = columnByHeading(page, "已完成");
    const card = sourceColumn.getByTestId("task-card");
    await expect(card).toContainText("拖曳這張卡片");

    await card.dragTo(targetColumn.getByTestId("task-list"));

    await expect(page.getByRole("status")).toContainText("任務已移動");
    await expect(targetColumn.getByTestId("task-card")).toContainText(
      "拖曳這張卡片",
    );
    await expect(sourceColumn.getByTestId("task-card")).toHaveCount(0);

    await expect
      .poll(async () => {
        const detail = await (await request.get(`/api/boards/${board.id}`)).json();
        return detail.columns.find((column) => column.id === done.id)?.tasks[0]
          ?.title;
      })
      .toBe("拖曳這張卡片");

    await page.reload();
    await expect(page.getByTestId("board-title")).toHaveText(boardName);
    await expect(
      columnByHeading(page, "已完成").getByTestId("task-card"),
    ).toContainText("拖曳這張卡片");
    await expect(
      columnByHeading(page, "進行中").getByTestId("task-card"),
    ).toHaveCount(0);
    await expect(
      columnByHeading(page, "待辦").getByTestId("task-card"),
    ).toHaveCount(0);

    const detail = await (await request.get(`/api/boards/${board.id}`)).json();
    expect(detail.columns.find((column) => column.id === todo.id).tasks).toEqual(
      [],
    );
  } finally {
    await request.delete(`/api/boards/${board.id}`);
  }
});

test("另一位使用者新增任務時，看板會透過 WebSocket 即時更新", async ({
  page,
  request,
}) => {
  const boardName = uniqueName("即時測試");
  const board = await createBoardThroughApi(request, boardName);
  const column = await createColumnThroughApi(request, board.id, "進行中");

  try {
    await page.goto("/");
    await page.getByTestId("board-item").filter({ hasText: boardName }).click();
    await expect(page.getByTestId("board-title")).toHaveText(boardName);
    await expect(page.locator("#live-status")).toHaveAttribute(
      "data-state",
      "online",
    );
    await expect(page.getByTestId("task-card")).toHaveCount(0);

    await createTaskThroughApi(request, column.id, {
      title: "即時出現的任務",
      description: "由另一個使用者建立。",
      priority: "medium",
      labels: ["Bug"],
    });

    await expect(page.getByTestId("task-card")).toContainText(
      "即時出現的任務",
    );
    await expect(page.getByTestId("task-label")).toHaveText("Bug");
  } finally {
    await request.delete(`/api/boards/${board.id}`);
  }
});

test("可以編輯與刪除任務，最後刪除整個看板", async ({ page, request }) => {
  const boardName = uniqueName("編輯測試");
  const board = await createBoardThroughApi(request, boardName);
  const column = await createColumnThroughApi(request, board.id, "待辦");
  await createTaskThroughApi(request, column.id, {
    title: "原本的任務",
    description: "準備被編輯。",
    priority: "medium",
  });

  await page.goto("/");
  await page.getByTestId("board-item").filter({ hasText: boardName }).click();
  await expect(page.getByTestId("board-title")).toHaveText(boardName);

  await page.getByTestId("task-card").click();
  await expect(page.getByRole("heading", { name: "編輯任務" })).toBeVisible();
  await page.getByLabel("任務標題").fill("更新後的任務");
  await page.getByLabel("優先順序").selectOption("low");
  await page.getByRole("button", { name: "儲存任務" }).click();

  await expect(page.getByRole("status")).toContainText("任務已更新");
  await expect(page.getByTestId("task-card")).toContainText("更新後的任務");
  await expect(page.getByTestId("task-card")).toContainText("低優先");

  await page.getByTestId("task-card").click();
  await page.getByRole("button", { name: "刪除任務" }).click();
  await expect(
    page.getByRole("heading", { name: "刪除這張卡片？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "確認刪除" }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(0);

  await page.getByRole("button", { name: "看板設定" }).click();
  await page.getByRole("button", { name: "刪除看板" }).click();
  await expect(
    page.getByRole("heading", { name: "刪除這個看板？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "確認刪除" }).click();

  await expect(
    page.getByTestId("board-item").filter({ hasText: boardName }),
  ).toHaveCount(0);

  const deleted = await request.get(`/api/boards/${board.id}`);
  expect(deleted.status()).toBe(404);
});
