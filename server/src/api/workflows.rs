use axum::{extract::Path, routing::{get, post}, Json, Router};
use serde_json::json;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_workflow).get(list_workflows))
        .route("/:id/run", post(run_workflow))
        .route("/:id/status", get(workflow_status))
}

async fn create_workflow() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "workflow", "action": "create"}))
}

async fn list_workflows() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "workflow", "action": "list", "items": []}))
}

async fn run_workflow(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "workflow", "action": "run", "id": id}))
}

async fn workflow_status(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "workflow", "action": "status", "id": id, "state": "queued"}))
}
