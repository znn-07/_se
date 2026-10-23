use crate::{
    error::AppError,
    models::{BoardDetail, BoardSummary, Column, ColumnDetail, Task},
};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::{fs, path::Path, time::Duration};
use uuid::Uuid;

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn open_database(path: &Path) -> Result<Connection, AppError> {
    if path != Path::new(":memory:") {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|error| AppError::internal(format!("無法建立資料庫目錄：{error}")))?;
            }
        }
    }

    let connection = Connection::open(path)?;
    configure(&connection, path != Path::new(":memory:"))?;
    Ok(connection)
}

pub fn open_in_memory() -> Result<Connection, AppError> {
    let connection = Connection::open_in_memory()?;
    configure(&connection, false)?;
    Ok(connection)
}

fn configure(connection: &Connection, on_disk: bool) -> Result<(), AppError> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON;")?;
    if on_disk {
        connection.execute_batch("PRAGMA journal_mode = WAL;")?;
    }
    initialize_schema(connection)
}

pub fn initialize_schema(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS boards (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS board_columns (
            id          TEXT PRIMARY KEY,
            board_id    TEXT NOT NULL,
            title       TEXT NOT NULL,
            position    INTEGER NOT NULL,
            created_at  TEXT NOT NULL,
            FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id          TEXT PRIMARY KEY,
            column_id   TEXT NOT NULL,
            title       TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            priority    TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high')),
            due_date    TEXT,
            position    INTEGER NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            labels      TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (column_id) REFERENCES board_columns(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_board_columns_board
            ON board_columns(board_id, position);
        CREATE INDEX IF NOT EXISTS idx_tasks_column
            ON tasks(column_id, position);
        "#,
    )?;

    let has_labels = {
        let mut statement = connection.prepare("PRAGMA table_info(tasks)")?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        columns.iter().any(|column| column == "labels")
    };

    if !has_labels {
        connection.execute(
            "ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }

    Ok(())
}

pub fn list_boards(connection: &Connection) -> Result<Vec<BoardSummary>, AppError> {
    let mut statement = connection.prepare(
        r#"
        SELECT
            b.id,
            b.name,
            (SELECT COUNT(*) FROM board_columns c WHERE c.board_id = b.id) AS column_count,
            (
                SELECT COUNT(*)
                FROM tasks t
                JOIN board_columns c ON c.id = t.column_id
                WHERE c.board_id = b.id
            ) AS task_count,
            b.created_at,
            b.updated_at
        FROM boards b
        ORDER BY b.created_at ASC, b.rowid ASC
        "#,
    )?;

    let boards = statement
        .query_map([], |row| {
            Ok(BoardSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                column_count: row.get(2)?,
                task_count: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(boards)
}

pub fn get_board_summary(
    connection: &Connection,
    board_id: &str,
) -> Result<Option<BoardSummary>, AppError> {
    let board = connection
        .query_row(
            r#"
            SELECT
                b.id,
                b.name,
                (SELECT COUNT(*) FROM board_columns c WHERE c.board_id = b.id) AS column_count,
                (
                    SELECT COUNT(*)
                    FROM tasks t
                    JOIN board_columns c ON c.id = t.column_id
                    WHERE c.board_id = b.id
                ) AS task_count,
                b.created_at,
                b.updated_at
            FROM boards b
            WHERE b.id = ?1
            "#,
            [board_id],
            |row| {
                Ok(BoardSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    column_count: row.get(2)?,
                    task_count: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()?;

    Ok(board)
}

pub fn create_board(connection: &Connection, name: &str) -> Result<BoardSummary, AppError> {
    let id = new_id();
    let timestamp = now();
    connection.execute(
        "INSERT INTO boards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, timestamp],
    )?;
    get_board_summary(connection, &id)?.ok_or_else(|| AppError::internal("建立看板後找不到資料"))
}

pub fn update_board(
    connection: &Connection,
    board_id: &str,
    name: &str,
) -> Result<Option<BoardSummary>, AppError> {
    let changed = connection.execute(
        "UPDATE boards SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now(), board_id],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_board_summary(connection, board_id)
}

pub fn delete_board(connection: &Connection, board_id: &str) -> Result<bool, AppError> {
    Ok(connection.execute("DELETE FROM boards WHERE id = ?1", [board_id])? > 0)
}

pub fn get_board(connection: &Connection, board_id: &str) -> Result<Option<BoardDetail>, AppError> {
    let board = connection
        .query_row(
            "SELECT id, name, created_at, updated_at FROM boards WHERE id = ?1",
            [board_id],
            |row| {
                Ok(BoardDetail {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    columns: Vec::new(),
                })
            },
        )
        .optional()?;

    let Some(mut board) = board else {
        return Ok(None);
    };

    let mut statement = connection.prepare(
        "SELECT id, board_id, title, position, created_at
         FROM board_columns
         WHERE board_id = ?1
         ORDER BY position ASC, rowid ASC",
    )?;

    let columns = statement
        .query_map([board_id], |row| {
            Ok(ColumnDetail {
                id: row.get(0)?,
                board_id: row.get(1)?,
                title: row.get(2)?,
                position: row.get(3)?,
                created_at: row.get(4)?,
                tasks: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    board.columns = columns
        .into_iter()
        .map(|mut column| {
            column.tasks = list_tasks(connection, &column.id)?;
            Ok(column)
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(Some(board))
}

pub fn create_column(
    connection: &Connection,
    board_id: &str,
    title: &str,
) -> Result<Column, AppError> {
    ensure_board_exists(connection, board_id)?;

    let position: i64 = connection.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM board_columns WHERE board_id = ?1",
        [board_id],
        |row| row.get(0),
    )?;

    let column = Column {
        id: new_id(),
        board_id: board_id.to_string(),
        title: title.to_string(),
        position,
        created_at: now(),
    };

    connection.execute(
        "INSERT INTO board_columns (id, board_id, title, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            column.id,
            column.board_id,
            column.title,
            column.position,
            column.created_at
        ],
    )?;

    Ok(column)
}

pub fn update_column(
    connection: &Connection,
    column_id: &str,
    title: &str,
) -> Result<Option<Column>, AppError> {
    let changed = connection.execute(
        "UPDATE board_columns SET title = ?1 WHERE id = ?2",
        params![title, column_id],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_column(connection, column_id)
}

pub fn get_column(connection: &Connection, column_id: &str) -> Result<Option<Column>, AppError> {
    let column = connection
        .query_row(
            "SELECT id, board_id, title, position, created_at
             FROM board_columns WHERE id = ?1",
            [column_id],
            |row| {
                Ok(Column {
                    id: row.get(0)?,
                    board_id: row.get(1)?,
                    title: row.get(2)?,
                    position: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        )
        .optional()?;
    Ok(column)
}

pub fn delete_column(connection: &mut Connection, column_id: &str) -> Result<bool, AppError> {
    let transaction = connection.transaction()?;
    let board_id: Option<String> = transaction
        .query_row(
            "SELECT board_id FROM board_columns WHERE id = ?1",
            [column_id],
            |row| row.get(0),
        )
        .optional()?;

    let Some(board_id) = board_id else {
        return Ok(false);
    };

    let deleted = transaction.execute("DELETE FROM board_columns WHERE id = ?1", [column_id])? > 0;
    normalize_column_positions(&transaction, &board_id)?;
    transaction.commit()?;
    Ok(deleted)
}

pub fn list_tasks(connection: &Connection, column_id: &str) -> Result<Vec<Task>, AppError> {
    let mut statement = connection.prepare(
        "SELECT id, column_id, title, description, priority, due_date, position,
                created_at, updated_at, labels
         FROM tasks
         WHERE column_id = ?1
         ORDER BY position ASC, rowid ASC",
    )?;

    let tasks = statement
        .query_map([column_id], map_task)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tasks)
}

pub fn get_task(connection: &Connection, task_id: &str) -> Result<Option<Task>, AppError> {
    let task = connection
        .query_row(
            "SELECT id, column_id, title, description, priority, due_date, position,
                    created_at, updated_at, labels
             FROM tasks WHERE id = ?1",
            [task_id],
            map_task,
        )
        .optional()?;
    Ok(task)
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let labels: String = row.get(9)?;
    Ok(Task {
        id: row.get(0)?,
        column_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        priority: row.get(4)?,
        due_date: row.get(5)?,
        position: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        labels: serde_json::from_str(&labels).unwrap_or_default(),
    })
}

pub fn create_task(
    connection: &Connection,
    column_id: &str,
    title: &str,
    description: &str,
    priority: &str,
    due_date: Option<&str>,
) -> Result<Task, AppError> {
    create_task_with_labels(
        connection,
        column_id,
        title,
        description,
        priority,
        due_date,
        &[],
    )
}

pub fn create_task_with_labels(
    connection: &Connection,
    column_id: &str,
    title: &str,
    description: &str,
    priority: &str,
    due_date: Option<&str>,
    labels: &[String],
) -> Result<Task, AppError> {
    let column =
        get_column(connection, column_id)?.ok_or_else(|| AppError::not_found("找不到欄位"))?;

    let position: i64 = connection.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE column_id = ?1",
        [column_id],
        |row| row.get(0),
    )?;

    let timestamp = now();
    let labels_json = serde_json::to_string(labels)
        .map_err(|error| AppError::internal(format!("無法序列化任務標籤：{error}")))?;
    let task = Task {
        id: new_id(),
        column_id: column.id,
        title: title.to_string(),
        description: description.to_string(),
        priority: priority.to_string(),
        due_date: due_date.map(str::to_string),
        position,
        created_at: timestamp.clone(),
        updated_at: timestamp,
        labels: labels.to_vec(),
    };

    connection.execute(
        "INSERT INTO tasks
            (id, column_id, title, description, priority, due_date, position,
             created_at, updated_at, labels)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            task.id,
            task.column_id,
            task.title,
            task.description,
            task.priority,
            task.due_date,
            task.position,
            task.created_at,
            task.updated_at,
            labels_json
        ],
    )?;

    Ok(task)
}

pub fn update_task(
    connection: &Connection,
    task_id: &str,
    title: &str,
    description: &str,
    priority: &str,
    due_date: Option<&str>,
) -> Result<Option<Task>, AppError> {
    let labels = get_task(connection, task_id)?
        .map(|task| task.labels)
        .unwrap_or_default();
    update_task_with_labels(
        connection,
        task_id,
        title,
        description,
        priority,
        due_date,
        &labels,
    )
}

pub fn update_task_with_labels(
    connection: &Connection,
    task_id: &str,
    title: &str,
    description: &str,
    priority: &str,
    due_date: Option<&str>,
    labels: &[String],
) -> Result<Option<Task>, AppError> {
    let labels_json = serde_json::to_string(labels)
        .map_err(|error| AppError::internal(format!("無法序列化任務標籤：{error}")))?;
    let changed = connection.execute(
        "UPDATE tasks
         SET title = ?1, description = ?2, priority = ?3, due_date = ?4,
             labels = ?5, updated_at = ?6
         WHERE id = ?7",
        params![
            title,
            description,
            priority,
            due_date,
            labels_json,
            now(),
            task_id
        ],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    get_task(connection, task_id)
}

pub fn delete_task(connection: &mut Connection, task_id: &str) -> Result<bool, AppError> {
    let transaction = connection.transaction()?;
    let column_id: Option<String> = transaction
        .query_row(
            "SELECT column_id FROM tasks WHERE id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .optional()?;

    let Some(column_id) = column_id else {
        return Ok(false);
    };

    let deleted = transaction.execute("DELETE FROM tasks WHERE id = ?1", [task_id])? > 0;
    normalize_task_positions(&transaction, &column_id)?;
    transaction.commit()?;
    Ok(deleted)
}

pub fn move_task(
    connection: &mut Connection,
    task_id: &str,
    target_column_id: &str,
    requested_position: Option<i64>,
) -> Result<Task, AppError> {
    let transaction = connection.transaction()?;

    let current: Option<(String, String)> = transaction
        .query_row(
            "SELECT t.column_id, c.board_id
             FROM tasks t
             JOIN board_columns c ON c.id = t.column_id
             WHERE t.id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((source_column_id, source_board_id)) = current else {
        return Err(AppError::not_found("找不到任務"));
    };

    let target_board_id: Option<String> = transaction
        .query_row(
            "SELECT board_id FROM board_columns WHERE id = ?1",
            [target_column_id],
            |row| row.get(0),
        )
        .optional()?;

    let Some(target_board_id) = target_board_id else {
        return Err(AppError::not_found("找不到目標欄位"));
    };

    if source_board_id != target_board_id {
        return Err(AppError::bad_request("任務只能在同一個看板內移動"));
    }

    let mut target_ids: Vec<String> = {
        let mut statement = transaction.prepare(
            "SELECT id FROM tasks
             WHERE column_id = ?1 AND id <> ?2
             ORDER BY position ASC, rowid ASC",
        )?;
        let ids = statement
            .query_map(params![target_column_id, task_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };

    let max_index = target_ids.len() as i64;
    let index = requested_position.unwrap_or(max_index).clamp(0, max_index) as usize;
    target_ids.insert(index, task_id.to_string());

    transaction.execute(
        "UPDATE tasks SET column_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![target_column_id, now(), task_id],
    )?;

    for (index, id) in target_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE tasks SET position = ?1 WHERE id = ?2",
            params![index as i64, id],
        )?;
    }

    if source_column_id != target_column_id {
        normalize_task_positions(&transaction, &source_column_id)?;
    }

    transaction.commit()?;
    get_task(connection, task_id)?.ok_or_else(|| AppError::internal("移動任務後找不到資料"))
}

fn ensure_board_exists(connection: &Connection, board_id: &str) -> Result<(), AppError> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM boards WHERE id = ?1)",
        [board_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(AppError::not_found("找不到看板"));
    }
    Ok(())
}

fn normalize_column_positions(connection: &Connection, board_id: &str) -> Result<(), AppError> {
    let ids: Vec<String> = {
        let mut statement = connection.prepare(
            "SELECT id FROM board_columns
             WHERE board_id = ?1
             ORDER BY position ASC, rowid ASC",
        )?;
        let ids = statement
            .query_map([board_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };

    for (index, id) in ids.iter().enumerate() {
        connection.execute(
            "UPDATE board_columns SET position = ?1 WHERE id = ?2",
            params![index as i64, id],
        )?;
    }
    Ok(())
}

fn normalize_task_positions(connection: &Connection, column_id: &str) -> Result<(), AppError> {
    let ids: Vec<String> = {
        let mut statement = connection.prepare(
            "SELECT id FROM tasks
             WHERE column_id = ?1
             ORDER BY position ASC, rowid ASC",
        )?;
        let ids = statement
            .query_map([column_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };

    for (index, id) in ids.iter().enumerate() {
        connection.execute(
            "UPDATE tasks SET position = ?1 WHERE id = ?2",
            params![index as i64, id],
        )?;
    }
    Ok(())
}

pub fn seed_demo_data(connection: &mut Connection) -> Result<(), AppError> {
    let board_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM boards", [], |row| row.get(0))?;
    if board_count > 0 {
        return Ok(());
    }

    let board = create_board(connection, "秋日產品衝刺")?;
    let backlog = create_column(connection, &board.id, "待辦")?;
    let doing = create_column(connection, &board.id, "進行中")?;
    let review = create_column(connection, &board.id, "待審核")?;
    let done = create_column(connection, &board.id, "已完成")?;

    create_task_with_labels(
        connection,
        &backlog.id,
        "整理使用者訪談洞察",
        "彙整 8 位受訪者的痛點，標記出三個最高頻的流程阻礙。",
        "high",
        Some("2026-11-02"),
        &["Research".to_string()],
    )?;
    create_task(
        connection,
        &backlog.id,
        "設計空狀態插圖",
        "為第一次開啟看板的使用者準備引導畫面。",
        "low",
        Some("2026-11-08"),
    )?;
    create_task_with_labels(
        connection,
        &doing.id,
        "實作拖曳排序",
        "支援卡片跨欄移動，並在放開後保存新的位置。",
        "high",
        Some("2026-10-28"),
        &["Feature".to_string(), "Frontend".to_string()],
    )?;
    create_task_with_labels(
        connection,
        &doing.id,
        "API 錯誤訊息統一",
        "讓所有 4xx / 5xx 回應都使用一致的 JSON 結構。",
        "medium",
        None,
        &["Bug".to_string(), "Backend".to_string()],
    )?;
    create_task_with_labels(
        connection,
        &review.id,
        "鍵盤操作檢查",
        "確認所有對話框都能用 Tab 與 Esc 操作。",
        "medium",
        Some("2026-10-30"),
        &["Accessibility".to_string()],
    )?;
    create_task(
        connection,
        &review.id,
        "行動版欄位橫向捲動",
        "在小螢幕上保留完整欄位寬度，避免卡片被壓縮。",
        "low",
        None,
    )?;
    create_task_with_labels(
        connection,
        &done.id,
        "建立 SQLite 資料模型",
        "看板、欄位、任務三層關聯與 cascade 刪除。",
        "high",
        None,
        &["Backend".to_string()],
    )?;
    create_task(
        connection,
        &done.id,
        "撰寫 API 系統測試",
        "涵蓋建立、更新、移動與刪除的完整流程。",
        "medium",
        None,
    )?;
    create_task(
        connection,
        &done.id,
        "設定 Playwright",
        "以無頭 Chromium 驗證主要使用流程。",
        "low",
        None,
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Connection, BoardSummary, Column, Column) {
        let connection = open_in_memory().unwrap();
        let board = create_board(&connection, "測試看板").unwrap();
        let todo = create_column(&connection, &board.id, "待辦").unwrap();
        let doing = create_column(&connection, &board.id, "進行中").unwrap();
        (connection, board, todo, doing)
    }

    fn titles(connection: &Connection, column_id: &str) -> Vec<String> {
        list_tasks(connection, column_id)
            .unwrap()
            .into_iter()
            .map(|task| task.title)
            .collect()
    }

    #[test]
    fn board_summary_counts_columns_and_tasks() {
        let (connection, board, todo, doing) = fixture();
        create_task(&connection, &todo.id, "A", "", "medium", None).unwrap();
        create_task(&connection, &todo.id, "B", "", "low", None).unwrap();
        create_task(&connection, &doing.id, "C", "", "high", None).unwrap();

        let summary = get_board_summary(&connection, &board.id).unwrap().unwrap();
        assert_eq!(summary.column_count, 2);
        assert_eq!(summary.task_count, 3);
    }

    #[test]
    fn task_labels_round_trip_and_can_be_updated() {
        let (connection, _, todo, _) = fixture();
        let task = create_task_with_labels(
            &connection,
            &todo.id,
            "修正登入",
            "",
            "high",
            None,
            &["Bug".to_string(), "Backend".to_string()],
        )
        .unwrap();

        assert_eq!(
            get_task(&connection, &task.id).unwrap().unwrap().labels,
            vec!["Bug", "Backend"]
        );

        update_task_with_labels(
            &connection,
            &task.id,
            &task.title,
            &task.description,
            &task.priority,
            None,
            &["Bug".to_string()],
        )
        .unwrap();

        assert_eq!(
            get_task(&connection, &task.id).unwrap().unwrap().labels,
            vec!["Bug"]
        );
    }

    #[test]
    fn move_task_reorders_within_the_same_column() {
        let (mut connection, _, todo, _) = fixture();
        let first = create_task(&connection, &todo.id, "A", "", "medium", None).unwrap();
        let second = create_task(&connection, &todo.id, "B", "", "medium", None).unwrap();
        let third = create_task(&connection, &todo.id, "C", "", "medium", None).unwrap();

        move_task(&mut connection, &third.id, &todo.id, Some(0)).unwrap();
        assert_eq!(titles(&connection, &todo.id), vec!["C", "A", "B"]);

        move_task(&mut connection, &first.id, &todo.id, Some(2)).unwrap();
        assert_eq!(titles(&connection, &todo.id), vec!["C", "B", "A"]);

        assert_eq!(
            get_task(&connection, &second.id).unwrap().unwrap().position,
            1
        );
    }

    #[test]
    fn move_task_across_columns_normalizes_both_columns() {
        let (mut connection, _, todo, doing) = fixture();
        let a = create_task(&connection, &todo.id, "A", "", "medium", None).unwrap();
        let b = create_task(&connection, &todo.id, "B", "", "medium", None).unwrap();
        let c = create_task(&connection, &doing.id, "C", "", "medium", None).unwrap();

        move_task(&mut connection, &a.id, &doing.id, Some(0)).unwrap();

        assert_eq!(titles(&connection, &todo.id), vec!["B"]);
        assert_eq!(titles(&connection, &doing.id), vec!["A", "C"]);
        assert_eq!(get_task(&connection, &b.id).unwrap().unwrap().position, 0);
        assert_eq!(get_task(&connection, &c.id).unwrap().unwrap().position, 1);
    }

    #[test]
    fn move_task_rejects_moving_between_boards() {
        let (mut connection, _, todo, _) = fixture();
        let other_board = create_board(&connection, "另一個看板").unwrap();
        let other_column = create_column(&connection, &other_board.id, "泳道").unwrap();
        let task = create_task(&connection, &todo.id, "A", "", "medium", None).unwrap();

        let error = move_task(&mut connection, &task.id, &other_column.id, None).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn deleting_a_board_cascades_to_columns_and_tasks() {
        let (mut connection, board, todo, _) = fixture();
        let task = create_task(&connection, &todo.id, "A", "", "medium", None).unwrap();

        assert!(delete_board(&connection, &board.id).unwrap());
        assert!(get_board(&connection, &board.id).unwrap().is_none());
        assert!(get_task(&connection, &task.id).unwrap().is_none());
        assert!(list_tasks(&connection, &todo.id).unwrap().is_empty());

        let _ = &mut connection;
    }

    #[test]
    fn deleting_a_task_compacts_positions() {
        let (mut connection, _, todo, _) = fixture();
        let a = create_task(&connection, &todo.id, "A", "", "medium", None).unwrap();
        let b = create_task(&connection, &todo.id, "B", "", "medium", None).unwrap();
        let c = create_task(&connection, &todo.id, "C", "", "medium", None).unwrap();

        assert!(delete_task(&mut connection, &b.id).unwrap());
        assert_eq!(titles(&connection, &todo.id), vec!["A", "C"]);
        assert_eq!(get_task(&connection, &a.id).unwrap().unwrap().position, 0);
        assert_eq!(get_task(&connection, &c.id).unwrap().unwrap().position, 1);
    }

    #[test]
    fn deleting_a_column_compacts_column_positions() {
        let (mut connection, board, todo, doing) = fixture();
        assert!(delete_column(&mut connection, &todo.id).unwrap());

        let detail = get_board(&connection, &board.id).unwrap().unwrap();
        assert_eq!(detail.columns.len(), 1);
        assert_eq!(detail.columns[0].id, doing.id);
        assert_eq!(detail.columns[0].position, 0);
    }
}
