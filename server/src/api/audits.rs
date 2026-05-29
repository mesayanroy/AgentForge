use axum::{extract::Path, routing::get, Json, Router};
use serde_json::json;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_audits))
        .route("/:id", get(get_audit))
        .route("/executions/:id/report", get(execution_report))
}

async fn list_audits() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "audit", "action": "list", "items": []}))
}

async fn get_audit(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "audit", "action": "get", "id": id}))
}

async fn execution_report(Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({"ok": true, "resource": "execution", "action": "report", "id": id}))
}
