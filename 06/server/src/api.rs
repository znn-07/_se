use crate::{
    db,
    error::AppError,
    models::{BoardDetail, BoardSummary, Column, Task},
    validation, AppState,
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::broadcast;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/boards", get(list_boards).post(create_board))
        .route(
            "/boards/{id}",
            get(get_board).patch(update_board).delete(delete_board),
        )
        .route("/boards/{id}/columns", axum::routing::post(create_column))
        .route(
            "/columns/{id}",
            axum::routing::patch(update_column).delete(delete_column),
        )
        .route("/columns/{id}/tasks", axum::routing::post(create_task))
        .route(
            "/tasks/{id}",
            axum::routing::patch(update_task).delete(delete_task),
        )
        .route("/tasks/{id}/move", axum::routing::post(move_task))
        .route("/ws", get(websocket))
        .fallback(api_not_found)
        .with_state(state)
}

fn read_db<T>(
    state: &AppState,
    action: impl FnOnce(&Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let connection = state
        .db
        .lock()
        .map_err(|_| AppError::internal("資料庫鎖定失敗"))?;
    action(&connection)
}

fn write_db<T>(
    state: &AppState,
    action: impl FnOnce(&mut Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut connection = state
        .db
        .lock()
        .map_err(|_| AppError::internal("資料庫鎖定失敗"))?;
    action(&mut connection)
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "taskboard-server",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[derive(Deserialize)]
struct BoardInput {
    name: String,
}

#[derive(Deserialize)]
struct ColumnInput {
    title: String,
}

#[derive(Deserialize)]
struct CreateTaskInput {
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    labels: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct UpdateTaskInput {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    labels: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct MoveTaskInput {
    column_id: String,
    #[serde(default)]
    position: Option<i64>,
}

async fn list_boards(State(state): State<AppState>) -> Result<Json<Vec<BoardSummary>>, AppError> {
    let boards = read_db(&state, db::list_boards)?;
    Ok(Json(boards))
}

async fn create_board(
    State(state): State<AppState>,
    Json(input): Json<BoardInput>,
) -> Result<(StatusCode, Json<BoardSummary>), AppError> {
    let name = validation::required_text(&input.name, "看板名稱", validation::BOARD_NAME_MAX)?;
    let board = read_db(&state, |connection| db::create_board(connection, &name))?;
    Ok((StatusCode::CREATED, Json(board)))
}

async fn get_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<BoardDetail>, AppError> {
    read_db(&state, |connection| db::get_board(connection, &board_id))?
        .map(Json)
        .ok_or_else(|| AppError::not_found("找不到看板"))
}

async fn update_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(input): Json<BoardInput>,
) -> Result<Json<BoardSummary>, AppError> {
    let name = validation::required_text(&input.name, "看板名稱", validation::BOARD_NAME_MAX)?;
    read_db(&state, |connection| {
        db::update_board(connection, &board_id, &name)
    })?
    .map(Json)
    .ok_or_else(|| AppError::not_found("找不到看板"))
}

async fn delete_board(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted = read_db(&state, |connection| db::delete_board(connection, &board_id))?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("找不到看板"))
    }
}

async fn create_column(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(input): Json<ColumnInput>,
) -> Result<(StatusCode, Json<Column>), AppError> {
    let title = validation::required_text(&input.title, "欄位名稱", validation::COLUMN_TITLE_MAX)?;
    let column = read_db(&state, |connection| {
        db::create_column(connection, &board_id, &title)
    })?;
    Ok((StatusCode::CREATED, Json(column)))
}

async fn update_column(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
    Json(input): Json<ColumnInput>,
) -> Result<Json<Column>, AppError> {
    let title = validation::required_text(&input.title, "欄位名稱", validation::COLUMN_TITLE_MAX)?;
    read_db(&state, |connection| {
        db::update_column(connection, &column_id, &title)
    })?
    .map(Json)
    .ok_or_else(|| AppError::not_found("找不到欄位"))
}

async fn delete_column(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted = write_db(&state, |connection| {
        db::delete_column(connection, &column_id)
    })?;
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::not_found("找不到欄位"))
    }
}

fn validate_task(
    title: &str,
    description: Option<&str>,
    priority: Option<&str>,
    due_date: Option<&str>,
) -> Result<(String, String, String, Option<String>), AppError> {
    let title = validation::required_text(title, "任務標題", validation::TASK_TITLE_MAX)?;
    let description =
        validation::optional_text(description, "任務描述", validation::TASK_DESCRIPTION_MAX)?;
    let priority = validation::priority(priority)?;
    let due_date = validation::due_date(due_date)?;
    Ok((title, description, priority, due_date))
}

async fn create_task(
    State(state): State<AppState>,
    Path(column_id): Path<String>,
    Json(input): Json<CreateTaskInput>,
) -> Result<(StatusCode, Json<Task>), AppError> {
    let (title, description, priority, due_date) = validate_task(
        &input.title,
        input.description.as_deref(),
        input.priority.as_deref(),
        input.due_date.as_deref(),
    )?;
    let labels = validation::labels(input.labels.as_deref())?;

    let task = read_db(&state, |connection| {
        db::create_task_with_labels(
            connection,
            &column_id,
            &title,
            &description,
            &priority,
            due_date.as_deref(),
            &labels,
        )
    })?;
    let board_id = read_db(&state, |connection| {
        Ok(db::get_column(connection, &column_id)?.map(|column| column.board_id))
    })?;
    state.broadcast(json!({
        "type": "task.created",
        "board_id": board_id,
        "column_id": task.column_id,
        "task": task.clone(),
    }));
    Ok((StatusCode::CREATED, Json(task)))
}

async fn update_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(input): Json<UpdateTaskInput>,
) -> Result<Json<Task>, AppError> {
    let current = read_db(&state, |connection| db::get_task(connection, &task_id))?
        .ok_or_else(|| AppError::not_found("找不到任務"))?;

    let title = match input.title.as_deref() {
        Some(title) => validation::required_text(title, "任務標題", validation::TASK_TITLE_MAX)?,
        None => current.title.clone(),
    };
    let description = match input.description.as_deref() {
        Some(description) => validation::optional_text(
            Some(description),
            "任務描述",
            validation::TASK_DESCRIPTION_MAX,
        )?,
        None => current.description.clone(),
    };
    let priority = match input.priority.as_deref() {
        Some(priority) => validation::priority(Some(priority))?,
        None => current.priority.clone(),
    };
    let due_date = match input.due_date.as_deref() {
        Some(due_date) => validation::due_date(Some(due_date))?,
        None => current.due_date.clone(),
    };
    let labels = match input.labels.as_deref() {
        Some(labels) => validation::labels(Some(labels))?,
        None => current.labels.clone(),
    };

    let task = read_db(&state, |connection| {
        db::update_task_with_labels(
            connection,
            &task_id,
            &title,
            &description,
            &priority,
            due_date.as_deref(),
            &labels,
        )
    })?
    .ok_or_else(|| AppError::not_found("找不到任務"))?;
    let board_id = read_db(&state, |connection| {
        Ok(db::get_column(connection, &task.column_id)?.map(|column| column.board_id))
    })?;
    state.broadcast(json!({
        "type": "task.updated",
        "board_id": board_id,
        "column_id": task.column_id,
        "task": task.clone(),
    }));
    Ok(Json(task))
}

async fn delete_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let task = read_db(&state, |connection| db::get_task(connection, &task_id))?
        .ok_or_else(|| AppError::not_found("找不到任務"))?;
    let deleted = write_db(&state, |connection| db::delete_task(connection, &task_id))?;
    if !deleted {
        return Err(AppError::not_found("找不到任務"));
    }
    let board_id = read_db(&state, |connection| {
        Ok(db::get_column(connection, &task.column_id)?.map(|column| column.board_id))
    })?;
    state.broadcast(json!({
        "type": "task.deleted",
        "board_id": board_id,
        "column_id": task.column_id,
        "task_id": task.id,
    }));
    Ok(StatusCode::NO_CONTENT)
}

async fn move_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(input): Json<MoveTaskInput>,
) -> Result<Json<Task>, AppError> {
    let column_id = input.column_id.trim().to_string();
    if column_id.is_empty() {
        return Err(AppError::bad_request("目標欄位不能是空白"));
    }

    let task = write_db(&state, |connection| {
        db::move_task(connection, &task_id, &column_id, input.position)
    })?;
    let board_id = read_db(&state, |connection| {
        Ok(db::get_column(connection, &column_id)?.map(|column| column.board_id))
    })?;
    state.broadcast(json!({
        "type": "task.moved",
        "board_id": board_id,
        "column_id": task.column_id,
        "task": task.clone(),
    }));
    Ok(Json(task))
}

async fn websocket(
    websocket: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    websocket.on_upgrade(move |socket| handle_socket(socket, state.subscribe()))
}

async fn handle_socket(mut socket: WebSocket, mut events: broadcast::Receiver<String>) {
    if socket
        .send(Message::Text(r#"{"type":"connected"}"#.into()))
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            event = events.recv() => {
                match event {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

async fn api_not_found() -> AppError {
    AppError::not_found("找不到 API 端點")
}
