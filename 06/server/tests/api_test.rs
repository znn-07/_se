use axum::{
    body::Body,
    http::{Method, Request, StatusCode},
    Router,
};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{net::SocketAddr, time::Duration};
use taskboard_server::{create_app, db::open_in_memory, AppState};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tower::ServiceExt;

struct TestContext {
    app: Router,
    _static_dir: TempDir,
}

fn test_app() -> TestContext {
    let connection = open_in_memory().expect("in-memory database");
    let static_dir = tempfile::tempdir().expect("temporary static directory");
    std::fs::write(
        static_dir.path().join("index.html"),
        "<!doctype html><title>Taskboard test</title>",
    )
    .expect("write index");
    let app = create_app(AppState::new(connection), static_dir.path());

    TestContext {
        app,
        _static_dir: static_dir,
    }
}

async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    payload: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    let body = match payload {
        Some(payload) => {
            builder = builder.header("content-type", "application/json");
            Body::from(payload.to_string())
        }
        None => Body::empty(),
    };

    let response = app
        .clone()
        .oneshot(builder.body(body).expect("request"))
        .await
        .expect("response");

    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();

    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).expect("JSON response")
    };

    (status, json)
}

async fn create_board(app: &Router, name: &str) -> String {
    let (status, body) = send(
        app,
        Method::POST,
        "/api/boards",
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().expect("board id").to_string()
}

async fn create_column(app: &Router, board_id: &str, title: &str) -> String {
    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/boards/{board_id}/columns"),
        Some(json!({ "title": title })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().expect("column id").to_string()
}

async fn create_task(app: &Router, column_id: &str, title: &str) -> String {
    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/columns/{column_id}/tasks"),
        Some(json!({
            "title": title,
            "description": "系統測試建立的工作",
            "priority": "high",
            "due_date": "2026-12-01",
            "labels": ["Bug", "Backend"]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["labels"], json!(["Bug", "Backend"]));
    body["id"].as_str().expect("task id").to_string()
}

#[tokio::test]
async fn health_endpoint_reports_service_status() {
    let context = test_app();
    let (status, body) = send(&context.app, Method::GET, "/api/health", None).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["service"], "taskboard-server");
}

#[tokio::test]
async fn serves_the_frontend_index() {
    let context = test_app();
    let response = context
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&bytes).contains("Taskboard test"));
}

#[tokio::test]
async fn full_board_column_and_task_workflow() {
    let context = test_app();
    let app = &context.app;

    let board_id = create_board(app, "API 測試看板").await;
    let todo_id = create_column(app, &board_id, "待辦").await;
    let doing_id = create_column(app, &board_id, "進行中").await;

    let first_task = create_task(app, &todo_id, "第一個任務").await;
    let second_task = create_task(app, &todo_id, "第二個任務").await;
    let third_task = create_task(app, &doing_id, "第三個任務").await;

    let (status, body) = send(
        app,
        Method::PATCH,
        &format!("/api/tasks/{first_task}"),
        Some(json!({
            "title": "更新後的任務",
            "description": "新的描述",
            "priority": "low",
            "due_date": "2026-12-31"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["title"], "更新後的任務");
    assert_eq!(body["priority"], "low");
    assert_eq!(body["due_date"], "2026-12-31");

    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/tasks/{first_task}/move"),
        Some(json!({ "column_id": doing_id, "position": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["column_id"], doing_id);
    assert_eq!(body["position"], 0);

    let (status, board) = send(app, Method::GET, &format!("/api/boards/{board_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(board["columns"][0]["tasks"][0]["id"], second_task);
    assert_eq!(board["columns"][1]["tasks"][0]["id"], first_task);
    assert_eq!(board["columns"][1]["tasks"][1]["id"], third_task);

    let (status, boards) = send(app, Method::GET, "/api/boards", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(boards[0]["column_count"], 2);
    assert_eq!(boards[0]["task_count"], 3);

    let (status, _) = send(
        app,
        Method::DELETE,
        &format!("/api/tasks/{second_task}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _) = send(
        app,
        Method::DELETE,
        &format!("/api/columns/{todo_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, board) = send(app, Method::GET, &format!("/api/boards/{board_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(board["columns"].as_array().unwrap().len(), 1);
    assert_eq!(board["columns"][0]["id"], doing_id);

    let (status, _) = send(
        app,
        Method::DELETE,
        &format!("/api/boards/{board_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, body) = send(app, Method::GET, &format!("/api/boards/{board_id}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn creating_a_task_persists_it_and_returns_its_json_representation() {
    let context = test_app();
    let app = &context.app;

    let board_id = create_board(app, "任務建立測試").await;
    let column_id = create_column(app, &board_id, "進行中").await;

    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/columns/{column_id}/tasks"),
        Some(json!({
            "title": "  修正登入 API  ",
            "description": "  回傳格式錯誤  ",
            "priority": "high",
            "due_date": "2026-12-15",
            "labels": ["Bug", "Backend", "bug"]
        })),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["title"], "修正登入 API");
    assert_eq!(body["description"], "回傳格式錯誤");
    assert_eq!(body["column_id"], column_id);
    assert_eq!(body["priority"], "high");
    assert_eq!(body["due_date"], "2026-12-15");
    assert_eq!(body["labels"], json!(["Bug", "Backend"]));
    assert!(body["id"].is_string());

    let (status, board) = send(app, Method::GET, &format!("/api/boards/{board_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    let task = &board["columns"][0]["tasks"][0];
    assert_eq!(task["id"], body["id"]);
    assert_eq!(task["title"], "修正登入 API");
    assert_eq!(task["labels"], json!(["Bug", "Backend"]));
}

async fn free_address() -> (TcpListener, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind websocket test server");
    let address = listener.local_addr().expect("local address");
    (listener, address)
}

#[tokio::test]
async fn websocket_broadcasts_task_created_events() {
    let context = test_app();
    let (listener, address) = free_address().await;
    let app = context.app.clone();
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve test app");
    });

    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}/api/ws"))
        .await
        .expect("connect websocket");

    let connected = socket
        .next()
        .await
        .expect("connected message")
        .expect("valid websocket frame");
    let connected = connected.into_text().expect("text frame");
    assert!(connected.contains("\"connected\""));

    let board_id = create_board(&context.app, "WebSocket 測試").await;
    let column_id = create_column(&context.app, &board_id, "進行中").await;
    let task_id = create_task(&context.app, &column_id, "即時推播任務").await;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let event = loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        assert!(!remaining.is_zero(), "timed out waiting for task.created");

        let frame = tokio::time::timeout(remaining, socket.next())
            .await
            .expect("websocket frame before timeout")
            .expect("websocket frame")
            .expect("valid websocket frame");

        if !frame.is_text() {
            continue;
        }

        let event: Value =
            serde_json::from_str(frame.into_text().expect("text frame").as_str()).expect("JSON");
        if event["type"] == "task.created" {
            break event;
        }
    };

    assert_eq!(event["board_id"], board_id);
    assert_eq!(event["column_id"], column_id);
    assert_eq!(event["task"]["id"], task_id);
    assert_eq!(event["task"]["title"], "即時推播任務");
    assert_eq!(event["task"]["labels"], json!(["Bug", "Backend"]));

    socket.close(None).await.expect("close websocket");
}

#[tokio::test]
async fn rejects_invalid_inputs_with_json_errors() {
    let context = test_app();
    let app = &context.app;

    let (status, body) = send(
        app,
        Method::POST,
        "/api/boards",
        Some(json!({ "name": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("看板名稱"));

    let board_id = create_board(app, "驗證看板").await;
    let column_id = create_column(app, &board_id, "待辦").await;

    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/columns/{column_id}/tasks"),
        Some(json!({ "title": "任務", "priority": "urgent" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("優先順序"));

    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/columns/{column_id}/tasks"),
        Some(json!({ "title": "任務", "due_date": "2026-02-30" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("截止日期"));

    let (status, body) = send(app, Method::GET, "/api/boards/not-found", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn rejects_moving_tasks_to_another_board() {
    let context = test_app();
    let app = &context.app;

    let board_id = create_board(app, "看板 A").await;
    let column_id = create_column(app, &board_id, "待辦").await;
    let task_id = create_task(app, &column_id, "任務").await;

    let other_board = create_board(app, "看板 B").await;
    let other_column = create_column(app, &other_board, "泳道").await;

    let (status, body) = send(
        app,
        Method::POST,
        &format!("/api/tasks/{task_id}/move"),
        Some(json!({ "column_id": other_column })),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("同一個看板"));
}

#[tokio::test]
async fn tasks_can_be_reordered_within_a_column_through_the_api() {
    let context = test_app();
    let app = &context.app;

    let board_id = create_board(app, "排序看板").await;
    let column_id = create_column(app, &board_id, "待辦").await;
    let a = create_task(app, &column_id, "A").await;
    let b = create_task(app, &column_id, "B").await;
    let c = create_task(app, &column_id, "C").await;

    let (status, _) = send(
        app,
        Method::POST,
        &format!("/api/tasks/{c}/move"),
        Some(json!({ "column_id": column_id, "position": 0 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, board) = send(app, Method::GET, &format!("/api/boards/{board_id}"), None).await;
    let tasks = board["columns"][0]["tasks"].as_array().unwrap();
    assert_eq!(tasks[0]["id"], c);
    assert_eq!(tasks[1]["id"], a);
    assert_eq!(tasks[2]["id"], b);

    let (status, _) = send(
        app,
        Method::POST,
        &format!("/api/tasks/{a}/move"),
        Some(json!({ "column_id": column_id, "position": 2 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, board) = send(app, Method::GET, &format!("/api/boards/{board_id}"), None).await;
    let tasks = board["columns"][0]["tasks"].as_array().unwrap();
    assert_eq!(tasks[0]["id"], c);
    assert_eq!(tasks[1]["id"], b);
    assert_eq!(tasks[2]["id"], a);
}
