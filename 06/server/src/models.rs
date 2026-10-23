use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardSummary {
    pub id: String,
    pub name: String,
    pub column_count: i64,
    pub task_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardDetail {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub columns: Vec<ColumnDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDetail {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub position: i64,
    pub created_at: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub description: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
    pub labels: Vec<String>,
}
