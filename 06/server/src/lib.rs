pub mod api;
pub mod db;
pub mod error;
pub mod models;
pub mod validation;

use axum::Router;
use rusqlite::Connection;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    events: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(connection: Connection) -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            db: Arc::new(Mutex::new(connection)),
            events,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.events.subscribe()
    }

    pub fn broadcast(&self, event: serde_json::Value) {
        let _ = self.events.send(event.to_string());
    }
}

pub fn create_app(state: AppState, static_dir: impl Into<PathBuf>) -> Router {
    let static_dir = static_dir.into();
    let index_file = static_dir.join("index.html");
    let static_files = ServeDir::new(static_dir).not_found_service(ServeFile::new(index_file));

    Router::new()
        .nest("/api", api::router(state))
        .fallback_service(static_files)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
