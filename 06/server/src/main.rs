use std::{
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
};
use taskboard_server::{create_app, db, AppState};
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "taskboard_server=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let host = env::var("TASKBOARD_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse::<u16>()?;
    let db_path = database_path();
    let static_dir = static_dir();
    let seed = env::var("TASKBOARD_SEED")
        .map(|value| value != "0")
        .unwrap_or(true);

    if env::var("TASKBOARD_RESET_DB").as_deref() == Ok("1") {
        reset_database(&db_path);
    }

    let mut connection = db::open_database(&db_path)?;
    if seed {
        db::seed_demo_data(&mut connection)?;
    }

    let app = create_app(AppState::new(connection), &static_dir);
    let address: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = TcpListener::bind(address).await?;

    println!("Taskboard is running at http://{address}");
    println!("Serving frontend from {}", static_dir.display());
    println!("SQLite database: {}", db_path.display());

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn database_path() -> PathBuf {
    env::var_os("TASKBOARD_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/taskboard.db"))
}

fn static_dir() -> PathBuf {
    env::var_os("TASKBOARD_STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web"))
}

fn reset_database(path: &Path) {
    if path == Path::new(":memory:") {
        return;
    }
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!("無法註冊關閉訊號：{error}");
    }
}
